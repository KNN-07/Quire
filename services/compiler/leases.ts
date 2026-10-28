import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { IdSchema, WorkerLeaseSchema } from "@quire/contracts";
import type { Id, WorkerLease, CompileJob, Artifact } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { Transaction } from "@quire/runtime";
import type { CompilerService } from "./service";
import { admitWorkerClaim, assertManagedLease, workerWallSeconds } from "../operations/workers/admission";
import { parseDiagnostics } from "./diagnostics";

const leaseRow = z.object({ job_id: IdSchema, worker_id: IdSchema, attempt: z.number(),
  fencing_token: z.number(), expires_at: z.string(), heartbeat_at: z.string() });
export type Fence = { readonly attempt: number; readonly fencingToken: number };
export class CompilerLeases {
  constructor(readonly service: CompilerService) {}
  private async admitQueued(tx: Transaction, id: Id): Promise<boolean> {
    const { service } = this;
    const bound = service.store.withTransaction(tx);
    const job = await bound.get(id);
    if (job.status !== "queued") return false;
    try {
      const actorId = IdSchema.parse((await bound.raw(id)).actor_id);
      const limits = await service.admission(tx, { actorId, snapshot: job.snapshot });
      await tx.run("UPDATE compiler_requests SET limits_json=? WHERE job_id=?", [JSON.stringify(limits), id]);
      return true;
    } catch (error) {
      if (!(error instanceof ServiceError) || !["FORBIDDEN", "NOT_FOUND", "UNAUTHENTICATED", "EDITOR_CLOSED", "HISTORY_WINDOW"].includes(error.code)) throw error;
      const canceled = { ...job, status: "canceled" as const, failureCode: "POLICY_CHANGED", finishedAt: service.context.clock.now() };
      await bound.save(tx, canceled);
      await bound.changed(tx, canceled);
      return false;
    }
  }
  async execute(id: Id, signal: AbortSignal, preview = true): Promise<void> {
    const { service } = this;
    const started = performance.now();
    const job = await service.store.get(id);
    const fence = await service.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:compiler");
      if (!await this.admitQueued(tx, id)) return null;
      const claimed = await tx.run(`UPDATE compile_jobs SET status='running',attempt=attempt+1,
        fencing_token=fencing_token+1,started_at=?,version=version+1 WHERE id=? AND status='queued'`, [service.context.clock.now(),id]);
      if (claimed.changes !== 1) return null;
      const bound = service.store.withTransaction(tx);
      const row = await bound.raw(id);
      await bound.changed(tx, await bound.get(id));
      return { attempt: row.attempt, fencingToken: row.fencing_token };
    });
    await service.context.events.dispatch();
    if (!fence) return;
    const verify = async (tx: Transaction) => {
      const row = await service.store.withTransaction(tx).raw(id);
      if (row.status !== "running" || row.worker_id !== null || row.attempt !== fence.attempt || row.fencing_token !== fence.fencingToken) {
        throw new ServiceError("STALE_LEASE",409,"Local compiler attempt was fenced");
      }
    };
    try {
      const environment = await service.resolveEnvironment(job.environmentId);
      const source = await service.context.services.get("projects").readSnapshot(job.snapshot.id);
      const settings = await service.store.settings(id);
      const cacheKey = new Bun.CryptoHasher("sha256").update(JSON.stringify({
        scope: job.snapshot.scope,
        files: source.files.map((file) => [file.id, file.path, file.blob]),
        settings, environment: environment.rootOrImageDigest,
      })).digest("hex");
      const clean = z.object({ clean: z.number() }).nullable().parse(
        (await service.context.db.get("SELECT clean FROM compiler_requests WHERE job_id=?", [id])))?.clean ?? 1;
      if (clean) (await service.context.db.run("DELETE FROM compiler_cache WHERE project_id=? AND branch=?", [job.snapshot.scope.projectId, job.snapshot.scope.branch]));
      const cached = z.object({ job_id: IdSchema }).nullable().parse((await service.context.db.get("SELECT job_id FROM compiler_cache WHERE cache_key=?", [cacheKey])));
      if (cached) {
        const previous = await service.store.get(cached.job_id);
        for (const artifact of previous.artifacts.filter((item) => item.kind !== "diff")) await service.store.artifact({ jobId: id, name: artifact.name,
          bytes: await service.context.blobs.get(artifact.sha256), mime: artifact.mime, kind: artifact.kind }, verify);
        if ((await service.store.get(id)).status === "canceled") return;
        await service.transition({ ...await service.store.get(id), status: "succeeded", finishedAt: service.context.clock.now(),
          elapsedMs: Math.round(performance.now() - started),
          diagnostics: previous.diagnostics.map((item) => ({ ...item, id: IdSchema.parse(crypto.randomUUID()), jobId: id })) },
          async tx => { if (preview) await service.publishPreview(tx, id); }, verify);
        return;
      }
      const result = await service.environments.build({ files: source.files, blobs: service.context.blobs, settings, environment,
        signal, unitId: id, limits: await service.limits(id) });
      if ((await service.store.get(id)).status === "canceled") return;
      await service.store.artifact({ jobId: id, name: "build.log", bytes: new TextEncoder().encode(result.log), kind: "log", mime: "text/plain" }, verify);
      for (const [name, bytes] of result.files) {
        if (/^(?:tmp|cache|texmf-var|texmf-config)\//.test(name) || ["build.log", "exit-code"].includes(name)) continue;
        const kind: Artifact["kind"] = name.endsWith(".pdf") ? "pdf" : name.endsWith(".dvi") ? "dvi" :
          name.endsWith(".synctex.gz") ? "synctex" : "generated";
        await service.store.artifact({ jobId: id, name, bytes, kind, mime: kind === "pdf" ? "application/pdf" : "application/octet-stream" }, verify);
      }
      const current = await service.store.get(id);
      if (current.status === "canceled") return;
      const status = result.success ? "succeeded" : result.log.includes("result: timeout") ? "timeout" : "failed";
      await service.transition({ ...current, status, finishedAt: service.context.clock.now(),
        elapsedMs: Math.round(performance.now() - started),
        diagnostics: parseDiagnostics({ jobId: id, log: result.log, files: source.files }),
        failureCode: result.success ? null : status === "timeout" ? "WALL_LIMIT" :
          result.log.includes("result: oom-kill") ? "MEMORY_LIMIT" : "COMPILE_FAILED" }, async tx => {
        if (result.success) {
          if (preview) await service.publishPreview(tx, id);
          (await tx.run("INSERT INTO compiler_cache(cache_key,project_id,branch,job_id) VALUES(?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET job_id=excluded.job_id", [cacheKey, job.snapshot.scope.projectId, job.snapshot.scope.branch, id]));
        }
      }, verify);
    } catch (error) {
      if ((await service.store.get(id)).status === "canceled") return;
      if (!(error instanceof Error)) throw error;
      if (error instanceof ServiceError && error.code === "STALE_LEASE") return;
      console.error("compiler.job.failed", { jobId: id, code: error instanceof ServiceError ? error.code : error.name });
      await service.transition({ ...await service.store.get(id), status: "failed", finishedAt: service.context.clock.now(),
        elapsedMs: Math.round(performance.now() - started), failureCode: error instanceof ServiceError ? error.code : "WORKER_FAILURE" }, undefined, verify);
    }
  }
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
  async fence(id: Id, fence: Fence, request?: Request, tx?: Transaction): Promise<void> {
    const { context, store } = this.service;
    if (!tx) return context.uow.run(async executor => {
      await executor.lock("quire:compiler");
      await this.fence(id, fence, request, executor);
    });
    const lease = leaseRow.nullable().parse(await tx.get("SELECT * FROM worker_leases WHERE job_id=?", [id]));
    const job = await store.withTransaction(tx).raw(id);
    if (!lease || lease.attempt !== fence.attempt || lease.fencing_token !== fence.fencingToken ||
      job.attempt !== fence.attempt || job.fencing_token !== fence.fencingToken || job.worker_id !== lease.worker_id ||
      Date.parse(lease.expires_at) <= Date.parse(context.clock.now()) || job.status !== "running") {
      throw new ServiceError("STALE_LEASE", 409, "Worker lease expired or was fenced");
    }
    await assertManagedLease(tx, lease.worker_id);
    if (request && request.headers.get("x-job-capability") !== this.capability(id, fence)) {
      throw new ServiceError("JOB_CAPABILITY_REQUIRED", 403, "Job-specific capability required");
    }
  }
  async reap(): Promise<void> {
    const { context, store } = this.service;
    await context.uow.run(async tx => {
      await tx.lock("quire:compiler");
      const bound = store.withTransaction(tx);
      const expired = await tx.all<{job_id: string}>("SELECT job_id FROM worker_leases WHERE expires_at<=? ORDER BY job_id", [context.clock.now()]);
      const jobs = [];
      for (const item of expired) {
        const id = IdSchema.parse(item.job_id);
        const job = await bound.get(id);
        await tx.run("DELETE FROM worker_leases WHERE job_id=?", [id]);
        await tx.run("UPDATE compile_jobs SET fencing_token=fencing_token+1 WHERE id=?", [id]);
        await tx.run("UPDATE workers SET state='offline',job_id=NULL WHERE job_id=?", [id]);
        if (job.status === "running") {
          const failed = { ...job, status: "failed" as const, finishedAt: context.clock.now(), failureCode: "WORKER_LEASE_EXPIRED" };
          await bound.save(tx, failed);
          jobs.push(failed);
        }
      }
      for (const job of jobs) await bound.changed(tx, job);
    });
    await context.events.dispatch();
  }
  async lease(workerId: Id, environmentIds: readonly Id[]): Promise<WorkerLease | null> {
    await this.reap();
    const { context, store } = this.service;
    const leased = await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:compiler");
      const bound = store.withTransaction(tx);
      await tx.run(`INSERT INTO workers(id,pool_id,state,environment_ids_json,last_heartbeat,builds_today)
        VALUES(?,?,'idle',?,?,0) ON CONFLICT(id) DO UPDATE SET
        environment_ids_json=excluded.environment_ids_json,last_heartbeat=excluded.last_heartbeat`,
        [workerId, workerId, JSON.stringify(environmentIds), context.clock.now()]);
      if (!await admitWorkerClaim(tx, workerId)) return null;
      if (await tx.get("SELECT job_id FROM worker_leases WHERE worker_id=?", [workerId])) return null;
      const candidates = await tx.all<{id:string;environment_id:string}>(`SELECT j.id,j.environment_id FROM compile_jobs j
        JOIN compiler_requests r ON r.job_id=j.id WHERE j.status='queued' ORDER BY j.queue_order`);
      const completed: CompileJob[] = [];
      let id: Id | null = null;
      for (const candidate of candidates.filter(item => environmentIds.some(environmentId => environmentId === item.environment_id))) {
        const candidateId = IdSchema.parse(candidate.id);
        if (!await this.admitQueued(tx, candidateId)) continue;
        const job = await bound.get(candidateId);
        const request = z.object({clean:z.number(),preview:z.number(),cache_key:z.string().nullable()}).parse(
          await tx.get("SELECT clean,preview,cache_key FROM compiler_requests WHERE job_id=?",[candidateId]));
        if (request.clean) await tx.run("DELETE FROM compiler_cache WHERE project_id=? AND branch=?",
          [job.snapshot.scope.projectId,job.snapshot.scope.branch]);
        const cached = request.cache_key ? z.object({job_id:IdSchema}).nullable().parse(
          await tx.get("SELECT job_id FROM compiler_cache WHERE cache_key=?",[request.cache_key])) : null;
        if (!cached) { id=candidateId; break; }
        const previous = await bound.get(cached.job_id);
        for (const artifact of previous.artifacts.filter(item => item.kind !== "diff")) {
          await tx.run(`INSERT INTO artifacts(id,job_id,name,mime,bytes,sha256,kind,created_at) VALUES(?,?,?,?,?,?,?,?)`,
            [crypto.randomUUID(),candidateId,artifact.name,artifact.mime,artifact.bytes,artifact.sha256,artifact.kind,context.clock.now()]);
        }
        const finished = {...job,status:"succeeded" as const,startedAt:context.clock.now(),finishedAt:context.clock.now(),
          elapsedMs:0,diagnostics:previous.diagnostics.map(item => ({...item,id:IdSchema.parse(crypto.randomUUID()),jobId:candidateId}))};
        await bound.save(tx,finished);
        if (request.preview) await this.service.publishPreview(tx,candidateId);
        completed.push(finished);
      }
      if (!id) {
        for (const job of completed) await bound.changed(tx,job);
        return null;
      }
      const claimed = await tx.run(`UPDATE compile_jobs SET status='running',worker_id=?,attempt=attempt+1,
        fencing_token=fencing_token+1,started_at=?,version=version+1 WHERE id=? AND status='queued'`,
        [workerId, context.clock.now(), id]);
      if (claimed.changes !== 1) return null;
      const row = await bound.raw(id);
      const expires = new Date(Date.parse(context.clock.now()) + 30000).toISOString();
      await tx.run(`INSERT INTO worker_leases(job_id,worker_id,attempt,fencing_token,expires_at,heartbeat_at)
        VALUES(?,?,?,?,?,?)`, [id,workerId,row.attempt,row.fencing_token,expires,context.clock.now()]);
      await tx.run("UPDATE workers SET state='busy',job_id=? WHERE id=?", [id,workerId]);
      const configuredLimits = await this.service.limits(id, tx);
      const limits = { ...configuredLimits, wallSeconds: await workerWallSeconds(tx, configuredLimits.wallSeconds) };
      const settings = await bound.settings(id);
      for (const job of completed) await bound.changed(tx,job);
      await bound.changed(tx, await bound.get(id));
      return WorkerLeaseSchema.parse({jobId:id,snapshotId:row.snapshot_id,environmentId:row.environment_id,
        settings,limits,attempt:row.attempt,fencingToken:row.fencing_token});
    });
    await context.events.dispatch();
    return leased;
  }
  async heartbeat(id: Id, fence: Fence): Promise<void> {
    const { context } = this.service;
    await context.uow.run(async tx => {
      await tx.lock("quire:compiler");
      await this.fence(id, fence, undefined, tx);
      await tx.run("UPDATE worker_leases SET heartbeat_at=?,expires_at=? WHERE job_id=?",
        [context.clock.now(),new Date(Date.parse(context.clock.now())+30000).toISOString(),id]);
      await tx.run("UPDATE workers SET last_heartbeat=? WHERE job_id=?", [context.clock.now(),id]);
    });
  }
}
