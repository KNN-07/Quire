import { test, expect } from "bun:test";
import { join } from "node:path";
import { createLocalAdapters, createRuntime, loadConfig, loadSecretKey } from "@quire/runtime";
import { createBackup, configureBackups, restoreBackup, restoreConfirmation } from "../../../services/operations/backups";
import { exportDatabase } from "../../../services/operations/backups/database";
import { exportRepository } from "../../../services/operations/backups/repositories";
import { fixtureIds } from "../../fixtures/foundation";
import { backupFixture, backupModules } from "./fixture";
import { scaleFixture } from "./scale-fixture";
import { prepareCompleteData } from "./complete-fixture";
import { S3BlobStore } from "../../../services/operations/storage/s3";

test("backs up actual PostgreSQL, S3 and repository state and restores original authority into isolated native storage", async () => {
  // Given a native archive and independently provisioned real scale target roles.
  await using fixture = await backupFixture();
  const complete = await prepareCompleteData(fixture);
  await using scale = await scaleFixture(fixture.runtime.secretKey);
  const original = await createBackup(fixture.runtime);
  configureBackups(fixture.runtime, {
    backupRoot: fixture.backupRoot, restoreRoot: fixture.restoreRoot, signingKey: fixture.signingKey,
    configuration: { profile: "scale-fixture" }, exclusive: work => fixture.gate.exclusive(work),
    openFresh: target => scale.open(target),
  });
  const restored = await restoreBackup(fixture.runtime, { archive: original.destination, target: "scale",
    confirmation: restoreConfirmation(original.manifest.id, "scale") });
  const source = await scale.open(restored.destination);
  try {
    configureBackups(source, {
      backupRoot: fixture.backupRoot, restoreRoot: fixture.restoreRoot, signingKey: fixture.signingKey,
      configuration: {
        QUIRE_POSTGRES_URL: scale.settings.postgresUrl, QUIRE_REDIS_URL: scale.settings.redisUrl,
        QUIRE_REDIS_NAMESPACE: scale.settings.namespace, QUIRE_REPOSITORY_URL: scale.settings.repositoryUrl,
        QUIRE_REPOSITORY_TOKEN: scale.settings.repositoryToken, QUIRE_S3_ENDPOINT: scale.settings.endpoint,
        QUIRE_S3_BUCKET: scale.settings.bucket, QUIRE_S3_REGION: scale.settings.region,
        QUIRE_S3_ACCESS_KEY_ID: scale.settings.accessKeyId, QUIRE_S3_SECRET_ACCESS_KEY: scale.settings.secretAccessKey,
      },
      exclusive: work => source.admission.exclusive(work),
      openFresh: target => createRuntime(loadConfig({ QUIRE_DATA_DIR: target }), {
        modules: backupModules.map(module => ({ ...module, register: () => {} })),
      }),
    });
    expect(Buffer.from(await new S3BlobStore(scale.settings).get(complete.pdf.sha256))).toEqual(Buffer.from(complete.bytes));
    const before = await exportDatabase(source);
    // When real remote ports are snapshotted and restored into a fresh local profile.
    const archive = await createBackup(source);
    const recovered = await restoreBackup(source, { archive: archive.destination, target: "native-from-scale",
      confirmation: restoreConfirmation(archive.manifest.id, "native-from-scale") });
    const config = loadConfig({ QUIRE_DATA_DIR: recovered.destination });
    const target = { ...await createLocalAdapters(config, source.clock), config, clock: source.clock,
      secretKey: await loadSecretKey(config) };
    try {
      // Then all rows except selected-dialect migration receipts and expired lease ownership agree.
      const after = await exportDatabase(target);
      const durable = (image: typeof before) => image.tables.filter(table =>
        !["schema_migrations", "branch_leases"].includes(table.name)).map(table => ({ name: table.name, rows: table.rows }));
      expect(durable(after)).toEqual(durable(before));
      expect(await exportRepository(target, fixtureIds.project)).toEqual(await exportRepository(source, fixtureIds.project));
      expect(target.secretKey).toEqual(source.secretKey);
      expect(Buffer.from(await target.blobs.get(complete.pdf.sha256))).toEqual(Buffer.from(complete.bytes));
      expect(await target.db.get("SELECT id FROM comments WHERE thread_id=?", [complete.thread.id])).not.toBeNull();
      expect(await target.db.get("SELECT comment_id FROM permanent_comment_tombstones WHERE comment_id=?", [complete.comment.id])).not.toBeNull();
      expect(await target.db.get("SELECT id FROM history_versions")).not.toBeNull();
      expect(await target.db.get("SELECT key FROM idempotency_results")).not.toBeNull();
      expect(source.db.dialect).toBe("postgres");
      console.info("BACKUP_SCALE_ROUNDTRIP", JSON.stringify({ source: source.db.dialect, tables: before.tables.length,
        backup: archive.manifest.id, pdf: complete.pdf.sha256, bytes: complete.bytes.length,
        recovered: join(recovered.destination, "recovery-receipt.json") }));
    } finally { await target.close(); }
  } finally { await source.close(); }
}, 300000);
