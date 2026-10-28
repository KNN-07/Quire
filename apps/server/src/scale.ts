import { z } from "zod";
import { InstantSchema } from "@quire/contracts";
import { StorageError, SqliteEventPort } from "@quire/runtime";
import type { RuntimeAdapters, RuntimeConfig } from "@quire/runtime";
import type { BranchCoordinator, BranchLease, Clock, Scope, Transaction, UnitOfWork } from "@quire/contracts";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { RedisNotificationTransport } from "../../../services/operations/storage/redis";
import { S3BlobStore } from "../../../services/operations/storage/s3";
import { RemoteBranchCoordinator, RemoteRepositoryService } from "../../../services/operations/repository";

const ScaleSchema = z.strictObject({
  postgresUrl: z.url(), redisUrl: z.url(), namespace: z.string().min(1),
  repositoryUrl: z.url(), repositoryToken: z.string().min(32),
  endpoint: z.url(), bucket: z.string().min(1), region: z.string().min(1).default("us-east-1"),
  accessKeyId: z.string().min(1), secretAccessKey: z.string().min(1),
  reconcileMs: z.coerce.number().int().min(10).default(1000),
});
export type ScaleConfig = z.infer<typeof ScaleSchema>;
export function loadScaleConfig(env: NodeJS.ProcessEnv = process.env): ScaleConfig {
  return ScaleSchema.parse({
    postgresUrl: env["QUIRE_POSTGRES_URL"], redisUrl: env["QUIRE_REDIS_URL"],
    namespace: env["QUIRE_REDIS_NAMESPACE"], repositoryUrl: env["QUIRE_REPOSITORY_URL"],
    repositoryToken: env["QUIRE_REPOSITORY_TOKEN"], endpoint: env["QUIRE_S3_ENDPOINT"],
    bucket: env["QUIRE_S3_BUCKET"], region: env["QUIRE_S3_REGION"],
    accessKeyId: env["QUIRE_S3_ACCESS_KEY_ID"], secretAccessKey: env["QUIRE_S3_SECRET_ACCESS_KEY"],
    reconcileMs: env["QUIRE_RECONCILE_MS"],
  });
}

