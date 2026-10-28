import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { createHmac } from "node:crypto";
import { createRuntime, foundationMigrations, loadConfig, systemClock } from "@quire/runtime";
import { modules } from "../../../apps/server/src/composition";
import { createScaleAdapters } from "../../../apps/server/src/scale";
import type { ScaleConfig } from "../../../apps/server/src/scale";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { S3TestServer } from "../../operations/storage/s3/server";
import { ApiProcess, bounded, command } from "./process";

export class LoggedProcess {
  readonly child;
  readonly exited: Promise<number | null>;
  readonly ready: Promise<string>;
  output = "";
  constructor(args: readonly string[], env: NodeJS.ProcessEnv, pattern: RegExp) {
    this.child = spawn(args[0] ?? "", [...args.slice(1)], { env, stdio: ["ignore", "pipe", "pipe"] });
    const ready = Promise.withResolvers<string>();
    const data = (bytes: Buffer) => {
      this.output += bytes.toString();
      const match = this.output.match(pattern);
      if (match) ready.resolve(match[0]);
    };
    this.child.stdout.on("data", data);
    this.child.stderr.on("data", data);
    this.exited = new Promise(resolve => {
      this.child.once("exit", code => {
        ready.reject(new Error(`Process exited ${code}: ${this.output}`));
        resolve(code);
      });
    });
    this.ready = bounded(ready.promise);
  }
  async stop(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill(signal);
    await bounded(this.exited);
  }
}

