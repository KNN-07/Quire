import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdSchema, endpoints } from "@quire/contracts";
import type { Id, Scope } from "@quire/contracts";
import type { ModuleContext, RequestContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import { fail } from "../base/store";
import { tokenActor, tokenDigest } from "./credentials";
import type { GitRepository } from "./repository";
import { run } from "./process";
import { publicRepository, publishPush } from "./transport";
async function backend(input: { readonly path: string; readonly projectId: Id; readonly request: Request; readonly actorId: Id }) {
  const url = new URL(input.request.url);
  const suffix = url.pathname.slice(`/git/${input.projectId}.git/`.length);
  const bytes = input.request.method === "POST" ? new Uint8Array(await input.request.arrayBuffer()) : undefined;
  if (bytes && bytes.length > 50 * 1024 * 1024) fail("GIT_REQUEST_LIMIT", 413, "Git request exceeds 50 MiB");
  const result = await run({ path: input.path, args: ["-c", "http.receivepack=true",
    "-c", "transfer.hideRefs=refs/quire/", "-c", "receive.hideRefs=refs/quire/",
    "-c", "uploadpack.allowAnySHA1InWant=false", "-c", "uploadpack.allowReachableSHA1InWant=false",
    "-c", "receive.fsckObjects=true", "-c", "uploadpack.allowFilter=false", "http-backend"],
    ...(bytes ? { input: bytes } : {}),
    env: { GIT_PROJECT_ROOT: join(input.path, ".."), GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: `/${input.projectId}.git/${suffix}`, REQUEST_METHOD: input.request.method,
      QUERY_STRING: url.search.slice(1), REMOTE_USER: input.actorId,
      CONTENT_TYPE: input.request.headers.get("content-type") ?? "", CONTENT_LENGTH: String(bytes?.length ?? 0),
      HTTP_GIT_PROTOCOL: input.request.headers.get("git-protocol") ?? "" } });
  const marker = result.bytes.indexOf(13);
  const headerEnd = new TextDecoder().decode(result.bytes).indexOf("\r\n\r\n");
  if (marker < 0 || headerEnd < 0) fail("GIT_BACKEND_FAILED", 502, "Malformed Git CGI response");
  // CGI headers are ASCII; byte offset equals character offset before the binary body.
  const headers = new Headers({ "cache-control": "no-store" });
  let status = 200;
  for (const line of new TextDecoder().decode(result.bytes.slice(0, headerEnd)).split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon);
    const value = line.slice(colon + 1).trim();
    if (name.toLowerCase() === "status") status = Number(value.split(" ")[0]);
    else headers.append(name, value);
  }
  return new Response(result.bytes.slice(headerEnd + 4), { status, headers });
}
async function serve(repo: GitRepository, actorId: Id, input: { readonly scope: Scope; readonly request: Request }) {
  const root = await mkdtemp(join(tmpdir(), "quire-git-public-"));
  const path = join(root, `${input.scope.projectId}.git`);
  try {
    await publicRepository(repo, input.scope, path);
    return await backend({ path, projectId: input.scope.projectId, request: input.request, actorId });
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function push(repo: GitRepository, actorId: Id, input: { readonly scope: Scope; readonly request: Request }) {
  const root = await mkdtemp(join(tmpdir(), "quire-git-quarantine-"));
  const path = join(root, `${input.scope.projectId}.git`);
  try {
    const original = await publicRepository(repo, input.scope, path);
    const response = await backend({ path, projectId: input.scope.projectId, request: input.request, actorId });
    if (!response.ok) return response;
    await publishPush(repo, actorId, {
      scope: input.scope,
      path,
      original,
      currentActor: () => tokenActor(repo.service.context, input.request),
      authorization: { tokenHash: tokenDigest(input.request) },
    });
    return response;
  } finally { await rm(root, { recursive: true, force: true }); }
}
export function registerHttp(context: ModuleContext, repo: GitRepository) {
  const handle = async ({ request }: RequestContext) => {
    try {
      const url = new URL(request.url);
      const match = /^\/git\/([^/]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(url.pathname);
      if (!match) fail("NOT_FOUND", 404, "Unknown Git service");
      const projectId = IdSchema.parse(match[1]);
      const actorId = await tokenActor(context, request);
      const project = await repo.service.getProject(projectId);
      const scope = { projectId, branch: project.defaultBranch };
      const receive = match[2] === "git-receive-pack" || url.searchParams.get("service") === "git-receive-pack";
      if (request.method === "GET" && (match[2] !== "info/refs"
        || !["git-upload-pack", "git-receive-pack"].includes(url.searchParams.get("service") ?? ""))) fail("NOT_FOUND", 404, "Unknown Git service");
      if (request.method === "POST" && match[2] === "info/refs") fail("NOT_FOUND", 404, "Unknown Git service");
      await repo.service.authorize(actorId, scope, receive ? "git.push" : "git.read");
      await repo.service.serialized(scope, lease => repo.head(actorId, scope, lease));
      return receive && request.method === "POST" ? push(repo, actorId, { scope, request })
        : serve(repo, actorId, { scope, request });
    } catch (error) {
      if (error instanceof ServiceError && error.status === 401) return new Response(error.message, {
        status: 401, headers: { "www-authenticate": 'Basic realm="Quire Git"', "cache-control": "no-store" },
      });
      throw error;
    }
  };
  context.routes.registerTransport(endpoints.gitHttpGet, handle);
  context.routes.registerTransport(endpoints.gitHttpPost, handle);
}
