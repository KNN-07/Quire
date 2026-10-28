import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { basicToken, fixtureGit, gitBackend, seedRepository } from "./fixture-git";

const authorizationSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.literal("remote-git-gitlab-client"),
  redirect_uri: z.url(),
  scope: z.literal("api"),
  state: z.string().min(43),
  code_challenge_method: z.literal("S256"),
  code_challenge: z.string().length(43),
});

export async function gitlabFixture() {
  const root = await mkdtemp(join(tmpdir(), "quire-gitlab-fixture-"));
  await seedRepository(root, "owner/research",
    "\\documentclass{article}\n\\begin{document}GitLab initial\\end{document}\n");
  const codes = new Map<string, z.infer<typeof authorizationSchema>>();
  const tokens = new Set<string>();
  let server: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/oauth/authorize") {
        const authorization = authorizationSchema.safeParse(Object.fromEntries(url.searchParams));
        if (!authorization.success) return Response.json({ error: "invalid_request" }, { status: 400 });
        const code = randomBytes(24).toString("base64url");
        codes.set(code, authorization.data);
        const redirect = new URL(authorization.data.redirect_uri);
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("state", authorization.data.state);
        return Response.redirect(redirect, 303);
      }
      if (url.pathname === "/oauth/token") {
        const form = Object.fromEntries(new URLSearchParams(await request.text()));
        const authorization = codes.get(form["code"] ?? "");
        if (!authorization
          || form["client_id"] !== "remote-git-gitlab-client"
          || form["client_secret"] !== "remote-git-gitlab-secret"
          || createHash("sha256").update(form["code_verifier"] ?? "").digest("base64url")
            !== authorization.code_challenge) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        codes.delete(form["code"] ?? "");
        const token = randomBytes(32).toString("base64url");
        tokens.add(token);
        return Response.json({ access_token: token, token_type: "Bearer", scope: "api" });
      }
      if (url.pathname === "/oauth/revoke") {
        const form = Object.fromEntries(new URLSearchParams(await request.text()));
        if (form["client_id"] !== "remote-git-gitlab-client"
          || form["client_secret"] !== "remote-git-gitlab-secret") {
          return Response.json({ error: "invalid_client" }, { status: 401 });
        }
        tokens.delete(form["token"] ?? "");
        return new Response(null, { status: 200 });
      }
      const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      const gitToken = basicToken(request);
      if (url.pathname.endsWith(".git/info/refs")
        || url.pathname.endsWith(".git/git-upload-pack")
        || url.pathname.endsWith(".git/git-receive-pack")) {
        if (!gitToken || !tokens.has(gitToken)) {
          return new Response("authentication required", {
            status: 401, headers: { "www-authenticate": 'Basic realm="GitLab fixture"' },
          });
        }
        return gitBackend({ root, request, pathname: url.pathname });
      }
      if (!tokens.has(bearer)) return Response.json({ message: "401 Unauthorized" }, { status: 401 });
      if (url.pathname === "/api/v4/user") return Response.json({ id: 8, username: "fixture-user" });
      if (url.pathname === "/api/v4/projects" && request.method === "GET") {
        return Response.json([{
          id: 1, name: "research", path_with_namespace: "owner/research",
          default_branch: "main", http_url_to_repo: `${server.url.origin}/owner/research.git`,
          visibility: "private", last_activity_at: "2026-10-27T12:00:00.000Z",
        }]);
      }
      if (url.pathname === "/api/v4/projects" && request.method === "POST") {
        const body = z.object({ name: z.string(), visibility: z.string() }).parse(await request.json());
        const fullName = `fixture-user/${body.name}`;
        const bare = join(root, `${fullName}.git`);
        await mkdir(join(bare, ".."), { recursive: true });
        await fixtureGit({ args: ["init", "--bare", "--initial-branch=main", bare] });
        return Response.json({
          id: 2, name: body.name, path_with_namespace: fullName, default_branch: "main",
          http_url_to_repo: `${server.url.origin}/${fullName}.git`,
          visibility: body.visibility, last_activity_at: "2026-10-27T12:00:00.000Z",
        }, { status: 201 });
      }
      return new Response(null, { status: 404 });
    },
  });
  return {
    origin: server.url.origin,
    async [Symbol.asyncDispose]() {
      await server.stop(true);
      await rm(root, { recursive: true, force: true });
    },
  };
}
