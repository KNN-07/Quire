import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBackup, inspectRestoreTarget, restoreBackupToTarget } from "../../../../services/operations/backups";
import { backupHost } from "../../../../services/operations/backups/model";
import { reconcileCommandKeys, reserveUpdateCommand } from "../../../../services/operations/updates";
import { fixtureIds } from "../../../fixtures/foundation";
import { backupFixture } from "../../backups/fixture";
import { at, controlFixture, id } from "../control-fixture";

test("real older application import cannot replace control receipts or floor and real backup keeps operation checks", async () => {
  const application = await backupFixture();
  const control = await controlFixture();
  try {
    const source = application.runtime;
    // This real signed archive predates the command reservation.
    const archive = await createBackup(source);
    const command = await reserveUpdateCommand(source.uow, "fixture-install", fixtureIds.operator, "independent-foundation", {
      releaseId: control.release.id, at, autoSecurity: false,
    });
    control.inhibit(command);
    expect(control.store.receipt(command.operationId)?.operation.status).toBe("running");
    expect(await source.db.all("SELECT * FROM operations WHERE kind='update'")).toEqual([]);
    const whileRunning = await createBackup(source);
    expect(whileRunning.manifest.tables.length).toBeGreaterThan(0);

    for (const kind of ["adapter", "update"]) {
      const pending = id();
      await source.db.run(`INSERT INTO operations
        (id,actor_id,kind,status,idempotency_key,created_at,updated_at) VALUES(?,?,?,'running',?,?,?)`,
      [pending, fixtureIds.operator, kind, pending, source.clock.now(), source.clock.now()]);
      try {
        await rejects(createBackup(source), { code: "BACKUP_RECOVERY_REQUIRED" });
        expect(await source.db.get("SELECT id,status FROM operations WHERE id=?", [pending]))
          .toEqual({ id: pending, status: "running" });
      } finally {
        await source.db.run("DELETE FROM operations WHERE id=?", [pending]);
      }
    }

    // Ledger-only stopped/health records test persistence, not process supervision.
    control.stopped(command.operationId);
    control.store.commit(control.commitInput(command.operationId, control.health(command.operationId)));
    const receipt = control.store.receipt(command.operationId);
    const floor = control.store.state().floor;
    const retained = [await inspectRestoreTarget(source)];
    const destination = join(application.restoreRoot, "older-application");
    await mkdir(destination, { mode: 0o700 });
    await writeFile(join(destination, "secret.key"), Buffer.from(source.secretKey).toString("hex") + "\n", { mode: 0o600 });
    const target = await backupHost(source).openFresh(destination, source.secretKey);
    try {
      await restoreBackupToTarget(source, {
        archive: archive.destination, target, identity: await inspectRestoreTarget(target), retained,
      });
      expect(await target.db.all("SELECT * FROM o_update_command_keys")).toEqual([]);
      expect(await target.db.all("SELECT * FROM update_install_state")).toEqual([]);
      expect(await target.db.all("SELECT * FROM operations WHERE kind='update'")).toEqual([]);
      control.reopen();
      expect(control.store.receipt(command.operationId)).toEqual(receipt);
      expect(control.store.state().floor).toEqual(floor);
      expect(control.store.existing(command)).toEqual(receipt);
      expect(() => control.store.accept(control.command("downgrade"), control.release, at)).toThrow("RELEASE_DOWNGRADE");
      await reconcileCommandKeys(target.uow, [command]);
      expect(await reserveUpdateCommand(target.uow, "fixture-install", fixtureIds.operator, command.key, command.request))
        .toEqual(command);
      await rejects(target.db.run(`INSERT INTO operations
        (id,actor_id,kind,status,idempotency_key,created_at,updated_at) VALUES(?,?,'adapter','queued',?,?,?)`,
      [id(), fixtureIds.operator, command.key, target.clock.now(), target.clock.now()]), /IDEMPOTENCY_CONFLICT/);
      expect(await source.db.get("SELECT operation_id FROM o_update_command_keys WHERE request_key=?", [command.key]))
        .toEqual({ operation_id: command.operationId });
      console.info("FOUNDATION_DURABILITY", JSON.stringify({
        archive: archive.manifest.id, manifestDigest: archive.manifestDigest,
        applicationRoot: application.root, controlRoot: control.root, operationId: command.operationId,
        floor, status: receipt?.operation.status, replacement: target.config.dataDir,
        reconciledOperationId: command.operationId,
      }));
    } finally {
      await target.close();
    }
  } finally {
    await control[Symbol.asyncDispose]();
    await application[Symbol.asyncDispose]();
  }
  expect(existsSync(control.root)).toBe(false);
  expect(existsSync(application.root)).toBe(false);
  console.info("FOUNDATION_CLEANED", JSON.stringify({ control: control.root, application: application.root }));
}, 120000);
