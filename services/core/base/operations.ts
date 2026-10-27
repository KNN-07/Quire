import { z } from "zod";
import { OperationSchema, DigestSchema, IdSchema } from "@quire/contracts";
import type { Id, Operation } from "@quire/contracts";
import { referenceBlob } from "@quire/runtime";
import type { CoreProjects } from "./projects";
import { sourceZip } from "./archives";
import { newId, fail } from "./store";

export function operation(service: CoreProjects, id: Id): Operation {
  const row = service.one("SELECT * FROM operations WHERE id=?", [id], z.object({
    id: z.string(), kind: z.string(), status: z.string(), progress: z.number(),
    result_json: z.string().nullable(), error_code: z.string().nullable(),
  }));
  return OperationSchema.parse({ id: row.id, kind: row.kind, status: row.status, progress: row.progress,
    result: row.result_json ? JSON.parse(row.result_json) : null, errorCode: row.error_code });
}
export async function exportSource(service: CoreProjects, actorId: Id, input: {
  readonly projectId: Id; readonly snapshotId?: Id; readonly key: string; readonly request?: Request;
}) {
  const project = service.getProject(input.projectId);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  if (input.request) await service.authorizeRequest(input.request, scope, "download");
  else await service.authorize(actorId, scope, "download");
  const revision = service.getBranch(scope).revision;
  const snapshot = input.snapshotId ? service.getSnapshot(input.snapshotId)
    : service.getSnapshot(service.one(`SELECT id FROM snapshots WHERE project_id=? AND branch=? AND revision=?
      ORDER BY created_at DESC,id DESC LIMIT 1`, [project.id, scope.branch, revision], z.object({ id: IdSchema })).id);
  if (snapshot.scope.projectId !== project.id) fail("SCOPE_MISMATCH", 400, "Snapshot belongs to another project");
  const bytes = await sourceZip(service, snapshot);
  return recordOperation(service, { actorId, key: input.key, kind: "source-export", bytes, projectIds: [project.id] });
}
export async function recordOperation(service: CoreProjects, input: {
  readonly actorId: Id | null; readonly key: string; readonly kind: string;
  readonly bytes?: Uint8Array; readonly projectIds: readonly Id[];
  readonly preflight?: () => void;
}) {
  const existing = service.context.db.query<{ id: string }, [string | null, string]>(
    "SELECT id FROM operations WHERE actor_id=? AND idempotency_key=?").get(input.actorId, input.key);
  if (existing) return operation(service, IdSchema.parse(existing.id));
  const id = newId();
  const blob = input.bytes ? await service.context.blobs.put(input.bytes) : null;
  const now = service.context.clock.now();
  service.context.uow.local((tx) => {
    input.preflight?.();
    if (blob && input.bytes) referenceBlob(tx, { digest: blob, bytes: input.bytes.length }, service.context.clock);
    tx.query(`INSERT INTO operations(id,actor_id,kind,status,progress,result_json,idempotency_key,created_at,updated_at)
      VALUES(?,?,?,'succeeded',1,?,?,?,?)`).run(id, input.actorId, input.kind,
      JSON.stringify({ blob, projectIds: input.projectIds }), input.key, now, now);
    service.context.events.append(tx, { topic: "operation.changed", aggregateId: id,
      payload: { resourceId: id, status: "succeeded" } });
  });
  service.context.events.dispatch();
  return operation(service, id);
}
export async function downloadOperation(service: CoreProjects, actorId: Id | null, input: {
  readonly id: Id; readonly request?: Request; readonly responseHeaders?: Headers;
}) {
  const row = service.one("SELECT actor_id,result_json FROM operations WHERE id=?", [input.id],
    z.object({ actor_id: z.string().nullable(), result_json: z.string().nullable() }));
  if (!row.result_json) fail("NOT_FOUND", 404, "Operation not found");
  if (row.actor_id !== null) {
    if (row.actor_id !== actorId) fail("NOT_FOUND", 404, "Operation not found");
  } else {
    const token = input.request?.headers.get("x-project-token");
    if (!token || !service.context.db.query("SELECT 1 FROM base_operation_grants WHERE operation_id=? AND token_hash=?")
      .get(input.id, new Bun.CryptoHasher("sha256").update(token).digest("hex"))) fail("NOT_FOUND", 404, "Operation not found");
  }
  const result = z.object({
    blob: DigestSchema.nullable(), projectIds: z.array(z.string()), operatorOnly: z.boolean().optional(),
    mime: z.string().regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/).optional(),
    filename: z.string().min(1).max(255).regex(/^[a-zA-Z0-9._ -]+$/).optional(),
  }).parse(JSON.parse(row.result_json));
  if (result.operatorOnly) {
    if (!actorId) fail("FORBIDDEN", 403, "Operator access required for this download");
    const user = service.one("SELECT operator,suspended,deleted_at FROM users WHERE id=?", [actorId],
      z.object({ operator: z.number(), suspended: z.number(), deleted_at: z.string().nullable() }));
    if (user.operator !== 1 || user.suspended !== 0 || user.deleted_at !== null) {
      fail("FORBIDDEN", 403, "Operator access required for this download");
    }
  }
  for (const projectId of result.projectIds) {
    const project = service.getProject(IdSchema.parse(projectId));
    const scope = { projectId: project.id, branch: project.defaultBranch };
    if (input.request) await service.authorizeRequest(input.request, scope, "download");
    else if (actorId) await service.authorize(actorId, scope, "download");
    else fail("UNAUTHENTICATED", 401, "Project access required");
  }
  if (!result.blob) fail("NO_DOWNLOAD", 404, "Operation has no downloadable content");
  const bytes = await service.context.blobs.get(result.blob);
  input.responseHeaders?.set("content-type", result.mime ?? "application/zip");
  input.responseHeaders?.set("content-disposition", `attachment; filename="${result.filename ?? "source.zip"}"`);
  return bytes;
}
