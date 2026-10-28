import { z } from "zod";
import { join } from "node:path";
import { assertNever, endpoints, GitOidSchema, IdSchema } from "@quire/contracts";
import { loadConfig, referenceBlob, ServiceError, SqliteEventPort, systemClock } from "@quire/runtime";
import { createApplication, modules } from "../../../apps/server/src/composition";
import { PostgresBranchCoordinator } from "../../../apps/server/src/scale";
import { createPostgresStorage } from "../../../services/operations/storage/postgres";
import { RemoteBranchCoordinator, RemoteRepositoryService, startRepositoryServer } from "../../../services/operations/repository";
import { createBackup, loadBackupSigner, verifyBackup } from "../../../services/operations/backups";
import { backupHost } from "../../../services/operations/backups/model";
import { seed } from "../../../scripts/seed";
import { fixtureIds } from "../../fixtures/foundation";
import { S3BlobStore } from "../../../services/operations/storage/s3";
import { RedisNotificationTransport } from "../../../services/operations/storage/redis";

const config = z.strictObject({
  role: z.enum(["api", "repository"]), database: z.string(), root: z.string(),
  token: z.string(), url: z.string().optional(), redis: z.string(), namespace: z.string(), signer: z.string(), backupRoot: z.string(),
  s3: z.strictObject({ endpoint: z.string(), bucket: z.string(), region: z.string(), accessKeyId: z.string(), secretAccessKey: z.string() }),
}).parse(JSON.parse(process.argv[2] ?? ""));
process.env["QUIRE_SECRET_KEY"] = new Bun.CryptoHasher("sha256").update(config.token).digest("hex");
process.env["QUIRE_BACKUP_ROOT"] = config.backupRoot;
const storage = await createPostgresStorage({ url: config.database });
const clock = systemClock;
const repository = await (async () => {
  switch (config.role) {
    case "repository": return startRepositoryServer({
      ...storage, volume: join(config.root, "git"), token: config.token,
      branches: new PostgresBranchCoordinator(storage.uow, clock), clock,
      gitCommand: [process.execPath, join(import.meta.dir, "../../operations/repository/git-probe.ts")],
    });
    case "api": return undefined;
    default: return assertNever(config.role);
  }
})();
const client = { url: z.url().parse(config.url ?? repository?.url), token: config.token, clock, admission: storage.admission };
const repositories = new RemoteRepositoryService(client);
const branches = new RemoteBranchCoordinator(client);
const events = new SqliteEventPort(storage.db, clock);
const notifications = new RedisNotificationTransport({ url: config.redis, namespace: config.namespace });
await notifications.connect();
let releaseWriter = Promise.withResolvers<void>();
let releaseBackup = Promise.withResolvers<void>();
const signal = (name: string, value: unknown = null) => process.send?.({ signal: name, value });
storage.admission.subscribe(phase => signal(phase));
const app = await (async () => {
  switch (config.role) {
    case "repository": return undefined;
    case "api": return createApplication({
  config: loadConfig({ QUIRE_DATA_DIR: config.root, QUIRE_PROFILE: "scale", QUIRE_COMPILER_BACKEND: "docker" }),
  modules: modules.map(module => ["010-a-identity", "041-o-backups", "042-o-tasks"].includes(module.id)
    ? module : { ...module, register: () => undefined }),
  backups: { signingKey: await loadBackupSigner(config.signer, false), configuration: {
    QUIRE_POSTGRES_URL: config.database, QUIRE_REDIS_URL: config.redis, QUIRE_REDIS_NAMESPACE: config.namespace,
    QUIRE_REPOSITORY_URL: client.url, QUIRE_REPOSITORY_TOKEN: config.token,
    QUIRE_S3_ENDPOINT: config.s3.endpoint, QUIRE_S3_BUCKET: config.s3.bucket, QUIRE_S3_REGION: config.s3.region,
    QUIRE_S3_ACCESS_KEY_ID: config.s3.accessKeyId, QUIRE_S3_SECRET_ACCESS_KEY: config.s3.secretAccessKey,
  } },
  createAdapters: async () => ({
    ...storage, repositories, branches, events,
    blobs: new S3BlobStore(config.s3),
    admission: {
      writer: work => storage.admission.writer(work),
      background: work => storage.admission.background(work),
      exclusive: work => storage.admission.exclusive(() => repositories.exclusive(async () => {
        signal("snapshot", storage.admission.ticket());
        await releaseBackup.promise;
        return work();
      })),
    },
    close: async () => {
      signal("close-phase", "repositories"); await repositories.close();
      signal("close-phase", "branches"); await branches.close();
      signal("close-phase", "events"); await events.close();
      signal("close-phase", "notifications"); await notifications.close();
      signal("close-phase", "storage"); await storage.close();
      signal("close-phase", "adapters-closed");
    },
  }),
    });
    default: return assertNever(config.role);
  }
})();
if (app) {
  const runtime = app.runtime;
  runtime.routes.forLane("K").registerTransport(endpoints.projectGet, async request => {
    const mode = new URL(request.request.url).searchParams.get("mode");
    const bytes = new TextEncoder().encode("scale admitted blob");
    const digest = await runtime.blobs.put(bytes);
    const oid = new TextDecoder().decode(await repositories.objects(fixtureIds.project,
      ["hash-object", "-w", "--stdin"], bytes)).trim();
    const ticket = storage.admission.ticket();
    const tree = new TextDecoder().decode(await repositories.objects(fixtureIds.project,
      ["rev-parse", "refs/heads/main^{tree}"])).trim();
    const next = GitOidSchema.parse(`sha1:${new TextDecoder().decode(await repositories.objects(fixtureIds.project,
      ["commit-tree", tree, "-m", ticket.name])).trim()}`);
    const previous = new TextDecoder().decode(await repositories.objects(fixtureIds.project,
      ["for-each-ref", "--format=%(objectname)", "refs/quire/admission"])).trim();
    const scope = { projectId: fixtureIds.project, branch: "main" };
    const lease = await branches.acquire(scope, ticket.name, 60000);
    if (!lease) throw new ServiceError("BRANCH_BUSY", 409, "Fixture branch is owned");
    const id = IdSchema.parse(crypto.randomUUID());
    if (mode === "hold") {
      signal("writer", { ticket, oid, digest });
      await releaseWriter.promise;
    }
    signal("before-git", ticket);
    try {
      await repositories.publish({ id, lease, updates: [{
        ref: "refs/quire/admission", expected: previous ? GitOidSchema.parse(`sha1:${previous}`) : null, next,
      }] });
      if (mode === "stale") {
        await releaseWriter.promise;
        await repositories.objects(fixtureIds.project, ["hash-object", "-w", "--stdin"], new TextEncoder().encode("stale forbidden object"));
      }
      await runtime.uow.run(async tx => {
        await referenceBlob(tx, { digest, bytes: bytes.length }, clock);
        await tx.run("UPDATE projects SET name=? WHERE id=?", [oid, fixtureIds.project]);
        await repositories.finalize(tx, id, lease);
      });
      return Response.json({ oid, digest });
    } finally { await branches.release(lease); }
  });
}
const server = app ? Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: request => app.fetch(request) }) : undefined;
process.send?.({ ready: repository?.url ?? server?.url.toString() });
process.on("message", (message: unknown) => {
  const input = z.strictObject({ id: z.number(), method: z.string(), value: z.unknown() }).parse(message);
  void (async () => {
    let result: unknown = null;
    switch (input.method) {
      case "release-writer": releaseWriter.resolve(); break;
      case "release-backup": releaseBackup.resolve(); break;
      case "reset": releaseWriter = Promise.withResolvers<void>(); releaseBackup = Promise.withResolvers<void>(); break;
      case "seed": {
        if (!app) throw new Error("API required");
        await seed(app.runtime, "quire-admission-scale-test");
        break;
      }
      case "backup": {
        if (!app) throw new Error("API required");
        const archive = await createBackup(app.runtime);
        const verified = await verifyBackup(archive.destination, app.runtime.secretKey, backupHost(app.runtime).signingKey);
        result = { manifest: verified.manifest, database: verified.database };
        break;
      }
      case "failure": {
        if (!app) throw new Error("API required");
        await app.runtime.admission.exclusive(async () => { throw new Error("owned scale failure"); });
        break;
      }
      case "lease-loss":
        if (!app) throw new Error("API required");
        result = await app.runtime.admission.exclusive(async () => "completed");
        break;
      case "sql": result = await storage.db.all(z.string().parse(input.value)); break;
      case "objects": {
        const args = z.array(z.string()).parse(input.value);
        result = new TextDecoder().decode(await repositories.objects(IdSchema.parse(fixtureIds.project), args));
        break;
      }
      case "recover":
        await storage.admission.writer(async () => {
          const lease = await branches.acquire({ projectId: fixtureIds.project, branch: "main" }, crypto.randomUUID(), 60000);
          if (!lease) throw new ServiceError("BRANCH_BUSY", 409, "Recovery lease is owned");
          try {
            const id = IdSchema.parse(input.value);
            await repositories.recover(id, lease);
            await storage.uow.run(tx => repositories.finalize(tx, id, lease));
          } finally { await branches.release(lease); }
        });
        break;
      case "close":
        releaseWriter.resolve(); releaseBackup.resolve();
        signal("close-phase", "http"); await server?.stop(true);
        signal("close-phase", "application"); await app?.close(); await repository?.close();
        if (!app) { await events.close(); await repositories.close(); await branches.close(); await notifications.close(); await storage.close(); }
        break;
      default: throw new Error("Unknown admission process command");
    }
    process.send?.({ id: input.id, result });
    if (input.method === "close") process.disconnect?.();
  })().catch((error: unknown) => process.send?.({
    id: input.id, error: error instanceof ServiceError ? error.code : error instanceof Error ? error.message : "UNKNOWN",
  }));
});