export async function topology(instanceKey?: string) {
  const root = await mkdtemp(join(tmpdir(), "quire-p1s-integrate-"));
  const suffix = crypto.randomUUID();
  const postgres = `quire-p1s-integrate-pg-${suffix}`;
  const redis = `quire-p1s-integrate-redis-${suffix}`;
  const s3 = new S3TestServer();
  const processes: LoggedProcess[] = [];
  const apis: ApiProcess[] = [];
  let createdPostgres = false;
  let createdRedis = false;
  let storage: Awaited<ReturnType<typeof createPostgresStorage>> | undefined;
  const cleanup = async () => {
    for (const api of apis) await api.close();
    for (const child of processes.reverse()) await child.stop();
    if (storage) await storage.close();
    await s3.remove();
    for (const [name, created] of [[redis, createdRedis], [postgres, createdPostgres]] as const) {
      if (created) await command(["docker", "rm", "--force", "--volumes", name]);
      if (await command(["docker", "ps", "--all", "--quiet", "--filter", `name=^/${name}$`])) {
        throw new Error(`Owned container remains: ${name}`);
      }
    }
    await rm(root, { recursive: true, force: true });
    console.info("TOPOLOGY_CLEANED", { root, postgres, redis, s3: s3.name, apiPids: apis.map(api => api.child.pid) });
  };
  try {
    await command(["docker", "create", "--name", postgres, "--label", "quire.owner=st_01a17ba5",
      "--publish", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD=quire-owned-integration",
      "postgres:17-alpine"]);
    createdPostgres = true;
    const pg = new LoggedProcess(["docker", "start", "--attach", postgres], process.env,
      /PostgreSQL init process complete;[\s\S]*database system is ready to accept connections/);
    processes.push(pg);
    await pg.ready;
    const pgBinding = await command(["docker", "port", postgres, "5432/tcp"]);
    const postgresUrl = `postgres://postgres:quire-owned-integration@${pgBinding}/postgres`;
    storage = await createPostgresStorage({ url: postgresUrl });
    const foundation = [...await foundationMigrations(), ...modules.flatMap(module => module.migrations ?? [])];
    console.info("SCHEMA_CLI_BEFORE_REPOSITORY", await command([process.execPath, "scripts/migrate.ts"], {
      ...process.env, QUIRE_PROFILE: "scale", QUIRE_POSTGRES_URL: postgresUrl,
      QUIRE_DATA_DIR: join(root, "schema-cli"),
    }));
    // Docker's anonymous host-port mapping changes after stop/start.
    const reservation = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const redisPort = reservation.port;
    reservation.stop(true);
    await command(["docker", "create", "--name", redis, "--label", "quire.owner=st_01a17ba5",
      "--publish", `127.0.0.1:${redisPort}:6379`, "redis:7.4-alpine", "redis-server", "--save", "", "--appendonly", "no"]);
    createdRedis = true;
    const red = new LoggedProcess(["docker", "start", "--attach", redis], process.env, /Ready to accept connections/);
    processes.push(red);
    await red.ready;
    await s3.create();
    const redisBinding = await command(["docker", "port", redis, "6379/tcp"]);
    const key = instanceKey ?? crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    const token = crypto.randomUUID() + crypto.randomUUID();
    const environment = {
      ...process.env, QUIRE_PROFILE: "scale", QUIRE_POSTGRES_URL: postgresUrl,
      QUIRE_REDIS_URL: `redis://${redisBinding}`, QUIRE_REDIS_NAMESPACE: `integration-${suffix}`,
      QUIRE_REPOSITORY_TOKEN: token, QUIRE_REPOSITORY_VOLUME: join(root, "repository"),
      QUIRE_SECRET_KEY: key, QUIRE_PUBLIC_URL: "http://localhost:5173", QUIRE_RECONCILE_MS: "50",
      QUIRE_S3_ENDPOINT: s3.options().endpoint, QUIRE_S3_BUCKET: s3.bucket, QUIRE_S3_REGION: "us-east-1",
      QUIRE_S3_ACCESS_KEY_ID: s3.accessKeyId, QUIRE_S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
    };
    const repository = new LoggedProcess([process.execPath, "apps/server/src/repository-main.ts"], environment,
      /http:\/\/127\.0\.0\.1:\d+/);
    processes.push(repository);
    const repositoryUrl = await repository.ready;
    const env = { ...environment, QUIRE_REPOSITORY_URL: repositoryUrl };
    const settings: ScaleConfig = {
      postgresUrl, redisUrl: env.QUIRE_REDIS_URL, namespace: env.QUIRE_REDIS_NAMESPACE,
      repositoryUrl, repositoryToken: token, ...s3.options(), reconcileMs: 50,
    };
    const config = loadConfig({ ...env, QUIRE_DATA_DIR: join(root, "controller") });
    const createController = async () => {
      await mkdir(config.dataDir, { recursive: true });
      await writeFile(join(config.dataDir, "secret.key"), key + "\n", { mode: 0o600 });
      return createRuntime(config, { foundation,
        createAdapters: (runtimeConfig, clock) => createScaleAdapters(runtimeConfig, clock, settings) });
    };
    return {
      root, env, storage, settings, config, foundation, key, createController,
      workerBearer: createHmac("sha256", Buffer.from(key, "hex")).update("quire:compiler:worker:v1").digest("hex"),
      async api(name: string) {
        const api = new ApiProcess({ ...env, QUIRE_DATA_DIR: join(root, name) });
        apis.push(api);
        return { api, url: await api.started() };
      },
      async redisStop() { await command(["docker", "stop", "--timeout", "5", redis]); },
      async redisStart() {
        const child = new LoggedProcess(["docker", "start", "--attach", redis], process.env, /Ready to accept connections/);
        processes.push(child);
        await child.ready;
        if (await command(["docker", "port", redis, "6379/tcp"]) !== redisBinding) {
          throw new Error("Owned Redis endpoint changed after restart");
        }
      },
      worker(baseUrl: string, id: string) {
        const worker = new LoggedProcess([process.execPath, "workers/compiler/main.ts"], {
          ...env, QUIRE_COORDINATOR_URL: baseUrl,
          QUIRE_WORKER_BEARER: createHmac("sha256", Buffer.from(key, "hex")).update("quire:compiler:worker:v1").digest("hex"),
          QUIRE_WORKER_ID: id,
        }, /worker/);
        // The worker has no readiness log. Its observable readiness is a SQL claim.
        void worker.ready.catch(() => {});
        processes.push(worker);
        return worker;
      },
      async [Symbol.asyncDispose]() { await cleanup(); },
    };
  } catch (error) { await cleanup(); throw error; }
}

export const responseData = async <T extends z.ZodType>(response: Response, schema: T): Promise<z.output<T>> => {
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return schema.parse(z.object({ data: z.unknown() }).parse(await response.json()).data);
};
export { systemClock };
