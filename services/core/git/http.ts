import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdSchema, endpoints } from "@quire/contracts";
import type { Id, Scope } from "@quire/contracts";
import type { ModuleContext, RequestContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import { fail } from "../base/store";
import { tokenActor } from "./credentials";
import type { GitRepository } from "./repository";
import { run, zero, encode } from "./process";
import { treeInputs } from "./trees";
import type { RefChange } from "./journal";

async function refs(path: string) {
  const text = (await run({ path, args: ["for-each-ref", "--format=%(refname) %(objectname)"] })).text;
  return new Map(text.split("\n").filter(Boolean).map(row => {
    const [name, head] = row.split(" ");
    if (!name || !head) fail("INVALID_REF", 500, "Invalid ref listing");
    return [name, head];
  }));
}
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
async function withScopes<T>(repo: GitRepository, scopes: readonly Scope[], work: () => Promise<T>): Promise<T> {
  const [scope, ...rest] = scopes;
  return scope ? repo.service.serialized(scope, () => withScopes(repo, rest, work)) : work();
}
/** Build a physically separate object store containing only finalized named ancestry. */
async function publicRepository(repo: GitRepository, scope: Scope, path: string) {
  const named = new Map([...(await refs(repo.path(scope)))].filter(([name]) => name.startsWith("refs/heads/")));
  const scopes = [...named.keys()].sort().map(name => ({ ...scope, branch: name.slice("refs/heads/".length) }));
  return withScopes(repo, scopes, async () => {
    if (repo.service.context.db.query("SELECT 1 FROM core_git_intents WHERE payload_json LIKE ?")
      .get(`%${scope.projectId}%`)) fail("GIT_RECOVERY_PENDING", 503, "Repository intent must finalize before serving");
    const finalized = new Map([...(await refs(repo.path(scope)))].filter(([name]) => named.has(name)));
    await run({ path, args: ["init", "--bare", `--initial-branch=${scope.branch}`, path] });
    if (finalized.size) {
      await run({ path, args: ["fetch", "--no-tags", "--no-write-fetch-head", repo.path(scope), ...finalized.values()] });
      await run({ path, args: ["update-ref", "--stdin"],
        input: encode([...finalized].map(([name, head]) => `create ${name} ${head}\n`).join("")) });
    }
    return finalized;
  });
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
    const proposed = await refs(path);
    const changes: RefChange[] = [];
    for (const name of new Set([...original.keys(), ...proposed.keys()])) {
      const before = original.get(name) ?? zero;
      const after = proposed.get(name) ?? zero;
      if (before === after) continue;
      if (!name.startsWith("refs/heads/")) fail("GIT_REF_FORBIDDEN", 403, "Only named branches may be pushed");
      const branch = name.slice("refs/heads/".length);
      if (after === zero && branch === input.scope.branch) fail("DEFAULT_BRANCH", 409, "Cannot delete default branch");
      if (after !== zero) {
        await run({ path, args: ["cat-file", "-e", `${after}^{commit}`] });
        await treeInputs(repo.service, { scope: { ...input.scope, branch }, path, commit: after });
      }
      changes.push({ scope: { ...input.scope, branch }, before, after, hydrate: after !== zero });
    }
    if (!changes.length) return response;
    await run({ path, args: ["fsck", "--strict", "--no-reflogs"] });
    return await withScopes(repo, changes.map(change => change.scope).sort((a, b) => a.branch.localeCompare(b.branch)), async () => {
      tokenActor(repo.service.context, input.request);
      for (const change of changes) {
        const exists = repo.service.context.db.query("SELECT 1 FROM branch_workspaces WHERE project_id=? AND branch=?")
          .get(change.scope.projectId, change.scope.branch);
        await repo.service.authorize(actorId, exists ? change.scope : input.scope, "git.push");
        if (exists) {
          const state = await repo.inspect(actorId, change.scope);
          if (state.hunks.length) fail("DIRTY_BROWSER", 409, "Browser has uncommitted edits; push a separate branch");
          if (state.head !== change.before) fail("STALE_HEAD", 409, "Branch moved during push");
        }
        if (change.after !== zero) await run({ path: repo.path(input.scope),
          args: ["fetch", "--no-tags", "--no-write-fetch-head", path, change.after] });
      }
      tokenActor(repo.service.context, input.request);
      await repo.service.authorize(actorId, input.scope, "git.push");
      await repo.journal.publish(actorId, changes);
      return response;
    });
  } finally { await rm(root, { recursive: true, force: true }); }
}
export function registerHttp(context: ModuleContext, repo: GitRepository) {
  const handle = async ({ request }: RequestContext) => {
    try {
      const url = new URL(request.url);
      const match = /^\/git\/([^/]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(url.pathname);
      if (!match) fail("NOT_FOUND", 404, "Unknown Git service");
      const projectId = IdSchema.parse(match[1]);
      const actorId = tokenActor(context, request);
      const project = repo.service.getProject(projectId);
      const scope = { projectId, branch: project.defaultBranch };
      const receive = match[2] === "git-receive-pack" || url.searchParams.get("service") === "git-receive-pack";
      if (request.method === "GET" && (match[2] !== "info/refs"
        || !["git-upload-pack", "git-receive-pack"].includes(url.searchParams.get("service") ?? ""))) fail("NOT_FOUND", 404, "Unknown Git service");
      if (request.method === "POST" && match[2] === "info/refs") fail("NOT_FOUND", 404, "Unknown Git service");
      await repo.service.authorize(actorId, scope, receive ? "git.push" : "git.read");
      await repo.service.serialized(scope, () => repo.head(actorId, scope));
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
