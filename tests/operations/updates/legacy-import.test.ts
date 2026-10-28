import { expect, test } from "bun:test";
import { z } from "zod";
import { ApplicationLegacySource, importLegacyUpdates } from "../../../services/operations/updates";
import { LegacyRowsSchema, LegacySnapshotSchema } from "../../../services/operations/installation/legacy-import";
import { controlDigest } from "../../../services/operations/installation/protocol";
import { fixture, id } from "./fixture";
import { discover } from "../../../services/operations/updates/feed";
import { rejection } from "./rejection";

async function legacy(f: Awaited<ReturnType<typeof fixture>>, phase: "succeeded" | "migrating" = "succeeded") {
  const release = (await discover(f.config, f.clock.now()))[0];
  if (release === undefined) throw new Error("Fixture release missing");
  const operationId = id();
  const releaseBytes = JSON.stringify(release, null, 2) + "\n";
  const resultBytes = phase === "succeeded" ? '{ "original": "result bytes", "version": "2.0.0" }\n' : null;
  const backupBytes = ' { "legacy": "exact backup bytes" }\n';
  await f.runtime.db.run(`INSERT INTO operations
    (id,actor_id,kind,status,progress,result_json,error_code,idempotency_key,version,created_at,updated_at)
    VALUES(?,?,'update',?,?,?,?,?,3,?,?)`, [
    operationId, f.actorId, phase === "succeeded" ? "succeeded" : "running",
    phase === "succeeded" ? 1 : 0.6, resultBytes, phase === "succeeded" ? null : "ORIGINAL_ERROR",
    "legacy-command", f.clock.now(), f.clock.now(),
  ]);
  await f.runtime.db.run(`INSERT INTO update_jobs
    (operation_id,release_json,scheduled_at,security_only,phase,prior_target,staged_target,backup_json)
    VALUES(?,?,?,0,?,'releases/prior','releases/legacy',?)`,
  [operationId, releaseBytes, f.clock.now(), phase, backupBytes]);
  await f.runtime.db.run("INSERT INTO update_install_state VALUES(?,?,?)", [f.config.installId, 2, "2.0.0"]);
  const source = new ApplicationLegacySource(f.runtime.uow, {
    sourceId: "owned-original-generation", installationId: f.config.installId,
    dataIdentity: `fixture-runtime:${f.root}/runtime`,
  });
  return { source, operationId, releaseBytes, resultBytes, backupBytes };
}

