import { OperationSchema } from "@quire/contracts";
import type { Id, Scope, GitOid } from "@quire/contracts";
import { fail, newId } from "../base/store";
import type { GitRepository } from "./repository";
import { patchedTree } from "./hunks";
import { hydrate, treeInputs } from "./trees";
import { raw, run, zero, branchName } from "./process";
import { compileStaged } from "./compile";
import type { GitReceipt } from "./journal";

export type Mutation = { readonly scope: Scope; readonly head: GitOid; readonly expectedVersion: number };
export async function stage(repo: GitRepository, actorId: Id, input: Mutation & {
  readonly hunkIds: readonly Id[]; readonly staged: boolean;
}) {
  const state = await repo.check(actorId, input);
  const selected = new Set(state.status.staged);
  for (const id of input.hunkIds) {
    const hunk = state.hunks.find(item => item.hunk.id === id);
    if (!hunk) fail("STALE_HUNK", 409, "Hunk no longer matches source");
    if (input.staged) {
      for (const saved of state.hunks) {
        if (saved.hunk.path === hunk.hunk.path
          && saved.hunk.oldStart <= hunk.hunk.oldStart + hunk.hunk.oldLines
          && hunk.hunk.oldStart <= saved.hunk.oldStart + saved.hunk.oldLines) selected.delete(saved.hunk.id);
      }
      selected.add(id);
    } else selected.delete(id);
  }
  repo.service.context.db.query(`INSERT INTO core_git_staging(project_id,branch,user_id,head,revision,hunks_json)
    VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,branch,user_id)
    DO UPDATE SET head=excluded.head,revision=excluded.revision,hunks_json=excluded.hunks_json`)
    .run(input.scope.projectId, input.scope.branch, actorId, state.head,
      input.expectedVersion, JSON.stringify(state.hunks.filter(item => selected.has(item.hunk.id))));
  return (await repo.inspect(actorId, input.scope)).status;
}
export async function discard(repo: GitRepository, actorId: Id, input: Mutation & { readonly hunkIds: readonly Id[] }) {
  const state = await repo.check(actorId, input);
  const selected = state.hunks.filter(item => input.hunkIds.includes(item.hunk.id));
  if (selected.length !== new Set(input.hunkIds).size) fail("STALE_HUNK", 409, "Hunk no longer matches source");
  const tree = await patchedTree(repo.path(input.scope), { base: raw(state.snapshot.tree), hunks: selected, reverse: true });
  await hydrate(repo.service, { actorId, scope: input.scope,
    inputs: await treeInputs(repo.service, { scope: input.scope, path: repo.path(input.scope), commit: tree }) });
  repo.service.context.db.query("UPDATE core_git_staging SET revision=?,hunks_json=? WHERE project_id=? AND branch=? AND user_id=?")
    .run(repo.service.getBranch(input.scope).revision,
      JSON.stringify(state.hunks.filter(item => item.hunk.staged && !input.hunkIds.includes(item.hunk.id))),
      input.scope.projectId, input.scope.branch, actorId);
  return (await repo.inspect(actorId, input.scope)).status;
}
function receipt(input: {
  readonly key: string; readonly kind: string; readonly result: Readonly<Record<string, unknown>>;
  readonly digest: string;
}): GitReceipt {
  return { key: input.key, digest: input.digest, operation: OperationSchema.parse({
    id: newId(), kind: input.kind, status: "succeeded", progress: 1, result: input.result, errorCode: null,
  }) };
}
function previous(repo: GitRepository, actorId: Id, input: { readonly key: string; readonly digest: string }) {
  const row = repo.service.context.db.query<{ digest: string; operation_json: string }, [string, string]>(
    "SELECT digest,operation_json FROM core_git_receipts WHERE actor_id=? AND key=?").get(actorId, input.key);
  if (!row) return null;
  if (row.digest !== input.digest) fail("IDEMPOTENCY_CONFLICT", 409, "Key was used for a different Git mutation");
  return OperationSchema.parse(JSON.parse(row.operation_json));
}
export async function commit(repo: GitRepository, actorId: Id, input: Mutation & {
  readonly message: string; readonly compileFirst: boolean; readonly key: string;
}) {
  if (!input.message.trim()) fail("EMPTY_MESSAGE", 422, "Commit message is required");
  const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex");
  await repo.service.authorize(actorId, input.scope, "git.commit");
  const cached = previous(repo, actorId, { key: input.key, digest });
  if (cached) return cached;
  const candidate = input.compileFirst ? await repo.service.serialized(input.scope, async () => {
    const state = await repo.check(actorId, input);
    return patchedTree(repo.path(input.scope), { base: state.head, hunks: state.hunks.filter(item => item.hunk.staged) });
  }) : null;
  const compiled = candidate ? await compileStaged(repo, actorId, { scope: input.scope, tree: candidate, key: input.key }) : null;
  return repo.service.serialized(input.scope, async () => {
    const state = await repo.check(actorId, input);
    const selected = state.hunks.filter(item => item.hunk.staged);
    const tree = await patchedTree(repo.path(input.scope), { base: state.head, hunks: selected });
    if (compiled && raw(compiled.snapshot.tree) !== tree) fail("COMPILE_TREE_MISMATCH", 409, "Compile gate must cover the exact staged tree");
    const after = await repo.commitTree(actorId, { scope: input.scope, tree, parents: [state.head], message: input.message });
    await repo.service.authorize(actorId, input.scope, "git.commit");
    const result = receipt({ key: input.key, digest, kind: "git-commit", result: { head: `sha1:${after}` } });
    await repo.journal.publish(actorId, [{ scope: input.scope, before: state.head, after, hydrate: false }], result);
    return result.operation;
  });
}
export async function merge(repo: GitRepository, actorId: Id, input: Mutation & { readonly from: string; readonly key: string }) {
  const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex");
  await repo.service.authorize(actorId, input.scope, "git.merge");
  const cached = previous(repo, actorId, { key: input.key, digest });
  if (cached) return cached;
  const state = await repo.check(actorId, input);
  if (state.hunks.length) fail("DIRTY_BROWSER", 409, "Commit or discard browser changes before merging");
  await branchName(repo.path(input.scope), input.from);
  const from = (await run({ path: repo.path(input.scope), args: ["rev-parse", "--verify", `refs/heads/${input.from}^{commit}`] })).text;
  const merged = await run({ path: repo.path(input.scope),
    args: ["merge-tree", "--write-tree", state.head, from], allowed: [0, 1] });
  if (merged.code !== 0) fail("MERGE_CONFLICT", 409, "Branches conflict; merge in a local checkout");
  const tree = merged.text.split("\n")[0];
  if (!tree) fail("MERGE_FAILED", 409, "Merge produced no tree");
  await treeInputs(repo.service, { scope: input.scope, path: repo.path(input.scope), commit: tree });
  const after = await repo.commitTree(actorId, { scope: input.scope, tree,
    parents: [state.head, from], message: `Merge ${input.from}` });
  const result = receipt({ key: input.key, digest, kind: "git-merge", result: { head: `sha1:${after}` } });
  await repo.journal.publish(actorId, [{ scope: input.scope, before: state.head, after, hydrate: true }], result);
  return result.operation;
}
export async function createBranch(repo: GitRepository, actorId: Id, input: {
  readonly projectId: Id; readonly name: string; readonly from: string; readonly expectedVersion: number;
}) {
  const scope = { projectId: input.projectId, branch: input.from };
  await branchName(repo.path(scope), input.name);
  await branchName(repo.path(scope), input.from);
  await repo.service.authorize(actorId, scope, "git.branch");
  const state = await repo.inspect(actorId, scope);
  if (repo.service.getBranch(scope).revision !== input.expectedVersion) fail("STALE_VERSION", 409, "Source changed");
  const next = { ...scope, branch: input.name };
  await treeInputs(repo.service, { scope: next, path: repo.path(scope), commit: state.head });
  const existing = await run({ path: repo.path(scope), args: ["show-ref", "--verify", "--quiet", `refs/heads/${input.name}`], allowed: [0, 1] });
  if (existing.code === 0) fail("BRANCH_EXISTS", 409, "Branch already exists");
  await repo.journal.publish(actorId, [{ scope: next, before: zero, after: state.head, hydrate: true }]);
  return (await repo.inspect(actorId, next)).status;
}
