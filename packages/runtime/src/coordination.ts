import { InstantSchema } from "@quire/contracts";
import type { BranchCoordinator, BranchLease, Clock, Scope, Transaction, UnitOfWork } from "@quire/contracts";
import { StorageError } from "./errors";
import { nativeRepositoryPath, serializedRepository } from "./repository-process";

type LeaseRow = { readonly owner: string; readonly fence: number; readonly expires_at: string };
export class LocalBranchCoordinator implements BranchCoordinator {
  private readonly listeners = new Set<(scope: Scope) => void>();
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;
  constructor(private readonly uow: UnitOfWork, private readonly clock: Clock, private readonly dataDir: string) {}
  private async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) throw new StorageError("COORDINATOR_CLOSED", this.dataDir);
    const result = work();
    this.pending.add(result);
    try { return await result; } finally { this.pending.delete(result); }
  }
  private expiry(ttlMs: number): ReturnType<typeof InstantSchema.parse> {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new StorageError("INVALID_LEASE_TTL", String(ttlMs));
    return InstantSchema.parse(new Date(Date.parse(this.clock.now()) + ttlMs).toISOString());
  }
  async acquire(scope: Scope, owner: string, ttlMs: number): Promise<BranchLease | null> {
    // A new fence cannot overtake an admitted Git child with an uncertain outcome.
    const lease = await this.run(() => serializedRepository(nativeRepositoryPath(this.dataDir, scope.projectId), () => this.uow.run(async (tx) => {
      await tx.lock(`branch:${scope.projectId}:${scope.branch}`);
      const row = await tx.get<LeaseRow>("SELECT owner,fence,expires_at FROM branch_leases WHERE project_id=? AND branch=?",
        [scope.projectId, scope.branch]);
      if (row && row.expires_at > this.clock.now()) return null;
      const fence = (row?.fence ?? 0) + 1;
      if (!Number.isSafeInteger(fence)) throw new StorageError("FENCE_EXHAUSTED", scope.projectId);
      const expiresAt = this.expiry(ttlMs);
      await tx.run("INSERT INTO branch_leases(project_id,branch,owner,fence,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(project_id,branch) DO UPDATE SET owner=excluded.owner,fence=excluded.fence,expires_at=excluded.expires_at",
        [scope.projectId, scope.branch, owner, fence, expiresAt]);
      return { scope, owner, fence, expiresAt };
    })));
    if (lease) this.notify(scope);
    return lease;
  }
  async renew(lease: BranchLease, ttlMs: number): Promise<BranchLease> {
    return this.run(() => this.uow.run(async (tx) => {
      await this.assert(tx, lease);
      const expiresAt = this.expiry(ttlMs);
      await tx.run("UPDATE branch_leases SET expires_at=? WHERE project_id=? AND branch=? AND owner=? AND fence=?",
        [expiresAt, lease.scope.projectId, lease.scope.branch, lease.owner, lease.fence]);
      return { ...lease, expiresAt };
    }));
  }
  async release(lease: BranchLease): Promise<void> {
    await this.run(() => this.uow.run(async (tx) => {
      await tx.run("UPDATE branch_leases SET expires_at=? WHERE project_id=? AND branch=? AND owner=? AND fence=?",
        [this.clock.now(), lease.scope.projectId, lease.scope.branch, lease.owner, lease.fence]);
    }));
    this.notify(lease.scope);
  }
  async assert(tx: Transaction, lease: BranchLease): Promise<void> {
    await tx.lock(`branch:${lease.scope.projectId}:${lease.scope.branch}`);
    const row = await tx.get<LeaseRow>("SELECT owner,fence,expires_at FROM branch_leases WHERE project_id=? AND branch=?",
      [lease.scope.projectId, lease.scope.branch]);
    if (!row || row.owner !== lease.owner || row.fence !== lease.fence || row.expires_at <= this.clock.now()) {
      throw new StorageError("STALE_BRANCH_FENCE", `${lease.scope.projectId}:${lease.scope.branch}:${lease.fence}`);
    }
  }
  subscribe(listener: (scope: Scope) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private notify(scope: Scope): void { for (const listener of this.listeners) listener(scope); }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.pending);
    this.listeners.clear();
  }
}
