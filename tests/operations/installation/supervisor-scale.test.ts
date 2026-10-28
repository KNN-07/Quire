import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { foundationMigrations } from "@quire/runtime";
import { restoreTargetScaleFixture } from "../backups/restore-target-scale-fixture";
import { backupModules } from "../backups/fixture";
import { BindingSchema } from "../../../services/operations/installation/model";
import { canonicalJson, controlDigest } from "../../../services/operations/installation/protocol";
import { checkStorageBinding, executeStorageHelper, openMaintenanceBinding } from "../../../services/operations/installation/prepared-storage-host";
import { exportDatabase } from "../../../services/operations/backups/database";
import { inspectRestoreTarget } from "../../../services/operations/backups/restore-target";
import { seed } from "../../../scripts/seed";
import type { InstallationBinding } from "../../../services/operations/installation/model";

test("concrete host restores PostgreSQL/S3/owned Git in the original dialect with actual identity checks", async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  await using scale = await restoreTargetScaleFixture(key);
  const source = await scale.open("source");
  const target = await scale.open("target");
  await seed(source.runtime, "owned-supervisor-postgres-2026");
  const snapshot = await exportDatabase(source.runtime);
  const releaseRoot = join(scale.root, "release");
  const archiveRoot = join(scale.root, "archives");
  const restoreRoot = join(scale.root, "restores");
  for (const root of [releaseRoot, archiveRoot, restoreRoot]) await mkdir(root, { mode: 0o700 });
  await writeFile(join(releaseRoot, "main.js"), "export const fixture = 'scale-storage-only';\n", { mode: 0o400 });
  const migrations = [...await foundationMigrations(), ...backupModules.flatMap(module => module.migrations ?? [])];
  await writeFile(join(releaseRoot, "installation-runtime.json"), canonicalJson({
    migrations, assets: [{ path: "main.js", digest: controlDigest("export const fixture = 'scale-storage-only';\n") }],
  }), { mode: 0o400 });
  const signerPath = join(scale.root, "signer.pem");
  await writeFile(signerPath, generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const release = { target: releaseRoot, entrypoint: "main.js", releaseId: IdSchema.parse(crypto.randomUUID()),
    version: "1.0.0", sequence: 1, manifestDigest: controlDigest("scale-host"), packageDigest: controlDigest("scale-host") };
  async function binding(name: string, resource: typeof source): Promise<InstallationBinding> {
    const identity = await inspectRestoreTarget(resource.runtime);
    if (identity.database.kind !== "postgres") throw new Error("Real PostgreSQL required");
    const root = join(scale.root, `${name}-credentials`);
    await mkdir(root, { mode: 0o700 });
    const settings = resource.configuration;
    const values = {
      "postgres.key": settings.QUIRE_POSTGRES_URL, "redis.key": settings.QUIRE_REDIS_URL,
      "repository.key": settings.QUIRE_REPOSITORY_TOKEN, "application.key": Buffer.from(key).toString("hex"),
      "s3.key": canonicalJson({ accessKeyId: settings.QUIRE_S3_ACCESS_KEY_ID, secretAccessKey: settings.QUIRE_S3_SECRET_ACCESS_KEY }),
    };
    for (const [fileName, value] of Object.entries(values)) await writeFile(join(root, fileName), value, { mode: 0o600 });
    return BindingSchema.parse({ release, data: { dialect: "postgres", generationId: crypto.randomUUID(),
      database: { identity: `${identity.database.cluster}:${identity.database.database}`, connectionSecretRef: join(root, "postgres.key") },
      blobs: { endpoint: settings.QUIRE_S3_ENDPOINT, region: settings.QUIRE_S3_REGION, bucket: settings.QUIRE_S3_BUCKET,
        credentialsSecretRef: join(root, "s3.key") },
      repository: { volume: identity.repositories.path, endpoint: resource.server.url, credentialsSecretRef: join(root, "repository.key") },
      redis: { namespace: name, connectionSecretRef: join(root, "redis.key") }, applicationSecretRef: join(root, "application.key") } });
  }
  const prior = await binding("source", source);
  const fresh = await binding("target", target);
  await source.runtime.close(); await target.runtime.close();
  await source.server.close(); await target.server.close();
  const policy = { archiveRoot, restoreRoot, signerPath, retained: [prior], freshTargets: [fresh] };
  const backup = z.object({ path: z.string() }).parse(await executeStorageHelper(prior, { action: "backup", policy }));
  const restored = z.object({ receipt: z.object({ sourceDialect: z.literal("postgres"), targetDialect: z.literal("postgres") }) })
    .parse(await executeStorageHelper(prior, { action: "restore", policy, archive: backup.path, target: fresh, retained: [prior], commands: [] }));
  expect(restored.receipt.sourceDialect).toBe("postgres");
  expect((await checkStorageBinding(fresh)).database).toBe("postgres");
  const reopened = await openMaintenanceBinding(fresh);
  const unchanged = await openMaintenanceBinding(prior);
  try {
    const durable = (image: typeof snapshot) => image.tables.filter(table => table.name !== "branch_leases");
    expect(durable(await exportDatabase(reopened.context))).toEqual(durable(snapshot));
    expect(await exportDatabase(unchanged.context)).toEqual(snapshot);
    const a = await inspectRestoreTarget(reopened.context);
    const b = await inspectRestoreTarget(unchanged.context);
    expect(a.database).not.toEqual(b.database);
    expect(a.blobs).not.toEqual(b.blobs);
    expect(a.repositories.path).not.toBe(b.repositories.path);
    console.info("SUPERVISOR_SCALE_IDENTITIES", canonicalJson({ source: b, target: a }));
  } finally { await reopened.close(); await unchanged.close(); }
  if (fresh.data.dialect !== "postgres") throw new Error("Scale binding required");
  const mismatch = { ...fresh, data: { ...fresh.data, database: { ...fresh.data.database, identity: "0:0" } } };
  const denied = await openMaintenanceBinding(mismatch).then(async opened => { await opened.close(); return null; }, (error: unknown) => error);
  expect(denied).toMatchObject({ code: "CONTROL_DATABASE_IDENTITY_MISMATCH" });
}, 300000);
