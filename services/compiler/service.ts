import { z } from "zod";
import { CompileSettingsSchema, CompileJobSchema, IdSchema } from "@quire/contracts";
import type { CompilePort, CompileJob, CompileRequest, Id, Environment, Artifact } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { build } from "../../workers/compiler/build";
import { CompilerStore } from "./store";
import { parseDiagnostics } from "./diagnostics";
import { defaultLimits } from "../../workers/compiler/sandbox";
import type { Limits } from "../../workers/compiler/sandbox";

export class CompilerService implements CompilePort {
  readonly store: CompilerStore;
  readonly active = new Map<Id, { readonly controller: AbortController; readonly promise: Promise<void> }>();
  readonly pending = new Set<Promise<unknown>>();
  readonly historical = new Set<Id>();
  readonly shutdown = new AbortController();
  running = false;
  leaseTimer: ReturnType<typeof setInterval> | null = null;
  constructor(readonly context: ModuleContext, readonly environment: Environment) {
    this.store = new CompilerStore(context);
  }
  async enqueue(actorId: Id, request: CompileRequest, key: string): Promise<CompileJob> {
    const projects = this.context.services.get("projects");
    await projects.authorize(actorId, request.scope, "compile");
    const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(request)).digest("hex");
    const existing = z.object({ id: IdSchema, digest: z.string() }).nullable().parse(this.context.db.query(
      `SELECT j.id,r.digest FROM compile_jobs j JOIN compiler_requests r ON r.job_id=j.id
       WHERE j.actor_id=? AND j.idempotency_key=?`).get(actorId, key));
    if (existing) {
      if (existing.digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Key already used for a different compile request");
      return this.store.get(existing.id);
    }
    const stored = z.object({ settings_json: z.string() }).nullable().parse(
      this.context.db.query("SELECT settings_json FROM projects WHERE id=?").get(request.scope.projectId));
    const settings = request.settings ?? CompileSettingsSchema.parse(JSON.parse(stored?.settings_json ?? "null"));
    if (settings.environmentId !== this.environment.id || !this.environment.available) {
      throw new ServiceError("ENVIRONMENT_UNAVAILABLE", 503, "Requested compiler environment has not passed its confinement probe");
    }
    const snapshot = await projects.snapshot(actorId, request.scope, request.expectedRevision);
    const policy = await this.context.services.get("policy").forProject(actorId, request.scope.projectId);
    if (policy.compileSeconds <= 0) throw new ServiceError("COMPILE_DISABLED", 403, "Project policy does not allow compilation time");
    const limits = { ...defaultLimits, wallSeconds: Math.min(600, policy.compileSeconds) };
    const job = CompileJobSchema.parse({ id: crypto.randomUUID(), snapshot, status: "queued",
      environmentId: settings.environmentId, queuedAt: this.context.clock.now(), startedAt: null,
      finishedAt: null, elapsedMs: null, diagnostics: [], artifacts: [], failureCode: null, workerId: null });
    this.context.uow.local((tx) => {
      tx.query(`INSERT INTO compile_jobs(id,actor_id,snapshot_id,environment_id,settings_json,status,
        queued_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?)`).run(job.id, actorId, snapshot.id,
        settings.environmentId, JSON.stringify(settings), job.status, job.queuedAt, key);
      tx.query("INSERT INTO compiler_requests(job_id,digest,clean,limits_json) VALUES(?,?,?,?)")
        .run(job.id, digest, Number(request.clean), JSON.stringify(limits));
    });
    this.store.save(job);
    this.pump();
    return job;
  }
  async get(actorId: Id, id: Id): Promise<CompileJob> {
    const job = this.store.get(id);
    await this.context.services.get("projects").authorize(actorId, job.snapshot.scope, "read");
    return job;
  }
  limits(id: Id): Limits {
    const row = z.object({ limits_json: z.string() }).nullable().parse(
      this.context.db.query("SELECT limits_json FROM compiler_requests WHERE job_id=?").get(id));
    return row ? z.object({ wallSeconds: z.number().positive().max(600), memoryBytes: z.number().positive(),
      processes: z.number().int().positive(), workspaceBytes: z.number().positive() }).parse(JSON.parse(row.limits_json)) : defaultLimits;
  }
  async cancel(actorId: Id, id: Id): Promise<void> {
    const job = await this.get(actorId, id);
    await this.context.services.get("projects").authorize(actorId, job.snapshot.scope, "compile");
    if (job.status !== "queued" && job.status !== "running") return;
    this.store.save({ ...job, status: "canceled", finishedAt: this.context.clock.now(), failureCode: "CANCELED" });
    const active = this.active.get(id);
    if (active) { active.controller.abort(); await active.promise; }
  }
  pump(): void {
    if (!this.running) return;
    const rows = this.context.db.query<{ id: string }, []>(
      "SELECT id FROM compile_jobs WHERE status='queued' ORDER BY queued_at,id").all();
    for (const row of rows) {
      if (this.active.size >= 2) break;
      const id = IdSchema.parse(row.id);
      if (this.active.has(id)) continue;
      void this.runJob(id, !this.historical.has(id));
    }
  }
  async runJob(id: Id, preview = true): Promise<void> {
    if (!preview) this.historical.add(id);
    const existing = this.active.get(id);
    if (existing) return existing.promise;
    if (this.active.size >= 2) {
      await Promise.race([...this.active.values()].map((active) => active.promise));
      if (this.store.get(id).status !== "queued") return this.active.get(id)?.promise;
      return this.runJob(id, preview);
    }
    const controller = new AbortController();
    const promise = this.execute(id, controller.signal, preview).finally(() => {
      this.active.delete(id); this.historical.delete(id); this.pump();
    });
    this.active.set(id, { controller, promise });
    return promise;
  }
  async start(): Promise<void> {
    if (this.running) return;
    const stale = this.context.db.query<{ id: string }, []>(
      "SELECT id FROM compile_jobs WHERE status='running' AND worker_id IS NULL").all();
    for (const row of stale) {
      const id = IdSchema.parse(row.id);
      const stopped = Bun.spawn(["/usr/bin/systemctl", "--user", "stop", `quire-compile-${id}.service`], { stdout: "ignore", stderr: "ignore" });
      await stopped.exited;
      this.store.save({ ...this.store.get(id), status: "failed", finishedAt: this.context.clock.now(), failureCode: "WORKER_RESTARTED" });
    }
    this.running = true;
    this.pump();
  }
  async stop(): Promise<void> {
    this.running = false;
    this.shutdown.abort();
    if (this.leaseTimer) { clearInterval(this.leaseTimer); this.leaseTimer = null; }
    for (const [id, active] of this.active) {
      active.controller.abort();
      this.store.save({ ...this.store.get(id), status: "canceled", finishedAt: this.context.clock.now(), failureCode: "WORKER_STOPPED" });
    }
    await Promise.all([...this.active.values()].map((active) => active.promise));
    await Promise.all(this.pending);
  }
  task<T>(promise: Promise<T>): Promise<T> {
    const tracked = promise.finally(() => { this.pending.delete(tracked); });
    this.pending.add(tracked);
    return tracked;
  }
  async execute(id: Id, signal: AbortSignal, preview = true): Promise<void> {
    const started = performance.now();
    const job = this.store.get(id);
    this.store.save({ ...job, status: "running", startedAt: this.context.clock.now() });
    try {
      if (!this.environment.available || job.environmentId !== this.environment.id) {
        throw new ServiceError("ENVIRONMENT_UNAVAILABLE", 503, "Job does not match the probed native environment");
      }
      const source = await this.context.services.get("projects").readSnapshot(job.snapshot.id);
      const settings = this.store.settings(id);
      const cacheKey = new Bun.CryptoHasher("sha256").update(JSON.stringify({
        scope: job.snapshot.scope,
        files: source.files.map((file) => [file.id, file.path, file.blob]),
        settings, environment: this.environment.rootOrImageDigest,
      })).digest("hex");
      const clean = z.object({ clean: z.number() }).nullable().parse(
        this.context.db.query("SELECT clean FROM compiler_requests WHERE job_id=?").get(id))?.clean ?? 1;
      if (clean) this.context.db.query("DELETE FROM compiler_cache WHERE project_id=? AND branch=?")
        .run(job.snapshot.scope.projectId, job.snapshot.scope.branch);
      const cached = z.object({ job_id: IdSchema }).nullable().parse(this.context.db.query(
        "SELECT job_id FROM compiler_cache WHERE cache_key=?").get(cacheKey));
      if (cached) {
        const previous = this.store.get(cached.job_id);
        for (const artifact of previous.artifacts.filter((item) => item.kind !== "diff")) await this.store.artifact({ jobId: id, name: artifact.name,
          bytes: await this.context.blobs.get(artifact.sha256), mime: artifact.mime, kind: artifact.kind });
        if (this.store.get(id).status === "canceled") return;
        this.store.save({ ...this.store.get(id), status: "succeeded", finishedAt: this.context.clock.now(),
          elapsedMs: Math.round(performance.now() - started),
          diagnostics: previous.diagnostics.map((item) => ({ ...item, id: IdSchema.parse(crypto.randomUUID()), jobId: id })) },
          () => { if (preview) this.publishPreview(id); });
        return;
      }
      const result = await build({ files: source.files, blobs: this.context.blobs, settings, signal, unitId: id, limits: this.limits(id) });
      if (this.store.get(id).status === "canceled") return;
      await this.store.artifact({ jobId: id, name: "build.log", bytes: new TextEncoder().encode(result.log), kind: "log", mime: "text/plain" });
      for (const [name, bytes] of result.files) {
        if (/^(?:tmp|cache|texmf-var|texmf-config)\//.test(name) || ["build.log", "exit-code"].includes(name)) continue;
        const kind: Artifact["kind"] = name.endsWith(".pdf") ? "pdf" : name.endsWith(".dvi") ? "dvi" :
          name.endsWith(".synctex.gz") ? "synctex" : "generated";
        await this.store.artifact({ jobId: id, name, bytes, kind, mime: kind === "pdf" ? "application/pdf" : "application/octet-stream" });
      }
      const current = this.store.get(id);
      if (current.status === "canceled") return;
      const status = result.success ? "succeeded" : result.log.includes("result: timeout") ? "timeout" : "failed";
      this.store.save({ ...current, status, finishedAt: this.context.clock.now(),
        elapsedMs: Math.round(performance.now() - started),
        diagnostics: parseDiagnostics({ jobId: id, log: result.log, files: source.files }),
        failureCode: result.success ? null : status === "timeout" ? "WALL_LIMIT" :
          result.log.includes("result: oom-kill") ? "MEMORY_LIMIT" : "COMPILE_FAILED" }, () => {
        if (result.success) {
          if (preview) this.publishPreview(id);
          this.context.db.query("INSERT OR REPLACE INTO compiler_cache(cache_key,project_id,branch,job_id) VALUES(?,?,?,?)")
            .run(cacheKey, job.snapshot.scope.projectId, job.snapshot.scope.branch, id);
        }
      });
    } catch (error) {
      if (this.store.get(id).status === "canceled") return;
      if (!(error instanceof Error)) throw error;
      console.error("compiler.job.failed", { jobId: id, code: error instanceof ServiceError ? error.code : error.name });
      this.store.save({ ...this.store.get(id), status: "failed", finishedAt: this.context.clock.now(),
        elapsedMs: Math.round(performance.now() - started), failureCode: error instanceof ServiceError ? error.code : "WORKER_FAILURE" });
    }
  }
  publishPreview(id: Id): void {
    const job = this.store.get(id);
    const pdf = z.object({ id: IdSchema }).nullable().parse(this.context.db.query(`
      SELECT a.id FROM artifacts a JOIN compile_jobs j ON j.id=a.job_id
      JOIN snapshots s ON s.id=j.snapshot_id JOIN compiler_requests r ON r.job_id=j.id
      WHERE s.project_id=? AND s.branch=? AND j.status='succeeded' AND a.name='output.pdf'
      ORDER BY s.revision DESC,j.queued_at DESC,j.rowid DESC LIMIT 1`)
      .get(job.snapshot.scope.projectId, job.snapshot.scope.branch));
    if (!pdf) throw new ServiceError("INVALID_PDF", 422, "Successful compile has no validated PDF");
    this.context.db.query(`INSERT INTO compiler_previews(project_id,branch,artifact_id) VALUES(?,?,?)
      ON CONFLICT(project_id,branch) DO UPDATE SET artifact_id=excluded.artifact_id`)
      .run(job.snapshot.scope.projectId, job.snapshot.scope.branch, pdf.id);
  }
}
