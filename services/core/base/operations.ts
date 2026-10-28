import { z } from "zod";
import { OperationSchema, DigestSchema, IdSchema, ScopeSchema, CountSchema, assertNever } from "@quire/contracts";
import type { Id, Operation, Transaction } from "@quire/contracts";
import { referenceBlob } from "@quire/runtime";
import { CoreProjects } from "./projects";
import { sourceZip } from "./archives";
import { newId, fail } from "./store";
import { saveReceipt } from "./receipts";
import type { HttpReceipt } from "./receipts";
import { assertHistoryAccess } from "./history-access";

export const ExportSourceSchema = z.object({
  snapshotId: IdSchema, scope: ScopeSchema, revision: CountSchema, kind: z.enum(["current", "history"]),
}).readonly();
export type ExportSource = z.infer<typeof ExportSourceSchema>;
export async function assertExportSource(service: CoreProjects, input: {
  readonly actorId: Id | null; readonly request?: Request; readonly source: ExportSource;
}): Promise<void> {
  const { source } = input;
  const snapshot = await service.getSnapshot(source.snapshotId);
  if (snapshot.scope.projectId !== source.scope.projectId || snapshot.scope.branch !== source.scope.branch ||
    snapshot.revision !== source.revision) fail("SCOPE_MISMATCH", 400, "Export snapshot provenance mismatch");
  if (input.request) await service.authorizeRead(input.request, source.scope, input.actorId);
  else if (input.actorId) await service.authorize(input.actorId, source.scope, "download");
  else fail("UNAUTHENTICATED", 401, "Project access required");
  switch (source.kind) {
    case "current":
      if ((await service.getBranch(source.scope)).revision === source.revision) return;
      break;
    case "history": break;
    default: assertNever(source.kind);
  }
  await assertHistoryAccess(service.context, { actorId: input.actorId,
    projectId: source.scope.projectId, snapshotId: source.snapshotId });
}

