import { z } from "zod";
import { CompileJobSchema, CompileSettingsSchema, SnapshotSchema, ArtifactSchema, DiagnosticSchema } from "@quire/contracts";
import type { CompileJob, Id, Artifact, Snapshot, CompileSettings } from "@quire/contracts";
import { ServiceError, referenceBlob } from "@quire/runtime";
import type { ModuleContext, Migration } from "@quire/runtime";

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
}];
const row = z.object({
  id: z.string(), actor_id: z.string(), snapshot_id: z.string(), environment_id: z.string(),
  settings_json: z.string(), status: z.string(), queued_at: z.string(), started_at: z.string().nullable(),
  finished_at: z.string().nullable(), elapsed_ms: z.number().nullable(), failure_code: z.string().nullable(),
  worker_id: z.string().nullable(), attempt: z.number(), fencing_token: z.number(), version: z.number(),
});
export class CompilerStore {
  constructor(readonly context: ModuleContext) {}
  raw(id: Id) {
    const value = this.context.db.query("SELECT * FROM compile_jobs WHERE id=?").get(id);
    if (!value) throw new ServiceError("NOT_FOUND", 404, "Compile job not found");
    return row.parse(value);
  }
  snapshot(id: string): Snapshot {
    const value = z.object({
      id: z.string(), project_id: z.string(), branch: z.string(), revision: z.number(),
      tree: z.string(), author_id: z.string(), reason: z.string(), created_at: z.string(),
    }).parse(this.context.db.query("SELECT * FROM snapshots WHERE id=?").get(id));
    return SnapshotSchema.parse({ id: value.id, scope: { projectId: value.project_id, branch: value.branch },
      revision: value.revision, tree: value.tree, authorId: value.author_id, reason: value.reason, createdAt: value.created_at });
  }
  get(id: Id): CompileJob {
    const value = this.raw(id);
    const artifacts = this.context.db.query(`SELECT id,job_id AS jobId,name,mime,bytes,sha256,kind
      FROM artifacts WHERE job_id=? ORDER BY name`).all(id).map((item) => ArtifactSchema.parse(item));
    const diagnostics = this.context.db.query(`SELECT id,job_id AS jobId,severity,message,file_id AS fileId,
      line,column,raw_start AS rawStart,raw_end AS rawEnd FROM diagnostics WHERE job_id=? ORDER BY raw_start`)
      .all(id).map((item) => DiagnosticSchema.parse(item));
    return CompileJobSchema.parse({ id, snapshot: this.snapshot(value.snapshot_id), status: value.status,
      environmentId: value.environment_id, queuedAt: value.queued_at, startedAt: value.started_at,
      finishedAt: value.finished_at, elapsedMs: value.elapsed_ms, failureCode: value.failure_code,
      workerId: value.worker_id, artifacts, diagnostics });
  }
  settings(id: Id): CompileSettings { return CompileSettingsSchema.parse(JSON.parse(this.raw(id).settings_json)); }
  save(job: CompileJob, finalize?: () => void): void {
    this.context.uow.local((tx) => {
      tx.query(`UPDATE compile_jobs SET status=?,started_at=?,finished_at=?,elapsed_ms=?,failure_code=?,
        worker_id=?,version=version+1 WHERE id=?`).run(job.status, job.startedAt, job.finishedAt,
        job.elapsedMs, job.failureCode, job.workerId, job.id);
      tx.query("DELETE FROM diagnostics WHERE job_id=?").run(job.id);
      for (const d of job.diagnostics) tx.query(`INSERT INTO diagnostics
        (id,job_id,severity,message,file_id,line,column,raw_start,raw_end) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(d.id, d.jobId, d.severity, d.message, d.fileId, d.line, d.column, d.rawStart, d.rawEnd);
      finalize?.();
      this.context.events.append(tx, { topic: "job.changed", aggregateId: job.snapshot.scope.projectId,
        payload: { resourceId: job.id, status: job.status } });
    });
    this.context.events.dispatch();
  }
  async artifact(input: { readonly jobId: Id; readonly name: string; readonly bytes: Uint8Array;
    readonly kind: Artifact["kind"]; readonly mime: string }, verify?: () => void): Promise<Artifact> {
    const digest = await this.context.blobs.put(input.bytes);
    const artifact = ArtifactSchema.parse({ id: crypto.randomUUID(), jobId: input.jobId, name: input.name,
      mime: input.mime, bytes: input.bytes.length, sha256: digest, kind: input.kind });
    this.context.uow.local((tx) => {
      verify?.();
      referenceBlob(tx, { digest, bytes: input.bytes.length }, this.context.clock);
      tx.query(`INSERT INTO artifacts(id,job_id,name,mime,bytes,sha256,kind,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(artifact.id, artifact.jobId, artifact.name, artifact.mime,
        artifact.bytes, artifact.sha256, artifact.kind, this.context.clock.now());
    });
    return artifact;
  }
  artifactById(id: Id): Artifact {
    const value = this.context.db.query(`SELECT id,job_id AS jobId,name,mime,bytes,sha256,kind
      FROM artifacts WHERE id=?`).get(id);
    if (!value) throw new ServiceError("NOT_FOUND", 404, "Artifact not found");
    return ArtifactSchema.parse(value);
  }
}
