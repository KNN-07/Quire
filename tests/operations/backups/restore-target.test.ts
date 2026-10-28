import { test, expect } from "bun:test";
import { rejects } from "node:assert/strict";
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DigestSchema } from "@quire/contracts";
import { createBackup, inspectRestoreTarget, restoreBackupToTarget } from "../../../services/operations/backups";
import { backupHost } from "../../../services/operations/backups/model";
import { exportDatabase } from "../../../services/operations/backups/database";
import { exportRepository } from "../../../services/operations/backups/repositories";
import { fixtureIds } from "../../fixtures/foundation";
import { backupFixture } from "./fixture";

async function openTarget(fixture: Awaited<ReturnType<typeof backupFixture>>, name: string) {
  const destination = join(fixture.restoreRoot, name);
  await mkdir(destination, { mode: 0o700 });
  await writeFile(join(destination, "secret.key"), Buffer.from(fixture.runtime.secretKey).toString("hex") + "\n", { mode: 0o600 });
  return backupHost(fixture.runtime).openFresh(destination, fixture.runtime.secretKey);
}

test("imports into an explicit native target, preserves original rows/blobs/Git and leaves source and caller handles intact", async () => {
  await using fixture = await backupFixture();
  const source = fixture.runtime;
  const before = await exportDatabase(source);
  const git = await exportRepository(source, fixtureIds.project);
  const archive = await createBackup(source);
  const retained = [await inspectRestoreTarget(source)];
  const target = await openTarget(fixture, "explicit-native");
  try {
    const identity = await inspectRestoreTarget(target);
    const result = await restoreBackupToTarget(source, { archive: archive.destination, target, identity, retained });
    expect(result.receipt.sourceDialect).toBe("sqlite");
    expect(result.receipt.targetDialect).toBe("sqlite");
    expect(result.receipt.backupId).toBe(archive.manifest.id);
    expect(result.receipt.manifestDigest).toBe(archive.manifestDigest);
    const durable = (image: typeof before) => image.tables.filter(table => table.name !== "branch_leases");
    expect(durable(await exportDatabase(target))).toEqual(durable(before));
    expect(await exportRepository(target, fixtureIds.project)).toEqual(git);
    for (const row of before.tables.find(table => table.name === "blobs")?.rows ?? []) {
      const digest = DigestSchema.parse(row["digest"]);
      expect(await target.blobs.get(digest)).toEqual(await source.blobs.get(digest));
    }
    expect(target.secretKey).toEqual(source.secretKey);
    expect(await exportDatabase(source)).toEqual(before);
    expect(await exportRepository(source, fixtureIds.project)).toEqual(git);
    expect(await target.db.get("SELECT id FROM users LIMIT 1")).not.toBeNull();
    console.info("RESTORE_TARGET_NATIVE", JSON.stringify({ backup: archive.manifest.id,
      digest: result.receipt.manifestDigest, tables: before.tables.length, database: identity.database,
      blobs: identity.blobs, repositories: identity.repositories }));
  } finally { await target.close(); }
}, 120000);

