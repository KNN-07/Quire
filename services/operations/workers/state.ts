import { z } from "zod";
import { IdSchema, WorkerSchema } from "@quire/contracts";
import type { SqlExecutor } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";

export const poolId = IdSchema.parse("08000000-0000-4000-8000-000000000001");
export const newId = () => IdSchema.parse(crypto.randomUUID());
export const policyRow = z.object({
  minimum: z.number(), maximum: z.number(), requested: z.number(),
  timeout_seconds: z.number(), sandbox: z.enum(["bwrap", "docker"]),
  version: z.number(), managed: z.number(),
});
export const processRow = z.object({
  id: IdSchema, pool_id: IdSchema, owner: z.string(),
  desired: z.enum(["running", "draining", "stopped", "deleted"]),
  pid: z.number().nullable(), started_at: z.string(), exited_at: z.string().nullable(),
  exit_code: z.number().nullable(), version: z.number(), drain_operation: IdSchema.nullable(),
  backend: z.enum(["bwrap", "docker"]), environment_ids_json: z.string(),
});
export async function policy(db: SqlExecutor) {
  return policyRow.parse(await db.get("SELECT * FROM o_worker_policy WHERE id=1"));
}
export async function processRecord(db: SqlExecutor, id: string) {
  const row = processRow.nullable().parse(await db.get("SELECT * FROM o_worker_processes WHERE id=?", [id]));
  if (!row || row.desired === "deleted") throw new ServiceError("NOT_FOUND", 404, "Managed worker not found");
  return row;
}
export function conflict(actual: number, expected: number): void {
  if (actual !== expected) throw new ServiceError("VERSION_CONFLICT", 409, "Worker state changed; refresh and retry");
}
export async function workers(db: SqlExecutor, now: string) {
  const rows = await db.all(`SELECT w.*,p.desired,p.pid,p.exited_at,c.expires_at,
    CASE WHEN c.owner=p.owner THEN 1 ELSE 0 END AS authority FROM workers w
    LEFT JOIN o_worker_processes p ON p.id=w.id
    LEFT JOIN o_worker_controller c ON c.id=1
    WHERE (p.desired IS NULL OR p.desired<>'deleted')
      AND (p.id IS NOT NULL OR w.job_id IS NOT NULL OR (SELECT managed FROM o_worker_policy WHERE id=1)=0)
    ORDER BY w.id`);
  return rows.map(value => {
    const row = z.object({
      id: IdSchema, pool_id: IdSchema, state: WorkerSchema.unwrap().shape.state,
      environment_ids_json: z.string(), job_id: IdSchema.nullable(), last_heartbeat: z.string(),
      builds_today: z.number(), desired: processRow.shape.desired.nullable(),
      pid: z.number().nullable(), exited_at: z.string().nullable(),
      expires_at: z.string().nullable(), authority: z.number(),
    }).parse(value);
    const offline = Date.parse(now) - Date.parse(row.last_heartbeat) >= 30000 ||
      (row.desired !== null && (row.pid === null || row.exited_at !== null ||
        row.authority !== 1 || Date.parse(row.expires_at ?? "") <= Date.parse(now)));
    return WorkerSchema.parse({
      id: row.id, poolId: row.pool_id,
      state: offline ? "offline" : row.desired === "draining" ? "draining" : row.state,
      environmentIds: JSON.parse(row.environment_ids_json), jobId: row.job_id,
      lastHeartbeat: row.last_heartbeat, buildsToday: row.builds_today,
    });
  });
}
