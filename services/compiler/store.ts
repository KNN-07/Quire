import { z } from "zod";
import { CompileJobSchema, CompileSettingsSchema, SnapshotSchema, ArtifactSchema, DiagnosticSchema } from "@quire/contracts";
import type { CompileJob, Id, Artifact, Snapshot, CompileSettings } from "@quire/contracts";
import { ServiceError, referenceBlob } from "@quire/runtime";
import type { ModuleContext, Migration, SqlExecutor, Transaction } from "@quire/runtime";

export const migrations: readonly Migration[] = [{
  id: "030-c-compiler",
  sql: `CREATE TABLE compiler_requests (
    job_id TEXT PRIMARY KEY REFERENCES compile_jobs(id), digest TEXT NOT NULL, clean INTEGER NOT NULL DEFAULT 0,
    limits_json TEXT NOT NULL
  ) STRICT;
  CREATE TABLE compiler_previews (
    project_id TEXT NOT NULL, branch TEXT NOT NULL, artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    PRIMARY KEY(project_id,branch)
  ) STRICT;
  CREATE TABLE compiler_cache (
    cache_key TEXT PRIMARY KEY, project_id TEXT NOT NULL, branch TEXT NOT NULL,
    job_id TEXT NOT NULL REFERENCES compile_jobs(id)
  ) STRICT;
  CREATE TABLE compiler_completions (
    job_id TEXT PRIMARY KEY REFERENCES compile_jobs(id), key TEXT NOT NULL, digest TEXT NOT NULL,
    version INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE compiler_diff_requests (
    actor_id TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL,
    operation_id TEXT NOT NULL REFERENCES operations(id), PRIMARY KEY(actor_id,key)
  ) STRICT;`,
  postgres: `CREATE TABLE compiler_requests (
    job_id TEXT PRIMARY KEY REFERENCES compile_jobs(id), digest TEXT NOT NULL, clean BIGINT NOT NULL DEFAULT 0,
    limits_json TEXT NOT NULL
  );
  CREATE TABLE compiler_previews (
    project_id TEXT NOT NULL, branch TEXT NOT NULL, artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    PRIMARY KEY(project_id,branch)
  );
  CREATE TABLE compiler_cache (
    cache_key TEXT PRIMARY KEY, project_id TEXT NOT NULL, branch TEXT NOT NULL,
    job_id TEXT NOT NULL REFERENCES compile_jobs(id)
  );
  CREATE TABLE compiler_completions (
    job_id TEXT PRIMARY KEY REFERENCES compile_jobs(id), key TEXT NOT NULL, digest TEXT NOT NULL,
    version BIGINT NOT NULL
  );
  CREATE TABLE compiler_diff_requests (
    actor_id TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL,
    operation_id TEXT NOT NULL REFERENCES operations(id), PRIMARY KEY(actor_id,key)
  );`,
}, {
  id: "031-c-portable",
  sql: `ALTER TABLE compiler_requests ADD COLUMN preview INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE compiler_requests ADD COLUMN cache_key TEXT;
    ALTER TABLE compile_jobs ADD COLUMN queue_order INTEGER NOT NULL DEFAULT 0;
    UPDATE compile_jobs SET queue_order=rowid;
    CREATE UNIQUE INDEX compiler_queue_order ON compile_jobs(queue_order);
    CREATE TABLE compiler_queue_counter (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL) STRICT;
    INSERT INTO compiler_queue_counter(id,value) SELECT 1,coalesce(max(queue_order),0) FROM compile_jobs;`,
  postgres: `ALTER TABLE compiler_requests ADD COLUMN preview BIGINT NOT NULL DEFAULT 1;
    ALTER TABLE compiler_requests ADD COLUMN cache_key TEXT;
    ALTER TABLE compile_jobs ADD COLUMN queue_order BIGINT NOT NULL DEFAULT 0;
    WITH ordered AS (SELECT id,row_number() OVER (ORDER BY queued_at,id) AS n FROM compile_jobs)
      UPDATE compile_jobs j SET queue_order=ordered.n FROM ordered WHERE j.id=ordered.id;
    CREATE UNIQUE INDEX compiler_queue_order ON compile_jobs(queue_order);
    CREATE TABLE compiler_queue_counter (id BIGINT PRIMARY KEY CHECK(id=1), value BIGINT NOT NULL);
    INSERT INTO compiler_queue_counter(id,value) SELECT 1,coalesce(max(queue_order),0) FROM compile_jobs;`,
}];
const row = z.object({
  id: z.string(), actor_id: z.string(), snapshot_id: z.string(), environment_id: z.string(),
  settings_json: z.string(), status: z.string(), queued_at: z.string(), started_at: z.string().nullable(),
  finished_at: z.string().nullable(), elapsed_ms: z.number().nullable(), failure_code: z.string().nullable(),
  worker_id: z.string().nullable(), attempt: z.number(), fencing_token: z.number(), version: z.number(),
});
export class CompilerStore {
  constructor(readonly context: ModuleContext, readonly db: SqlExecutor = context.db) {}
  withTransaction(tx: Transaction): CompilerStore { return new CompilerStore(this.context, tx); }
  async raw(id: Id) {
    const value = (await this.db.get("SELECT * FROM compile_jobs WHERE id=?", [id]));
    if (!value) throw new ServiceError("NOT_FOUND", 404, "Compile job not found");
    return row.parse(value);
  }
  async snapshot(id: string): Promise<Snapshot> {
    const value = z.object({
      id: z.string(), project_id: z.string(), branch: z.string(), revision: z.number(),
      tree: z.string(), author_id: z.string(), reason: z.string(), created_at: z.string(),
    }).parse((await this.db.get("SELECT * FROM snapshots WHERE id=?", [id])));
    return SnapshotSchema.parse({ id: value.id, scope: { projectId: value.project_id, branch: value.branch },
      revision: value.revision, tree: value.tree, authorId: value.author_id, reason: value.reason, createdAt: value.created_at });
  }
  async get(id: Id): Promise<CompileJob> {
    const value = await this.raw(id);
    const artifacts = (await this.db.all(`SELECT id,job_id AS "jobId",name,mime,bytes,sha256,kind
      FROM artifacts WHERE job_id=? ORDER BY name`, [id])).map((item) => ArtifactSchema.parse(item));
    const diagnostics = (await this.db.all(`SELECT id,job_id AS "jobId",severity,message,file_id AS "fileId",
      line,"column",raw_start AS "rawStart",raw_end AS "rawEnd" FROM diagnostics WHERE job_id=? ORDER BY raw_start`, [id])).map((item) => DiagnosticSchema.parse(item));
    return CompileJobSchema.parse({ id, snapshot: await this.snapshot(value.snapshot_id), status: value.status,
      environmentId: value.environment_id, queuedAt: value.queued_at, startedAt: value.started_at,
      finishedAt: value.finished_at, elapsedMs: value.elapsed_ms, failureCode: value.failure_code,
      workerId: value.worker_id, artifacts, diagnostics });
  }
  async settings(id: Id): Promise<CompileSettings> { return CompileSettingsSchema.parse(JSON.parse((await this.raw(id)).settings_json)); }
  async save(tx: Transaction, job: CompileJob): Promise<void> {
    await tx.run(`UPDATE compile_jobs SET status=?,started_at=?,finished_at=?,elapsed_ms=?,failure_code=?,
      worker_id=?,version=version+1 WHERE id=?`, [job.status, job.startedAt, job.finishedAt,
      job.elapsedMs, job.failureCode, job.workerId, job.id]);
    await tx.run("DELETE FROM diagnostics WHERE job_id=?", [job.id]);
    for (const d of job.diagnostics) await tx.run(`INSERT INTO diagnostics
      (id,job_id,severity,message,file_id,line,"column",raw_start,raw_end) VALUES(?,?,?,?,?,?,?,?,?)`,
      [d.id, d.jobId, d.severity, d.message, d.fileId, d.line, d.column, d.rawStart, d.rawEnd]);
  }
  async changed(tx: Transaction, job: CompileJob): Promise<void> {
    await this.context.events.record(tx, { topic: "job.changed", aggregateId: job.snapshot.scope.projectId,
      payload: { resourceId: job.id, status: job.status } });
  }
  async artifact(input: { readonly jobId: Id; readonly name: string; readonly bytes: Uint8Array;
    readonly kind: Artifact["kind"]; readonly mime: string }, verify?: (tx: Transaction) => Promise<void>): Promise<Artifact> {
    const digest = await this.context.blobs.put(input.bytes);
    const artifact = ArtifactSchema.parse({ id: crypto.randomUUID(), jobId: input.jobId, name: input.name,
      mime: input.mime, bytes: input.bytes.length, sha256: digest, kind: input.kind });
    return this.context.uow.run(async (tx) => {
      await tx.lock("quire:compiler");
      await verify?.(tx);
      const previous = (await this.withTransaction(tx).get(input.jobId)).artifacts.find(item => item.name === input.name);
      if (previous) {
        if (previous.sha256 !== digest) throw new ServiceError("ARTIFACT_CONFLICT", 409, "Immutable artifact already exists");
        return previous;
      }
      await referenceBlob(tx, { digest, bytes: input.bytes.length }, this.context.clock);
      (await tx.run(`INSERT INTO artifacts(id,job_id,name,mime,bytes,sha256,kind,created_at)
        VALUES(?,?,?,?,?,?,?,?)`, [artifact.id, artifact.jobId, artifact.name, artifact.mime, artifact.bytes, artifact.sha256, artifact.kind, this.context.clock.now()]));
      return artifact;
    });
  }
  async artifactById(id: Id): Promise<Artifact> {
    const value = (await this.db.get(`SELECT id,job_id AS "jobId",name,mime,bytes,sha256,kind
      FROM artifacts WHERE id=?`, [id]));
    if (!value) throw new ServiceError("NOT_FOUND", 404, "Artifact not found");
    return ArtifactSchema.parse(value);
  }
}
