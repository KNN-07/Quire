import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { IdSchema, WorkerLeaseSchema } from "@quire/contracts";
import type { Id, WorkerLease } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { CompilerService } from "./service";

const leaseRow = z.object({ job_id: IdSchema, worker_id: IdSchema, attempt: z.number(),
  fencing_token: z.number(), expires_at: z.string(), heartbeat_at: z.string() });
export type Fence = { readonly attempt: number; readonly fencingToken: number };
export class CompilerLeases {
  constructor(readonly service: CompilerService) {}
  bearer(): string {
    return createHmac("sha256", this.service.context.secretKey).update("quire:compiler:worker:v1").digest("hex");
  }
  capability(id: Id, fence: Fence): string {
    return createHmac("sha256", this.bearer()).update(`${id}:${fence.attempt}:${fence.fencingToken}`).digest("hex");
  }
  authorize(request: Request): void {
    const supplied = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
    const expected = Buffer.from(this.bearer());
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ServiceError("WORKER_UNAUTHORIZED", 401, "Worker bearer required");
    }
  }
  fence(id: Id, fence: Fence, request?: Request): void {
    const { context, store } = this.service;
    const lease = leaseRow.nullable().parse(context.db.query("SELECT * FROM worker_leases WHERE job_id=?").get(id));
    if (!lease || lease.attempt !== fence.attempt || lease.fencing_token !== fence.fencingToken ||
      Date.parse(lease.expires_at) <= Date.parse(context.clock.now()) || store.get(id).status !== "running") {
      throw new ServiceError("STALE_LEASE", 409, "Worker lease expired or was fenced");
    }
    if (request && request.headers.get("x-job-capability") !== this.capability(id, fence)) {
      throw new ServiceError("JOB_CAPABILITY_REQUIRED", 403, "Job-specific capability required");
    }
  }
  reap(): void {
    const { context, store } = this.service;
    const expired = context.db.query<{ job_id: string }, [string]>(
      "SELECT job_id FROM worker_leases WHERE expires_at<=?").all(context.clock.now());
    for (const item of expired) {
      const id = IdSchema.parse(item.job_id);
      const job = store.get(id);
      context.db.query("DELETE FROM worker_leases WHERE job_id=?").run(id);
      context.db.query("UPDATE compile_jobs SET fencing_token=fencing_token+1 WHERE id=?").run(id);
      context.db.query("UPDATE workers SET state='offline',job_id=NULL WHERE job_id=?").run(id);
      if (job.status === "running") store.save({ ...job, status: "failed",
        finishedAt: context.clock.now(), failureCode: "WORKER_LEASE_EXPIRED" });
    }
  }
  lease(workerId: Id, environmentIds: readonly Id[]): WorkerLease | null {
    this.reap();
    const { context, store } = this.service;
    const leased = context.uow.local((tx) => {
      tx.query(`INSERT INTO workers(id,pool_id,state,environment_ids_json,last_heartbeat,builds_today)
        VALUES(?,?,'idle',?,?,0) ON CONFLICT(id) DO UPDATE SET
        environment_ids_json=excluded.environment_ids_json,last_heartbeat=excluded.last_heartbeat`)
        .run(workerId, workerId, JSON.stringify(environmentIds), context.clock.now());
      if (tx.query("SELECT job_id FROM worker_leases WHERE worker_id=?").get(workerId)) return null;
      const candidates = tx.query<{ id: string; environment_id: string }, []>(
        `SELECT j.id,j.environment_id FROM compile_jobs j JOIN compiler_requests r ON r.job_id=j.id
         WHERE j.status='queued' ORDER BY j.queued_at,j.id`).all();
      const candidate = candidates.find((item) => environmentIds.some((id) => id === item.environment_id));
      if (!candidate) return null;
      const id = IdSchema.parse(candidate.id);
      tx.query(`UPDATE compile_jobs SET status='running',worker_id=?,attempt=attempt+1,
        fencing_token=fencing_token+1,started_at=? WHERE id=? AND status='queued'`)
        .run(workerId, context.clock.now(), id);
      const row = store.raw(id);
      const expires = new Date(Date.parse(context.clock.now()) + 30000).toISOString();
      tx.query(`INSERT INTO worker_leases(job_id,worker_id,attempt,fencing_token,expires_at,heartbeat_at)
        VALUES(?,?,?,?,?,?)`).run(id, workerId, row.attempt, row.fencing_token, expires, context.clock.now());
      tx.query("UPDATE workers SET state='busy',job_id=? WHERE id=?").run(id, workerId);
      context.events.append(tx, { topic: "job.changed", aggregateId: store.snapshot(row.snapshot_id).scope.projectId,
        payload: { resourceId: id, status: "running" } });
      return WorkerLeaseSchema.parse({ jobId: id, snapshotId: row.snapshot_id, environmentId: row.environment_id,
        settings: store.settings(id), limits: this.service.limits(id), attempt: row.attempt, fencingToken: row.fencing_token });
    });
    context.events.dispatch();
    return leased;
  }
  heartbeat(id: Id, fence: Fence): void {
    this.fence(id, fence);
    const { context } = this.service;
    context.db.query("UPDATE worker_leases SET heartbeat_at=?,expires_at=? WHERE job_id=?")
      .run(context.clock.now(), new Date(Date.parse(context.clock.now()) + 30000).toISOString(), id);
    context.db.query("UPDATE workers SET last_heartbeat=? WHERE job_id=?").run(context.clock.now(), id);
  }
}
