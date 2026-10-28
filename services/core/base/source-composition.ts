import { z } from "zod";
import { GitOidSchema, IdSchema } from "@quire/contracts";
import type { BranchLease, Id, Project, Scope, Snapshot, Transaction } from "@quire/contracts";
import type { ModuleContext, PendingEvent } from "@quire/runtime";
import { AccessStore } from "./access";
import { applySourceRecords, validateSource } from "./source-records";
import type { SourceInput, SourceIntent } from "./source-records";
import type { HttpSourceReceipt } from "./receipts";
import type { SourceFinalization } from "./source-finalization";
import { fail } from "./store";

export type SourceCommitInput = {
  readonly actorId: Id; readonly scope: Scope; readonly lease: BranchLease; readonly expectedRevision: number;
  readonly inputs: readonly SourceInput[]; readonly reason?: Snapshot["reason"]; readonly advance?: boolean;
  readonly receipt?: SourceIntent["receipt"]; readonly http?: HttpSourceReceipt;
  readonly finalization?: SourceFinalization;
  readonly creation?: { readonly project: Project; readonly branchId: Id };
};
export type SourcePreparation = SourceCommitInput & { readonly newBranchId?: Id };
export type PreparedSources = {
  readonly publication: { readonly id: Id; readonly lease: BranchLease };
  readonly sources: readonly { readonly source: SourceIntent; readonly lease: BranchLease }[];
};

/** One existing publication, one caller-owned SQL transaction, deferred events. */
export async function finalizePreparedSources(context: ModuleContext, tx: Transaction,
  input: PreparedSources): Promise<readonly PendingEvent[]> {
  await tx.lock("quire:accounts");
  const transaction = { ...context, db: tx };
  const service = new AccessStore(transaction);
  const published = z.object({ project_id: IdSchema, updates_json: z.string() }).parse(
    await tx.get("SELECT project_id,updates_json FROM repository_intents WHERE id=?", [input.publication.id]));
  const updates = z.array(z.object({ ref: z.string(), next: GitOidSchema.nullable() })).parse(JSON.parse(published.updates_json));
  const scopes = new Set<string>();
  for (const { source, lease } of input.sources) {
    const scope = source.snapshot.scope;
    const key = `${scope.projectId}:${scope.branch}`;
    if (scopes.has(key)) fail("DUPLICATE_SOURCE_SCOPE", 409, "Only one prepared source per branch may be finalized");
    scopes.add(key);
    if (published.project_id !== scope.projectId || !updates.some(update =>
      update.ref === `refs/quire/history/${source.snapshot.id}` && update.next === `sha1:${source.commit}`)) {
      fail("SOURCE_PUBLICATION_MISMATCH", 409, "The publication must contain every prepared source checkpoint");
    }
    await context.branches.assert(tx, lease);
    if (source.createBranch) {
      const project = await service.getProject(scope.projectId);
      await service.authorize(source.snapshot.authorId, { ...scope, branch: project.defaultBranch }, "write");
      if (await tx.get("SELECT 1 FROM branch_workspaces WHERE project_id=? AND branch=?", [scope.projectId, scope.branch])) {
        fail("BRANCH_EXISTS", 409, "The prepared new branch already exists");
      }
      await tx.run("INSERT INTO branch_workspaces(id,project_id,branch,created_at,updated_at) VALUES(?,?,?,?,?)",
        [source.branchId, scope.projectId, scope.branch, source.snapshot.createdAt, source.snapshot.createdAt]);
    }
  }
  // Validate the whole batch before any project version is advanced by its own source writes.
  for (const { source, lease } of input.sources) await validateSource(transaction, source, lease);
  await context.repositories.finalize(tx, input.publication.id, input.publication.lease);
  const events: PendingEvent[] = [];
  for (const { source } of input.sources) events.push(...await applySourceRecords(transaction, source));
  return events;
}
