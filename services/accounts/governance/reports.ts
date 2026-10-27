import { z } from "zod";
import { endpoints, AuditEntrySchema, OperationSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Principal } from "@quire/runtime";
import { authorize, audit, denied, newId, route } from "./shared";

export function csv(rows: readonly (readonly string[])[]): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(rows.map((row) => row.map((cell) => {
    const safe = /^[\s]*[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n") + "\r\n");
}
type AuditFilter = {
  readonly organizationId?: Id; readonly event?: string | undefined; readonly from?: string | undefined; readonly to?: string | undefined;
  readonly cursor?: string | undefined; readonly limit?: number;
};
export function auditRows(context: ModuleContext, filter: AuditFilter) {
  if (filter.from && filter.to && filter.from > filter.to) throw new ServiceError("INVALID_RANGE", 400, "From must precede to");
  const cursor = filter.cursor === undefined ? 0 : Number(filter.cursor);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new ServiceError("INVALID_CURSOR", 400, "Invalid audit sequence cursor");
  const rows = z.array(z.object({
    id: z.string(), seq: z.number(), at: z.string(), actor_id: z.string().nullable(),
    organization_id: z.string().nullable(), event: z.string(), target_id: z.string(), ip: z.string().nullable(), details_json: z.string(),
  })).parse(context.db.query(
    "SELECT * FROM audit_entries WHERE seq>? AND (? IS NULL OR organization_id=?) AND (? IS NULL OR event=?) AND (? IS NULL OR at>=?) AND (? IS NULL OR at<=?) ORDER BY seq LIMIT ?")
    .all(cursor, filter.organizationId ?? null, filter.organizationId ?? null, filter.event ?? null, filter.event ?? null,
      filter.from ?? null, filter.from ?? null, filter.to ?? null, filter.to ?? null, filter.limit ?? -1));
  return rows.map((row) => AuditEntrySchema.parse({
    id: row.id, seq: row.seq, at: row.at, actorId: row.actor_id, organizationId: row.organization_id,
    event: row.event, targetId: row.target_id, ip: row.ip, details: Object.fromEntries(Object.entries(
      AuditEntrySchema.unwrap().shape.details.parse(JSON.parse(row.details_json))).map(([key, value]) =>
      [key, /password|secret|token|credential|authorization|cookie|private.?key/i.test(key) ? "[redacted]" : value])),
  }));
}
export function exportAudit(context: ModuleContext, principal: Principal, filter: AuditFilter) {
  const rows = auditRows(context, filter);
  const bytes = csv([["sequence", "at", "actorId", "organizationId", "event", "targetId", "details"],
    ...rows.map((row) => [String(row.seq), row.at, row.actorId ?? "", row.organizationId ?? "", row.event,
      row.targetId, JSON.stringify(row.details)])]);
  const result = { format: "csv", mime: "text/csv", filename: "audit.csv", csv: new TextDecoder().decode(bytes), rows: rows.length };
  const operation = OperationSchema.parse({ id: newId(), kind: "audit-export", status: "succeeded", progress: 1, result, errorCode: null });
  context.db.query("INSERT INTO operations(id,actor_id,kind,status,progress,result_json,created_at,updated_at) VALUES(?,?,?,'succeeded',1,?,?,?)")
    .run(operation.id, principal.user.id, operation.kind, JSON.stringify(result), context.clock.now(), context.clock.now());
  audit(context, principal, { organizationId: filter.organizationId ?? null, event: "audit.exported", targetId: operation.id,
    details: { rows: rows.length } });
  return operation;
}
export function operator(principal: Principal): void {
  if (!principal.operator) throw denied();
}
export function registerReports(context: ModuleContext): void {
  route(context, endpoints.organizationAudit, ({ params, query }, principal) => {
    authorize(context, principal, { organizationId: params.o, level: "admin" });
    const rows = auditRows(context, { organizationId: params.o, ...query, limit: query.limit + 1 });
    return { items: rows.slice(0, query.limit), nextCursor: rows.length > query.limit ? String(rows[query.limit - 1]?.seq) : null };
  });
  route(context, endpoints.organizationAuditExport, ({ params }, principal) => {
    authorize(context, principal, { organizationId: params.o, level: "admin" });
    return exportAudit(context, principal, { organizationId: params.o });
  });
  route(context, endpoints.auditList, ({ query }, principal) => {
    operator(principal);
    const rows = auditRows(context, { ...query, limit: query.limit + 1 });
    return { items: rows.slice(0, query.limit), nextCursor: rows.length > query.limit ? String(rows[query.limit - 1]?.seq) : null };
  });
  route(context, endpoints.auditExport, ({ body }, principal) => {
    operator(principal);
    return exportAudit(context, principal, body);
  });
  route(context, endpoints.organizationMetrics, ({ params, query }, principal) => {
    authorize(context, principal, { organizationId: params.o, level: "manager" });
    if (query.from > query.to) throw new ServiceError("INVALID_RANGE", 400, "From must precede to");
    const count = (sql: string) => z.object({ total: z.number() }).parse(context.db.query(sql).get(params.o, query.from, query.to)).total;
    return { ...query,
      activeUsers: count("SELECT count(DISTINCT s.user_id) AS total FROM sessions s JOIN members m ON m.user_id=s.user_id WHERE m.organization_id=? AND s.last_seen_at>=? AND s.last_seen_at<=?"),
      activeProjects: count("SELECT count(*) AS total FROM projects WHERE workspace_id=? AND updated_at>=? AND updated_at<=? AND deleted_at IS NULL"),
      compileCount: count("SELECT count(*) AS total FROM compile_jobs j JOIN snapshots s ON s.id=j.snapshot_id JOIN projects p ON p.id=s.project_id WHERE p.workspace_id=? AND j.queued_at>=? AND j.queued_at<=?"),
      compileMs: count("SELECT coalesce(sum(j.elapsed_ms),0) AS total FROM compile_jobs j JOIN snapshots s ON s.id=j.snapshot_id JOIN projects p ON p.id=s.project_id WHERE p.workspace_id=? AND j.queued_at>=? AND j.queued_at<=?"),
      storageBytes: count("SELECT coalesce(sum(f.bytes),0) AS total FROM files f JOIN branch_workspaces b ON b.id=f.branch_id JOIN projects p ON p.id=b.project_id WHERE p.workspace_id=? AND f.created_at>=? AND f.created_at<=? AND f.deleted_at IS NULL"),
      aiUses: count("SELECT count(*) AS total FROM ai_runs r JOIN projects p ON p.id=r.project_id WHERE p.workspace_id=? AND r.created_at>=? AND r.created_at<=?"),
    };
  });
}
