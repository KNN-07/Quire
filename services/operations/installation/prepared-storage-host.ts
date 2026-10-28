import { createPrivateKey } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { DigestSchema } from "@quire/contracts";
import { createRuntime, loadConfig, migrateDatabase, RouteRegistry, ServiceRegistry, SqliteEventPort, systemClock } from "@quire/runtime";
import type { RuntimeConfig, RuntimeOptions, RuntimeAdapters } from "@quire/runtime";
import { createLocalAdapters } from "../../../packages/runtime/src/context";
import { verifyRuntimeSchema } from "../../../packages/runtime/src/prepared";
import { createPostgresStorage } from "../storage/postgres";
import { S3BlobStore } from "../storage/s3";
import { RemoteBranchCoordinator, RemoteRepositoryService } from "../repository/client";
import { startRepositoryServer } from "../repository/server";
import { PostgresBranchCoordinator } from "../../../apps/server/src/scale";
import { RedisNotificationTransport } from "../storage/redis";
import { createBackup, verifyBackup } from "../backups/archive";
import { configureBackups } from "../backups/model";
import type { BackupContext } from "../backups/model";
import { inspectRestoreTarget, restoreBackupToTarget } from "../backups/restore-target";
import { BindingSchema, ControlError, ReservedUpdateCommandSchema } from "./model";
import type { InstallationBinding } from "./model";
import { canonicalJson, controlDigest } from "./protocol";
import { below, privateDirectory } from "./driver-config";
import { handleControl, servePreparedRole } from "./controller-server";
import type { ControlledRoleSession } from "./controller-server";
import { reconcileCommandKeys } from "../updates/commands";
import { CompilerService } from "../../compiler/service";
import { quiesceCompilerJobs } from "../../compiler/quiescence";
import { reportPreparedFailure } from "./prepared-failure";

