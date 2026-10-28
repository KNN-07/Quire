import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { basicToken, fixtureGit, gitBackend, seedRepository } from "./fixture-git";

const authorizationSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.literal("remote-git-github-client"),
  redirect_uri: z.url(),
  scope: z.literal("repo read:user"),
  state: z.string().min(43),
  code_challenge_method: z.literal("S256"),
  code_challenge: z.string().length(43),
});
type Authorization = z.infer<typeof authorizationSchema>;

export async function githubFixture() {
  const root = await mkdtemp(join(tmpdir(), "quire-github-fixture-"));
  await seedRepository(root, "owner/research",
    "\\documentclass{article}\n\\begin{document}Remote initial\\end{document}\n");
  const research = join(root, "owner/research.git");
  const initial = new TextDecoder().decode(await fixtureGit({
    args: ["--git-dir", research, "rev-parse", "refs/heads/main"],
  })).trim();
  await fixtureGit({ args: ["--git-dir", research, "update-ref", "refs/heads/protected/release", initial] });
  await fixtureGit({ args: ["--git-dir", research, "update-ref", "refs/tags/v1.0.0", initial] });
  const codes = new Map<string, Authorization>();
  const tokens = new Set<string>();
  const repositories = new Map([
    ["owner/research", { id: 1, name: "research", fullName: "owner/research", repository: "owner/research" }],
  ]);
  let listCalls = 0;
  let server: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/login/oauth/authorize") {
        const authorization = authorizationSchema.safeParse(Object.fromEntries(url.searchParams));
        if (!authorization.success) return Response.json({ error: "invalid_request" }, { status: 400 });
        const code = randomBytes(24).toString("base64url");
        codes.set(code, authorization.data);
        const redirect = new URL(authorization.data.redirect_uri);
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("state", authorization.data.state);
        return Response.redirect(redirect, 303);
      }
      if (url.pathname === "/login/oauth/access_token") {
        const form = Object.fromEntries(new URLSearchParams(await request.text()));
        const authorization = codes.get(form["code"] ?? "");
        if (!authorization
          || form["client_id"] !== "remote-git-github-client"
          || form["client_secret"] !== "remote-git-github-secret"
          || createHash("sha256").update(form["code_verifier"] ?? "").digest("base64url")
            !== authorization.code_challenge) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        codes.delete(form["code"] ?? "");
        const token = randomBytes(32).toString("base64url");
        tokens.add(token);
        return Response.json({ access_token: token, token_type: "Bearer", scope: "repo read:user" });
      }
      const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      const gitToken = basicToken(request);
      if (url.pathname.endsWith(".git/info/refs")
        || url.pathname.endsWith(".git/git-upload-pack")
        || url.pathname.endsWith(".git/git-receive-pack")) {
        if (!gitToken || !tokens.has(gitToken)) {
          return new Response("authentication required", {
            status: 401, headers: { "www-authenticate": 'Basic realm="GitHub fixture"' },
          });
        }
        return gitBackend({ root, request, pathname: url.pathname });
      }
      if (url.pathname === "/api/v3/applications/remote-git-github-client/grant"
        && request.method === "DELETE") {
        const expected = `Basic ${Buffer.from(
          "remote-git-github-client:remote-git-github-secret",
        ).toString("base64")}`;
        if (request.headers.get("authorization") !== expected) {
          return Response.json({ message: "Bad credentials" }, { status: 401 });
        }
        const body = z.object({ access_token: z.string() }).parse(await request.json());
        tokens.delete(body.access_token);
        return new Response(null, { status: 204 });
      }
      if (!tokens.has(bearer)) return Response.json({ message: "Bad credentials" }, { status: 401 });
      if (url.pathname === "/api/v3/user") return Response.json({ id: 7, login: "fixture-user" });
      if (url.pathname === "/api/v3/user/repos" && request.method === "GET") {
        listCalls++;
        return Response.json([...repositories.values()].map((repository) => ({
          id: repository.id, name: repository.name, full_name: repository.fullName,
          default_branch: "main", clone_url: `${server.url.origin}/${repository.repository}.git`,
          private: true, updated_at: "2026-10-27T12:00:00.000Z",
        })));
      }
      if (url.pathname === "/api/v3/user/repos" && request.method === "POST") {
        const body = z.object({ name: z.string(), private: z.boolean() }).parse(await request.json());
        const fullName = `fixture-user/${body.name}`;
        if (repositories.has(fullName)) return Response.json({ message: "name already exists" }, { status: 422 });
        const bare = join(root, `${fullName}.git`);
        await mkdir(join(bare, ".."), { recursive: true });
        await fixtureGit({ args: ["init", "--bare", "--initial-branch=main", bare] });
        const repository = { id: repositories.size + 1, name: body.name, fullName, repository: fullName };
        repositories.set(fullName, repository);
        return Response.json({
          id: repository.id, name: repository.name, full_name: repository.fullName,
          default_branch: "main", clone_url: `${server.url.origin}/${repository.repository}.git`,
          private: body.private, updated_at: "2026-10-27T12:00:00.000Z",
        }, { status: 201 });
      }
      return new Response(null, { status: 404 });
    },
  });
  return {
    origin: server.url.origin,
    get listCalls() { return listCalls; },
    get tokens() { return [...tokens]; },
    async commit(repository: string, text: string, message: string) {
      const bare = join(root, `${repository}.git`);
      const work = await mkdtemp(join(tmpdir(), "quire-provider-commit-"));
      try {
        await fixtureGit({ args: ["clone", bare, work] });
        await fixtureGit({ cwd: work, args: ["config", "user.name", "Provider Fixture"] });
        await fixtureGit({ cwd: work, args: ["config", "user.email", "fixture@example.invalid"] });
        await writeFile(join(work, "main.tex"), text);
        await fixtureGit({ cwd: work, args: ["add", "main.tex"] });
        await fixtureGit({ cwd: work, args: ["commit", "-m", message] });
        await fixtureGit({ cwd: work, args: ["push", "origin", "main"] });
      } finally { await rm(work, { recursive: true, force: true }); }
    },
    async read(repository: string, path: string, branch = "main") {
      return new TextDecoder().decode(await fixtureGit({
        args: ["--git-dir", join(root, `${repository}.git`), "show", `${branch}:${path}`],
      }));
    },
    async branches(repository: string) {
      const output = new TextDecoder().decode(await fixtureGit({
        args: ["--git-dir", join(root, `${repository}.git`),
          "for-each-ref", "--format=%(refname)", "refs/heads/"],
      }));
      return output.trim().split("\n").filter(Boolean);
    },
    async [Symbol.asyncDispose]() {
      await server.stop(true);
      await rm(root, { recursive: true, force: true });
    },
  };
}
