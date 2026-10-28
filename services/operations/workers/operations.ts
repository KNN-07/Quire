import { z } from "zod";
import { OperationSchema } from "@quire/contracts";
import type { Id, Transaction } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { newId } from "./state";

export async function createOperation(context: ModuleContext & { readonly db: Transaction }, input: {
  readonly actor: Id; readonly kind: string; readonly key: string;
}) {
  const id = newId();
  const now = context.clock.now();
  await context.db.run(`INSERT INTO operations
    (id,actor_id,kind,status,progress,result_json,idempotency_key,created_at,updated_at)
    VALUES(?,?,?,'queued',0,?,?,?,?)`, [id, input.actor, input.kind,
    JSON.stringify({ blob: null, projectIds: [], operatorOnly: true }), `workers:${id}:${input.key}`, now, now]);
  await context.events.record(context.db, {
    topic: "operation.changed", aggregateId: id, payload: { resourceId: id, status: "queued" },
  });
  return OperationSchema.parse({ id, kind: input.kind, status: "queued", progress: 0,
    result: { blob: null, projectIds: [], operatorOnly: true }, errorCode: null });
}
export async function finishOperation(context: ModuleContext & { readonly db: Transaction }, id: Id, error: string | null) {
  const row = z.object({ status: z.string() }).parse(await context.db.get("SELECT status FROM operations WHERE id=?", [id]));
  if (row.status !== "queued" && row.status !== "running") return;
  const status = error ? "failed" : "succeeded";
  await context.db.run("UPDATE operations SET status=?,progress=1,error_code=?,updated_at=?,version=version+1 WHERE id=?",
    [status, error, context.clock.now(), id]);
  await context.events.record(context.db, {
    topic: "operation.changed", aggregateId: id, payload: { resourceId: id, status },
  });
}
