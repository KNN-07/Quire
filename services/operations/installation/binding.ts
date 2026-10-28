import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { loadConfig, systemClock } from "@quire/runtime";
import type { RuntimeOptions } from "@quire/runtime";
import type { SqlExecutor } from "@quire/contracts";
import { createScaleAdapters, loadScaleConfig } from "../../../apps/server/src/scale";
import { createPostgresStorage } from "../storage/postgres";
import { privateInstallationFile } from "./client";
import { ControlError } from "./model";
import type { InstallationBinding } from "./model";
import { releaseInventory } from "./prepared-storage-host";
import { ExecutionProfileSchema } from "./execution-model";

export const InstallationRolesSchema = z.strictObject({
  installationId: z.string().min(1),
  controlSocket: z.string().startsWith("/"),
  executionProfiles: z.array(ExecutionProfileSchema).max(128).optional(),
  roles: z.array(z.strictObject({
    role: z.string().min(1), kind: z.enum(["api", "repository", "ssh", "worker-controller", "worker"]),
    host: z.string().default("127.0.0.1"), port: z.number().int().min(1).max(65535),
    publicUrl: z.url(), compilerBackend: z.enum(["bwrap", "docker"]),
    apiCredentialFile: z.string().regex(/^[a-zA-Z0-9_.-]+$/).optional(),
    sshClientFile: z.string().regex(/^[a-zA-Z0-9_.-]+$/).optional(),
    sshEntrypoint: z.string().regex(/^[a-zA-Z0-9_.-]+$/).optional(),
    coordinator: z.url().optional(), workerId: IdSchema.optional(),
    environmentIds: z.array(IdSchema).min(1).optional(),
  })).min(1).max(128),
});
export type InstallationRole = z.infer<typeof InstallationRolesSchema>["roles"][number];
export async function assertInstallationDatabase(db: SqlExecutor, expected: string): Promise<void> {
  const actual = z.object({ cluster: z.string(), database: z.string() }).parse(await db.get(
    "SELECT c.system_identifier::text AS cluster,d.oid::text AS database FROM pg_catalog.pg_control_system() c " +
    "CROSS JOIN pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database()"));
  if (`${actual.cluster}:${actual.database}` !== expected) throw new ControlError("CONTROL_DATABASE_IDENTITY_MISMATCH");
}
export async function loadInstallationRole(binding: InstallationBinding, role: string) {
  const inventory = await releaseInventory(binding);
  if (!inventory.assets.some(asset => asset.path === "installation-roles.json")) throw new ControlError("CONTROL_ROLE_INVENTORY_REQUIRED");
  const input: unknown = JSON.parse(await readFile(join(binding.release.target, "installation-roles.json"), "utf8"));
  const manifest = InstallationRolesSchema.parse(input);
  if (new Set(manifest.roles.map(item => item.role)).size !== manifest.roles.length) throw new ControlError("CONTROL_INVENTORY_INVALID");
  const selected = manifest.roles.find(item => item.role === role);
  if (!selected) throw new ControlError("CONTROL_ROLE_UNSUPPORTED");
  return { manifest, role: selected, inventory };
}
export async function installationEnvironment(binding: InstallationBinding, role: InstallationRole) {
  const data = binding.data;
  const dataRoot = data.dialect === "sqlite" ? data.dataRoot : dirname(data.applicationSecretRef);
  const secretPath = data.dialect === "sqlite" ? join(dataRoot, "secret.key") : data.applicationSecretRef;
  const secret = z.string().regex(/^[0-9a-f]{64}$/).parse((await privateInstallationFile(secretPath)).toString("utf8").trim());
  const env: Record<string, string> = {
    QUIRE_DATA_DIR: dataRoot, QUIRE_PROFILE: data.dialect === "sqlite" ? "local" : "scale",
    QUIRE_HOST: role.host, QUIRE_PORT: String(role.port), QUIRE_PUBLIC_URL: role.publicUrl,
    QUIRE_COMPILER_BACKEND: role.compilerBackend, QUIRE_SECRET_KEY: secret,
    QUIRE_BACKUP_ROOT: join(dataRoot, "backups"), QUIRE_BACKUP_SIGNING_KEY_FILE: join(dataRoot, "backup-signing.pem"),
    QUIRE_INSTALLATION_ID: (await loadInstallationRole(binding, role.role)).manifest.installationId,
    NODE_ENV: "production", TMPDIR: join(dataRoot, "work"),
  };
  if (data.dialect === "postgres") {
    const credentials = z.strictObject({ accessKeyId: z.string().min(1), secretAccessKey: z.string().min(1) })
      .parse(JSON.parse((await privateInstallationFile(data.blobs.credentialsSecretRef)).toString("utf8")));
    Object.assign(env, {
      QUIRE_POSTGRES_URL: (await privateInstallationFile(data.database.connectionSecretRef)).toString("utf8").trim(),
      QUIRE_REDIS_URL: (await privateInstallationFile(data.redis.connectionSecretRef)).toString("utf8").trim(),
      QUIRE_REDIS_NAMESPACE: data.redis.namespace, QUIRE_REPOSITORY_URL: data.repository.endpoint,
      QUIRE_REPOSITORY_VOLUME: data.repository.volume,
      QUIRE_REPOSITORY_TOKEN: (await privateInstallationFile(data.repository.credentialsSecretRef)).toString("utf8").trim(),
      QUIRE_S3_ENDPOINT: data.blobs.endpoint, QUIRE_S3_REGION: data.blobs.region, QUIRE_S3_BUCKET: data.blobs.bucket,
      QUIRE_S3_ACCESS_KEY_ID: credentials.accessKeyId, QUIRE_S3_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    });
  }
  // Installation storage/key/DSN inputs come solely from the committed binding.
  for (const key of Object.keys(process.env)) if (key.startsWith("QUIRE_")) delete process.env[key];
  Object.assign(process.env, env);
  return { env, config: loadConfig(env), dataRoot };
}
export function installationPreparedAdapters(binding: InstallationBinding, env: NodeJS.ProcessEnv): RuntimeOptions["prepareAdapters"] {
  if (binding.data.dialect !== "postgres") return undefined;
  const data = binding.data;
  const settings = loadScaleConfig(env);
  return async config => {
    const storage = await createPostgresStorage({ url: settings.postgresUrl });
    try {
      await assertInstallationDatabase(storage.db, data.database.identity);
      let active: Awaited<ReturnType<typeof createScaleAdapters>> | undefined;
      return {
        db: storage.db,
        async activate() {
          await storage.close();
          const candidate = await createScaleAdapters(config, systemClock, settings);
          try { await assertInstallationDatabase(candidate.db, data.database.identity); }
          catch (error) { await candidate.close(); throw error; }
          active = candidate;
          return active;
        },
        async dispose() { await storage.close(); await active?.close(); },
      };
    } catch (error) { await storage.close(); throw error; }
  };
}
