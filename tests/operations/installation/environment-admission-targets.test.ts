import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { rejects } from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, loadConfig } from "@quire/runtime";
import { applicationMigrations } from "../../../apps/server/src/migrations";
import { configureBackups, createBackup, inspectRestoreTarget, restoreBackupToTarget } from "../../../services/operations/backups";

for (const seeded of [false, true]) test(`admission next-target provisioning ${seeded ? "rejects synthetic user rows" : "restores into an empty migrated schema"}`, async () => {
  const root = await mkdtemp(join(tmpdir(), "quire-p27-target-"));
  await using resources = new AsyncDisposableStack();
  resources.defer(() => rm(root, { recursive: true }));
  const migrations = [...await applicationMigrations(), { id: "099-o-admission-target",
    sql: "CREATE TABLE installation_update_probe(value TEXT NOT NULL);" +
      (seeded ? " INSERT INTO installation_update_probe VALUES('real-signed-migration');" : "") }];
  const source = await createRuntime(loadConfig({ QUIRE_DATA_DIR: join(root, "source"), QUIRE_COMPILER_BACKEND: "docker" }),
    { foundation: migrations });
  resources.defer(() => source.close());
  const destination = join(root, "target");
  await mkdir(destination, { mode: 0o700 });
  await writeFile(join(destination, "secret.key"), Buffer.from(source.secretKey).toString("hex"), { mode: 0o600 });
  const target = await createRuntime(loadConfig({ QUIRE_DATA_DIR: destination, QUIRE_COMPILER_BACKEND: "docker" }),
    { foundation: migrations });
  resources.defer(() => target.close());
  const backupRoot = join(root, "archives");
  const restoreRoot = join(root, "restores");
  await mkdir(backupRoot, { mode: 0o700 }); await mkdir(restoreRoot, { mode: 0o700 });
  configureBackups(source, { backupRoot, restoreRoot, signingKey: generateKeyPairSync("ed25519").privateKey,
    configuration: {}, exclusive: work => source.admission.exclusive(work),
    openFresh: async () => { throw new Error("Only explicit targets are used"); } });
  const backup = await createBackup(source);
  const restore = () => restoreBackupToTarget(source, { archive: backup.destination, target,
    identity: targetIdentity, retained: [sourceIdentity] });
  const targetIdentity = await inspectRestoreTarget(target);
  const sourceIdentity = await inspectRestoreTarget(source);
  if (seeded) {
    await rejects(restore(), { code: "RESTORE_TARGET_NOT_EMPTY", message: "installation_update_probe" });
    expect(await target.db.get("SELECT value FROM installation_update_probe")).toEqual({ value: "real-signed-migration" });
  } else {
    const result = await restore();
    expect(result.receipt.backupId).toBe(backup.manifest.id);
    expect(await target.db.get("SELECT value FROM installation_update_probe")).toBeNull();
  }
  console.info("P27_NATIVE_TARGET_FRESHNESS", { root, seeded, sourceIdentity, targetIdentity,
    outcome: seeded ? "RESTORE_TARGET_NOT_EMPTY" : "restored" });
}, 120000);
