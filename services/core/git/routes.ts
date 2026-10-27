import { endpoints, resourceVersionTag, InstantSchema } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { actor, etag, replay, checkMatch } from "../base/http";
import { compare, fail } from "../base/store";
import type { GitRepository } from "./repository";
import { stage, discard, commit, merge, createBranch } from "./actions";
import { run, oid, branchName, zero } from "./process";

export function registerRepositoryRoutes(context: ModuleContext, repo: GitRepository) {
  context.routes.register(endpoints.gitStatus, async (input, request) => {
    const actorId = await actor(context, request);
    const scope = { projectId: input.params.p, branch: input.query.branch };
    return repo.service.serialized(scope, async () => {
      const state = await repo.inspect(actorId, scope);
      etag(request, repo.service.getBranch(scope).revision);
      return state.status;
    });
  });
  context.routes.register(endpoints.gitLog, async (input, request) => {
    const actorId = await actor(context, request);
    const scope = { projectId: input.params.p, branch: input.query.branch };
    return repo.service.serialized(scope, async () => {
      await repo.service.authorize(actorId, scope, "git.read");
      const head = await repo.head(actorId, scope);
      const text = (await run({ path: repo.path(scope), args: ["log",
        "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%B%x00%x1e", head] })).text;
      const items = text.split("\x1e").filter(row => row.trim()).map(row => {
        const [hash, parents, author, email, at, message] = row.trimStart().split("\0");
        const user = context.db.query<{ id: string }, [string]>("SELECT id FROM users WHERE primary_email=?").get(email ?? "");
        return { oid: oid(hash ?? ""), parents: (parents ?? "").split(" ").filter(Boolean).map(oid),
          authorId: user?.id ?? null, author: author ?? "", at: InstantSchema.parse(at), message: message?.trimEnd() ?? "" };
      });
      const start = input.query.cursor ? items.findIndex(item => item.oid === input.query.cursor) + 1 : 0;
      if (input.query.cursor && start === 0) fail("INVALID_CURSOR", 400, "Log cursor does not belong to this branch");
      const page = items.slice(start, start + input.query.limit);
      return { items: page, nextCursor: start + page.length < items.length ? page.at(-1)?.oid ?? null : null };
    });
  });
  context.routes.register(endpoints.gitBranches, async (input, request) => {
    const actorId = await actor(context, request);
    const scope = { projectId: input.params.p, branch: input.query.branch };
    return repo.service.serialized(scope, async () => {
      await repo.service.authorize(actorId, scope, "git.read");
      await repo.head(actorId, scope);
      const refs = (await run({ path: repo.path(scope), args: ["for-each-ref",
        "--format=%(refname:strip=2) %(objectname)", "refs/heads/"] })).text;
      return refs.split("\n").filter(Boolean).map(row => {
        const [name, hash] = row.split(" ");
        return { name: name ?? "", head: oid(hash ?? ""), current: name === scope.branch };
      });
    });
  });
  context.routes.register(endpoints.gitStage, async (input, request) => {
    const actorId = await actor(context, request);
    if (input.body.scope.projectId !== input.params.p) fail("SCOPE_MISMATCH", 400, "Scope differs from URL");
    checkMatch(request, input.body.expectedVersion);
    return repo.service.serialized(input.body.scope, async () => {
      const result = await stage(repo, actorId, input.body);
      etag(request, input.body.expectedVersion);
      return result;
    });
  });
  context.routes.register(endpoints.gitDiscard, async (input, request) => {
    const actorId = await actor(context, request);
    if (input.body.scope.projectId !== input.params.p) fail("SCOPE_MISMATCH", 400, "Scope differs from URL");
    return repo.service.serialized(input.body.scope, async () => {
      const result = await discard(repo, actorId, input.body);
      etag(request, repo.service.getBranch(input.body.scope).revision);
      return result;
    });
  });
  context.routes.register(endpoints.gitCommit, async (input, request) => {
    const actorId = await actor(context, request);
    if (input.body.scope.projectId !== input.params.p) fail("SCOPE_MISMATCH", 400, "Scope differs from URL");
    return replay(context, { actorId, request, route: "gitCommit", body: input, schema: endpoints.gitCommit.output },
      () => commit(repo, actorId, { ...input.body, key: request.request.headers.get("idempotency-key") ?? "" }));
  });
  context.routes.register(endpoints.gitMerge, async (input, request) => {
    const actorId = await actor(context, request);
    if (input.body.scope.projectId !== input.params.p) fail("SCOPE_MISMATCH", 400, "Scope differs from URL");
    return replay(context, { actorId, request, route: "gitMerge", body: input, schema: endpoints.gitMerge.output },
      () => repo.service.serialized(input.body.scope, () => merge(repo, actorId,
        { ...input.body, key: request.request.headers.get("idempotency-key") ?? "" })));
  });
  context.routes.register(endpoints.gitBranchCreate, async (input, request) => {
    const actorId = await actor(context, request);
    const scope = { projectId: input.params.p, branch: input.body.from };
    return replay(context, { actorId, request, route: "gitBranchCreate", body: input, schema: endpoints.gitBranchCreate.output },
      () => repo.service.serialized(scope, async () => {
        const status = await createBranch(repo, actorId, { projectId: input.params.p, ...input.body });
        request.responseHeaders.set("etag", resourceVersionTag(repo.service.getBranch({ ...scope, branch: input.body.name }).revision));
        return status;
      }));
  });
  context.routes.register(endpoints.gitBranchDelete, async (input, request) => {
    const actorId = await actor(context, request);
    const scope = { projectId: input.params.p, branch: input.params.name };
    if (input.body.scope.projectId !== scope.projectId || input.body.scope.branch !== scope.branch) fail("SCOPE_MISMATCH", 400, "Scope differs from URL");
    return repo.service.serialized(scope, async () => {
      await repo.service.authorize(actorId, scope, "git.branch");
      await branchName(repo.path(scope), scope.branch);
      compare(repo.service.getBranch(scope).revision, input.body.expectedVersion);
      if (repo.service.getProject(scope.projectId).defaultBranch === scope.branch) fail("DEFAULT_BRANCH", 409, "Cannot delete default branch");
      const state = await repo.inspect(actorId, scope);
      if (state.hunks.length) fail("DIRTY_BROWSER", 409, "Branch has browser edits");
      await repo.journal.publish(actorId, [{ scope, before: state.head, after: zero, hydrate: false }]);
      return { ok: true, version: input.body.expectedVersion + 1 };
    });
  });
}
