import { OperationSchema } from "@quire/contracts";
import type { Id, Scope, GitOid, BranchLease } from "@quire/contracts";
import { fail, newId } from "../base/store";
import type { GitRepository } from "./repository";
import { patchedTree } from "./hunks";
import { hydrate, treeInputs } from "./trees";
import { raw, objects, zero, branchName } from "./process";
import { compileStaged } from "./compile";
import type { GitReceipt } from "./journal";
import { store as identityStore } from "../../accounts/identity/store";

export type Mutation = { readonly scope: Scope; readonly head: GitOid; readonly expectedVersion: number };
export async function stage(repo: GitRepository, actorId: Id, input: Mutation & {
  readonly hunkIds: readonly Id[]; readonly staged: boolean;
}, lease: BranchLease) {
  const state = await repo.check(actorId, input, lease);
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
  const { context } = repo.service;
  await context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await context.branches.assert(tx, lease);
    await repo.service.withTransaction(tx).authorize(actorId, input.scope, "git.stage");
    await tx.run(`INSERT INTO core_git_staging(project_id,branch,user_id,head,revision,hunks_json)
      VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,branch,user_id)
      DO UPDATE SET head=excluded.head,revision=excluded.revision,hunks_json=excluded.hunks_json`,
    [input.scope.projectId, input.scope.branch, actorId, state.head,
      input.expectedVersion, JSON.stringify(state.hunks.filter(item => selected.has(item.hunk.id)))]);
  });
  return (await repo.inspect(actorId, input.scope, lease)).status;
}
export async function discard(repo: GitRepository, actorId: Id, input: Mutation & { readonly hunkIds: readonly Id[] }, lease: BranchLease) {
  const state = await repo.check(actorId, input, lease);
  const selected = state.hunks.filter(item => input.hunkIds.includes(item.hunk.id));
  if (selected.length !== new Set(input.hunkIds).size) fail("STALE_HUNK", 409, "Hunk no longer matches source");
  const tree = await patchedTree(repo.service, input.scope, { base: raw(state.snapshot.tree), hunks: selected, reverse: true });
  await hydrate(repo.service, { actorId, scope: input.scope, lease,
    inputs: await treeInputs(repo.service, { scope: input.scope, commit: tree }) });
  await repo.service.context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await repo.service.context.branches.assert(tx, lease);
    await repo.service.withTransaction(tx).authorize(actorId, input.scope, "git.discard");
    await tx.run("UPDATE core_git_staging SET revision=?,hunks_json=? WHERE project_id=? AND branch=? AND user_id=?",
    [(await repo.service.withTransaction(tx).getBranch(input.scope)).revision,
      JSON.stringify(state.hunks.filter(item => item.hunk.staged && !input.hunkIds.includes(item.hunk.id))),
      input.scope.projectId, input.scope.branch, actorId]);
  });
  return (await repo.inspect(actorId, input.scope, lease)).status;
}
export function gitReceipt(input: {
  readonly key: string; readonly kind: string; readonly result: Readonly<Record<string, unknown>>;
  readonly digest: string;
}): GitReceipt {
  return { key: input.key, digest: input.digest, operation: OperationSchema.parse({
    id: newId(), kind: input.kind, status: "succeeded", progress: 1, result: input.result, errorCode: null,
  }) };
}
export async function previousReceipt(
  repo: GitRepository,
  actorId: Id,
  input: { readonly key: string; readonly digest: string },
) {
  const row = await repo.service.context.db.get<{ digest: string; operation_json: string }>(
    "SELECT digest,operation_json FROM core_git_receipts WHERE actor_id=? AND key=?", [actorId, input.key]);
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
  const cached = await previousReceipt(repo, actorId, { key: input.key, digest });
  if (cached) return cached;
  // Sample this user preference at admission, not on replay or internal checkpoints.
  const preferences = await identityStore(repo.service.context).preferences(actorId);
  const candidate = (input.compileFirst || preferences.compileBeforeCommit) ? await repo.service.serialized(input.scope, async lease => {
    const state = await repo.check(actorId, input, lease);
    return patchedTree(repo.service, input.scope, { base: state.head, hunks: state.hunks.filter(item => item.hunk.staged) });
  }) : null;
  const compiled = candidate ? await compileStaged(repo, actorId, { scope: input.scope, tree: candidate, key: input.key }) : null;
  return repo.service.serialized(input.scope, async lease => {
    const replayed = await previousReceipt(repo, actorId, { key: input.key, digest });
    if (replayed) return replayed;
    const state = await repo.check(actorId, input, lease);
    const selected = state.hunks.filter(item => item.hunk.staged);
    const tree = await patchedTree(repo.service, input.scope, { base: state.head, hunks: selected });
    if (compiled && raw(compiled.snapshot.tree) !== tree) fail("COMPILE_TREE_MISMATCH", 409, "Compile gate must cover the exact staged tree");
    const after = await repo.commitTree(actorId, { scope: input.scope, tree, parents: [state.head], message: input.message });
    await repo.service.authorize(actorId, input.scope, "git.commit");
    const result = gitReceipt({ key: input.key, digest, kind: "git-commit", result: { head: `sha1:${after}` } });
    await repo.journal.publish(actorId, [{ scope: input.scope, before: state.head, after, hydrate: false }], [lease], result);
    return result.operation;
  });
}
export async function createBranch(repo: GitRepository, actorId: Id, input: {
  readonly projectId: Id; readonly name: string; readonly from: string; readonly expectedVersion: number;
}, lease: BranchLease) {
  const scope = { projectId: input.projectId, branch: input.from };
  await branchName(input.name);
  await branchName(input.from);
  await repo.service.authorize(actorId, scope, "git.branch");
  const state = await repo.inspect(actorId, scope, lease);
  if ((await repo.service.getBranch(scope)).revision !== input.expectedVersion) fail("STALE_VERSION", 409, "Source changed");
  const next = { ...scope, branch: input.name };
  await treeInputs(repo.service, { scope: next, commit: state.head });
  const existing = await objects(repo.service, scope, ["for-each-ref", "--format=%(refname)", "refs/heads/"]);
  if (existing.text.split("\n").includes(`refs/heads/${input.name}`)) fail("BRANCH_EXISTS", 409, "Branch already exists");
  return repo.service.serialized(next, async nextLease => {
    await repo.journal.publish(actorId, [{ scope: next, before: zero, after: state.head, hydrate: true }], [nextLease]);
    return (await repo.inspect(actorId, next, nextLease)).status;
  });
}
