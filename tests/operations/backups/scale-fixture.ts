import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntime, foundationMigrations, loadConfig, migrateDatabase, systemClock } from "@quire/runtime";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { createScaleAdapters } from "../../../apps/server/src/scale";
import type { ScaleConfig } from "../../../apps/server/src/scale";
import { LoggedProcess } from "../../integration/portable/topology";
import { bounded, command } from "../../integration/portable/process";
import { S3TestServer } from "../storage/s3/server";
import { backupModules } from "./fixture";

class BackupS3 extends S3TestServer {
  override readonly name = `quire-p2o-backup-s3-${crypto.randomUUID()}`;
}

/** Real isolated PostgreSQL, Redis, S3 and singleton repository roles, never SQLite fallback. */
export async function scaleFixture(key: Uint8Array) {
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-backup-scale-"));
  const suffix = crypto.randomUUID();
  const postgres = `quire-p2o-backup-pg-${suffix}`;
  const redis = `quire-p2o-backup-redis-${suffix}`;
  const s3 = new BackupS3();
  const created: string[] = [];
  const processes: LoggedProcess[] = [];
  let storage: Awaited<ReturnType<typeof createPostgresStorage>> | undefined;
  const cleanup = async () => {
    for (const process of processes.slice(2).reverse()) await process.stop();
    await storage?.close();
    await s3.remove();
    for (const name of created.reverse()) await command(["docker", "rm", "--force", "--volumes", name]);
    const exits = await Promise.all(processes.map(process => bounded(process.exited)));
    await rm(root, { recursive: true });
    console.info("BACKUP_SCALE_CLEANED", JSON.stringify({ root, containers: created, s3: s3.name,
      processes: processes.map((process, index) => ({ pid: process.child.pid, exit: exits[index] })) }));
  };
  try {
    await command(["docker", "create", "--name", postgres, "--label", "quire.owner=st_01a17c2e",
      "--publish", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD=quire-owned-backup", "postgres:17-alpine"]);
    created.push(postgres);
    const pg = new LoggedProcess(["docker", "start", "--attach", postgres], process.env,
      /PostgreSQL init process complete;[\s\S]*database system is ready to accept connections/);
    processes.push(pg); await pg.ready;
    const postgresUrl = `postgres://postgres:quire-owned-backup@${await command(["docker", "port", postgres, "5432/tcp"])}/postgres`;
    storage = await createPostgresStorage({ url: postgresUrl });
    await migrateDatabase(storage.uow, [...await foundationMigrations(), ...backupModules.flatMap(module => module.migrations ?? [])]);
    await command(["docker", "create", "--name", redis, "--label", "quire.owner=st_01a17c2e",
      "--publish", "127.0.0.1::6379", "redis:7.4-alpine", "redis-server", "--save", "", "--appendonly", "no"]);
    created.push(redis);
    const red = new LoggedProcess(["docker", "start", "--attach", redis], process.env, /Ready to accept connections/);
    processes.push(red); await red.ready;
    await s3.create();
    const redisUrl = `redis://${await command(["docker", "port", redis, "6379/tcp"])}`;
    const token = crypto.randomUUID() + crypto.randomUUID();
    const env = {
      ...process.env, QUIRE_PROFILE: "scale", QUIRE_POSTGRES_URL: postgresUrl,
      QUIRE_REDIS_URL: redisUrl, QUIRE_REDIS_NAMESPACE: suffix,
      QUIRE_REPOSITORY_TOKEN: token, QUIRE_REPOSITORY_VOLUME: join(root, "repositories"),
      QUIRE_SECRET_KEY: Buffer.from(key).toString("hex"),
    };
    const repository = new LoggedProcess([process.execPath, "apps/server/src/repository-main.ts"], env,
      /http:\/\/127\.0\.0\.1:\d+/);
    processes.push(repository);
    const repositoryUrl = await repository.ready;
    const settings: ScaleConfig = { postgresUrl, redisUrl, namespace: suffix, repositoryUrl,
      repositoryToken: token, reconcileMs: 1000, ...s3.options() };
    const open = async (directory: string) => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(join(directory, "secret.key"), Buffer.from(key).toString("hex") + "\n", { mode: 0o600 });
      return createRuntime(loadConfig({ QUIRE_DATA_DIR: directory, QUIRE_PROFILE: "scale" }), {
        clock: systemClock, modules: backupModules.map(module => ({ ...module, register: () => {} })),
        createAdapters: (config, clock) => createScaleAdapters(config, clock, settings),
      });
    };
    console.info("BACKUP_SCALE_READY", JSON.stringify({ root, postgres, redis, s3: s3.name, repositoryUrl }));
    return { root, open, storage, settings, [Symbol.asyncDispose]: cleanup };
  } catch (error) { await cleanup(); throw error; }
}
