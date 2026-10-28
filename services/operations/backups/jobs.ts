import { BackupSchema, IdSchema, OperationSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { ServiceError } from "@quire/runtime";
import { createBackup, verifyBackup } from "./archive";
import { BackupError, backupHost, digest } from "./model";
import { ownedPath } from "./files";
import { restoreBackup } from "./restore";

export type BackupJob = { readonly key: string } & (
  | { readonly action: "create" }
  | { readonly action: "verify"; readonly backupId: Id }
  | { readonly action: "restore"; readonly backupId: Id; readonly target: string; readonly confirmation: string }
);

export async function backupRecord(context: ModuleContext, id: string) {
  const row = await context.db.get(`SELECT id,status,created_at AS "createdAt",manifest_digest AS "manifestDigest",
    destination,verified_at AS "verifiedAt",operation_id AS "operationId" FROM backups WHERE id=?`, [id]);
  if (!row) throw new BackupError("BACKUP_NOT_FOUND", id);
  return BackupSchema.parse(row);
}
export async function performJob(context: ModuleContext, actor: Id, input: BackupJob) {
  const requestDigest = digest(JSON.stringify(input));
  const id = IdSchema.parse(crypto.randomUUID());
  let backupId: Id;
  let createsArchive: boolean;
  switch (input.action) {
    case "create": backupId = IdSchema.parse(crypto.randomUUID()); createsArchive = true; break;
    case "verify":
    case "restore": backupId = input.backupId; createsArchive = false; break;
    default: { const exhaustive: never = input; throw new BackupError("BACKUP_ACTION_INVALID", exhaustive); }
  }
  const destination = await ownedPath(backupHost(context).backupRoot, backupId);
  const now = context.clock.now();
  const initial = OperationSchema.parse({ id, kind: `backup-${input.action}`, status: "running", progress: 0,
    result: { backupId, blob: null, projectIds: [], operatorOnly: true },
    errorCode: null });
  const admitted = await context.uow.run(async tx => {
    await tx.lock("quire:backup-jobs");
    const replay = await tx.get<{ request_digest: string; response_json: string }>(
      "SELECT request_digest,response_json FROM o_backup_receipts WHERE actor_id=? AND request_key=?", [actor, input.key]);
    if (replay) {
      if (replay.request_digest !== requestDigest) throw new BackupError("IDEMPOTENCY_CONFLICT", "Key was used for a different backup action");
      return { fresh: false, operation: OperationSchema.parse(JSON.parse(replay.response_json)) };
    }
    if (await tx.get("SELECT id FROM operations WHERE actor_id=? AND idempotency_key=?", [actor, input.key])) {
      throw new BackupError("IDEMPOTENCY_CONFLICT", "Key was used for another operation");
    }
    await tx.run(`INSERT INTO operations(id,actor_id,kind,status,progress,result_json,idempotency_key,created_at,updated_at)
      VALUES(?,?,?,'running',0,?,?,?,?)`, [id, actor, initial.kind, JSON.stringify(initial.result), input.key, now, now]);
    await tx.run("INSERT INTO o_backup_receipts(actor_id,request_key,action,request_digest,response_json) VALUES(?,?,?,?,?)",
      [actor, input.key, input.action, requestDigest, JSON.stringify(initial)]);
    if (createsArchive) await tx.run(`INSERT INTO backups(id,status,created_at,destination,operation_id)
      VALUES(?,'running',?,?,?)`, [backupId, now, destination, id]);
    return { fresh: true, operation: initial };
  });
  if (!admitted.fresh) return admitted.operation;
  try {
    let result: Readonly<Record<string, unknown>>;
    switch (input.action) {
      case "create": {
        const archive = await createBackup(context, backupId, async () => {
          if (!await context.db.get("SELECT id FROM users WHERE id=? AND operator=1 AND suspended=0 AND deleted_at IS NULL", [actor])) {
            throw new ServiceError("FORBIDDEN", 403, "Operator authority was revoked before backup admission");
          }
        });
        await context.db.run("UPDATE backups SET status='succeeded',manifest_digest=? WHERE id=?",
          [archive.manifestDigest, backupId]);
        result = { backupId: archive.manifest.id, manifestDigest: archive.manifestDigest };
        break;
      }
      case "verify":
      case "restore": {
        const record = await backupRecord(context, input.backupId);
        const archive = await ownedPath(backupHost(context).backupRoot, record.id);
        if (record.destination !== archive) throw new BackupError("BACKUP_PATH_DENIED", record.id);
        const verified = await verifyBackup(archive, context.secretKey, backupHost(context).signingKey);
        if (verified.manifestDigest !== record.manifestDigest) throw new BackupError("BACKUP_DIGEST_INVALID", record.id);
        switch (input.action) {
          case "verify":
            await context.db.run("UPDATE backups SET verified_at=? WHERE id=?", [context.clock.now(), record.id]);
            result = { backupId: record.id, manifestDigest: verified.manifestDigest, tables: verified.manifest.tables };
            break;
          case "restore":
            result = await restoreBackup(context, { archive, target: input.target, confirmation: input.confirmation });
            break;
          default: { const exhaustive: never = input; throw new BackupError("BACKUP_ACTION_INVALID", exhaustive); }
        }
        break;
      }
      default: { const exhaustive: never = input; throw new BackupError("BACKUP_ACTION_INVALID", exhaustive); }
    }
    const operation = OperationSchema.parse({
      id, kind: `backup-${input.action}`, status: "succeeded", progress: 1,
      result: { ...result, blob: null, projectIds: [], operatorOnly: true }, errorCode: null,
    });
    await context.uow.run(async tx => {
      await tx.run("UPDATE operations SET status='succeeded',progress=1,result_json=?,updated_at=? WHERE id=?",
        [JSON.stringify(operation.result), context.clock.now(), id]);
      await tx.run("UPDATE o_backup_receipts SET response_json=? WHERE actor_id=? AND request_key=?",
        [JSON.stringify(operation), actor, input.key]);
      await context.events.record(tx, { topic: "operation.changed", aggregateId: id,
        payload: { resourceId: id, status: "succeeded" } });
    });
    await context.events.dispatch();
    return operation;
  } catch (error) {
    const failed = { ...initial, status: "failed", errorCode: error instanceof ServiceError ? error.code : "BACKUP_FAILED" };
    await context.uow.run(async tx => {
      await tx.run("UPDATE operations SET status='failed',error_code=?,updated_at=? WHERE id=?",
        [failed.errorCode, context.clock.now(), id]);
      await tx.run("UPDATE o_backup_receipts SET response_json=? WHERE actor_id=? AND request_key=?",
        [JSON.stringify(failed), actor, input.key]);
      if (createsArchive) await tx.run("UPDATE backups SET status='failed' WHERE id=?", [backupId]);
    });
    throw error;
  }
}
