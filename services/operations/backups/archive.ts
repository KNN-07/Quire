import { timingSafeEqual } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DigestSchema, IdSchema } from "@quire/contracts";
import { BackupError, backupHost, databaseSchema, digest, manifestSchema } from "./model";
import type { BackupContext, Manifest } from "./model";
import { exportDatabase } from "./database";
import { exportRepository } from "./repositories";
import { inventory, ownedPath, readRegular, syncDirectory, writeDurable } from "./files";
import { verifyRepositories } from "./git-verify";
import { signManifest, signerFingerprint, verifyManifest } from "./signing";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const keySchema = z.string().regex(/^[0-9a-f]{64}$/);

export async function createBackup(context: BackupContext, id = IdSchema.parse(crypto.randomUUID()),
  authorize?: () => Promise<void>) {
  const host = backupHost(context);
  switch (context.config.profile) {
    case "local": break;
    case "scale":
      for (const key of ["QUIRE_POSTGRES_URL", "QUIRE_REDIS_URL", "QUIRE_REDIS_NAMESPACE",
        "QUIRE_REPOSITORY_URL", "QUIRE_REPOSITORY_TOKEN", "QUIRE_S3_ENDPOINT", "QUIRE_S3_BUCKET",
        "QUIRE_S3_REGION", "QUIRE_S3_ACCESS_KEY_ID", "QUIRE_S3_SECRET_ACCESS_KEY"]) {
        if (!host.configuration[key]) throw new BackupError("BACKUP_CONFIGURATION_INCOMPLETE", `Missing deployment configuration ${key}`);
      }
      break;
    default: { const exhaustive: never = context.config.profile; throw new BackupError("BACKUP_PROFILE_INVALID", exhaustive); }
  }
  const destination = await ownedPath(host.backupRoot, id);
  const staging = await ownedPath(host.backupRoot, `.partial-${id}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    const manifest = await host.exclusive(async () => {
      await authorize?.();
      const database = await exportDatabase(context, id);
      // Mutable inventory builders are sealed by manifestSchema before publication.
      const files: Array<Manifest["files"][number]> = [];
      const put = async (path: string, bytes: Uint8Array | string) => {
        const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
        await writeDurable(join(staging, path), data);
        files.push({ path, bytes: data.length, sha256: digest(data) });
      };
      await put("database.json", JSON.stringify(database));
      await put("configuration.json", JSON.stringify({ runtime: context.config, deployment: host.configuration }));
      await put("secret.key", Buffer.from(context.secretKey).toString("hex") + "\n");
      await mkdir(join(staging, "blobs"), { mode: 0o700 });
      const blobs = database.tables.find(table => table.name === "blobs");
      if (!blobs) throw new BackupError("BACKUP_INCOMPLETE", "Blob catalog is missing");
      for (const row of blobs.rows) {
        const hash = DigestSchema.parse(row["digest"]);
        const bytes = await context.blobs.get(hash);
        if (digest(bytes) !== hash || bytes.length !== row["bytes"]) throw new BackupError("BACKUP_BLOB_CORRUPT", hash);
        await put(`blobs/${hash}`, bytes);
      }
      await mkdir(join(staging, "repositories"), { mode: 0o700 });
      const repositories: Array<Manifest["repositories"][number]> = [];
      for (const row of database.tables.find(table => table.name === "repositories")?.rows ?? []) {
        const repository = await exportRepository(context, IdSchema.parse(row["project_id"]));
        repositories.push(repository.metadata);
        await put(`repositories/${repository.metadata.projectId}.pack`, repository.pack);
      }
      return manifestSchema.parse({
        format: "quire-full-recovery-v1", id, createdAt: context.clock.now(),
        dialect: database.dialect, authority: digest(context.secretKey), signer: signerFingerprint(host.signingKey),
        files: files.sort((a, b) => a.path.localeCompare(b.path)), repositories,
        tables: database.tables.map(table => ({ name: table.name, rows: table.rows.length })),
      });
    });
    const bytes = JSON.stringify(manifest);
    await writeDurable(join(staging, "manifest.json"), bytes);
    await writeDurable(join(staging, "manifest.sig"), signManifest(host.signingKey, new TextEncoder().encode(bytes)));
    await syncDirectory(join(staging, "blobs"));
    await syncDirectory(join(staging, "repositories"));
    await syncDirectory(staging);
    await rename(staging, destination);
    await syncDirectory(host.backupRoot);
    return { manifest, destination, manifestDigest: digest(bytes) };
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}

/** trustedKey is independently provisioned original authority, never inferred from the archive. */
export async function verifyBackup(path: string, trustedKey: Uint8Array, trustedSigner: KeyObject) {
  const actualFiles = await inventory(path);
  const bytes = await readRegular(join(path, "manifest.json"));
  const manifest = manifestSchema.parse(JSON.parse(text(bytes)));
  const signed = await readRegular(join(path, "manifest.sig"));
  if (!verifyManifest(trustedSigner, bytes, signed) || manifest.signer !== signerFingerprint(trustedSigner) ||
      manifest.authority !== digest(trustedKey)) {
    throw new BackupError("BACKUP_SIGNATURE_INVALID", "Archive signer or original instance authority differs from the independently trusted keys");
  }
  const expectedFiles = [...manifest.files.map(file => file.path), "manifest.json", "manifest.sig"].sort();
  if (new Set(expectedFiles).size !== expectedFiles.length || JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new BackupError("BACKUP_INCOMPLETE", "Missing, duplicate or unrecorded archive files");
  }
  for (const file of manifest.files) {
    const content = await readRegular(join(path, file.path));
    if (content.length !== file.bytes || digest(content) !== file.sha256) throw new BackupError("BACKUP_DIGEST_INVALID", file.path);
  }
  const key = Buffer.from(keySchema.parse(text(await readRegular(join(path, "secret.key"))).trim()), "hex");
  if (!timingSafeEqual(key, trustedKey)) throw new BackupError("BACKUP_KEY_MISMATCH", "Original instance authority is required");
  const configuration = z.strictObject({
    runtime: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).readonly(),
    deployment: z.record(z.string(), z.string()).readonly(),
  }).readonly().parse(JSON.parse(text(await readRegular(join(path, "configuration.json")))));
  const database = databaseSchema.parse(JSON.parse(text(await readRegular(join(path, "database.json")))));
  if (database.dialect !== manifest.dialect || JSON.stringify(database.tables.map(table => ({
    name: table.name, rows: table.rows.length,
  }))) !== JSON.stringify(manifest.tables)) throw new BackupError("BACKUP_INCOMPLETE", "SQL catalog differs from signed manifest");
  const names = new Set(database.tables.map(table => table.name));
  for (const required of ["schema_migrations", "users", "sessions", "projects", "files", "blobs", "repositories",
    "snapshots", "threads", "comments", "permanent_comment_tombstones", "history_versions", "operator_settings", "branch_leases", "idempotency_results"]) {
    if (!names.has(required)) throw new BackupError("BACKUP_INCOMPLETE", `Missing recovery category ${required}`);
  }
  if (names.size !== database.tables.length) throw new BackupError("BACKUP_INCOMPLETE", "Duplicate SQL tables");
  const blobPaths = database.tables.find(table => table.name === "blobs")?.rows.map(row => `blobs/${DigestSchema.parse(row["digest"])}`).sort();
  const repoIds = database.tables.find(table => table.name === "repositories")?.rows.map(row => IdSchema.parse(row["project_id"])).sort();
  if (JSON.stringify(blobPaths) !== JSON.stringify(manifest.files.filter(file => file.path.startsWith("blobs/")).map(file => file.path).sort()) ||
    JSON.stringify(repoIds) !== JSON.stringify(manifest.repositories.map(repo => repo.projectId).sort()) ||
    JSON.stringify(repoIds?.map(id => `repositories/${id}.pack`)) !==
      JSON.stringify(manifest.files.filter(file => file.path.startsWith("repositories/")).map(file => file.path).sort())) {
    throw new BackupError("BACKUP_INCOMPLETE", "SQL blob or repository catalog is incomplete");
  }
  await verifyRepositories(path, manifest);
  return { manifest, database, configuration, key, manifestDigest: digest(bytes) };
}
