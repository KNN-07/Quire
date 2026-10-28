import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntime, foundationMigrations, loadConfig, migrateDatabase, SqliteEventPort, systemClock } from "@quire/runtime";
import type { Runtime } from "@quire/runtime";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { S3BlobStore } from "../../../services/operations/storage/s3";
import { RemoteBranchCoordinator, RemoteRepositoryService, startRepositoryServer } from "../../../services/operations/repository";
import type { RepositoryServer } from "../../../services/operations/repository/server";
import { PostgresBranchCoordinator } from "../../../apps/server/src/scale";
import { LoggedProcess } from "../../integration/portable/topology";
import { bounded, command } from "../../integration/portable/process";
import { S3TestServer } from "../storage/s3/server";
import { backupModules } from "./fixture";

class RestoreS3 extends S3TestServer {
  override readonly name = `quire-p5-restore-s3-${crypto.randomUUID()}`;
}

/** One actual cluster/S3 authority, distinct databases, buckets and owned Git volumes. */
export async function restoreTargetScaleFixture(key: Uint8Array) {
  const root = await mkdtemp(join(tmpdir(), "quire-p5-restore-scale-"));
  const name = `quire-p5-restore-pg-${crypto.randomUUID()}`;
  const s3 = new RestoreS3();
  const redisName = `quire-p5-restore-redis-${crypto.randomUUID()}`;
  let created = false;
  let redisCreated = false;
  let redis: LoggedProcess | undefined;
  let process: LoggedProcess | undefined;
  let admin: Awaited<ReturnType<typeof createPostgresStorage>> | undefined;
  const runtimes: Runtime[] = [];
  const servers: RepositoryServer[] = [];
  const storages: Awaited<ReturnType<typeof createPostgresStorage>>[] = [];
  const cleanup = async () => {
    for (const runtime of runtimes.reverse()) await runtime.close();
    for (const server of servers.reverse()) await server.close();
    for (const storage of storages.reverse()) await storage.close();
    await admin?.close();
    await s3.remove();
    if (redisCreated) await command(["docker", "rm", "--force", "--volumes", redisName]);
    const redisExit = redis ? await bounded(redis.exited) : null;
    if (created) await command(["docker", "rm", "--force", "--volumes", name]);
    const exit = process ? await bounded(process.exited) : null;
    await rm(root, { recursive: true });
    const remaining = await command(["docker", "ps", "--all", "--quiet", "--filter", `name=^/${name}$`]);
    if (remaining) throw new Error(`Owned PostgreSQL container survived cleanup: ${name}`);
    const remainingRedis = await command(["docker", "ps", "--all", "--quiet", "--filter", `name=^/${redisName}$`]);
    if (remainingRedis) throw new Error(`Owned Redis container survived cleanup: ${redisName}`);
    console.info("RESTORE_TARGET_SCALE_CLEANED", JSON.stringify({ root, postgres: name, redis: redisName, s3: s3.name, exit, redisExit }));
  };
  try {
    await command(["docker", "create", "--name", name, "--label", "quire.owner=st_01a17df9",
      "--publish", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD=quire-owned-restore", "postgres:17-alpine"]);
    created = true;
    process = new LoggedProcess(["docker", "start", "--attach", name], globalThis.process.env,
      /PostgreSQL init process complete;[\s\S]*database system is ready to accept connections/);
    await process.ready;
    const url = new URL(`postgres://postgres:quire-owned-restore@${await command(["docker", "port", name, "5432/tcp"])}/postgres`);
    admin = await createPostgresStorage({ url: url.href });
    const provisioning = admin;
    await command(["docker", "create", "--name", redisName, "--label", "quire.owner=st_01a17df9",
      "--publish", "127.0.0.1::6379", "redis:7.4-alpine", "redis-server", "--save", "", "--appendonly", "no"]);
    redisCreated = true;
    redis = new LoggedProcess(["docker", "start", "--attach", redisName], globalThis.process.env, /Ready to accept connections/);
    await redis.ready;
    const redisUrl = `redis://${await command(["docker", "port", redisName, "6379/tcp"])}`;
    await s3.create();
    const open = async (generation: "source" | "target" | "nonempty") => {
      const database = `restore_${generation}`;
      await provisioning.db.exec(`CREATE DATABASE "${database}"`);
      const selected = new URL(url);
      selected.pathname = "/" + database;
      const storage = await createPostgresStorage({ url: selected.href });
      storages.push(storage);
      await migrateDatabase(storage.uow, [...await foundationMigrations(), ...backupModules.flatMap(module => module.migrations ?? [])]);
      const bucket = `restore-${generation}`;
      await command(["docker", "exec", s3.name, "mkdir", `/data/${bucket}`]);
      const blobs = new S3BlobStore({ ...s3.options(), bucket });
      const directory = join(root, generation);
      await mkdir(directory, { mode: 0o700 });
      await writeFile(join(directory, "secret.key"), Buffer.from(key).toString("hex") + "\n", { mode: 0o600 });
      const token = crypto.randomUUID() + crypto.randomUUID();
      const localBranches = new PostgresBranchCoordinator(storage.uow, systemClock);
      const server = await startRepositoryServer({ volume: join(root, `${generation}-git`), token,
        db: storage.db, uow: storage.uow, clock: systemClock, branches: localBranches, admission: storage.admission });
      servers.push(server);
      const client = { url: server.url, token, clock: systemClock, admission: storage.admission };
      const openRuntime = async (dataDir: string) => {
        const branches = new RemoteBranchCoordinator(client);
        const repositories = new RemoteRepositoryService(client);
        const events = new SqliteEventPort(storage.db, systemClock);
        const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: dataDir, QUIRE_PROFILE: "scale" }), {
          modules: backupModules.map(module => ({ ...module, register: () => {} })),
          createAdapters: async () => ({ ...storage, blobs, branches, repositories, events,
            close: async () => {
              await repositories.close(); await branches.close(); await events.close();
            } }),
        });
        runtimes.push(runtime);
        return runtime;
      };
      const runtime = await openRuntime(directory);
      return { runtime, openRuntime, server, token, client, blobOptions: { ...s3.options(), bucket },
        configuration: {
          QUIRE_POSTGRES_URL: selected.href, QUIRE_REDIS_URL: redisUrl, QUIRE_REDIS_NAMESPACE: generation,
          QUIRE_REPOSITORY_URL: server.url, QUIRE_REPOSITORY_TOKEN: token,
          QUIRE_S3_ENDPOINT: s3.options().endpoint, QUIRE_S3_BUCKET: bucket, QUIRE_S3_REGION: s3.options().region,
          QUIRE_S3_ACCESS_KEY_ID: s3.accessKeyId, QUIRE_S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
        } };
    };
    return { root, open, [Symbol.asyncDispose]: cleanup };
  } catch (error) { await cleanup(); throw error; }
}
