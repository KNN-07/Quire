import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Environment, Migration } from "@quire/contracts";
import { createRuntime, loadConfig, migrateDatabase, systemClock } from "@quire/runtime";
import { createScaleAdapters, PostgresBranchCoordinator } from "../../../apps/server/src/scale";
import { seed } from "../../../scripts/seed";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { startRepositoryServer } from "../../../services/operations/repository";
import { DataBindingSchema } from "../../../services/operations/installation/model";
import { LoggedProcess } from "../portable/topology";
import { bounded, command } from "../portable/process";
import { S3TestServer } from "../../operations/storage/s3/server";
import { password } from "./native-fixture";
import { provisionAcceptedEnvironment } from "./environment-fixture";

class InstallationS3 extends S3TestServer {
  override readonly name = `quire-installation-s3-${crypto.randomUUID()}`;
}

/** Isolated actual services; no Docker connection is passed to application roles. */
export async function installationScaleResources() {
  const suffix = crypto.randomUUID();
  const postgres = `quire-installation-pg-${suffix}`;
  const redis = `quire-installation-redis-${suffix}`;
  const s3 = new InstallationS3();
  let pgCreated = false;
  let redisCreated = false;
  let pg: LoggedProcess | undefined;
  let red: LoggedProcess | undefined;
  let admin: Awaited<ReturnType<typeof createPostgresStorage>> | undefined;
  const cleanup = async () => {
    await admin?.close();
    await s3.remove();
    if (redisCreated) await command(["docker", "rm", "--force", "--volumes", redis]);
    if (pgCreated) await command(["docker", "rm", "--force", "--volumes", postgres]);
    const exits = await Promise.all([red ? bounded(red.exited) : null, pg ? bounded(pg.exited) : null]);
    for (const name of [postgres, redis]) {
      if (await command(["docker", "ps", "--all", "--quiet", "--filter", `name=^/${name}$`])) {
        throw new Error(`Owned installation container survived: ${name}`);
      }
    }
    console.info("INSTALLATION_SCALE_SERVICES_CLEANED", JSON.stringify({ postgres, redis, s3: s3.name, exits }));
  };
  try {
    await command(["docker", "create", "--name", postgres, "--label", "quire.owner=st_01a17e71",
      "--publish", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD=quire-installation-owned", "postgres:17-alpine"]);
    pgCreated = true;
    pg = new LoggedProcess(["docker", "start", "--attach", postgres], process.env,
      /PostgreSQL init process complete;[\s\S]*database system is ready to accept connections/);
    await pg.ready;
    const base = new URL(`postgres://postgres:quire-installation-owned@${await command(["docker", "port", postgres, "5432/tcp"])}/postgres`);
    admin = await createPostgresStorage({ url: base.href });
    const provisioning = admin;
    await command(["docker", "create", "--name", redis, "--label", "quire.owner=st_01a17e71",
      "--publish", "127.0.0.1::6379", "redis:7.4-alpine", "redis-server", "--save", "", "--appendonly", "no"]);
    redisCreated = true;
    red = new LoggedProcess(["docker", "start", "--attach", redis], process.env, /Ready to accept connections/);
    await red.ready;
    const redisUrl = `redis://${await command(["docker", "port", redis, "6379/tcp"])}`;
    await s3.create();
    console.info("INSTALLATION_SCALE_SERVICES_OWNED", JSON.stringify({ postgres, redis, s3: s3.name }));
    return {
      async generation(input: {
        readonly name: string; readonly root: string; readonly repositoryPort: number;
        readonly secret: string; readonly migrations: readonly Migration[]; readonly environment: Environment;
      }) {
        if (!/^[a-z-]+$/.test(input.name)) throw new Error("Invalid owned generation name");
        const database = `installation_${input.name.replaceAll("-", "_")}`;
        await provisioning.db.exec(`CREATE DATABASE "${database}"`);
        const selected = new URL(base);
        selected.pathname = `/${database}`;
        const storage = await createPostgresStorage({ url: selected.href });
        try {
          await migrateDatabase(storage.uow, input.migrations);
          const identity = z.object({ cluster: z.string(), database: z.string() }).parse(await storage.db.get(
            "SELECT c.system_identifier::text AS cluster,d.oid::text AS database FROM pg_control_system() c " +
            "CROSS JOIN pg_database d WHERE d.datname=current_database()"));
          const bucket = `installation-${input.name}`;
          await command(["docker", "exec", s3.name, "mkdir", `/data/${bucket}`]);
          const volume = join(input.root, "git-volume");
          const runtimeRoot = join(input.root, "runtime");
          await mkdir(volume, { mode: 0o700 });
          await mkdir(runtimeRoot, { mode: 0o700 });
          for (const name of ["work", "mail", "cache", "backups", "restores"]) {
            await mkdir(join(runtimeRoot, name), { mode: 0o700 });
          }
          const token = crypto.randomUUID() + crypto.randomUUID();
          const repositoryUrl = `http://127.0.0.1:${input.repositoryPort}/`;
          const refs = { database: join(runtimeRoot, "postgres.key"), redis: join(runtimeRoot, "redis.key"),
            blobs: join(runtimeRoot, "s3.json"), repository: join(runtimeRoot, "repository.key"), application: join(runtimeRoot, "secret.key") };
          for (const [path, value] of [[refs.database, selected.href], [refs.redis, redisUrl], [refs.repository, token],
            [refs.application, input.secret], [refs.blobs, JSON.stringify({ accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey })]] as const) {
            await writeFile(path, value, { mode: 0o600 });
          }
          const data = DataBindingSchema.parse({ dialect: "postgres", generationId: crypto.randomUUID(),
            database: { identity: `${identity.cluster}:${identity.database}`, connectionSecretRef: refs.database },
            blobs: { endpoint: s3.options().endpoint, bucket, region: s3.options().region, credentialsSecretRef: refs.blobs },
            repository: { volume, endpoint: repositoryUrl, credentialsSecretRef: refs.repository },
            redis: { namespace: `installation-${suffix}-${input.name}`, connectionSecretRef: refs.redis },
            applicationSecretRef: refs.application });
          if (input.name === "source") {
            const branches = new PostgresBranchCoordinator(storage.uow, systemClock);
            const server = await startRepositoryServer({ ...storage, branches, clock: systemClock,
              volume, token, hostname: "127.0.0.1", port: input.repositoryPort, admission: storage.admission });
            try {
              const settings = { postgresUrl: selected.href, redisUrl, namespace: data.dialect === "postgres" ? data.redis.namespace : "",
                repositoryUrl, repositoryToken: token, ...s3.options(), bucket, reconcileMs: 250 };
              const config = loadConfig({ QUIRE_DATA_DIR: runtimeRoot, QUIRE_PROFILE: "scale",
                QUIRE_COMPILER_BACKEND: "docker", QUIRE_SECRET_KEY: input.secret });
              const runtime = await createRuntime(config, { foundation: input.migrations,
                createAdapters: () => createScaleAdapters(config, systemClock, settings) });
              try {
                await seed(runtime, password);
                await provisionAcceptedEnvironment(runtime, input.environment);
              } finally { await runtime.close(); }
            } finally { await server.close(); await branches.close(); }
          }
          return data;
        } finally { await storage.close(); }
      },
      [Symbol.asyncDispose]: cleanup,
    };
  } catch (error) { await cleanup(); throw error; }
}
