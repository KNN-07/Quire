import { z } from "zod";
import { GitOidSchema, IdSchema, InstantSchema, ScopeSchema } from "@quire/contracts";
import type { BranchLease, Clock, Id, RepositoryIntentState, SqlExecutor, Transaction } from "@quire/contracts";
import { StorageError } from "@quire/runtime";

export const leaseSchema = z.strictObject({
  scope: ScopeSchema, owner: z.string().min(1).max(256),
  fence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), expiresAt: InstantSchema,
});
export const updatesSchema = z.array(z.strictObject({
  ref: z.string().min(1).max(1024), expected: GitOidSchema.nullable(), next: GitOidSchema.nullable(),
})).min(1).max(256);
export const intentSchema = z.strictObject({ id: IdSchema, lease: leaseSchema, updates: updatesSchema });
export type IntentRow = {
  readonly id: Id; readonly project_id: Id; readonly branch: string; readonly owner: string;
  readonly fence: number; readonly updates_json: string; readonly state: RepositoryIntentState;
};

export async function assertRepositoryFence(tx: Transaction, lease: BranchLease, clock: Clock): Promise<void> {
  if (tx.dialect !== "postgres") throw new StorageError("REPOSITORY_POSTGRES_REQUIRED", "Scale repository requires PostgreSQL");
  await tx.lock(`branch:${lease.scope.projectId}:${lease.scope.branch}`);
  const row = await tx.get<{ owner: string; fence: number; expires_at: string }>(
    "SELECT owner,fence,expires_at FROM branch_leases WHERE project_id=? AND branch=?",
    [lease.scope.projectId, lease.scope.branch],
  );
  if (!row || row.owner !== lease.owner || row.fence !== lease.fence || row.expires_at <= clock.now()) {
    throw new StorageError("STALE_BRANCH_FENCE", `${lease.scope.projectId}:${lease.scope.branch}:${lease.fence}`);
  }
}

export async function requireIntent(db: SqlExecutor, id: Id, lease: BranchLease): Promise<IntentRow> {
  const row = await db.get<IntentRow>("SELECT * FROM repository_intents WHERE id=?", [id]);
  if (!row || row.project_id !== lease.scope.projectId || row.branch !== lease.scope.branch) {
    throw new StorageError("REPOSITORY_INTENT_NOT_FOUND", id);
  }
  return row;
}

/** SQL only: joins source, authorization, receipt and outbox finalization. */
export async function finalizeRepositoryIntent(tx: Transaction, id: Id, lease: BranchLease, clock: Clock): Promise<void> {
  await assertRepositoryFence(tx, lease, clock);
  const row = await requireIntent(tx, id, lease);
  if (row.owner !== lease.owner || row.fence !== lease.fence ||
    (row.state !== "published" && row.state !== "finalized")) {
    throw new StorageError("REPOSITORY_NOT_PUBLISHED", id);
  }
  await tx.run("UPDATE repository_intents SET state='finalized' WHERE id=?", [id]);
}
