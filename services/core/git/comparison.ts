import { IdSchema } from "@quire/contracts";
import type { BranchLease, GitOid, Id, Scope, Snapshot } from "@quire/contracts";
import { fail } from "../base/store";
import { patchedTree } from "./hunks";
import { stableId } from "./process";
import type { GitRepository } from "./repository";
import { hydrate, treeInputs } from "./trees";

async function snapshotForTree(
  repo: GitRepository,
  actorId: Id,
  input: { readonly scope: Scope; readonly tree: string },
): Promise<Snapshot> {
  const branch = `quire-compare-${stableId(input.tree)}`;
  const scope = { ...input.scope, branch };
  const existing = await repo.service.context.db.get<{ id: string }>(
    `SELECT id FROM snapshots WHERE project_id=? AND branch=? AND tree=?
     ORDER BY created_at DESC,id DESC LIMIT 1`,
    [scope.projectId, scope.branch, `sha1:${input.tree}`],
  );
  if (existing) return repo.service.getSnapshot(IdSchema.parse(existing.id));
  return repo.service.serialized(scope, async lease => {
    const replay = await repo.service.context.db.get<{ id: string }>(
      `SELECT id FROM snapshots WHERE project_id=? AND branch=? AND tree=?
       ORDER BY created_at DESC,id DESC LIMIT 1`,
      [scope.projectId, scope.branch, `sha1:${input.tree}`],
    );
    if (replay) return repo.service.getSnapshot(IdSchema.parse(replay.id));
    return hydrate(repo.service, {
      actorId, scope, lease,
      inputs: await treeInputs(repo.service, { scope, commit: input.tree }),
    });
  });
}

export async function createComparison(repo: GitRepository, actorId: Id, input: {
  readonly scope: Scope; readonly head: GitOid; readonly expectedVersion: number;
  readonly target: "working" | "staged";
}, lease: BranchLease) {
  const state = await repo.check(actorId, input, lease);
  const base = await snapshotForTree(repo, actorId, { scope: input.scope, tree: state.head });
  if (input.target === "working") return { kind: input.target, base, target: state.snapshot };
  const staged = state.hunks.filter(item => item.hunk.staged);
  if (!staged.length) fail("EMPTY_STAGE", 422, "Stage at least one hunk before comparing staged source");
  const tree = await patchedTree(repo.service, input.scope, { base: state.head, hunks: staged });
  const target = await snapshotForTree(repo, actorId, { scope: input.scope, tree });
  return { kind: input.target, base, target };
}