/** SQL authority used only behind the singleton repository admission queue. */
export class PostgresBranchCoordinator implements BranchCoordinator {
  private readonly listeners = new Set<(scope: Scope) => void>();
  constructor(private readonly uow: UnitOfWork, private readonly clock: Clock) {}
  async acquire(scope: Scope, owner: string, ttlMs: number): Promise<BranchLease | null> {
    const result = await this.uow.run(async (tx) => {
      await tx.lock(`branch:${scope.projectId}:${scope.branch}`);
      const row = await tx.get<{ owner: string; fence: number; expires_at: string }>(
        "SELECT owner,fence,expires_at FROM branch_leases WHERE project_id=? AND branch=?", [scope.projectId, scope.branch]);
      if (row && row.expires_at > this.clock.now()) return null;
      const fence = (row?.fence ?? 0) + 1;
      if (!Number.isSafeInteger(fence)) throw new StorageError("FENCE_EXHAUSTED", scope.projectId);
      const expiresAt = this.expiry(ttlMs);
      await tx.run("INSERT INTO branch_leases(project_id,branch,owner,fence,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(project_id,branch) DO UPDATE SET owner=excluded.owner,fence=excluded.fence,expires_at=excluded.expires_at",
        [scope.projectId, scope.branch, owner, fence, expiresAt]);
      return { scope, owner, fence, expiresAt };
    });
    if (result) this.notify(scope);
    return result;
  }
  private expiry(ttlMs: number): BranchLease["expiresAt"] {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new StorageError("INVALID_LEASE_TTL", String(ttlMs));
    return InstantSchema.parse(new Date(Date.parse(this.clock.now()) + ttlMs).toISOString());
  }
  async renew(lease: BranchLease, ttlMs: number): Promise<BranchLease> {
    const result = await this.uow.run(async (tx) => {
      await this.assert(tx, lease);
      const expiresAt = this.expiry(ttlMs);
      await tx.run("UPDATE branch_leases SET expires_at=? WHERE project_id=? AND branch=? AND owner=? AND fence=?",
        [expiresAt, lease.scope.projectId, lease.scope.branch, lease.owner, lease.fence]);
      return { ...lease, expiresAt };
    });
    this.notify(lease.scope);
    return result;
  }
  async release(lease: BranchLease): Promise<void> {
    await this.uow.run(async (tx) => {
      await tx.run("UPDATE branch_leases SET expires_at=? WHERE project_id=? AND branch=? AND owner=? AND fence=?",
        [this.clock.now(), lease.scope.projectId, lease.scope.branch, lease.owner, lease.fence]);
    });
    this.notify(lease.scope);
  }
  async assert(tx: Transaction, lease: BranchLease): Promise<void> {
    await tx.lock(`branch:${lease.scope.projectId}:${lease.scope.branch}`);
    const row = await tx.get<{ owner: string; fence: number; expires_at: string }>(
      "SELECT owner,fence,expires_at FROM branch_leases WHERE project_id=? AND branch=?", [lease.scope.projectId, lease.scope.branch]);
    if (!row || row.owner !== lease.owner || row.fence !== lease.fence || row.expires_at <= this.clock.now()) {
      throw new StorageError("STALE_BRANCH_FENCE", `${lease.scope.projectId}:${lease.scope.branch}:${lease.fence}`);
    }
  }
  private notify(scope: Scope): void { for (const listener of this.listeners) listener(scope); }
  subscribe(listener: (scope: Scope) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  async close(): Promise<void> { this.listeners.clear(); }
}

export async function createScaleAdapters(_config: RuntimeConfig, clock: Clock,
  settings: ScaleConfig = loadScaleConfig()): Promise<RuntimeAdapters> {
  const storage = await createPostgresStorage({ url: settings.postgresUrl });
  const transport = new RedisNotificationTransport({ url: settings.redisUrl, namespace: settings.namespace });
  const client = { url: settings.repositoryUrl, token: settings.repositoryToken, clock, admission: storage.admission };
  const remote = new RemoteBranchCoordinator(client);
  const repositories = new RemoteRepositoryService(client);
  const blobs = new S3BlobStore({ endpoint: settings.endpoint, bucket: settings.bucket, region: settings.region,
    accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey });
  const events = new SqliteEventPort(storage.db, clock);
  const listeners = new Set<(scope: Scope) => void>();
  const notifications = new Set<Promise<void>>();
  let closed = false;
  let started = false;
  let reconciliation: Promise<void> | undefined;
  const report = (error: unknown) => { console.error("scale.reconcile.failed", error); };
  const catchUp = () => {
    if (closed || !started || reconciliation) return;
    const task = events.dispatch().catch(report);
    reconciliation = task;
    void task.then(() => { if (reconciliation === task) reconciliation = undefined; });
  };
  transport.subscribeEvents(catchUp);
  transport.subscribeState((state) => { if (state === "ready") catchUp(); });
  transport.subscribeLeases((scope) => { for (const listener of listeners) listener(scope); });
  const advisory = (work: () => Promise<void>) => {
    const task = work().catch((error: unknown) => { console.error("scale.notification.failed", error); });
    notifications.add(task);
    void task.then(() => notifications.delete(task));
    return task;
  };
  remote.subscribe((scope) => {
    for (const listener of listeners) listener(scope);
    void advisory(() => transport.publishLease(scope));
  });
  try { await transport.connect(); }
  catch (error) {
    await Promise.all([transport.close(), remote.close(), repositories.close(), events.close()]);
    await storage.close();
    throw error;
  }
  // Production reconciliation repairs missed Pub/Sub wakes and explicitly reconnects.
  const timer = setInterval(() => {
    catchUp();
    if (started && transport.state === "disconnected") void transport.connect().catch(report);
  }, settings.reconcileMs);
  timer.unref();
  const branches: BranchCoordinator = {
    acquire: (scope, owner, ttl) => remote.acquire(scope, owner, ttl),
    renew: (lease, ttl) => remote.renew(lease, ttl),
    release: (lease) => remote.release(lease),
    assert: (tx, lease) => remote.assert(tx, lease),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close: () => remote.close(),
  };
  return {
    db: storage.db, uow: storage.uow, branches, repositories,
    admission: {
      writer: work => storage.admission.writer(work),
      background: work => storage.admission.background(work),
      exclusive: work => storage.admission.exclusive(() => repositories.exclusive(work)),
    },
    blobs,
    events: {
      record: (tx, event) => events.record(tx, event), read: (seq, options) => events.read(seq, options),
      subscribe: (listener) => events.subscribe(listener),
      dispatch: async () => { started = true; await events.dispatch(); await advisory(() => transport.publishEvents()); },
      close: () => events.close(),
    },
    close: async () => {
      closed = true;
      clearInterval(timer);
      await storage.admission.close();
      await repositories.close();
      await remote.close();
      await Promise.all(notifications);
      await transport.close();
      await reconciliation;
      await events.close();
      listeners.clear();
      await storage.close();
    },
  };
}
