import { createHash } from "node:crypto";
import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import type { Id, Operation, SqlExecutor, Transaction } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import { CoreProjects } from "../../core/base";
import type { AdapterActionDefinition } from "./contracts";

export const ExecuteActionSchema = z.strictObject({
  actorId: IdSchema, grantId: IdSchema, action: z.string().min(1), projectId: IdSchema.optional(),
  parameters: z.record(z.string(), z.json()), expectedCursor: z.string().nullable(),
  expectedVersion: z.number().int().nonnegative(), key: z.string().min(1).max(255),
}).readonly();
export type ExecuteAction = z.infer<typeof ExecuteActionSchema>;
type JsonValue = z.infer<ReturnType<typeof z.json>>;
function stable(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}
export function actionDigest(input: ExecuteAction): string {
  return createHash("sha256").update(JSON.stringify(stable({
    action: input.action, grantId: input.grantId, projectId: input.projectId ?? null,
    parameters: input.parameters, expectedCursor: input.expectedCursor, expectedVersion: input.expectedVersion,
  }))).digest("hex");
}
export async function readOperation(executor: SqlExecutor, id: Id): Promise<Operation> {
  const row = z.object({
    id: IdSchema, kind: z.string(), status: z.string(), progress: z.number(),
    result_json: z.string().nullable(), error_code: z.string().nullable(),
  }).parse(await executor.get("SELECT * FROM operations WHERE id=?", [id]));
  return OperationSchema.parse({ id: row.id, kind: row.kind, status: row.status, progress: row.progress,
    result: row.result_json === null ? null : JSON.parse(row.result_json), errorCode: row.error_code });
}
export async function priorOperation(context: ModuleContext, input: ExecuteAction, executor: SqlExecutor = context.db) {
  const previous = await executor.get<{ id: string; request_digest: string }>(
    `SELECT o.id,r.request_digest FROM operations o JOIN adapter_operation_receipts r ON r.operation_id=o.id
     WHERE o.actor_id=? AND o.idempotency_key=?`, [input.actorId, input.key]);
  if (!previous) return null;
  if (previous.request_digest !== actionDigest(input)) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Key belongs to a different adapter request");
  return readOperation(executor, IdSchema.parse(previous.id));
}
export async function authorizeAction(context: ModuleContext, input: Pick<ExecuteAction, "actorId" | "projectId" | "parameters">, action: AdapterActionDefinition): Promise<void> {
  if (!input.projectId) {
    if (action.projectAccess !== "none") throw new ServiceError("PROJECT_REQUIRED", 400, "Action requires a project");
    return;
  }
  const projects = new CoreProjects(context);
  const project = await projects.getProject(input.projectId);
  const branch = input.parameters["branch"] === undefined ? project.defaultBranch : z.string().min(1).parse(input.parameters["branch"]);
  await projects.authorize(input.actorId, { projectId: input.projectId, branch },
    action.projectAccess === "none" ? "read" : action.projectAccess);
  await projects.policy(input.actorId, input.projectId);
}
export async function assertCursor(tx: SqlExecutor, input: ExecuteAction): Promise<void> {
  const row = await tx.get<{ cursor: string | null }>(
    "SELECT cursor FROM adapter_cursors WHERE grant_id=? AND action=? AND project_id=?",
    [input.grantId, input.action, input.projectId ?? ""]);
  if ((row?.cursor ?? null) !== input.expectedCursor) throw new ServiceError("CURSOR_CONFLICT", 409, "Provider cursor changed");
}
export async function operationEvent(context: ModuleContext, tx: Transaction, operation: Operation): Promise<void> {
  await context.events.record(tx, { topic: "operation.changed", aggregateId: operation.id,
    payload: { resourceId: operation.id, status: operation.status } });
}
