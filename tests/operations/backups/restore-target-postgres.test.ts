import { test, expect } from "bun:test";
import { S3Client } from "bun";
import { rejects } from "node:assert/strict";
import { createBackup, configureBackups, inspectRestoreTarget, restoreBackup, restoreBackupToTarget,
  restoreConfirmation } from "../../../services/operations/backups";
import { exportDatabase } from "../../../services/operations/backups/database";
import { exportRepository } from "../../../services/operations/backups/repositories";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { S3BlobStore } from "../../../services/operations/storage/s3";
import { RemoteRepositoryService } from "../../../services/operations/repository";
import { DigestSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { backupFixture } from "./fixture";
import { restoreTargetScaleFixture } from "./restore-target-scale-fixture";

test("restores actual PostgreSQL/S3/owned remote Git into distinct original-dialect stores and rejects shared authority", async () => {
  await using native = await backupFixture();
  const original = await createBackup(native.runtime);
  await using scale = await restoreTargetScaleFixture(native.runtime.secretKey);
  const source = await scale.open("source");
  configureBackups(native.runtime, {
    backupRoot: native.backupRoot, restoreRoot: native.restoreRoot, signingKey: native.signingKey,
    configuration: {}, exclusive: work => native.gate.exclusive(work),
    openFresh: source.openRuntime,
  });
  await restoreBackup(native.runtime, { archive: original.destination, target: "postgres-seed",
    confirmation: restoreConfirmation(original.manifest.id, "postgres-seed") });
  configureBackups(source.runtime, {
    backupRoot: native.backupRoot, restoreRoot: native.restoreRoot, signingKey: native.signingKey,
    configuration: source.configuration, exclusive: work => source.runtime.admission.exclusive(work),
    openFresh: source.openRuntime,
  });
  const before = await exportDatabase(source.runtime);
  const git = await exportRepository(source.runtime, fixtureIds.project);
  const archive = await createBackup(source.runtime);
  const retained = [await inspectRestoreTarget(source.runtime)];
  const target = await scale.open("target");
  const identity = await inspectRestoreTarget(target.runtime);
  await target.runtime.db.exec("CREATE ROLE restore_unprivileged LOGIN PASSWORD 'quire-owned-probe'");
  await target.runtime.db.exec("REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC");
  const restrictedUrl = new URL(target.configuration.QUIRE_POSTGRES_URL);
  restrictedUrl.username = "restore_unprivileged";
  restrictedUrl.password = "quire-owned-probe";
  const restricted = await createPostgresStorage({ url: restrictedUrl.href });
  try {
    await rejects(inspectRestoreTarget({ ...target.runtime, db: restricted.db }), /permission denied for function pg_control_system/);
  } finally { await restricted.close(); }
  const sameDatabase = await createPostgresStorage({ url: source.configuration.QUIRE_POSTGRES_URL });
  try {
    const shared = { ...target.runtime, db: sameDatabase.db, uow: sameDatabase.uow };
    await rejects(restoreBackupToTarget(source.runtime, { archive: archive.destination, target: shared,
      identity: await inspectRestoreTarget(shared), retained }), { code: "RESTORE_LIVE_TARGET" });
  } finally { await sameDatabase.close(); }
  const sharedBucket = { ...target.runtime, blobs: new S3BlobStore(source.blobOptions) };
  await rejects(restoreBackupToTarget(source.runtime, { archive: archive.destination, target: sharedBucket,
    identity: await inspectRestoreTarget(sharedBucket), retained }), { code: "RESTORE_LIVE_TARGET" });
  const sharedRepository = new RemoteRepositoryService(source.client);
  try {
    const sharedGit = { ...target.runtime, repositories: sharedRepository };
    await rejects(restoreBackupToTarget(source.runtime, { archive: archive.destination, target: sharedGit,
      identity: await inspectRestoreTarget(sharedGit), retained }), { code: "RESTORE_LIVE_TARGET" });
  } finally { await sharedRepository.close(); }
  const aliased = { ...target.runtime, blobs: new S3BlobStore({
    ...target.blobOptions, endpoint: target.blobOptions.endpoint.replace("127.0.0.1", "localhost"),
  }) };
  await rejects(restoreBackupToTarget(source.runtime, { archive: archive.destination, target: aliased,
    identity: await inspectRestoreTarget(aliased), retained }), { code: "RESTORE_TARGET_AUTHORITY" });
  expect(await target.runtime.db.get("SELECT id FROM users LIMIT 1")).toBeNull();
  const result = await restoreBackupToTarget(source.runtime, {
    archive: archive.destination, target: target.runtime, identity, retained,
  });
  expect(result.receipt.sourceDialect).toBe("postgres");
  expect(result.receipt.targetDialect).toBe("postgres");
  expect(result.receipt.manifestDigest).toBe(archive.manifestDigest);
  const durable = (image: typeof before) => image.tables.filter(table => table.name !== "branch_leases");
  expect(durable(await exportDatabase(target.runtime))).toEqual(durable(before));
  expect(await exportRepository(target.runtime, fixtureIds.project)).toEqual(git);
  for (const row of before.tables.find(table => table.name === "blobs")?.rows ?? []) {
    const digest = DigestSchema.parse(row["digest"]);
    expect(await target.runtime.blobs.get(digest)).toEqual(await source.runtime.blobs.get(digest));
  }
  expect(await target.runtime.db.all("SELECT id,digest FROM schema_migrations ORDER BY id"))
    .toEqual(await source.runtime.db.all("SELECT id,digest FROM schema_migrations ORDER BY id"));
  expect(await exportDatabase(source.runtime)).toEqual(before);
  expect(await exportRepository(source.runtime, fixtureIds.project)).toEqual(git);
  const survivor = await scale.open("nonempty");
  const blob = await survivor.runtime.blobs.put(new TextEncoder().encode("preserve existing bucket contents"));
  await rejects(restoreBackupToTarget(source.runtime, { archive: archive.destination, target: survivor.runtime,
    identity: await inspectRestoreTarget(survivor.runtime), retained }), { code: "RESTORE_TARGET_NOT_EMPTY" });
  expect(await survivor.runtime.blobs.get(blob)).toEqual(new TextEncoder().encode("preserve existing bucket contents"));
  await new S3Client(survivor.blobOptions).file(`${blob.slice(0, 2)}/${blob}`).delete();
  await survivor.runtime.repositories.initialize(fixtureIds.project);
  await rejects(restoreBackupToTarget(source.runtime, { archive: archive.destination, target: survivor.runtime,
    identity: await inspectRestoreTarget(survivor.runtime), retained }), { code: "RESTORE_TARGET_NOT_EMPTY" });
  expect(await survivor.runtime.db.get("SELECT id FROM users LIMIT 1")).toBeNull();
  const unauthorized = await fetch(new URL("/v1/restore-identity", target.server.url), {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  expect(unauthorized.status).toBe(401);
  console.info("RESTORE_TARGET_POSTGRES", JSON.stringify({ backup: archive.manifest.id,
    digest: result.receipt.manifestDigest, tables: before.tables.length, database: identity.database,
    blobs: identity.blobs, repositories: identity.repositories, source: retained[0] }));
}, 300000);
