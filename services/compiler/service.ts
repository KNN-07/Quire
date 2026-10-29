import { z } from "zod";
import { CompileSettingsSchema, CompileJobSchema, IdSchema } from "@quire/contracts";
import type { CompilePort, CompileJob, CompileRequest, Id, Environment, Snapshot } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Transaction, SqlExecutor } from "@quire/runtime";
import { build } from "../../workers/compiler/build";
import type { BuildInput, BuildResult } from "../../workers/compiler/build";
import { CompilerStore } from "./store";
import { defaultLimits } from "../../workers/compiler/sandbox";
import type { Limits } from "../../workers/compiler/sandbox";
import { managedWorkerPool, workerWallSeconds } from "../operations/workers/admission";
import { CompilerLeases } from "./leases";
import { AccessStore } from "../core/base/access";
import { assertHistoryAccess } from "../core/base/history-access";
import { installationRoleSession } from "../operations/installation/launch";
import { diagnosticsCachePrefix } from "./diagnostics";

export type CompilerEnvironments = {
  readonly resolve: (id: Id) => Promise<Environment>;
  readonly build: (input: BuildInput & { readonly environment: Environment }) => Promise<BuildResult>;
};

export class CompilerService implements CompilePort {
  readonly store: CompilerStore;
  readonly active = new Map<Id, { readonly controller: AbortController; readonly promise: Promise<void> }>();
  readonly pending = new Set<Promise<unknown>>();
  readonly historical = new Set<Id>();
  readonly shutdown = new AbortController();
  running = false;
  leaseTimer: ReturnType<typeof setInterval> | null = null;
  private readonly backgroundFailures = new Set<unknown>();
  private starting: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  environments: CompilerEnvironments;
  constructor(readonly context: ModuleContext, readonly environment: Environment | null) {
    this.store = new CompilerStore(context);
    this.environments = {
      resolve: async id => {
        if (!environment || id !== environment.id) throw new ServiceError("ENVIRONMENT_UNAVAILABLE", 503, "Requested compiler environment has not been provisioned");
        return environment;
      },
      build: input => build(input),
    };
  }
  configureEnvironments(provider: CompilerEnvironments): void {
    this.environments = provider;
  }
  async resolveEnvironment(id: Id): Promise<Environment> {
    const environment = await this.environments.resolve(id);
    if (environment.id !== id || !environment.available) {
      throw new ServiceError("ENVIRONMENT_UNAVAILABLE", 503, "Requested compiler environment has not passed its confinement probe");
    }
    return environment;
  }
  async remoteWorkers(): Promise<boolean> {
    return this.context.config.profile === "scale" || await managedWorkerPool(this.context.db);
  }
  async enqueue(actorId: Id, request: CompileRequest, key: string): Promise<CompileJob> {
    const projects = this.context.services.get("projects");
    await projects.authorize(actorId, request.scope, "compile");
    const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(request)).digest("hex");
    const existing = z.object({ id: IdSchema, digest: z.string() }).nullable().parse((await this.context.db.get(`SELECT j.id,r.digest FROM compile_jobs j JOIN compiler_requests r ON r.job_id=j.id
       WHERE j.actor_id=? AND j.idempotency_key=?`, [actorId, key])));
    if (existing) {
      if (existing.digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Key already used for a different compile request");
      return this.store.get(existing.id);
    }
    const stored = z.object({ settings_json: z.string() }).nullable().parse(
      (await this.context.db.get("SELECT settings_json FROM projects WHERE id=?", [request.scope.projectId])));
    const settings = request.settings ?? CompileSettingsSchema.parse(JSON.parse(stored?.settings_json ?? "null"));
    const environment = await this.resolveEnvironment(settings.environmentId);
    if (!environment.engines.includes(settings.engine)) throw new ServiceError("ENGINE_UNAVAILABLE", 422, "Requested engine is unavailable in this environment");
    const snapshot = await projects.snapshot(actorId, request.scope, request.expectedRevision);
    const source = await projects.readSnapshot(snapshot.id);
    const cacheKey = diagnosticsCachePrefix + new Bun.CryptoHasher("sha256").update(JSON.stringify({
      scope: snapshot.scope, files: source.files.map(file => [file.id, file.path, file.blob]),
      settings, environment: environment.rootOrImageDigest,
    })).digest("hex");
    const job = CompileJobSchema.parse({ id: crypto.randomUUID(), snapshot, status: "queued",
      environmentId: settings.environmentId, queuedAt: this.context.clock.now(), startedAt: null,
      finishedAt: null, elapsedMs: null, diagnostics: [], artifacts: [], failureCode: null, workerId: null });
    const admitted = await this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:compiler");
      const limits = await this.admission(tx, { actorId, snapshot });
      const replay = z.object({id:IdSchema,digest:z.string()}).nullable().parse(await tx.get(`SELECT j.id,r.digest
        FROM compile_jobs j JOIN compiler_requests r ON r.job_id=j.id WHERE j.actor_id=? AND j.idempotency_key=?`, [actorId,key]));
      if (replay) {
        if (replay.digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT",409,"Key already used for a different compile request");
        return this.store.withTransaction(tx).get(replay.id);
      }
      const order = z.object({value:z.number()}).parse(await tx.get("UPDATE compiler_queue_counter SET value=value+1 WHERE id=1 RETURNING value"));
      await tx.run(`INSERT INTO compile_jobs(id,actor_id,snapshot_id,environment_id,settings_json,status,
        queued_at,idempotency_key,queue_order,version) VALUES(?,?,?,?,?,?,?,?,?,1)`, [job.id,actorId,snapshot.id,
        settings.environmentId,JSON.stringify(settings),job.status,job.queuedAt,key,order.value]);
      await tx.run("INSERT INTO compiler_requests(job_id,digest,clean,limits_json,cache_key) VALUES(?,?,?,?,?)",
        [job.id,digest,Number(request.clean),JSON.stringify(limits),cacheKey]);
      await this.store.changed(tx, job);
      return job;
    });
    await this.context.events.dispatch();
    this.runBackground(this.context.admission.background(() => this.pump()));
    return admitted;
  }
  async get(actorId: Id, id: Id): Promise<CompileJob> {
    const job = await this.store.get(id);
    await this.context.services.get("projects").authorize(actorId, job.snapshot.scope, "read");
    await assertHistoryAccess(this.context, { actorId, projectId: job.snapshot.scope.projectId, snapshotId: job.snapshot.id });
    return job;
  }
  async admission(tx: Transaction, input: { readonly actorId: Id; readonly snapshot: Snapshot }): Promise<Limits> {
    const context = { ...this.context, db: tx };
    const access = new AccessStore(context);
    await access.authorize(input.actorId, input.snapshot.scope, "compile");
    await assertHistoryAccess(context, { actorId: input.actorId, projectId: input.snapshot.scope.projectId, snapshotId: input.snapshot.id });
    const policy = await access.policy(input.actorId, input.snapshot.scope.projectId);
    return { ...defaultLimits, wallSeconds: await workerWallSeconds(tx, Math.min(600, policy.compileSeconds)) };
  }
  async limits(id: Id, db: SqlExecutor = this.context.db): Promise<Limits> {
    const row = z.object({ limits_json: z.string() }).nullable().parse(
      (await db.get("SELECT limits_json FROM compiler_requests WHERE job_id=?", [id])));
    return row ? z.object({ wallSeconds: z.number().positive().max(600), memoryBytes: z.number().positive(),
      processes: z.number().int().positive(), workspaceBytes: z.number().positive() }).parse(JSON.parse(row.limits_json)) : defaultLimits;
  }
  async cancel(actorId: Id, id: Id, expectedVersion?: number): Promise<void> {
    const job = await this.store.get(id);
    await this.context.services.get("projects").authorize(actorId, job.snapshot.scope, "compile");
    await this.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await tx.lock("quire:compiler");
      await new AccessStore({ ...this.context, db: tx }).authorize(actorId, job.snapshot.scope, "compile");
      const bound = this.store.withTransaction(tx);
      if (expectedVersion !== undefined && (await bound.raw(id)).version !== expectedVersion) {
        throw new ServiceError("VERSION_CONFLICT", 409, "Compile version changed");
      }
      const current = await bound.get(id);
      if (current.status !== "queued" && current.status !== "running") return;
      const canceled = { ...current, status: "canceled" as const, finishedAt:this.context.clock.now(),failureCode:"CANCELED" };
      await tx.run("UPDATE compile_jobs SET fencing_token=fencing_token+1 WHERE id=?",[id]);
      await tx.run("DELETE FROM worker_leases WHERE job_id=?",[id]);
      await tx.run("UPDATE workers SET state='idle',job_id=NULL WHERE job_id=?",[id]);
      await bound.save(tx,canceled);
      await bound.changed(tx,canceled);
    });
    await this.context.events.dispatch();
    const active = this.active.get(id);
    if (active) { active.controller.abort(); await active.promise; }
  }
  async pump(): Promise<void> {
    if (!this.running || await this.remoteWorkers()) return;
    const rows = (await this.context.db.all<{ id: string }>("SELECT id FROM compile_jobs WHERE status='queued' ORDER BY queue_order", []));
    for (const row of rows) {
      if (!this.running || this.shutdown.signal.aborted || this.active.size >= 2) break;
      const id = IdSchema.parse(row.id);
      if (this.active.has(id)) continue;
      const request = z.object({preview:z.number()}).nullable().parse(await this.context.db.get("SELECT preview FROM compiler_requests WHERE job_id=?",[id]));
      if (!this.running || this.shutdown.signal.aborted) break;
      this.runBackground(this.context.admission.background(() => this.runJob(id, request ? !!request.preview : !this.historical.has(id))));
    }
  }
  async runJob(id: Id, preview = true): Promise<void> {
    if (await this.remoteWorkers()) throw new ServiceError("REMOTE_WORKER_REQUIRED",503,"Configured worker pool requires remote workers");
    if (!preview) this.historical.add(id);
    const existing = this.active.get(id);
    if (existing) return existing.promise;
    if (this.active.size >= 2) {
      await Promise.race([...this.active.values()].map((active) => active.promise));
      if ((await this.store.get(id)).status !== "queued") return this.active.get(id)?.promise;
      return this.runJob(id, preview);
    }
    const controller = new AbortController();
    const promise = this.context.admission.writer(() => this.execute(id, controller.signal, preview)).finally(() => {
      this.active.delete(id); this.historical.delete(id);
      if (this.running && !this.shutdown.signal.aborted) {
        this.runBackground(this.context.admission.background(() => this.pump()));
      }
    });
    this.active.set(id, { controller, promise });
    return promise;
  }
  start(): Promise<void> {
    if (this.stopping) return Promise.reject(new ServiceError("WORKER_STOPPED", 503, "Compiler is stopping"));
    this.starting ??= this.startOwned();
    return this.starting;
  }
  private async startOwned(): Promise<void> {
    if (this.running || await this.remoteWorkers()) return;
    const stale = (await this.context.db.all<{ id: string }>("SELECT id FROM compile_jobs WHERE status='running' AND worker_id IS NULL", []));
    for (const row of stale) {
      const id = IdSchema.parse(row.id);
      if (!installationRoleSession()) {
        const stopped = Bun.spawn(["/usr/bin/systemctl", "--user", "stop", `quire-compile-${id}.service`], { stdout: "ignore", stderr: "ignore" });
        await stopped.exited;
      }
      await this.transition({ ...await this.store.get(id), status: "failed", finishedAt: this.context.clock.now(), failureCode: "WORKER_RESTARTED" });
    }
    this.running = true;
    this.runBackground(this.context.admission.background(() => this.pump()));
  }
  stop(): Promise<void> {
    this.stopping ??= this.stopOwned();
    return this.stopping;
  }
  private async stopOwned(): Promise<void> {
    if (this.starting) await this.starting.then(() => undefined, error => { this.backgroundFailures.add(error); });
    this.running = false;
    this.shutdown.abort();
    if (this.leaseTimer) { clearInterval(this.leaseTimer); this.leaseTimer = null; }
    for (const [id, active] of this.active) {
      active.controller.abort();
      try {
        await this.transition({ ...await this.store.get(id), status: "canceled", finishedAt: this.context.clock.now(), failureCode: "WORKER_STOPPED" });
      } catch (error) { this.backgroundFailures.add(error); }
    }
    for (const result of await Promise.allSettled([...this.active.values()].map(active => active.promise))) {
      if (result.status === "rejected") this.backgroundFailures.add(result.reason);
    }
    for (const result of await Promise.allSettled(this.pending)) {
      if (result.status === "rejected") this.backgroundFailures.add(result.reason);
    }
    if (this.backgroundFailures.size) throw new AggregateError([...this.backgroundFailures], "Compiler background work failed");
  }
  /** Detached work is observed immediately and its failure is reported at shutdown. */
  runBackground(promise: Promise<void>): void {
    void this.task(promise).catch(error => { this.backgroundFailures.add(error); });
  }
  task<T>(promise: Promise<T>): Promise<T> {
    const tracked = promise.finally(() => { this.pending.delete(tracked); });
    this.pending.add(tracked);
    return tracked;
  }
  async execute(id: Id, signal: AbortSignal, preview = true): Promise<void> {
    await new CompilerLeases(this).execute(id, signal, preview);
  }
  async publishPreview(tx: Transaction, id: Id): Promise<void> {
    const job = await this.store.withTransaction(tx).get(id);
    const pdf = z.object({ id: IdSchema }).nullable().parse((await tx.get(`
      SELECT a.id FROM artifacts a JOIN compile_jobs j ON j.id=a.job_id
      JOIN snapshots s ON s.id=j.snapshot_id JOIN compiler_requests r ON r.job_id=j.id
      WHERE s.project_id=? AND s.branch=? AND j.status='succeeded' AND r.preview=1 AND a.name='output.pdf'
      ORDER BY s.revision DESC,j.queued_at DESC,j.queue_order DESC LIMIT 1`, [job.snapshot.scope.projectId, job.snapshot.scope.branch])));
    if (!pdf) throw new ServiceError("INVALID_PDF", 422, "Successful compile has no validated PDF");
    (await tx.run(`INSERT INTO compiler_previews(project_id,branch,artifact_id) VALUES(?,?,?)
      ON CONFLICT(project_id,branch) DO UPDATE SET artifact_id=excluded.artifact_id`, [job.snapshot.scope.projectId, job.snapshot.scope.branch, pdf.id]));
  }
  async waitJob(id: Id): Promise<void> {
    const done = Promise.withResolvers<void>();
    const unsubscribe = this.context.events.subscribe(event => {
      if (event.topic === "job.changed" && event.payload.resourceId === id && !["queued","running"].includes(event.payload.status)) done.resolve();
    });
    const abort = () => done.reject(new ServiceError("WORKER_STOPPED",503,"Compiler is stopping"));
    const deadline = setTimeout(() => done.reject(new ServiceError("WORKER_UNAVAILABLE",503,"Remote compilation did not finish within its deadline")), 660000);
    this.shutdown.signal.addEventListener("abort",abort,{once:true});
    try {
      if (this.shutdown.signal.aborted) abort();
      if (!["queued","running"].includes((await this.store.get(id)).status)) done.resolve();
      await done.promise;
    } finally { clearTimeout(deadline);unsubscribe();this.shutdown.signal.removeEventListener("abort",abort); }
  }
  async transition(job: CompileJob, finalize?: (tx: Transaction) => Promise<void>, verify?: (tx: Transaction) => Promise<void>): Promise<void> {
    await this.context.uow.run(async tx => {
      await tx.lock("quire:compiler");
      const bound = this.store.withTransaction(tx);
      const current = await bound.get(job.id);
      if (["canceled","succeeded","failed","timeout"].includes(current.status)) return;
      await verify?.(tx);
      await bound.save(tx,job);
      await finalize?.(tx);
      await bound.changed(tx,job);
    });
    await this.context.events.dispatch();
  }

}
