import { InstantSchema } from "@quire/contracts";
import type { BranchCoordinator, BranchLease, Clock, Scope, Transaction, UnitOfWork } from "@quire/contracts";
import { assertRepositoryFence } from "../../../services/operations/repository";

/** Actual PostgreSQL authority; the server is its only lease issuer. */
export class TestAuthority implements BranchCoordinator {
  constructor(private readonly uow: UnitOfWork, private readonly clock: Clock) {}
  acquire(scope: Scope, owner: string, ttlMs: number): Promise<BranchLease | null> {
    return this.uow.run(async (tx) => {
      await tx.lock(`branch:${scope.projectId}:${scope.branch}`);
      const row = await tx.get<{ fence: number; expires_at: string }>(
        "SELECT fence,expires_at FROM branch_leases WHERE project_id=? AND branch=?", [scope.projectId, scope.branch]);
      if (row && row.expires_at > this.clock.now()) return null;
      const lease = {
        scope, owner, fence: (row?.fence ?? 0) + 1,
        expiresAt: InstantSchema.parse(new Date(Date.parse(this.clock.now()) + ttlMs).toISOString()),
      };
      await tx.run("INSERT INTO branch_leases(project_id,branch,owner,fence,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(project_id,branch) DO UPDATE SET owner=excluded.owner,fence=excluded.fence,expires_at=excluded.expires_at",
        [scope.projectId, scope.branch, owner, lease.fence, lease.expiresAt]);
      return lease;
    });
  }
  renew(lease: BranchLease, ttlMs: number): Promise<BranchLease> {
    return this.uow.run(async (tx) => {
      await this.assert(tx, lease);
      const expiresAt = InstantSchema.parse(new Date(Date.parse(this.clock.now()) + ttlMs).toISOString());
      await tx.run("UPDATE branch_leases SET expires_at=? WHERE project_id=? AND branch=?",
        [expiresAt, lease.scope.projectId, lease.scope.branch]);
      return { ...lease, expiresAt };
    });
  }
  async release(lease: BranchLease): Promise<void> {
    await this.uow.run(async (tx) => {
      await tx.run("UPDATE branch_leases SET expires_at=? WHERE project_id=? AND branch=? AND owner=? AND fence=?",
        [this.clock.now(), lease.scope.projectId, lease.scope.branch, lease.owner, lease.fence]);
    });
  }
  assert(tx: Transaction, lease: BranchLease): Promise<void> { return assertRepositoryFence(tx, lease, this.clock); }
  subscribe(_listener: (scope: Scope) => void): () => void { return () => undefined; }
  async close(): Promise<void> {}
}
