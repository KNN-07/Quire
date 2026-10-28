import { test, expect } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, loadConfig } from "@quire/runtime";
import { createBackup, verifyBackup, restoreBackup, restoreConfirmation } from "../../../services/operations/backups";
import { exportDatabase } from "../../../services/operations/backups/database";
import { exportRepository } from "../../../services/operations/backups/repositories";
import { fixtureIds } from "../../fixtures/foundation";
import { backupFixture, backupModules } from "./fixture";

test("restores all tables, immutable blobs, hidden and unreachable Git objects when the source is quiesced", async () => {
  // Given a real seeded SQLite/disk/Git instance, including an unreachable staged object.
  await using fixture = await backupFixture();
  const { runtime } = fixture;
  const dangling = await runtime.repositories.objects(fixtureIds.project, ["hash-object", "-w", "--stdin"],
    new TextEncoder().encode("unreachable staged bytes"));
  const before = await exportDatabase(runtime);
  const repository = await exportRepository(runtime, fixtureIds.project);
  // When the signed archive is restored to a new isolated root.
  const archive = await createBackup(runtime);
  const verified = await verifyBackup(archive.destination, runtime.secretKey, fixture.signingKey);
  const result = await restoreBackup(runtime, { archive: archive.destination, target: "isolated",
    confirmation: restoreConfirmation(archive.manifest.id, "isolated") });
  const target = await createRuntime(loadConfig({ QUIRE_DATA_DIR: result.destination }),
    { modules: backupModules.map(module => ({ ...module, register: () => {} })) });
  try {
    // Then every durable category survives, including original key and migration receipts.
    const after = await exportDatabase(target);
    expect(after.tables.filter(table => table.name !== "branch_leases")).toEqual(before.tables.filter(table => table.name !== "branch_leases"));
    expect(target.secretKey).toEqual(runtime.secretKey);
    expect(await exportRepository(target, fixtureIds.project)).toEqual(repository);
    expect(new TextDecoder().decode(await target.repositories.objects(fixtureIds.project,
      ["cat-file", "-p", new TextDecoder().decode(dangling).trim()]))).toBe("unreachable staged bytes");
    for (const file of verified.manifest.files.filter(entry => entry.path.startsWith("blobs/"))) {
      expect(await readFile(join(archive.destination, file.path))).toEqual(
        await readFile(join(result.destination, "blobs", file.sha256.slice(0, 2), file.sha256)));
    }
  } finally { await target.close(); }
}, 120000);

test("rejects corruption and missing authority when verifying a full backup", async () => {
  // Given a complete archive whose trusted key is held separately.
  await using fixture = await backupFixture();
  const archive = await createBackup(fixture.runtime);
  // When the archived key is removed.
  await rm(join(archive.destination, "secret.key"));
  // Then full recovery is rejected rather than silently generating replacement authority.
  await rejects(verifyBackup(archive.destination, fixture.runtime.secretKey, fixture.signingKey), { code: "BACKUP_INCOMPLETE" });
}, 120000);

test("rejects configuration-only exports when requested as full recovery", async () => {
  // Given an operator configuration export.
  await using fixture = await backupFixture();
  const path = join(fixture.backupRoot, "configuration-only");
  await mkdir(path);
  await writeFile(join(path, "manifest.json"), JSON.stringify({ format: "quire-config-v1" }));
  // When it is submitted as full recovery.
  const recovery = verifyBackup(path, fixture.runtime.secretKey, fixture.signingKey);
  // Then it is rejected before any isolated target is opened.
  await rejects(recovery);
}, 120000);

test("preserves survivor bytes when a restore target already exists", async () => {
  // Given a pre-existing target containing unrelated user data.
  await using fixture = await backupFixture();
  const archive = await createBackup(fixture.runtime);
  const target = join(fixture.restoreRoot, "survivor");
  await mkdir(target);
  await writeFile(join(target, "important.txt"), "survivor data");
  // When a confirmed restore attempts to reuse that target.
  const recovery = restoreBackup(fixture.runtime, { archive: archive.destination, target: "survivor",
    confirmation: restoreConfirmation(archive.manifest.id, "survivor") });
  // Then exclusive directory creation fails and the survivor is byte-identical.
  await rejects(recovery, { code: "EEXIST" });
  expect(await readFile(join(target, "important.txt"), "utf8")).toBe("survivor data");
}, 120000);