const absolute = z.string().startsWith("/").max(4096);
export const StoragePolicySchema = z.strictObject({
  archiveRoot: absolute, restoreRoot: absolute, signerPath: absolute,
  retained: z.array(BindingSchema).min(1).max(256),
  freshTargets: z.array(BindingSchema).min(1).max(128),
}).readonly();
export type StoragePolicy = z.infer<typeof StoragePolicySchema>;
const releaseSchema = z.strictObject({
  migrations: z.array(z.strictObject({ id: z.string(), sql: z.string(), postgres: z.string().optional() })).min(1),
  assets: z.array(z.strictObject({ path: z.string().min(1), digest: DigestSchema })).min(1),
});
async function privateBytes(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 1048576 ||
      await realpath(path) !== path) throw new ControlError("CONTROL_SECRET_UNSAFE");
  return readFile(path);
}
export async function releaseInventory(binding: InstallationBinding) {
  const root = binding.release.target;
  const file = join(root, "installation-runtime.json");
  const info = await lstat(file);
  if (!info.isFile() || info.size > 16_777_216 || await realpath(file) !== file) throw new ControlError("CONTROL_RELEASE_INVENTORY_REQUIRED");
  const input: unknown = JSON.parse(await readFile(file, "utf8"));
  const inventory = releaseSchema.parse(input);
  if (!inventory.assets.some(asset => resolve(root, asset.path) === resolve(root, binding.release.entrypoint))) {
    throw new ControlError("CONTROL_RELEASE_ENTRYPOINT_DIGEST_REQUIRED");
  }
  for (const asset of [...inventory.assets, { path: binding.release.entrypoint, digest: null }]) {
    const path = resolve(root, asset.path);
    if (!below(root, path) || path === root || await realpath(path) !== path || !(await lstat(path)).isFile()) {
      throw new ControlError("CONTROL_RELEASE_ASSET_INVALID");
    }
    if (asset.digest && controlDigest(await readFile(path)) !== asset.digest) throw new ControlError("CONTROL_RELEASE_ASSET_CHANGED");
  }
  return { ...inventory, migrations: inventory.migrations.map(migration => ({
    id: migration.id, sql: migration.sql, ...(migration.postgres === undefined ? {} : { postgres: migration.postgres }),
  })) };
}
export async function openMaintenanceBinding(binding: InstallationBinding, existingRepository = false) {
  const data = binding.data;
  let adapters: Pick<RuntimeAdapters, "db" | "uow" | "blobs" | "repositories" | "branches" | "admission" | "close">;
  let configuration: Record<string, string> = {};
  let secret: Uint8Array;
  const config = loadConfig({
    QUIRE_DATA_DIR: data.dialect === "sqlite" ? data.dataRoot : dirname(data.applicationSecretRef),
    QUIRE_PROFILE: data.dialect === "sqlite" ? "local" : "scale", QUIRE_COMPILER_BACKEND: "docker",
  });
  if (data.dialect === "sqlite") {
    await privateDirectory(data.dataRoot);
    // Never create a missing database while probing a binding.
    await lstat(join(data.dataRoot, "quire.sqlite"));
    secret = Buffer.from(z.string().regex(/^[0-9a-f]{64}$/).parse((await privateBytes(join(data.dataRoot, "secret.key"))).toString().trim()), "hex");
    adapters = await createLocalAdapters(config, systemClock);
  } else {
    secret = Buffer.from(z.string().regex(/^[0-9a-f]{64}$/).parse((await privateBytes(data.applicationSecretRef)).toString().trim()), "hex");
    const url = z.url().parse((await privateBytes(data.database.connectionSecretRef)).toString().trim());
    const redisUrl = z.url().parse((await privateBytes(data.redis.connectionSecretRef)).toString().trim());
    const token = z.string().min(32).parse((await privateBytes(data.repository.credentialsSecretRef)).toString().trim());
    const credentials: unknown = JSON.parse((await privateBytes(data.blobs.credentialsSecretRef)).toString());
    const keys = z.strictObject({ accessKeyId: z.string().min(1), secretAccessKey: z.string().min(1) }).parse(credentials);
    const storage = await createPostgresStorage({ url });
    const branches = new PostgresBranchCoordinator(storage.uow, systemClock);
    try {
      const identity = z.object({ cluster: z.string(), database: z.string() }).parse(await storage.db.get(
        "SELECT c.system_identifier::text AS cluster,d.oid::text AS database FROM pg_catalog.pg_control_system() c " +
        "CROSS JOIN pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database()"));
      if (`${identity.cluster}:${identity.database}` !== data.database.identity) throw new ControlError("CONTROL_DATABASE_IDENTITY_MISMATCH");
      const repository = existingRepository ? null : await startRepositoryServer({
        db: storage.db, uow: storage.uow, branches, clock: systemClock,
        volume: data.repository.volume, token, admission: storage.admission });
      const client = { url: repository?.url ?? data.repository.endpoint, token, clock: systemClock, admission: storage.admission };
      const remote = new RemoteBranchCoordinator(client);
      const repositories = new RemoteRepositoryService(client);
      const blobs = new S3BlobStore({ endpoint: data.blobs.endpoint, bucket: data.blobs.bucket, region: data.blobs.region, ...keys });
      adapters = { ...storage, branches: remote, repositories, blobs,
        admission: {
          writer: work => storage.admission.writer(work),
          background: work => storage.admission.background(work),
          exclusive: work => storage.admission.exclusive(() => repositories.exclusive(work)),
        },
        async close() { await remote.close(); await repositories.close(); await repository?.close(); await branches.close(); await storage.close(); } };
      configuration = {
        QUIRE_POSTGRES_URL: url, QUIRE_REDIS_URL: redisUrl, QUIRE_REDIS_NAMESPACE: data.redis.namespace,
        QUIRE_REPOSITORY_URL: data.repository.endpoint, QUIRE_REPOSITORY_TOKEN: token,
        QUIRE_S3_ENDPOINT: data.blobs.endpoint, QUIRE_S3_BUCKET: data.blobs.bucket, QUIRE_S3_REGION: data.blobs.region,
        QUIRE_S3_ACCESS_KEY_ID: keys.accessKeyId, QUIRE_S3_SECRET_ACCESS_KEY: keys.secretAccessKey,
      };
    } catch (error) { await branches.close(); await storage.close(); throw error; }
  }
  const context: BackupContext = { ...adapters, config, secretKey: secret, clock: systemClock };
  return { context, configuration, adapters, close: adapters.close };
}
async function configureHost(opened: Awaited<ReturnType<typeof openMaintenanceBinding>>, policy: StoragePolicy, compiler?: CompilerService) {
  await privateDirectory(policy.archiveRoot);
  await privateDirectory(policy.restoreRoot);
  const signingKey = createPrivateKey(await privateBytes(policy.signerPath));
  const admission = opened.adapters.admission;
  if (!admission) throw new ControlError("UPDATES_ADMISSION_UNAVAILABLE");
  configureBackups(opened.context, {
    exclusive: work => admission.exclusive(async () => {
      if (compiler) await quiesceCompilerJobs(compiler, { dispatch: "deferred" });
      return work();
    }),
    openFresh: () => Promise.reject(new ControlError("CONTROL_EXPLICIT_TARGET_REQUIRED")),
    configuration: opened.configuration, signingKey, backupRoot: policy.archiveRoot, restoreRoot: policy.restoreRoot,
  });
  return signingKey;
}
export async function checkStorageBinding(binding: InstallationBinding) {
  const inventory = await releaseInventory(binding);
  const opened = await openMaintenanceBinding(binding);
  try {
    const readiness = await verifyRuntimeSchema(opened.context.db, inventory.migrations);
    const identity = await inspectRestoreTarget(opened.context);
    if (binding.data.dialect === "postgres") {
      const transport = new RedisNotificationTransport({
        url: z.url().parse(opened.configuration["QUIRE_REDIS_URL"]), namespace: binding.data.redis.namespace,
      });
      try { await transport.connect(); } finally { await transport.close(); }
    }
    const blobs = await opened.context.db.query("SELECT digest FROM blobs", [], z.object({ digest: DigestSchema }));
    for (const blob of blobs) {
      if (controlDigest(await opened.context.blobs.get(blob.digest)) !== blob.digest) throw new ControlError("CONTROL_BLOB_CHANGED");
    }
    return { ...readiness, identity, authority: controlDigest(opened.context.secretKey) };
  } finally { await opened.close(); }
}
const helperSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("backup"), policy: StoragePolicySchema }),
  z.strictObject({ action: z.literal("migrate") }),
  z.strictObject({ action: z.literal("preflight"), roles: z.array(z.string().min(1)).min(1).max(128) }),
  z.strictObject({ action: z.literal("check") }),
  z.strictObject({ action: z.literal("restore"), policy: StoragePolicySchema, archive: absolute,
    target: BindingSchema, retained: z.array(BindingSchema), commands: z.array(ReservedUpdateCommandSchema) }),
]);
/** Called only by a trusted, digest-pinned launcher after its kernel-attested permit. */
export async function executeStorageHelper(binding: InstallationBinding, value: unknown): Promise<unknown> {
  const input = helperSchema.parse(value);
  if (input.action === "check") return checkStorageBinding(binding);
  if (input.action === "preflight") {
    const migration = await openMaintenanceBinding(binding);
    let schema;
    try {
      const inventory = await releaseInventory(binding);
      await migrateDatabase(migration.context.uow, inventory.migrations);
      schema = await verifyRuntimeSchema(migration.context.db, inventory.migrations);
    } finally { await migration.close(); }
    // Migration handles are gone before constructing the actual candidate runtime.
    const factory = await releaseFactory(binding);
    for (const role of input.roles) {
      const lifecycle = await factory(binding, role);
      try {
        const health = z.object({ database: z.enum(["sqlite", "postgres"]),
          migrations: z.array(z.object({ id: z.string(), digest: DigestSchema })) }).parse(await lifecycle.check());
        if (canonicalJson(health) !== canonicalJson(schema)) throw new ControlError("CONTROL_PREFLIGHT_SCHEMA_MISMATCH");
      } finally { await lifecycle.dispose(); }
    }
    return schema;
  }
  const source = await openMaintenanceBinding(binding);
  try {
    if (input.action === "migrate") {
      const inventory = await releaseInventory(binding);
      await migrateDatabase(source.context.uow, inventory.migrations);
      return verifyRuntimeSchema(source.context.db, inventory.migrations);
    }
    if (input.action === "backup") {
      const admission = source.adapters.admission;
      if (!admission) throw new ControlError("UPDATES_ADMISSION_UNAVAILABLE");
      const events = new SqliteEventPort(source.context.db, source.context.clock);
      const compiler = new CompilerService({ ...source.context, admission, events,
        services: new ServiceRegistry(), routes: new RouteRegistry(undefined, admission).forLane("C") }, null);
      try {
        const signer = await configureHost(source, input.policy, compiler);
        const backup = await createBackup(source.context);
        const verified = await verifyBackup(backup.destination, source.context.secretKey, signer);
        return { id: verified.manifest.id, digest: verified.manifestDigest, path: backup.destination,
          verifiedAt: systemClock.now(),
          originalMigrationLedger: canonicalJson(verified.database.tables.find(table => table.name === "schema_migrations")?.rows ?? []) };
      } finally { await compiler.stop(); await events.close(); }
    }
    await configureHost(source, input.policy);
    if (!below(input.policy.archiveRoot, input.archive) || !input.policy.freshTargets.some(target => canonicalJson(target) === canonicalJson(input.target))) {
      throw new ControlError("CONTROL_RESTORE_TARGET_UNCONFIGURED");
    }
    const retained = new Map<string, Awaited<ReturnType<typeof openMaintenanceBinding>>>();
    retained.set(binding.data.generationId, source);
    const target = await openMaintenanceBinding(input.target);
    try {
      for (const prior of input.retained) {
        if (!retained.has(prior.data.generationId)) retained.set(prior.data.generationId, await openMaintenanceBinding(prior));
      }
      const identities = await Promise.all([...retained.values()].map(item => inspectRestoreTarget(item.context)));
      const identity = await inspectRestoreTarget(target.context);
      const result = await restoreBackupToTarget(source.context, { archive: input.archive, target: target.context, identity, retained: identities });
      await reconcileCommandKeys(target.context.uow, input.commands);
      const readiness = await verifyRuntimeSchema(target.context.db, (await releaseInventory(input.target)).migrations);
      return { binding: input.target, receipt: result.receipt, readiness };
    } finally {
      await target.close();
      for (const item of retained.values()) if (item !== source) await item.close();
    }
  } finally { await source.close(); }
}
export async function serveStorageHelper(session: ControlledRoleSession): Promise<void> {
  let executed = false;
  handleControl(session.channel, async (method, value) => {
    const request = z.strictObject({ token: z.string(), generation: z.number(), epoch: z.string(), input: z.unknown() }).parse(value);
    const permit = session.permit;
    if (method !== "execute" || executed || request.token !== permit.token ||
        request.generation !== permit.execution.generation || request.epoch !== permit.execution.supervisorEpoch) {
      throw new ControlError("CONTROL_HELPER_DENIED");
    }
    executed = true;
    try { return { outcome: "succeeded", value: await executeStorageHelper(permit.binding, request.input) }; }
    catch (error) {
      const code = z.object({ code: z.string().max(128) }).safeParse(error).data?.code ?? "CONTROL_HELPER_FAILED";
      return { outcome: "failed", code, detail: error instanceof Error ? error.message : String(error) };
    }
  });
  await session.channel.request("ready", { token: session.permit.token });
  await session.channel.closed;
}
export async function serveControlledRuntime(session: ControlledRoleSession, config: RuntimeConfig, options: RuntimeOptions): Promise<void> {
  const binding = session.permit.binding;
  if (config.profile !== (binding.data.dialect === "sqlite" ? "local" : "scale") ||
      (binding.data.dialect === "sqlite" && config.dataDir !== binding.data.dataRoot)) throw new ControlError("CONTROL_BINDING_MISMATCH");
  await releaseInventory(binding);
  const entrypointDigest = controlDigest(await readFile(resolve(binding.release.target, binding.release.entrypoint)));
  const prepared = await createRuntime(config, { ...options, startup: "prepared" });
  await servePreparedRole(session, {
    async check() { return { ...await prepared.check(), entrypointDigest }; },
    activate: prepared.activate, dispose: prepared.dispose,
  });
}
/** A signed release exports this factory; the stable launcher never imports it before attestation. */
async function releaseFactory(binding: InstallationBinding) {
  await releaseInventory(binding);
  const path = resolve(binding.release.target, binding.release.entrypoint);
  const imported: unknown = await import(pathToFileURL(path).href);
  const module = z.object({ prepareInstallationRole: z.custom<(binding: InstallationBinding, role: string) => Promise<unknown>>(
    value => typeof value === "function") }).parse(imported);
  return async (selected: InstallationBinding, role: string) => z.object({
      check: z.custom<() => Promise<unknown>>(value => typeof value === "function"),
      activate: z.custom<() => Promise<unknown>>(value => typeof value === "function"),
      dispose: z.custom<() => Promise<void>>(value => typeof value === "function"),
    }).parse(await module.prepareInstallationRole(selected, role));
}
export async function serveReleaseRole(session: ControlledRoleSession): Promise<void> {
  let lifecycle;
  try { lifecycle = await (await releaseFactory(session.permit.binding))(session.permit.binding, session.permit.execution.role); }
  catch (error) {
    if (session.permit.execution.purpose !== "prepared") throw error;
    await reportPreparedFailure(session, "construction", error);
    await session.channel.closed;
    return;
  }
  const path = resolve(session.permit.binding.release.target, session.permit.binding.release.entrypoint);
  const entrypointDigest = controlDigest(await readFile(path));
  await servePreparedRole(session, {
    async check() {
      const result = z.object({ database: z.enum(["sqlite", "postgres"]),
        migrations: z.array(z.object({ id: z.string(), digest: DigestSchema })) }).parse(await lifecycle.check());
      return { ...result, entrypointDigest };
    },
    activate: lifecycle.activate, dispose: lifecycle.dispose,
  });
}
