import { z } from "zod";
import { IdSchema, CompileSettingsSchema, OperationSchema } from "@quire/contracts";
import type { Id, Operation, RequestOf, Snapshot, CompileSettings, endpoints } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { renderedDifference } from "../../workers/compiler/pdf-diff";
import type { CompilerService } from "./service";

export async function pdfDifference(service: CompilerService, actor: Id,
  input: RequestOf<typeof endpoints.pdfDiff>) {
  const { context, store } = service;
  const snapshots = [store.snapshot(input.body.fromSnapshotId), store.snapshot(input.body.toSnapshotId)] as const;
  for (const snapshot of snapshots) {
    if (snapshot.scope.projectId !== input.params.p) throw new ServiceError("SCOPE_MISMATCH", 400, "Snapshot belongs to another project");
    await context.services.get("projects").authorize(actor, snapshot.scope, "compile");
  }
  const key = z.string().min(1).parse(input.headers?.["idempotency-key"]);
  const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(input.body)).digest("hex");
  const previous = z.object({ id: IdSchema, status: z.string(), progress: z.number(),
    result_json: z.string().nullable(), error_code: z.string().nullable(), digest: z.string() }).nullable().parse(
    context.db.query(`SELECT o.id,o.status,o.progress,o.result_json,o.error_code,r.digest
      FROM operations o JOIN compiler_diff_requests r ON r.operation_id=o.id WHERE r.actor_id=? AND r.key=?`).get(actor, key));
  if (previous) {
    if (previous.digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Key already names another PDF comparison");
    return OperationSchema.parse({ id: previous.id, kind: "pdf-diff", status: previous.status, progress: previous.progress,
      result: previous.result_json ? JSON.parse(previous.result_json) : null, errorCode: previous.error_code });
  }
  const settingsRow = z.object({ settings_json: z.string() }).parse(context.db.query("SELECT settings_json FROM projects WHERE id=?").get(input.params.p));
  const settings = CompileSettingsSchema.parse(JSON.parse(settingsRow.settings_json));
  const operationId = IdSchema.parse(crypto.randomUUID());
  context.uow.local((tx) => {
    tx.query(`INSERT INTO operations(id,actor_id,kind,status,progress,idempotency_key,created_at,updated_at)
      VALUES(?,?,'pdf-diff','running',0,?,?,?)`).run(operationId, actor, `compiler:pdf-diff:${key}`, context.clock.now(), context.clock.now());
    tx.query("INSERT INTO compiler_diff_requests(actor_id,key,digest,operation_id) VALUES(?,?,?,?)").run(actor, key, digest, operationId);
  });
  const running = OperationSchema.parse({ id: operationId, kind: "pdf-diff", status: "running", progress: 0,
    result: null, errorCode: null });
  void service.task(completeDifference(service, { operationId, actor, snapshots, settings, mode: input.body.mode }));
  return running;
}
type DiffWork = {
  readonly operationId: Id; readonly actor: Id; readonly snapshots: readonly [Snapshot, Snapshot];
  readonly settings: CompileSettings; readonly mode: "side-by-side" | "overlay";
};
async function completeDifference(service: CompilerService, work: DiffWork): Promise<void> {
  const { context, store } = service;
  const { operationId, actor, snapshots, settings, mode } = work;
  let operation: Operation;
  try {
    const jobs = [];
    for (const snapshot of snapshots) {
      const id = IdSchema.parse(crypto.randomUUID());
      context.db.query(`INSERT INTO compile_jobs(id,actor_id,snapshot_id,environment_id,settings_json,status,queued_at,idempotency_key)
        VALUES(?,?,?,?,?,'queued',?,?)`).run(id, actor, snapshot.id, settings.environmentId,
        JSON.stringify(settings), context.clock.now(), `diff:${operationId}:${id}`);
      await service.runJob(id, false);
      const job = store.get(id);
      if (job.status !== "succeeded") throw new ServiceError("DIFF_COMPILE_FAILED", 422, `Snapshot compile failed: ${job.failureCode}`);
      jobs.push(job);
    }
    const [left, right] = jobs;
    const from = left?.artifacts.find((artifact) => artifact.name === "output.pdf");
    const to = right?.artifacts.find((artifact) => artifact.name === "output.pdf");
    if (!left || !right || !from || !to) throw new ServiceError("DIFF_PDF_MISSING", 422, "Both snapshots must produce a PDF");
    const result = await renderedDifference({ from: await context.blobs.get(from.sha256),
      to: await context.blobs.get(to.sha256), mode, signal: service.shutdown.signal });
    const artifact = await store.artifact({ jobId: right.id, name: `diff-${mode}.pdf`,
      bytes: result.pdf, kind: "diff", mime: "application/pdf" });
    const preview = await store.artifact({ jobId: right.id, name: `diff-${mode}.png`,
      bytes: result.preview, kind: "diff", mime: "image/png" });
    const pages = [];
    for (const [name, bytes] of result.images) pages.push(await store.artifact({
      jobId: right.id, name, bytes, kind: "diff", mime: name.endsWith(".png") ? "image/png" : "image/x-portable-pixmap" }));
    operation = OperationSchema.parse({ id: operationId, kind: "pdf-diff", status: "succeeded", progress: 1,
      result: { artifactId: artifact.id, previewArtifactId: preview.id, pages, regions: result.regions,
        fromJobId: left.id, toJobId: right.id, mode }, errorCode: null });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error("compiler.diff.failed", { operationId, code: error instanceof ServiceError ? error.code : error.name });
    operation = OperationSchema.parse({ id: operationId, kind: "pdf-diff", status: "failed", progress: 0,
      result: null, errorCode: error instanceof ServiceError ? error.code : "PDF_DIFF_FAILED" });
  }
  context.uow.local((tx) => {
    tx.query("UPDATE operations SET status=?,progress=?,result_json=?,error_code=?,updated_at=? WHERE id=?")
      .run(operation.status, operation.progress, operation.result ? JSON.stringify(operation.result) : null,
        operation.errorCode, context.clock.now(), operation.id);
    context.events.append(tx, { topic: "operation.changed", aggregateId: snapshots[0].scope.projectId,
      payload: { resourceId: operation.id, status: operation.status } });
  });
  context.events.dispatch();
}
