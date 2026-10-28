import { z } from "zod";
import type { Id, SqlExecutor, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";

async function installed(db: SqlExecutor): Promise<boolean> {
  return Boolean(await db.get(db.dialect === "sqlite"
    ? "SELECT name FROM sqlite_master WHERE type='table' AND name='o_worker_policy'"
    : "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='o_worker_policy'"));
}
export async function managedWorkerPool(db: SqlExecutor): Promise<boolean> {
  if (!await installed(db)) return false;
  const row = z.object({ managed: z.number() }).parse(
    await db.get("SELECT managed FROM o_worker_policy WHERE id=1"));
  return Boolean(row.managed);
}
async function authority(db: SqlExecutor, workerId: Id) {
  return z.object({
    desired: z.string(), pid: z.number().nullable(), exited_at: z.string().nullable(),
    backend: z.enum(["bwrap", "docker"]),
    owner: z.string(), controller_owner: z.string().nullable(), expires_at: z.string().nullable(),
  }).nullable().parse(await db.get(`SELECT p.desired,p.pid,p.exited_at,p.owner,p.backend,
    c.owner AS controller_owner,c.expires_at FROM o_worker_processes p
    LEFT JOIN o_worker_controller c ON c.id=1 WHERE p.id=?`, [workerId]));
}
/** Called under the compiler lock, in the claim's own transaction. */
export async function admitWorkerClaim(tx: Transaction, workerId: Id): Promise<boolean> {
  if (!await installed(tx)) return true;
  const policy = z.object({ managed: z.number(), maximum: z.number(), sandbox: z.enum(["bwrap", "docker"]) }).parse(
    await tx.get("SELECT managed,maximum,sandbox FROM o_worker_policy WHERE id=1"));
  if (!policy.managed) return true;
  const row = await authority(tx, workerId);
  if (!row || row.desired !== "running" || row.pid === null || row.exited_at !== null ||
    row.owner !== row.controller_owner || row.backend !== policy.sandbox ||
    Date.parse(row.expires_at ?? "") <= Date.now() || policy.maximum === 0) return false;
  await tx.run("UPDATE workers SET pool_id=(SELECT pool_id FROM o_worker_processes WHERE id=?) WHERE id=?", [workerId, workerId]);
  return true;
}
/** A normal drain retains its current lease; lost controller authority does not. */
export async function assertManagedLease(tx: Transaction, workerId: Id): Promise<void> {
  if (!await installed(tx)) return;
  const row = await authority(tx, workerId);
  if (!row) return;
  if (row.owner !== row.controller_owner || row.pid === null || row.exited_at !== null ||
    row.desired === "stopped" || row.desired === "deleted" || Date.parse(row.expires_at ?? "") <= Date.now()) {
    throw new ServiceError("STALE_LEASE", 409, "Worker controller authority expired");
  }
}
export async function workerWallSeconds(db: SqlExecutor, configured: number): Promise<number> {
  if (!await installed(db)) return configured;
  const row = z.object({ timeout_seconds: z.number() }).parse(
    await db.get("SELECT timeout_seconds FROM o_worker_policy WHERE id=1"));
  return Math.min(configured, row.timeout_seconds);
}