export async function operation(service: CoreProjects, id: Id): Promise<Operation> {
  const row = (await service.one("SELECT * FROM operations WHERE id=?", [id], z.object({
    id: z.string(), kind: z.string(), status: z.string(), progress: z.number(),
    result_json: z.string().nullable(), error_code: z.string().nullable(),
  })));
  return OperationSchema.parse({
    id: row.id, kind: row.kind, status: row.status, progress: row.progress,
    result: row.result_json ? JSON.parse(row.result_json) : null, errorCode: row.error_code
  });
}
export async function exportSource(service: CoreProjects, actorId: Id, input: {
  readonly projectId: Id; readonly snapshotId?: Id; readonly key: string; readonly request?: Request;
  readonly http?: HttpReceipt;
}) {
  const project = (await service.getProject(input.projectId));
  const scope = { projectId: project.id, branch: project.defaultBranch };
  if (input.request) await service.authorizeRequest(input.request, scope, "download");
  else await service.authorize(actorId, scope, "download");
  const revision = (await service.getBranch(scope)).revision;
  const snapshot = input.snapshotId ? (await service.getSnapshot(input.snapshotId))
    : (await service.getSnapshot((await service.one(`SELECT id FROM snapshots WHERE project_id=? AND branch=? AND revision=?
      ORDER BY created_at DESC,id DESC LIMIT 1`, [project.id, scope.branch, revision], z.object({ id: IdSchema }))).id));
  if (snapshot.scope.projectId !== project.id) fail("SCOPE_MISMATCH", 400, "Snapshot belongs to another project");
  const source: ExportSource = { snapshotId: snapshot.id, scope: snapshot.scope, revision: snapshot.revision,
    kind: input.snapshotId ? "history" : "current" };
  await assertExportSource(service, { actorId, source, ...(input.request ? { request: input.request } : {}) });
  const bytes = await sourceZip(service, snapshot);
  return recordOperation(service, {
    actorId, key: input.key, kind: "source-export", bytes, projectIds: [project.id],
    sourceSnapshots: [source],
    preflight: async bound => assertExportSource(bound, { actorId, source, ...(input.request ? { request: input.request } : {}) }),
    ...(input.http ? { http: input.http } : {})
  });
}
export async function recordOperation(service: CoreProjects, input: {
  readonly actorId: Id | null; readonly key: string; readonly kind: string;
  readonly bytes?: Uint8Array; readonly projectIds: readonly Id[];
  readonly preflight?: (bound: CoreProjects, tx: Transaction) => Promise<void>;
  readonly http?: HttpReceipt;
  readonly sourceSnapshots?: readonly ExportSource[];
  readonly grant?: { readonly projectId: Id; readonly tokenHash: string; readonly digest: string };
}) {
  const id = newId();
  const blob = input.bytes ? await service.context.blobs.put(input.bytes) : null;
  const now = service.context.clock.now();
  const result = await service.context.uow.run(async (tx) => {
    await tx.lock("quire:accounts");
    const boundContext = { ...service.context, db: tx };
    const boundService = new CoreProjects(boundContext);

    const existing = input.grant ? await tx.get<{ id: string }>(
      "SELECT operation_id AS id FROM base_operation_grants WHERE project_id=? AND token_hash=? AND request_key=?",
      [input.grant.projectId, input.grant.tokenHash, input.key])
      : await tx.get<{ id: string }>("SELECT id FROM operations WHERE actor_id=? AND idempotency_key=?", [input.actorId, input.key]);
    if (existing) {
      const prior = await operation(boundService, IdSchema.parse(existing.id));
      if (input.http) await saveReceipt(boundContext, { ...input.http, response: JSON.stringify({ data: prior, etag: null }) });
      return prior;
    }
    await input.preflight?.(boundService, tx);
    if (blob && input.bytes) (await referenceBlob(tx, { digest: blob, bytes: input.bytes.length }, boundContext.clock));
    (await tx.run(`INSERT INTO operations(id,actor_id,kind,status,progress,result_json,idempotency_key,created_at,updated_at)
      VALUES(?,?,?,'succeeded',1,?,?,?,?)`, [id, input.actorId, input.kind, JSON.stringify({ blob, projectIds: input.projectIds,
      ...(input.sourceSnapshots ? { sourceSnapshots: input.sourceSnapshots } : {}) }), input.key, now, now]));
    if (input.grant) await tx.run(`INSERT INTO base_operation_grants
      (operation_id,project_id,token_hash,request_key,request_digest) VALUES(?,?,?,?,?)`,
      [id, input.grant.projectId, input.grant.tokenHash, input.key, input.grant.digest]);
    const created = await operation(boundService, id);
    if (input.http) await saveReceipt(boundContext, { ...input.http, response: JSON.stringify({ data: created, etag: null }) });
    await boundContext.events.record(tx, {
      topic: "operation.changed", aggregateId: id,
      payload: { resourceId: id, status: "succeeded" }
    });
    return created;
  });
  (await service.context.events.dispatch());
  return result;
}
export async function downloadOperation(service: CoreProjects, actorId: Id | null, input: {
  readonly id: Id; readonly request?: Request; readonly responseHeaders?: Headers;
}) {
  const row = (await service.one("SELECT actor_id,kind,result_json FROM operations WHERE id=?", [input.id],
    z.object({ actor_id: z.string().nullable(), kind: z.string(), result_json: z.string().nullable() })));
  if (!row.result_json) fail("NOT_FOUND", 404, "Operation not found");
  if (row.actor_id !== null) {
    if (row.actor_id !== actorId) fail("NOT_FOUND", 404, "Operation not found");
  } else {
    const token = input.request?.headers.get("x-project-token");
    if (!token || !(await service.context.db.get("SELECT 1 FROM base_operation_grants WHERE operation_id=? AND token_hash=?", [input.id, new Bun.CryptoHasher("sha256").update(token).digest("hex")]))) fail("NOT_FOUND", 404, "Operation not found");
  }
  const result = z.object({
    blob: DigestSchema.nullable(), projectIds: z.array(IdSchema), operatorOnly: z.boolean().optional(),
    sourceSnapshots: z.array(ExportSourceSchema).min(1).optional(),
    mime: z.string().regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/).optional(),
    filename: z.string().min(1).max(255).regex(/^[a-zA-Z0-9._ -]+$/).optional(),
  }).parse(JSON.parse(row.result_json));
  const recheck = async (bound: CoreProjects) => {
    if (result.operatorOnly) {
      if (!actorId) fail("FORBIDDEN", 403, "Operator access required for this download");
      const user = (await bound.one("SELECT operator,suspended,deleted_at FROM users WHERE id=?", [actorId],
        z.object({ operator: z.number(), suspended: z.number(), deleted_at: z.string().nullable() })));
      if (user.operator !== 1 || user.suspended !== 0 || user.deleted_at !== null) {
        fail("FORBIDDEN", 403, "Operator access required for this download");
      }
    }
    for (const projectId of result.projectIds) {
      const project = (await bound.getProject(projectId));
      const scope = { projectId: project.id, branch: project.defaultBranch };
      if (input.request) await bound.authorizeRead(input.request, scope, actorId);
      else if (actorId) await bound.authorize(actorId, scope, "download");
      else fail("UNAUTHENTICATED", 401, "Project access required");
    }
    if (row.kind === "source-export") {
      const sources = result.sourceSnapshots;
      if (sources) {
        if (sources.length !== result.projectIds.length ||
          result.projectIds.some(projectId => !sources.some(source => source.scope.projectId === projectId))) {
          fail("SCOPE_MISMATCH", 400, "Export project provenance mismatch");
        }
        for (const source of sources) await assertExportSource(bound,
          { actorId, source, ...(input.request ? { request: input.request } : {}) });
      } else {
        if (!result.projectIds.length) fail("HISTORY_WINDOW", 403, "Legacy source export has no trustworthy snapshot provenance; re-export current source");
        for (const projectId of result.projectIds) {
          const project = await bound.getProject(projectId);
          if ((await bound.policy(actorId ?? project.ownerId, projectId)).historyDays !== null) {
            fail("HISTORY_WINDOW", 403, "Legacy source export has no trustworthy snapshot provenance; re-export current source");
          }
        }
      }
    }
  };
  await service.context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await recheck(new CoreProjects({ ...service.context, db: tx }));
  });
  if (!result.blob) fail("NO_DOWNLOAD", 404, "Operation has no downloadable content");
  const bytes = await service.context.blobs.get(result.blob);
  await service.context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await recheck(new CoreProjects({ ...service.context, db: tx }));
  });
  input.responseHeaders?.set("content-type", result.mime ?? "application/zip");
  input.responseHeaders?.set("content-disposition", `attachment; filename="${result.filename ?? "source.zip"}"`);
  return bytes;
}
