import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { z } from "zod";
import { ControlError } from "../../../services/operations/installation/model";
import { LegacyRowsSchema, LegacySnapshotSchema } from "../../../services/operations/installation/legacy-import";
import type { LegacyCopyCheckpoint, LegacyImportSource } from "../../../services/operations/installation/legacy-import";
import { controlDigest } from "../../../services/operations/installation/protocol";
import { at, controlFixture, id, later } from "./control-fixture";

test("byte-exact legacy copy/removal checkpoints survive both crash gaps with real source transactions", async () => {
  await using fixture = await controlFixture();
  const command = fixture.command();
  const job = {
    operation_id: command.operationId, release_json: JSON.stringify(fixture.release, null, 2) + "\n",
    scheduled_at: at, security_only: 0, phase: "succeeded",
    prior_target: "releases/prior", staged_target: "releases/candidate", backup_json: ' { "legacy": "backup bytes" }\n',
  };
  const operation = {
    id: command.operationId, actor_id: command.actorId, kind: "update", status: "succeeded",
    progress: 1, result_json: '{ "version": "2.0.0", "nested": { "preserved": true } }\n',
    error_code: null, idempotency_key: command.key, version: 3, created_at: at, updated_at: later,
  };
  const rows = LegacyRowsSchema.parse({
    jobs: [job], operations: [operation],
    floors: [{ install_id: "fixture-install", sequence: 2, version: "2.0.0" }],
  });
  const migrationLedgerBytes = '[ { "id": "070-o-updates", "sqlDigest": "original SQL bytes" } ]\n';
  using source = new Database(join(fixture.root, "legacy.sqlite"));
  source.exec(`
    CREATE TABLE operations(
      id TEXT PRIMARY KEY,actor_id TEXT,kind TEXT NOT NULL,status TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,result_json TEXT,error_code TEXT,idempotency_key TEXT,
      version INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      UNIQUE(actor_id,idempotency_key)
    ) STRICT;
    CREATE TABLE update_jobs(
      operation_id TEXT PRIMARY KEY REFERENCES operations(id),
      release_json TEXT NOT NULL,scheduled_at TEXT NOT NULL,security_only INTEGER NOT NULL,
      phase TEXT NOT NULL DEFAULT 'queued',prior_target TEXT,staged_target TEXT,backup_json TEXT
    ) STRICT;
    CREATE TABLE update_install_state(install_id TEXT PRIMARY KEY,sequence INTEGER NOT NULL,version TEXT NOT NULL) STRICT;
    CREATE TABLE schema_migrations(original_bytes TEXT NOT NULL);
    CREATE TABLE o_update_command_keys(actor_id TEXT,request_key TEXT,operation_id TEXT,request_digest TEXT,UNIQUE(actor_id,request_key));
    CREATE TABLE import_tombstones(source_id TEXT PRIMARY KEY,digest TEXT NOT NULL,receipt_bytes TEXT NOT NULL);
  `);
  source.query("INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
    operation.id, operation.actor_id, operation.kind, operation.status, operation.progress,
    operation.result_json, operation.error_code, operation.idempotency_key, operation.version,
    operation.created_at, operation.updated_at,
  );
  source.query("INSERT INTO update_jobs VALUES(?,?,?,?,?,?,?,?)").run(
    job.operation_id, job.release_json, job.scheduled_at, job.security_only, job.phase,
    job.prior_target, job.staged_target, job.backup_json,
  );
  source.query("INSERT INTO update_install_state VALUES(?,?,?)").run("fixture-install", 2, "2.0.0");
  source.query("INSERT INTO schema_migrations VALUES(?)").run(migrationLedgerBytes);
  const readRows = (table: string) => source.query(`SELECT * FROM ${table} ORDER BY 1`).all();
  const snapshot = () => LegacySnapshotSchema.parse({
    sourceId: "legacy-generation-one", installationId: "fixture-install", dataIdentity: "owned-test-sqlite-generation",
    migrationLedgerBytes: z.object({ original_bytes: z.string() }).parse(source.query("SELECT * FROM schema_migrations").get()).original_bytes,
    rowsBytes: JSON.stringify({ jobs: readRows("update_jobs"), operations: readRows("operations"), floors: readRows("update_install_state") }),
  });
  const adapter: LegacyImportSource = {
    snapshot: () => Promise.resolve(snapshot()),
    removeCopied(checkpoint: LegacyCopyCheckpoint) {
      return Promise.resolve(source.transaction(() => {
        const tombstone = z.object({ digest: z.string(), receipt_bytes: z.string() }).nullable().parse(
          source.query("SELECT digest,receipt_bytes FROM import_tombstones WHERE source_id=?").get(checkpoint.sourceId),
        );
        if (tombstone !== null) {
          if (tombstone.digest !== checkpoint.digest) throw new ControlError("SOURCE_IMPORT_CONFLICT");
          return { sourceId: checkpoint.sourceId, digest: checkpoint.digest, receiptBytes: tombstone.receipt_bytes };
        }
        if (JSON.stringify(snapshot()) !== checkpoint.snapshotBytes ||
            controlDigest(checkpoint.snapshotBytes) !== checkpoint.digest) throw new ControlError("SOURCE_BYTES_CHANGED");
        source.query("INSERT INTO o_update_command_keys VALUES(?,?,?,?)").run(
          command.actorId, command.key, command.operationId, command.requestDigest,
        );
        source.query("DELETE FROM update_jobs WHERE operation_id=?").run(command.operationId);
        source.query("DELETE FROM operations WHERE id=?").run(command.operationId);
        source.query("DELETE FROM update_install_state WHERE install_id=?").run("fixture-install");
        const receiptBytes = JSON.stringify({ sourceId: checkpoint.sourceId, digest: checkpoint.digest, copiedOperationIds: [command.operationId] });
        source.query("INSERT INTO import_tombstones VALUES(?,?,?)").run(checkpoint.sourceId, checkpoint.digest, receiptBytes);
        return { sourceId: checkpoint.sourceId, digest: checkpoint.digest, receiptBytes };
      }).immediate());
    },
  };
  const original = await adapter.snapshot();
  const checkpoint = fixture.store.copyLegacy(original, at);
  expect(checkpoint.digest).toBe(controlDigest(checkpoint.snapshotBytes));
  expect(fixture.store.receipt(command.operationId)?.resultBytes).toBe(operation.result_json);
  expect(fixture.store.receipt(command.operationId)?.recovery?.originalMigrationLedger).toBe(migrationLedgerBytes);
  expect(fixture.store.state().floor).toEqual({ sequence: 2, version: "2.0.0" });
  // First crash gap: copy committed, source rows are still present.
  fixture.reopen();
  expect(fixture.store.copyLegacy(original, later)).toEqual(checkpoint);
  expect(readRows("operations")).toEqual(rows.operations);
  const changed = { ...original, rowsBytes: original.rowsBytes + " " };
  expect(() => fixture.store.copyLegacy(changed, later)).toThrow("CONTROL_IMPORT_CONFLICT");
  expect(() => fixture.store.confirmLegacyRemoval({ sourceId: original.sourceId, digest: controlDigest("wrong"), receiptBytes: "no" }, later))
    .toThrow("CONTROL_IMPORT_REMOVAL_UNPROVEN");
  // A changed source blocks removal even after the control copy is committed.
  source.query("UPDATE operations SET progress=0.9 WHERE id=?").run(command.operationId);
  let removalError: unknown;
  try { await adapter.removeCopied(checkpoint); }
  catch (error) { removalError = error; }
  expect(removalError).toBeInstanceOf(ControlError);
  expect(removalError).toMatchObject({ code: "SOURCE_BYTES_CHANGED" });
  expect(source.query("SELECT * FROM o_update_command_keys").all()).toEqual([]);
  source.query("UPDATE operations SET progress=1 WHERE id=?").run(command.operationId);
  const removal = await adapter.removeCopied(checkpoint);
  // Second crash gap: source deletion/reservation committed, control removal
  // checkpoint not yet acknowledged. Retry uses the source tombstone.
  fixture.reopen();
  expect(fixture.store.legacyImport(original.sourceId)?.removedAt).toBeNull();
  expect(await adapter.removeCopied(checkpoint)).toEqual(removal);
  fixture.store.confirmLegacyRemoval(removal, later);
  fixture.reopen();
  expect(fixture.store.legacyImport(original.sourceId)?.removalReceiptBytes).toBe(removal.receiptBytes);
  expect(fixture.store.copyLegacy(original, later).removedAt).toBe(later);
  expect(readRows("operations")).toEqual([]);
  expect(readRows("update_jobs")).toEqual([]);
  expect(readRows("update_install_state")).toEqual([]);
  expect(source.query("SELECT operation_id FROM o_update_command_keys").all()).toEqual([{ operation_id: command.operationId }]);
  expect(z.object({ original_bytes: z.string() }).parse(source.query("SELECT * FROM schema_migrations").get()).original_bytes).toBe(migrationLedgerBytes);
});