test("real application removal is byte-verified and resumable through both independent-store crash gaps", async () => {
  await using f = await fixture();
  const old = await legacy(f);
  const ledger = await f.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id");
  const snapshot = await old.source.snapshot();
  const copied = f.control.copyLegacy(snapshot, f.clock.now());
  expect(copied.digest).toBe(controlDigest(copied.snapshotBytes));
  expect(f.control.receipt(old.operationId)?.resultBytes).toBe(old.resultBytes);
  const originalSnapshot = LegacySnapshotSchema.parse(JSON.parse(copied.snapshotBytes));
  const originalRows = LegacyRowsSchema.parse(JSON.parse(originalSnapshot.rowsBytes));
  expect(originalRows.jobs[0]?.release_json).toBe(old.releaseBytes);
  expect(originalRows.jobs[0]?.backup_json).toBe(old.backupBytes);
  await f.reopenControl();
  expect(f.control.copyLegacy(await old.source.snapshot(), f.clock.now())).toEqual(copied);
  await f.runtime.db.run("UPDATE operations SET progress=0.9 WHERE id=?", [old.operationId]);
  expect(await rejection(old.source.removeCopied(copied))).toMatchObject({ code: "LEGACY_SOURCE_CHANGED" });
  expect(await f.runtime.db.all("SELECT * FROM o_update_command_keys")).toEqual([]);
  await f.runtime.db.run("UPDATE operations SET progress=1 WHERE id=?", [old.operationId]);
  const removed = await old.source.removeCopied(copied);
  expect(await f.runtime.db.all("SELECT * FROM update_jobs")).toEqual([]);
  expect(await f.runtime.db.all("SELECT * FROM operations WHERE kind='update'")).toEqual([]);
  expect(await f.runtime.db.all("SELECT * FROM update_install_state")).toEqual([]);
  await f.reopenControl();
  expect(f.control.legacyImport(snapshot.sourceId)?.removedAt).toBeNull();
  expect(await old.source.snapshot()).toEqual(snapshot);
  expect(await old.source.removeCopied(copied)).toEqual(removed);
  await f.runtime.db.run("UPDATE o_update_legacy_removals SET receipt_bytes='corrupt' WHERE source_id=?", [snapshot.sourceId]);
  expect(await rejection(old.source.snapshot())).toMatchObject({ code: "LEGACY_CHECKPOINT_INVALID" });
  expect(await rejection(old.source.removeCopied(copied))).toMatchObject({ code: "LEGACY_CHECKPOINT_INVALID" });
  await f.runtime.db.run("UPDATE o_update_legacy_removals SET receipt_bytes=? WHERE source_id=?", [removed.receiptBytes, snapshot.sourceId]);
  const final = await importLegacyUpdates(old.source, f.control, f.clock);
  expect(final.removalReceiptBytes).toBe(removed.receiptBytes);
  expect(final.removedAt).toBe(f.clock.now());
  expect(await f.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id")).toEqual(ledger);
  expect(f.control.state().floor).toEqual({ sequence: 2, version: "2.0.0" });
  expect(z.object({ operation_id: z.string() }).parse(await f.runtime.db.get(
    "SELECT operation_id FROM o_update_command_keys WHERE request_key='legacy-command'",
  )).operation_id).toBe(old.operationId);
});

test("source deletion, command reservation and tombstone roll back together on a real SQL failure", async () => {
  await using f = await fixture();
  const old = await legacy(f);
  const copied = f.control.copyLegacy(await old.source.snapshot(), f.clock.now());
  await f.runtime.db.exec(`CREATE TRIGGER fail_legacy_remove BEFORE INSERT ON o_update_legacy_removals
    BEGIN SELECT RAISE(ABORT,'injected tombstone transaction failure'); END;`);
  expect(await rejection(old.source.removeCopied(copied))).toBeInstanceOf(Error);
  expect(await f.runtime.db.get("SELECT id FROM operations WHERE id=?", [old.operationId])).not.toBeNull();
  expect(await f.runtime.db.get("SELECT operation_id FROM update_jobs WHERE operation_id=?", [old.operationId])).not.toBeNull();
  expect(await f.runtime.db.all("SELECT * FROM o_update_command_keys")).toEqual([]);
  expect(await f.runtime.db.all("SELECT * FROM o_update_legacy_removals")).toEqual([]);
  await f.runtime.db.exec("DROP TRIGGER fail_legacy_remove");
  await importLegacyUpdates(old.source, f.control, f.clock);
  expect(await f.runtime.db.all("SELECT * FROM operations WHERE kind='update'")).toEqual([]);
});

test("interrupted legacy work remains recovery-required and changed original ledger bytes prevent removal", async () => {
  await using f = await fixture();
  const old = await legacy(f, "migrating");
  const copied = f.control.copyLegacy(await old.source.snapshot(), f.clock.now());
  expect(f.control.state().mode).toBe("recovery_required");
  expect(f.control.receipt(old.operationId)?.operation.errorCode).toBe("ORIGINAL_ERROR");
  expect(f.control.receipt(old.operationId)?.recovery?.migrationIntent).toBe(`legacy-unresolved:${old.operationId}`);
  await f.runtime.db.run("UPDATE schema_migrations SET applied_at=? WHERE id='070-o-updates'", ["2026-10-27T00:00:00.000Z"]);
  expect(await rejection(old.source.removeCopied(copied))).toMatchObject({ code: "LEGACY_SOURCE_CHANGED" });
  expect(await f.runtime.db.get("SELECT id FROM operations WHERE id=?", [old.operationId])).not.toBeNull();
  const sourceSnapshot = LegacySnapshotSchema.parse(JSON.parse(copied.snapshotBytes));
  expect(f.control.receipt(old.operationId)?.recovery?.originalMigrationLedger).toBe(sourceSnapshot.migrationLedgerBytes);
  await f.reopenControl();
  expect(f.control.state().mode).toBe("recovery_required");
});
