import { z } from "zod";
import { IdSchema, OperationSummarySchema } from "@quire/contracts";
import type { Id, Operation } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";

export const rowSchema = z.object({
  id: IdSchema, actor_id: IdSchema.nullable(), kind: z.string(), status: z.string(),
  progress: z.number(), result_json: z.string().nullable(), error_code: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(),
  operator_only: z.boolean().optional(),
});
export type Row = z.infer<typeof rowSchema>;
export function result(row: Row) {
  return OperationSummarySchema.parse({
    id: row.id, kind: row.kind, status: row.status, progress: row.progress,
    result: row.result_json ? JSON.parse(row.result_json) : null, errorCode: row.error_code,
    createdAt: row.created_at, updatedAt: row.updated_at,
  });
}
export interface OperationQuery {
  readonly actorId: Id;
  readonly cursor: Id | null;
  readonly kind: string | null;
  readonly status: Operation["status"] | null;
  readonly limit: number;
}
export async function getApplicationOperation(context: Pick<ModuleContext, "db">, id: Id): Promise<Row | null> {
  const stored = await context.db.get("SELECT * FROM operations WHERE id=?", [id]);
  return stored ? rowSchema.parse(stored) : null;
}
export async function listApplicationOperations(
  context: Pick<ModuleContext, "db">, query: OperationQuery,
): Promise<readonly Row[]> {
  return z.array(rowSchema).parse(await context.db.all(`SELECT * FROM operations
    WHERE actor_id=? AND (CAST(? AS TEXT) IS NULL OR id>?)
    AND (CAST(? AS TEXT) IS NULL OR kind=?) AND (CAST(? AS TEXT) IS NULL OR status=?)
    ORDER BY id LIMIT ?`, [query.actorId, query.cursor, query.cursor,
    query.kind, query.kind, query.status, query.status, query.limit]));
}