test("interrupted legacy commands close authority and conflicting import rolls back every row", async () => {
  await using fixture = await controlFixture();
  const command = fixture.command();
  const rows = LegacyRowsSchema.parse({
    jobs: [{
      operation_id: command.operationId, release_json: JSON.stringify(fixture.release),
      scheduled_at: at, security_only: 0, phase: "migrating",
      prior_target: "releases/prior", staged_target: "releases/candidate", backup_json: null,
    }],
    operations: [{
      id: command.operationId, actor_id: command.actorId, kind: "update", status: "running",
      progress: 0.5, result_json: null, error_code: "ORIGINAL_ERROR", idempotency_key: command.key,
      version: 0, created_at: at, updated_at: at,
    }], floors: [],
  });
  const snapshot = LegacySnapshotSchema.parse({
    sourceId: "interrupted", installationId: "fixture-install", dataIdentity: "original-generation",
    rowsBytes: JSON.stringify(rows), migrationLedgerBytes: "original ledger bytes\n",
  });
  fixture.store.copyLegacy(snapshot, at);
  expect(fixture.store.state().mode).toBe("recovery_required");
  expect(fixture.store.receipt(command.operationId)?.phase).toBe("recovery_required");
  expect(fixture.store.receipt(command.operationId)?.recovery?.migrationIntent).toBe(`legacy-unresolved:${command.operationId}`);
  expect(fixture.store.receipt(command.operationId)?.operation.errorCode).toBe("ORIGINAL_ERROR");
  expect(fixture.store.state().floor.sequence).toBe(1);
  const otherCommand = fixture.command("another");
  const conflictRows = LegacyRowsSchema.parse({
    ...rows,
    jobs: [{ ...rows.jobs[0], operation_id: otherCommand.operationId }, ...rows.jobs],
    operations: [{ ...rows.operations[0], id: otherCommand.operationId, idempotency_key: otherCommand.key }, ...rows.operations],
  });
  expect(() => fixture.store.copyLegacy({ ...snapshot, sourceId: "conflicting", rowsBytes: JSON.stringify(conflictRows) }, at))
    .toThrow("CONTROL_IMPORT_CONFLICT");
  expect(fixture.store.receipt(otherCommand.operationId)).toBeNull();
  expect(fixture.store.legacyImport("conflicting")).toBeNull();
  fixture.reopen();
  expect(fixture.store.state().mode).toBe("recovery_required");
  expect(() => fixture.store.copyLegacy({ ...snapshot, sourceId: "wrong-install", installationId: "other" }, at))
    .toThrow("CONTROL_IMPORT_IDENTITY_CONFLICT");
  expect(() => fixture.store.confirmLegacyRemoval({ sourceId: id(), digest: controlDigest("uncommitted"), receiptBytes: "unproven" }, at))
    .toThrow("CONTROL_IMPORT_REMOVAL_UNPROVEN");
});
