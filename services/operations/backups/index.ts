import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import sqlite from "./041-o-backups.sql" with { type: "text" };
import postgres from "./041-o-backups.postgres.sql" with { type: "text" };
import { backupRecord, performJob } from "./jobs";
import { getPolicy, putPolicy, retainBackups, scheduleSlot } from "./policy";

export { configureBackups, BackupError } from "./model";
export type { BackupHost, BackupContext, Manifest } from "./model";
export { createBackup, verifyBackup } from "./archive";
export { restoreBackup, restoreConfirmation } from "./restore";
export { inspectRestoreTarget, restoreBackupToTarget } from "./restore-target";
export type { RestoreTargetIdentity } from "./restore-target";
export { loadBackupSigner } from "./signer-key";
export const migrations = [{ id: "041-o-backups", sql: sqlite, postgres }] as const;

async function operator(context: ModuleContext, request: Request) {
  const identity = context.services.get("identity");
  const principal = await identity.require(request);
  if (!principal.operator) throw new ServiceError("FORBIDDEN", 403, "Operator access required");
  if (request.method !== "GET") {
    await identity.verifyMutation(request, principal);
    const session = z.object({ created_at: z.string() }).parse(
      await context.db.get("SELECT created_at FROM sessions WHERE id=?", [principal.sessionId]));
    if (Date.parse(context.clock.now()) - Date.parse(session.created_at) > 15 * 60000) {
      throw new ServiceError("FRESH_AUTH_REQUIRED", 403, "Sign in again before backup administration");
    }
  }
  return principal;
}
export function register(context: ModuleContext): void {
  context.routes.register(endpoints.backupPolicyGet, async (_input, request) => {
    await operator(context, request.request);
    const policy = await getPolicy(context);
    request.responseHeaders.set("etag", `"v${policy.version}"`);
    return policy;
  });
  context.routes.register(endpoints.backupPolicyPut, async (input, request) => {
    await operator(context, request.request);
    if (request.request.headers.get("if-match") !== `"v${input.body.expectedVersion}"`) {
      throw new ServiceError("VERSION_CONFLICT", 409, "Policy If-Match must match expectedVersion");
    }
    return putPolicy(context, input.body);
  });
  context.routes.register(endpoints.backupCreate, async (input, request) => {
    const principal = await operator(context, request.request);
    const operation = await performJob(context, principal.user.id,
      { action: "create", key: z.string().parse(input.headers["idempotency-key"]) });
    return backupRecord(context, z.string().parse(operation.result?.["backupId"]));
  });
  context.routes.register(endpoints.backupsList, async (input, request) => {
    await operator(context, request.request);
    const rows = await context.db.query("SELECT id FROM backups WHERE id>? ORDER BY id LIMIT ?",
      [input.query.cursor ?? "", input.query.limit + 1], z.object({ id: z.string() }));
    return { items: await Promise.all(rows.slice(0, input.query.limit).map(row => backupRecord(context, row.id))),
      nextCursor: rows.length > input.query.limit ? rows[input.query.limit - 1]?.id ?? null : null };
  });
  context.routes.register(endpoints.backupVerify, async (input, request) => {
    const principal = await operator(context, request.request);
    if (input.body.expectedVersion !== 0) throw new ServiceError("VERSION_CONFLICT", 409, "Backup content is immutable at version 0");
    return performJob(context, principal.user.id, { action: "verify", backupId: input.params.id,
      key: z.string().parse(input.headers["idempotency-key"]) });
  });
  context.routes.register(endpoints.backupRestore, async (input, request) => {
    const principal = await operator(context, request.request);
    if (input.body.expectedVersion !== 0) throw new ServiceError("VERSION_CONFLICT", 409, "Backup content is immutable at version 0");
    return performJob(context, principal.user.id, { action: "restore", backupId: input.params.id,
      target: input.body.target, confirmation: input.body.confirmation, key: z.string().parse(input.headers["idempotency-key"]) });
  });
}
/** The role scheduler calls this using its current injected clock and an enrolled operator. */
export async function runScheduledBackup(context: ModuleContext, operatorId: string) {
  const principal = await context.db.get("SELECT id FROM users WHERE id=? AND operator=1 AND suspended=0 AND deleted_at IS NULL", [operatorId]);
  if (!principal) throw new ServiceError("FORBIDDEN", 403, "An enrolled operator must own scheduled backups");
  const policy = await getPolicy(context);
  const slot = scheduleSlot(policy.schedule, context.clock.now());
  if (!slot) return null;
  const operation = await performJob(context, IdSchema.parse(operatorId),
    { action: "create", key: `backup-schedule:${policy.version}:${slot}` });
  if (operation.status !== "succeeded") return operation;
  await performJob(context, IdSchema.parse(operatorId), { action: "verify",
    backupId: IdSchema.parse(operation.result?.["backupId"]),
    key: `backup-schedule-verify:${policy.version}:${slot}` });
  await context.db.run("UPDATE o_backup_schedule SET last_slot=? WHERE singleton=1", [slot]);
  await retainBackups(context);
  return operation;
}