test("rejects shared, wrong, stale, nonempty and migration-mismatched native targets before import", async () => {
  await using fixture = await backupFixture();
  const source = fixture.runtime;
  const before = await exportDatabase(source);
  const sourceGit = await exportRepository(source, fixtureIds.project);
  const archive = await createBackup(source);
  const retained = [await inspectRestoreTarget(source)];
  const first = await openTarget(fixture, "first");
  const second = await openTarget(fixture, "second");
  const shared = await backupHost(source).openFresh(source.config.dataDir, source.secretKey);
  const aliasPath = join(fixture.root, "source-alias");
  await symlink(source.config.dataDir, aliasPath);
  const alias = await backupHost(source).openFresh(aliasPath, source.secretKey);
  try {
    const identity = await inspectRestoreTarget(first);
    await rejects(restoreBackupToTarget(source, { archive: archive.destination, target: second, identity, retained }),
      { code: "RESTORE_TARGET_AUTHORITY" });
    await rejects(restoreBackupToTarget(source, { archive: archive.destination, target: first,
      identity: structuredClone(identity), retained }), { code: "RESTORE_TARGET_AUTHORITY" });
    await rejects(restoreBackupToTarget(source, { archive: archive.destination, target: first, identity, retained: [] }),
      { code: "RESTORE_TARGET_AUTHORITY" });
    await rejects(restoreBackupToTarget(source, { archive: archive.destination, target: first, identity,
      retained: [...retained, identity] }), { code: "RESTORE_LIVE_TARGET" });
    const wrongKey = { ...first, secretKey: new Uint8Array(32) };
    await rejects(restoreBackupToTarget(source, { archive: archive.destination, target: wrongKey,
      identity: await inspectRestoreTarget(wrongKey), retained }), { code: "RESTORE_TARGET_AUTHORITY" });
    await rejects(restoreBackupToTarget(source, { archive: archive.destination, target: shared,
      identity: await inspectRestoreTarget(shared), retained }), { code: "RESTORE_LIVE_TARGET" });
    await rejects(restoreBackupToTarget(source, { archive: archive.destination, target: alias,
      identity: await inspectRestoreTarget(alias), retained }), { code: "RESTORE_LIVE_TARGET" });
    for (const target of [{ ...first, blobs: source.blobs }, { ...first, repositories: source.repositories }]) {
      await rejects(restoreBackupToTarget(source, { archive: archive.destination, target,
        identity: await inspectRestoreTarget(target), retained }), { code: "RESTORE_LIVE_TARGET" });
    }
    await first.blobs.put(new TextEncoder().encode("retained unregistered blob"));
    await rejects(restoreBackupToTarget(source, { archive: archive.destination, target: first, identity, retained }),
      { code: "RESTORE_TARGET_AUTHORITY" });
    await rejects(restoreBackupToTarget(source, { archive: archive.destination, target: first,
      identity: await inspectRestoreTarget(first), retained }), { code: "RESTORE_TARGET_NOT_EMPTY" });
    await second.repositories.initialize(fixtureIds.project);
    await rejects(restoreBackupToTarget(source, { archive: archive.destination, target: second,
      identity: await inspectRestoreTarget(second), retained }), { code: "RESTORE_TARGET_NOT_EMPTY" });
    expect(await first.db.get("SELECT id FROM users LIMIT 1")).toBeNull();
    expect(await second.db.get("SELECT id FROM users LIMIT 1")).toBeNull();
    expect(await exportDatabase(source)).toEqual(before);
    expect(await exportRepository(source, fixtureIds.project)).toEqual(sourceGit);
  } finally { await alias.close(); await shared.close(); await second.close(); await first.close(); }
  for (const { name, mutation, code } of [
    { name: "configured", mutation: "UPDATE o_worker_policy SET maximum=9,version=1 WHERE id=1", code: "RESTORE_TARGET_NOT_EMPTY" },
    { name: "migration", mutation: "UPDATE schema_migrations SET digest='wrong'", code: "RESTORE_MIGRATION_MISMATCH" },
    { name: "schema", mutation: "CREATE TABLE unexpected_restore_data(id TEXT)", code: "RESTORE_SCHEMA_MISMATCH" },
  ]) {
    const target = await openTarget(fixture, name);
    try {
      await target.db.run(mutation);
      await rejects(restoreBackupToTarget(source, { archive: archive.destination, target,
        identity: await inspectRestoreTarget(target), retained }), { code });
      expect(await target.db.get("SELECT id FROM users LIMIT 1")).toBeNull();
    } finally { await target.close(); }
  }
  const permissions = await openTarget(fixture, "permissions");
  try {
    await chmod(join(permissions.config.dataDir, "blobs"), 0o755);
    await rejects(inspectRestoreTarget(permissions), { code: "RESTORE_TARGET_AUTHORITY" });
  } finally { await permissions.close(); }
}, 120000);
