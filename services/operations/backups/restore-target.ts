import { mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { Runtime } from "@quire/runtime";
import { DiskBlobStore, LocalRepositoryService } from "@quire/runtime";
import { S3BlobStore } from "../storage/s3";
import { RemoteRepositoryService } from "../repository/client";
import { verifyBackup } from "./archive";
import { decodeCell, orderedTables, tableNames } from "./database";
import { BackupError, backupHost, identifier } from "./model";
import type { BackupContext, DatabaseImage } from "./model";
import { ownedPath, readRegular, writeDurable } from "./files";

type DirectoryIdentity = {
  readonly host: string; readonly path: string; readonly device: string; readonly inode: string;
  readonly empty: boolean;
};
type DatabaseIdentity =
  | { readonly kind: "sqlite"; readonly host: string; readonly path: string; readonly device: string; readonly inode: string }
  | { readonly kind: "postgres"; readonly cluster: string; readonly database: string; readonly name: string };
/** Only values issued by inspectRestoreTarget are accepted; JSON is not authority. */
export type RestoreTargetIdentity = {
  readonly database: DatabaseIdentity;
  readonly blobs: ({ readonly kind: "disk" } & DirectoryIdentity) |
    { readonly kind: "s3"; readonly endpoint: string; readonly bucket: string; readonly empty: boolean };
  readonly repositories: DirectoryIdentity;
};
const identities = new WeakMap<RestoreTargetIdentity, {
  readonly target: BackupContext; readonly snapshot: string;
  readonly handles: readonly object[]; readonly value: RestoreTargetIdentity;
}>();

async function localIdentity(path: string): Promise<Omit<DirectoryIdentity, "empty">> {
  const canonical = await realpath(path);
  const metadata = await stat(canonical, { bigint: true });
  const directory = metadata.isDirectory() ? metadata : await stat(dirname(canonical), { bigint: true });
  const uid = process.getuid?.();
  if (uid === undefined || metadata.uid !== BigInt(uid) ||
      directory.uid !== BigInt(uid) || (directory.mode & 0o077n) !== 0n) {
    throw new BackupError("RESTORE_TARGET_AUTHORITY", "Local storage must be privately owned");
  }
  const host = (await readFile("/etc/machine-id", "utf8")).trim();
  if (!host) throw new BackupError("RESTORE_TARGET_AUTHORITY", "Host identity is unavailable");
  return { host, path: canonical, device: metadata.dev.toString(), inode: metadata.ino.toString() };
}
async function inspect(target: BackupContext): Promise<RestoreTargetIdentity> {
  let database: DatabaseIdentity;
  switch (target.db.dialect) {
    case "sqlite": {
      const row = await target.db.get<{ file: string }>("SELECT file FROM pragma_database_list WHERE name='main'");
      if (!row?.file) throw new BackupError("RESTORE_TARGET_AUTHORITY", "A durable SQLite file is required");
      database = { kind: "sqlite", ...await localIdentity(row.file) };
      break;
    }
    case "postgres": {
      const row = await target.db.get<{ cluster: string; database: string; name: string }>(
        `SELECT c.system_identifier::text AS cluster,d.oid::text AS database,d.datname AS name
         FROM pg_catalog.pg_control_system() c CROSS JOIN pg_catalog.pg_database d
         WHERE d.datname=pg_catalog.current_database()`);
      const identity = z.strictObject({ cluster: z.string().regex(/^\d+$/),
        database: z.string().regex(/^\d+$/), name: z.string().min(1) }).parse(row);
      database = { kind: "postgres", ...identity };
      break;
    }
    default: { const exhaustive: never = target.db.dialect; throw new BackupError("RESTORE_DIALECT_INVALID", exhaustive); }
  }
  let blobs: RestoreTargetIdentity["blobs"];
  if (target.blobs instanceof DiskBlobStore) {
    const identity = await localIdentity(target.blobs.root);
    blobs = { kind: "disk", ...identity, empty: (await readdir(identity.path)).length === 0 };
  } else if (target.blobs instanceof S3BlobStore) {
    blobs = { kind: "s3", ...await target.blobs.restoreIdentity() };
  } else throw new BackupError("RESTORE_TARGET_AUTHORITY", "Blob adapter has no concrete identity probe");
  if (!(target.repositories instanceof LocalRepositoryService) &&
      !(target.repositories instanceof RemoteRepositoryService)) {
    throw new BackupError("RESTORE_TARGET_AUTHORITY", "Repository adapter has no concrete identity probe");
  }
  const repositories = z.strictObject({
    host: z.string().min(1), path: z.string().min(1), device: z.string().regex(/^\d+$/),
    inode: z.string().regex(/^\d+$/), empty: z.boolean(),
  }).parse(await target.repositories.restoreIdentity());
  return Object.freeze({ database: Object.freeze(database), blobs: Object.freeze(blobs),
    repositories: Object.freeze(repositories) });
}
/** Inspect before closing retained handles. This function never imports or closes resources. */
export async function inspectRestoreTarget(target: BackupContext): Promise<RestoreTargetIdentity> {
  const value = await inspect(target);
  const identity = Object.freeze({ database: Object.freeze({ ...value.database }),
    blobs: Object.freeze({ ...value.blobs }), repositories: Object.freeze({ ...value.repositories }) });
  identities.set(identity, { target, snapshot: JSON.stringify(value), value,
    handles: [target.db, target.uow, target.blobs, target.repositories, target.branches] });
  return identity;
}
function directoryShares(left: Omit<DirectoryIdentity, "empty">, right: Omit<DirectoryIdentity, "empty">): boolean {
  return left.host === right.host && ((left.device === right.device && left.inode === right.inode) ||
    left.path === right.path || left.path.startsWith(right.path + "/") || right.path.startsWith(left.path + "/"));
}
function requireDistinct(target: RestoreTargetIdentity, retained: RestoreTargetIdentity): void {
  const left = target.database;
  const right = retained.database;
  if ((left.kind === "sqlite" && right.kind === "sqlite" && directoryShares(left, right)) ||
      (left.kind === "postgres" && right.kind === "postgres" &&
        left.cluster === right.cluster && left.database === right.database)) {
    throw new BackupError("RESTORE_LIVE_TARGET", "Target shares a retained database");
  }
  if (target.blobs.kind !== retained.blobs.kind) {
    throw new BackupError("RESTORE_TARGET_AUTHORITY", "Rollback must preserve blob storage kind");
  }
  if (target.blobs.kind === "s3" && retained.blobs.kind === "s3") {
    if (target.blobs.endpoint !== retained.blobs.endpoint) {
      throw new BackupError("RESTORE_TARGET_AUTHORITY", "Different S3 endpoints cannot prove distinct authority");
    }
    if (target.blobs.bucket === retained.blobs.bucket) throw new BackupError("RESTORE_LIVE_TARGET", "Target shares a retained bucket");
  }
  if (target.blobs.kind === "disk" && retained.blobs.kind === "disk" && directoryShares(target.blobs, retained.blobs)) {
    throw new BackupError("RESTORE_LIVE_TARGET", "Target shares retained blob storage");
  }
  if (target.repositories.host !== retained.repositories.host) {
    throw new BackupError("RESTORE_TARGET_AUTHORITY", "Repository volume is not on the installation host");
  }
  if (directoryShares(target.repositories, retained.repositories)) {
    throw new BackupError("RESTORE_LIVE_TARGET", "Target shares a retained Git volume");
  }
  const localPaths = (identity: RestoreTargetIdentity) => [
    ...(identity.database.kind === "sqlite" ? [identity.database] : []),
    ...(identity.blobs.kind === "disk" ? [identity.blobs] : []), identity.repositories,
  ];
  if (localPaths(target).some(candidate => localPaths(retained).some(previous => directoryShares(candidate, previous)))) {
    throw new BackupError("RESTORE_LIVE_TARGET", "Target overlaps retained local storage");
  }
}
/**
 * Original-dialect import into an already opened target. The caller owns all
 * handles and must stop writers/provision exclusively before inspection.
 * The installation controller supplies retained from its complete durable binding
 * inventory under stopped authority. This primitive validates issued identities
 * and source inclusion; it cannot prove that the caller supplied every binding.
 */
export async function restoreBackupToTarget(context: BackupContext, input: {
  readonly archive: string; readonly target: BackupContext;
  readonly identity: RestoreTargetIdentity; readonly retained: readonly RestoreTargetIdentity[];
}) {
  const host = backupHost(context);
  const verified = await verifyBackup(input.archive, context.secretKey, host.signingKey);
  const bound = identities.get(input.identity);
  const handles = [input.target.db, input.target.uow, input.target.blobs, input.target.repositories, input.target.branches];
  if (bound?.target !== input.target || bound.handles.some((handle, index) => handle !== handles[index]) ||
      bound.snapshot !== JSON.stringify(await inspect(input.target)) ||
      !input.retained.some(identity => identities.get(identity)?.target === context)) {
    throw new BackupError("RESTORE_TARGET_AUTHORITY", "Opened target and issued source identity evidence are required");
  }
  if (input.target.db === context.db || input.target.blobs === context.blobs ||
      input.target.repositories === context.repositories) {
    throw new BackupError("RESTORE_LIVE_TARGET", "Source handles cannot be restore targets");
  }
  for (const identity of input.retained) {
    const retained = identities.get(identity);
    if (!retained) {
      throw new BackupError("RESTORE_TARGET_AUTHORITY", "Retained identity was not inspected");
    }
    requireDistinct(bound.value, retained.value);
  }
  if (input.target.db.dialect !== verified.database.dialect ||
      !timingSafeEqual(input.target.secretKey, verified.key)) {
    throw new BackupError("RESTORE_TARGET_AUTHORITY", "Rollback requires the original dialect and secret authority");
  }
  if (!bound.value.blobs.empty || !bound.value.repositories.empty) {
    throw new BackupError("RESTORE_TARGET_NOT_EMPTY", "Blob bucket/directory and Git volume must be empty");
  }
  const receipt = await importVerifiedBackup(context, input.archive, input.target, verified);
  return { receipt, configuration: verified.configuration };
}

export function restoreConfirmation(id: string, target: string): string {
  return `RESTORE ${id} TO ${target}`;
}
async function requireFresh(target: BackupContext, image: DatabaseImage): Promise<void> {
  const names = await tableNames(target.db);
  if (JSON.stringify([...names].sort()) !== JSON.stringify(image.tables.map(table => table.name).sort())) {
    throw new BackupError("RESTORE_SCHEMA_MISMATCH", "Target must have exactly the backup's migration set");
  }
  // Only the exact rows seeded by migrations may precede restoration.
  // A versioned operator policy is user state even when no users/projects remain.
  const userData: Readonly<Record<string, string>> = {
    schema_migrations: "0=1",
    event_counter: "id<>1 OR value<>0",
    compiler_queue_counter: "id<>1 OR value<>0",
    o_worker_policy: "id<>1 OR minimum<>0 OR maximum<>2 OR requested<>0 OR timeout_seconds<>180 OR sandbox<>'bwrap' OR version<>0 OR managed<>0",
    account_project_benefits: `scope_kind<>'deployment' OR scope_id<>'local' OR benefits_json IS NULL
      OR benefits_json<>'{"compileSeconds":180,"writableMembers":null,"historyDays":null,"trackChanges":true}'
      OR version<>0 OR updated_at<>'1970-01-01T00:00:00.000Z'`,
  };
  for (const name of names) {
    if (await target.db.get(`SELECT 1 FROM ${identifier(name)} WHERE ${userData[name] ?? "1=1"} LIMIT 1`)) {
      throw new BackupError("RESTORE_TARGET_NOT_EMPTY", name);
    }
  }
  const source = image.tables.find(table => table.name === "schema_migrations");
  const migrated = await target.db.all<{ id: string; digest: string }>("SELECT id,digest FROM schema_migrations ORDER BY id");
  const original = source?.rows.map(row => z.object({ id: z.string(), digest: z.string() }).parse(row))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (target.db.dialect === image.dialect && JSON.stringify(original) !== JSON.stringify(migrated)) {
    throw new BackupError("RESTORE_MIGRATION_MISMATCH", "Original migration bytes do not match target");
  }
  if (target.db.dialect !== image.dialect &&
      JSON.stringify(original?.map(row => row.id)) !== JSON.stringify(migrated.map(row => row.id))) {
    throw new BackupError("RESTORE_MIGRATION_MISMATCH", "Explicit target dialect variants are required for every source migration");
  }
}
async function importDatabase(target: BackupContext, image: DatabaseImage): Promise<{
  readonly interruptedBackupOperations: readonly Id[];
  readonly expiredWorkerIds: readonly Id[];
  readonly workerControllerGeneration: number | null;
}> {
  const ordered = orderedTables(image);
  return target.uow.run(async tx => {
    await tx.lock("quire:backup-restore");
    switch (tx.dialect) {
      case "sqlite": await tx.exec("PRAGMA defer_foreign_keys=ON"); break;
      case "postgres": break;
      default: { const exhaustive: never = tx.dialect; throw new BackupError("RESTORE_DIALECT_INVALID", exhaustive); }
    }
    for (const table of [...ordered].reverse()) {
      if (table.name !== "schema_migrations") await tx.run(`DELETE FROM ${identifier(table.name)}`);
    }
    for (const table of ordered) {
      if (table.name === "schema_migrations" && tx.dialect !== image.dialect) continue;
      if (table.name === "schema_migrations") await tx.run("DELETE FROM schema_migrations");
      for (const row of table.rows) {
        const columns = Object.keys(row);
        await tx.run(`INSERT INTO ${identifier(table.name)} (${columns.map(identifier).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
          columns.map(column => decodeCell(row[column] ?? null)));
      }
    }
    // Dead owners must not acquire authority on the isolated instance; retain every fence.
    await tx.run("UPDATE branch_leases SET expires_at=?", [target.clock.now()]);
    switch (tx.dialect) {
      case "sqlite": break;
      case "postgres":
        for (const table of ["audit_entries", "events"]) await tx.exec(
          `SELECT setval(pg_get_serial_sequence('${table}','seq'), GREATEST(COALESCE((SELECT MAX(seq) FROM ${identifier(table)}),0),1), EXISTS(SELECT 1 FROM ${identifier(table)}))`);
        break;
      default: { const exhaustive: never = tx.dialect; throw new BackupError("RESTORE_DIALECT_INVALID", exhaustive); }
    }
    const expiredWorkers = await tx.all<{ id: string }>(
      "UPDATE workers SET state='offline',job_id=NULL WHERE state<>'offline' OR job_id IS NOT NULL RETURNING id");
    await tx.run("UPDATE worker_leases SET expires_at=?", [target.clock.now()]);
    let workerControllerGeneration: number | null = null;
    if (image.tables.some(table => table.name === "o_worker_controller")) {
      const controller = await tx.get<{ generation: number }>("SELECT generation FROM o_worker_controller WHERE id=1");
      workerControllerGeneration = controller?.generation ?? null;
      await tx.run("UPDATE o_worker_controller SET expires_at=?", [target.clock.now()]);
      // Source process IDs are receipts, never handles that a restored controller may own.
      await tx.run(`UPDATE o_worker_processes SET pid=NULL,desired='stopped',exited_at=?,version=version+1
        WHERE exited_at IS NULL`, [target.clock.now()]);
    }
    const interrupted: Id[] = [];
    for (const row of await tx.all<{ actor_id: string; request_key: string; response_json: string }>(
      "SELECT actor_id,request_key,response_json FROM o_backup_receipts")) {
      const operation = OperationSchema.parse(JSON.parse(row.response_json));
      switch (operation.status) {
        case "queued":
        case "running": {
          const recovered = { ...operation, status: "failed", errorCode: "RESTORE_INTERRUPTED_BACKUP" };
          await tx.run("UPDATE operations SET status='failed',error_code=? WHERE id=?", [recovered.errorCode, operation.id]);
          await tx.run("UPDATE backups SET status='failed' WHERE operation_id=?", [operation.id]);
          await tx.run("UPDATE o_backup_receipts SET response_json=? WHERE actor_id=? AND request_key=?",
            [JSON.stringify(recovered), row.actor_id, row.request_key]);
          interrupted.push(operation.id);
          break;
        }
        case "succeeded": case "failed": case "timeout": case "canceled": break;
        default: { const exhaustive: never = operation.status; throw new BackupError("RESTORE_OPERATION_INVALID", exhaustive); }
      }
    }
    return { interruptedBackupOperations: interrupted,
      expiredWorkerIds: expiredWorkers.map(worker => IdSchema.parse(worker.id)), workerControllerGeneration };
  });
}
export async function restoreBackup(context: BackupContext, input: {
  readonly archive: string; readonly target: string; readonly confirmation: string;
}) {
  const host = backupHost(context);
  const verified = await verifyBackup(input.archive, context.secretKey, host.signingKey);
  if (input.confirmation !== restoreConfirmation(verified.manifest.id, input.target)) {
    throw new BackupError("RESTORE_CONFIRMATION_REQUIRED", "Enter the exact backup ID and isolated target confirmation");
  }
  const destination = await ownedPath(host.restoreRoot, input.target);
  if (destination === resolve(context.config.dataDir)) throw new BackupError("RESTORE_LIVE_TARGET", "Live restore is not supported");
  // Exclusive creation rejects even an empty pre-existing directory; never delete a survivor.
  await mkdir(destination, { mode: 0o700 });
  await writeDurable(join(destination, "secret.key"), Buffer.from(verified.key).toString("hex") + "\n");
  let target: Runtime | undefined;
  try {
    target = await host.openFresh(destination, verified.key);
    if (target.db === context.db || resolve(target.config.dataDir) !== destination ||
        !timingSafeEqual(target.secretKey, verified.key)) {
      throw new BackupError("RESTORE_TARGET_AUTHORITY", "Target factory must preserve original key and open isolated storage");
    }
    const receipt = await importVerifiedBackup(context, input.archive, target, verified);
    await writeDurable(join(destination, "recovery-receipt.json"), JSON.stringify(receipt));
    await writeDurable(join(destination, "recovered-configuration.json"), JSON.stringify(verified.configuration));
    return { destination, receipt };
  } catch (error) {
    await writeDurable(join(destination, "recovery-failed.json"), JSON.stringify({
      backupId: verified.manifest.id, code: error instanceof BackupError ? error.code : "RESTORE_FAILED",
    }));
    throw error;
  } finally { await target?.close(); }
}

async function importVerifiedBackup(context: BackupContext, archive: string, target: BackupContext,
  verified: Awaited<ReturnType<typeof verifyBackup>>) {
  await requireFresh(target, verified.database);
  for (const file of verified.manifest.files.filter(entry => entry.path.startsWith("blobs/"))) {
    const bytes = await readRegular(join(archive, file.path));
    if (await target.blobs.put(bytes) !== file.sha256) throw new BackupError("RESTORE_BLOB_MISMATCH", file.path);
  }
  for (const repository of verified.manifest.repositories) {
    await target.repositories.initialize(repository.projectId);
    await target.repositories.importPack(repository.projectId,
      await readRegular(join(archive, `repositories/${repository.projectId}.pack`)));
  }
  const recoveredAuthority = await importDatabase(target, verified.database);
  for (const repository of verified.manifest.repositories) {
    if (!repository.refs.length) continue;
    const scope = { projectId: repository.projectId, branch: "main" };
    const lease = await target.branches.acquire(scope, crypto.randomUUID(), 300000);
    if (!lease) throw new BackupError("RESTORE_BRANCH_BUSY", repository.projectId);
    const id = IdSchema.parse(crypto.randomUUID());
    try {
      await target.repositories.publish({ id, lease, updates: repository.refs.map(ref => ({
        ref: ref.ref, expected: null, next: ref.oid,
      })) });
      await target.uow.run(async tx => {
        await target.repositories.finalize(tx, id, lease);
        await tx.run("DELETE FROM repository_intents WHERE id=?", [id]);
      });
    } finally { await target.branches.release(lease); }
  }
  return {
    backupId: verified.manifest.id, manifestDigest: verified.manifestDigest,
    sourceDialect: verified.database.dialect, targetDialect: target.db.dialect,
    originalMigrations: verified.database.tables.find(table => table.name === "schema_migrations")?.rows,
    authority: verified.manifest.authority, restoredAt: context.clock.now(),
    tables: verified.manifest.tables, repositories: verified.manifest.repositories.length, ...recoveredAuthority,
  };
}
