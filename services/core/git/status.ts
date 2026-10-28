import type { GitOid, Scope } from "@quire/contracts";
import type { GitRepository } from "./repository";
import { objects, oid } from "./process";
import { compareHeads } from "./ancestry";

export type BranchRelation = {
  readonly upstream: string | null;
  readonly base: GitOid;
  readonly ahead: number;
  readonly behind: number;
};

/** Compare topic branches to the project's live default branch, never copied counters. */
export async function branchRelation(
  repo: GitRepository,
  scope: Scope,
  head: string,
): Promise<BranchRelation> {
  const project = await repo.service.getProject(scope.projectId);
  if (scope.branch === project.defaultBranch) {
    return { upstream: null, base: oid(head), ahead: 0, behind: 0 };
  }
  const upstream = (await objects(repo.service, scope, [
    "rev-parse", "--verify", `refs/heads/${project.defaultBranch}^{commit}`,
  ])).text;
  const relation = await compareHeads(repo, { scope, head, upstream });
  return {
    upstream: project.defaultBranch,
    base: oid(relation.base),
    ahead: relation.ahead,
    behind: relation.behind,
  };
}
