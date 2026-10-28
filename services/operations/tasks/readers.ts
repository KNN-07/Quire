import { ServiceError } from "@quire/runtime";
import type { Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import type { UpdateClient, UpdateOperationQuery, UpdateOperationRow } from "../updates";
import { getApplicationOperation, listApplicationOperations } from "./store";
import type { OperationQuery, Row } from "./store";

function updateRow(row: UpdateOperationRow): Row {
  return {
    id: row.operation.id, actor_id: row.actorId, kind: row.operation.kind,
    status: row.operation.status, progress: row.operation.progress,
    result_json: row.operation.result === null ? null : JSON.stringify(row.operation.result),
    error_code: row.operation.errorCode, created_at: row.createdAt, updated_at: row.updatedAt,
    operator_only: true,
  };
}
export async function getOperation(
  context: Pick<ModuleContext, "db">, id: Id, updates?: Pick<UpdateClient, "get" | "list">,
): Promise<Row | null> {
  const [application, update] = await Promise.all([
    getApplicationOperation(context, id), updates?.get(id) ?? null,
  ]);
  if (application && update) throw new ServiceError("OPERATION_ID_CONFLICT", 409, "Conflicting operation authorities");
  return update ? updateRow(update) : application;
}
export async function listOperations(
  context: Pick<ModuleContext, "db">, query: OperationQuery, updates?: Pick<UpdateClient, "get" | "list">,
): Promise<readonly Row[]> {
  const controlQuery: UpdateOperationQuery = {
    actorId: query.actorId, order: "asc", limit: Math.min(100, query.limit),
    ...(query.cursor === null ? {} : { cursor: query.cursor }),
    ...(query.kind === null ? {} : { kind: query.kind }),
    ...(query.status === null ? {} : { status: query.status }),
  };
  const [application, controlPage] = await Promise.all([
    listApplicationOperations(context, query), updates?.list(controlQuery) ?? [],
  ]);
  const control = [...controlPage];
  // The public endpoint needs one lookahead row even at its 100-row limit.
  // Control pages are capped at 100, so obtain that single row separately.
  const last = control.at(-1);
  if (updates && last && control.length < query.limit && control.length === controlQuery.limit) {
    control.push(...await updates.list({ ...controlQuery, cursor: last.operation.id, limit: query.limit - control.length }));
  }
  const rows = [...application, ...control.map(updateRow)].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]?.id === rows[i - 1]?.id) {
      throw new ServiceError("OPERATION_ID_CONFLICT", 409, "Conflicting operation authorities");
    }
  }
  return rows.slice(0, query.limit);
}
