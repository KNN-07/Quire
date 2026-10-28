import { test, expect } from "bun:test";
import { rejects } from "node:assert/strict";
import { chmod, readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { createRuntime, loadConfig } from "@quire/runtime";
import { fixtureIds } from "../../fixtures/foundation";
import { createBackup, verifyBackup, restoreBackup, restoreConfirmation } from "../../../services/operations/backups";
import { digest, manifestSchema } from "../../../services/operations/backups/model";
import { signManifest } from "../../../services/operations/backups/signing";
import { backupFixture } from "./fixture";

test("rejects changed blob bytes even when the manifest itself is intact", async () => {
  // Given a signed full archive.
  await using fixture = await backupFixture();
  const archive = await createBackup(fixture.runtime);
  const blob = archive.manifest.files.find(file => file.path.startsWith("blobs/"));
  if (!blob) throw new TypeError("Fixture must have real source blobs");
  // When an actual archived blob is corrupted.
  await writeFile(join(archive.destination, blob.path), "corrupt");
  // Then verification fails on its recorded digest before restore.
  await rejects(verifyBackup(archive.destination, fixture.runtime.secretKey, fixture.signingKey), { code: "BACKUP_DIGEST_INVALID" });
}, 120000);

test("rejects a previously interrupted backup instead of exempting every backup job", async () => {
  // Given a durable older backup claim with no running creator in this owned fixture.
  await using fixture = await backupFixture();
  const operation = crypto.randomUUID();
  const backup = crypto.randomUUID();
  const now = fixture.runtime.clock.now();
  await fixture.runtime.db.run(`INSERT INTO operations(id,actor_id,kind,status,created_at,updated_at)
    VALUES(?,?,'backup-create','running',?,?)`, [operation, fixtureIds.operator, now, now]);
  await fixture.runtime.db.run(`INSERT INTO backups(id,status,created_at,destination,operation_id)
    VALUES(?,'running',?,?,?)`, [backup, now, join(fixture.backupRoot, backup), operation]);
  // When a different backup attempts to export source state.
  const result = createBackup(fixture.runtime);
  // Then only its own active claim can be exempt, never another interrupted operation.
  await rejects(result, { code: "BACKUP_RECOVERY_REQUIRED" });
}, 120000);

test("rejects a different trusted instance key instead of trusting the archived key", async () => {
  // Given a complete archive signed under the original runtime authority.
  await using fixture = await backupFixture();
  const archive = await createBackup(fixture.runtime);
  // When a different independently supplied key is used.
  const result = verifyBackup(archive.destination, crypto.getRandomValues(new Uint8Array(32)), fixture.signingKey);
  // Then the otherwise intact archive fails authentication.
  await rejects(result, { code: "BACKUP_SIGNATURE_INVALID" });
}, 120000);

test("rejects an invalid Git pack even with a valid updated digest and signature", async () => {
  // Given a complete signed archive with a real repository.
  await using fixture = await backupFixture();
  const archive = await createBackup(fixture.runtime);
  const manifest = manifestSchema.parse(JSON.parse(await readFile(join(archive.destination, "manifest.json"), "utf8")));
  const pack = manifest.files.find(file => file.path.startsWith("repositories/"));
  if (!pack) throw new TypeError("Fixture must contain a Git pack");
  const corrupt = new TextEncoder().encode("not a Git pack");
  await writeFile(join(archive.destination, pack.path), corrupt);
  const replacement = JSON.stringify({ ...manifest, files: manifest.files.map(file =>
    file.path === pack.path ? { ...file, bytes: corrupt.length, sha256: digest(corrupt) } : file) });
  await writeFile(join(archive.destination, "manifest.json"), replacement);
  await writeFile(join(archive.destination, "manifest.sig"), signManifest(fixture.signingKey, new TextEncoder().encode(replacement)));
  // When the authorized but invalid archive is verified.
  const result = verifyBackup(archive.destination, fixture.runtime.secretKey, fixture.signingKey);
  // Then real Git validation rejects it rather than treating digest equality as recovery proof.
  await rejects(result, { code: "BACKUP_GIT_INVALID" });
}, 120000);

test("rejects a substituted signing key even though the archive contains the correct instance key", async () => {
  // Given a valid archive and its independently pinned verification authority.
  await using fixture = await backupFixture();
  const archive = await createBackup(fixture.runtime);
  // When verification is attempted under an unrelated signer.
  const result = verifyBackup(archive.destination, fixture.runtime.secretKey, generateKeyPairSync("ed25519").publicKey);
  // Then possessing the archived instance key cannot establish signature trust.
  await rejects(result, { code: "BACKUP_SIGNATURE_INVALID" });
}, 120000);

test("rejects pending repository publication rather than copying inconsistent SQL and refs", async () => {
  // Given a repository journal that has not finalized.
  await using fixture = await backupFixture();
  await fixture.runtime.db.run("UPDATE repository_intents SET state='published'");
  // When a backup attempts to export the instance.
  const result = createBackup(fixture.runtime);
  // Then recovery must complete explicitly before backup is accepted.
  await rejects(result, { code: "BACKUP_RECOVERY_REQUIRED" });
}, 120000);

test("rejects symlink restore targets without changing survivor bytes", async () => {
  // Given a source root that contains the live instance key.
  await using fixture = await backupFixture();
  const archive = await createBackup(fixture.runtime);
  const sourceKey = await readFile(join(fixture.runtime.config.dataDir, "secret.key"));
  await symlink(fixture.runtime.config.dataDir, join(fixture.restoreRoot, "alias"));
  // When an alias target points at the live instance.
  const result = restoreBackup(fixture.runtime, { archive: archive.destination, target: "alias",
    confirmation: restoreConfirmation(archive.manifest.id, "alias") });
  // Then exclusive target creation rejects it and live authority is unchanged.
  await rejects(result, { code: "EEXIST" });
  expect(await readFile(join(fixture.runtime.config.dataDir, "secret.key"))).toEqual(sourceKey);
}, 120000);

test("rejects traversal outside the configured isolated restore root", async () => {
  // Given a signed archive and the live source next to the configured restore root.
  await using fixture = await backupFixture();
  const archive = await createBackup(fixture.runtime);
  const key = await readFile(join(fixture.runtime.config.dataDir, "secret.key"));
  // When a confirmed target attempts to leave the isolated root.
  const result = restoreBackup(fixture.runtime, { archive: archive.destination, target: "../source",
    confirmation: restoreConfirmation(archive.manifest.id, "../source") });
  // Then no live source file can be overwritten.
  await rejects(result, { code: "BACKUP_PATH_DENIED" });
  expect(await readFile(join(fixture.runtime.config.dataDir, "secret.key"))).toEqual(key);
}, 120000);

test("rejects a publicly accessible backup root before writing authority material", async () => {
  // Given a misconfigured owned destination directory.
  await using fixture = await backupFixture();
  await chmod(fixture.backupRoot, 0o755);
  // When a full backup would include the original private instance key.
  const result = createBackup(fixture.runtime);
  // Then the boundary rejects unsafe destination permissions.
  await rejects(result, { code: "BACKUP_ROOT_PERMISSIONS" });
}, 120000);

test("fails closed when root assembly has not installed a quiescence host", async () => {
  // Given a real runtime with no maintenance host.
  await using fixture = await backupFixture();
  const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: join(fixture.root, "unconfigured") }));
  try {
    // When full backup is requested.
    const result = createBackup(runtime);
    // Then it cannot report a successful snapshot without all-writer exclusion.
    await rejects(result, { code: "BACKUP_QUIESCENCE_REQUIRED" });
  } finally { await runtime.close(); }
}, 120000);
