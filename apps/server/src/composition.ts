import { createRuntime, prepareRuntime, PreparedLifecycle, loadConfig, StorageError } from "@quire/runtime";
import type { ModuleContext, RuntimeConfig, ServiceModule, RuntimeOptions } from "@quire/runtime";
import type { Runtime } from "@quire/runtime";
import type { RealtimeSocketData } from "@quire/runtime";
import type { Server, WebSocketHandler } from "bun";
import { mkdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { endpoints } from "@quire/contracts";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register as governance, migrations as governanceMigrations } from "../../../services/accounts/governance";
import { register as base, migrations as baseMigrations } from "../../../services/core/base";
import { register as review, migrations as reviewMigrations, dispose as disposeReview } from "../../../services/core/review";
import { register as git, registerCredentials, migrations as gitMigrations } from "../../../services/core/git";
import { register as catalog, migrations as catalogMigrations } from "../../../services/core/catalog";
import { register as compiler, migrations as compilerMigrations, quiesceCompiler, startWorker, stopWorker } from "../../../services/compiler";
import { register as overview } from "../../../services/operations/overview";
import { configureBackups, loadBackupSigner, register as backups, migrations as backupMigrations } from "../../../services/operations/backups";
import type { BackupHost } from "../../../services/operations/backups";
import { register as tasks } from "../../../services/operations/tasks";
import { register as workers, migrations as workerMigrations } from "../../../services/operations/workers";
import { register as environments, migrations as environmentMigrations, stopEnvironmentBuilds } from "../../../services/operations/environments";
import { createScaleAdapters } from "./scale";
import { createApplicationAdapters } from "../../../services/adapters";
import type { AdapterDeployment } from "../../../services/adapters";
import { operationalModules, registerSupport, startSupport, stopSupport } from "../../../services/operations";
import { register as registerUpdateModule, registerUpdates } from "../../../services/operations/updates";
import type { UpdateApiOptions } from "../../../services/operations/updates";

// F owns this ordered module list. Feature lanes export register(context), never edit this file.
export const modules: readonly ServiceModule[] = [
  { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
  { id: "011-a-governance", lane: "A", order: 11, register: governance, migrations: governanceMigrations },
  { id: "021-k-base", lane: "K", order: 21, register: base, migrations: baseMigrations },
  { id: "023-k-review", lane: "K", order: 23, register: review, migrations: reviewMigrations },
  { id: "024-k-catalog", lane: "K", order: 24, register: catalog, migrations: catalogMigrations },
  { id: "024-k-git", lane: "K", order: 24, register: git, migrations: gitMigrations },
  { id: "025-a-git-credentials", lane: "A", order: 25, register: registerCredentials },
  { id: "030-c-compiler", lane: "C", order: 30, register: compiler, migrations: compilerMigrations },
  { id: "040-o-overview", lane: "O", order: 40, register: overview },
  { id: "041-o-backups", lane: "O", order: 41, register: backups, migrations: backupMigrations },
  { id: "042-o-tasks", lane: "O", order: 42, register: tasks },
  { id: "060-o-environments", lane: "O", order: 60, register: environments, migrations: environmentMigrations },
  { id: "080-o-workers", lane: "O", order: 80, register: workers, migrations: workerMigrations },
  ...operationalModules,
];
export type ApplicationOptions = {
  readonly config?: RuntimeConfig; readonly modules?: readonly ServiceModule[];
  readonly createAdapters?: RuntimeOptions["createAdapters"];
  readonly prepareAdapters?: RuntimeOptions["prepareAdapters"];
  readonly startup?: "prepared";
  readonly updates?: UpdateApiOptions;
  readonly clock?: RuntimeOptions["clock"];
  readonly backups?: Partial<Omit<BackupHost, "exclusive">>;
  /** Custom module lists retain replacement semantics unless adapters are explicitly requested. */
  readonly adapters?: AdapterDeployment | false;
};
export async function createApplication(options: ApplicationOptions = {}) {
  const config = options.config ?? loadConfig();
  const signerPath = process.env["QUIRE_BACKUP_SIGNING_KEY_FILE"];
  if ((config.production || config.profile === "scale") && !options.backups?.signingKey && !signerPath) {
    throw new StorageError("BACKUP_SIGNER_REQUIRED", "Production and scale require a shared, independently provisioned signer");
  }
  const configuredBackupRoot = options.backups?.backupRoot ?? process.env["QUIRE_BACKUP_ROOT"];
  if (config.profile === "scale" && (!configuredBackupRoot || !isAbsolute(configuredBackupRoot))) {
    throw new StorageError("BACKUP_ROOT_REQUIRED", "Scale requires an absolute shared durable QUIRE_BACKUP_ROOT or backups.backupRoot");
  }
  const backupRoot = resolve(configuredBackupRoot ?? join(config.dataDir, "backups"));
  const adapters = options.adapters === false || (options.modules !== undefined && options.adapters === undefined)
    ? undefined : createApplicationAdapters(options.adapters);
  const hostModules = [...options.modules ?? modules, ...adapters?.modules ?? []];
  let registeredOwner = false;
  const cleanup = async (context: Pick<ModuleContext, "db" | "services" | "admission">) => {
    const failures: unknown[] = [];
    const actions = [
      () => stopSupport(context),
      () => adapters?.close(),
      () => stopEnvironmentBuilds(context),
      () => context.services.has("compiler") ? stopWorker(context) : undefined,
      () => disposeReview(context),
    ];
    for (const action of actions) {
      try { await action(); }
      catch (error) { failures.push(error); }
    }
    return failures;
  };
  // Register this owner first so partial registration and initial-dispatch failures
  // drain producers before the runtime closes its storage.
  const owner: ServiceModule = {
    id: "000-f-application-owner", lane: "F", order: -1, register() { registeredOwner = true; },
    async dispose(context) {
      const failures = await cleanup(context);
      if (failures.length) throw new AggregateError(failures, "Application shutdown failed");
    },
  };
  const constructionFailed = async (error: unknown): Promise<never> => {
    if (!registeredOwner && adapters) {
      try { await adapters.close(); }
      catch (failure) { throw new AggregateError([error, failure], "Application construction and cleanup failed", { cause: failure }); }
    }
    throw error;
  };
  const runtimeOptions: RuntimeOptions = { modules: [owner, ...hostModules.map(module => ({
    ...module, async register(context: ModuleContext) {
      if (module.register === registerSupport && adapters) registerSupport(context, { inquiries: adapters.inquiries });
      else if (module.register === registerUpdateModule && options.updates) registerUpdates(context, options.updates);
      else if (module.register === tasks && options.updates) tasks(context, options.updates.client);
      else await module.register(context);
    },
  }))],
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.prepareAdapters ? { prepareAdapters: options.prepareAdapters } : {}),
    ...(options.createAdapters ? { createAdapters: options.createAdapters }
      : config.profile === "scale" ? { createAdapters: createScaleAdapters } : {}) };
  const restoreRoot = options.backups?.restoreRoot ?? join(config.dataDir, "restores");
  const signingKey = async () => {
    const key = options.backups?.signingKey ?? await loadBackupSigner(
      signerPath ?? join(config.dataDir, "backup-signing.pem"),
      options.startup !== "prepared" && !config.production && config.profile === "local");
    if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") {
      throw new StorageError("BACKUP_SIGNER_ALGORITHM", "An Ed25519 private signing key is required");
    }
    return key;
  };
  const bind = async (runtime: Runtime) => {
  let closing: Promise<void> | undefined;
  let starting: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      if (starting) await starting.then(() => undefined, () => undefined);
      await runtime.close();
    })();
    return closing;
  };
  try {
    if (options.startup !== "prepared") {
      await mkdir(backupRoot, { recursive: true, mode: 0o700 });
      await mkdir(restoreRoot, { recursive: true, mode: 0o700 });
    }
    configureBackups(runtime, {
      signingKey: await signingKey(),
      backupRoot, restoreRoot, configuration: {
        ...(options.backups?.configuration ?? Object.fromEntries(
          Object.entries({ ...process.env, ...(config.profile === "scale" ? { QUIRE_S3_REGION: process.env["QUIRE_S3_REGION"] ?? "us-east-1" } : {}) })
            .flatMap(([key, value]) => key.startsWith("QUIRE_") && !key.startsWith("QUIRE_BACKUP_SIGNING_") && value !== undefined
              ? [[key, value]] : []))),
        QUIRE_BACKUP_ROOT: backupRoot,
      },
      openFresh: options.backups?.openFresh ?? (async target => createRuntime({
        ...config, dataDir: target, profile: "local", production: false,
      }, { modules: hostModules.map(module => ({ ...module, register: () => undefined })) })),
      exclusive: work => runtime.admission.exclusive(async () => {
        if (runtime.services.has("compiler")) await quiesceCompiler(runtime);
        return work();
      }),
    });
    runtime.routes.forLane("F").register(endpoints.health, async () => {
      await runtime.db.get("SELECT 1");
      return { status: "ok", runtime: `bun-${Bun.version}`, database: runtime.db.dialect, at: runtime.clock.now() } as const;
    });
  } catch (error) {
    try { await close(); }
    catch (failure) { throw new AggregateError([error, failure], "Application startup and cleanup failed", { cause: failure }); }
    throw error;
  }
  const websocket = {
    message: (socket, message) => runtime.services.get("realtime").handlers.message(socket, message),
    open: (socket) => runtime.services.get("realtime").handlers.open?.(socket),
    close: (socket, code, reason) => runtime.services.get("realtime").handlers.close?.(socket, code, reason),
    drain: (socket) => runtime.services.get("realtime").handlers.drain?.(socket),
    maxPayloadLength: 4 * 1024 * 1024,
  } satisfies WebSocketHandler<RealtimeSocketData>;
  const start = (): Promise<void> => {
    if (closing) return Promise.reject(new StorageError("APPLICATION_CLOSED", "Application is already closed"));
    starting ??= (async () => {
      if (closing) throw new StorageError("APPLICATION_CLOSED", "Application is already closed");
      try {
        if (runtime.services.has("compiler")) await startWorker(runtime);
        if (hostModules.some(module => module.register === registerSupport)) startSupport(runtime);
        adapters?.start();
      } catch (error) {
        try { await runtime.close(); }
        catch (failure) { throw new AggregateError([error, failure], "Application start and cleanup failed", { cause: failure }); }
        throw error;
      }
    })();
    return starting;
  };
  return {
    runtime, adapters, websocket, fetch: (request: Request) => runtime.routes.fetch(request),
    get state() { return closing ? "disposed" as const : "active" as const; },
    start,
    handle: (request: Request, server: Server<RealtimeSocketData>) => {
      if (request.headers.get("upgrade")?.toLowerCase() === "websocket" && runtime.services.has("realtime")) {
        return runtime.services.get("realtime").upgrade(request, server);
      }
      if (new URL(request.url).pathname === endpoints.events.path) server.timeout(request, 0);
      return runtime.routes.fetch(request);
    },
    close,
  };
  };
  if (options.startup !== "prepared") {
    const runtime = await createRuntime(config, runtimeOptions).catch(constructionFailed);
    const app = await bind(runtime);
    return { ...app, activate: app.start, dispose: app.close, get state() { return app.state; },
      check: async () => {
        await runtime.db.get("SELECT 1");
        return { database: runtime.db.dialect,
          migrations: await runtime.db.all<{ id: string; digest: string }>("SELECT id,digest FROM schema_migrations ORDER BY id") };
      } };
  }
  // Preparation only reads already-provisioned backup authority and roots.
  const prepared = await (async () => {
    await signingKey();
    for (const path of [backupRoot, restoreRoot]) {
      if (!(await stat(path)).isDirectory()) throw new StorageError("BACKUP_ROOT_REQUIRED", path);
    }
    return prepareRuntime(config, runtimeOptions);
  })().catch(constructionFailed);
  let active: Awaited<ReturnType<typeof bind>> | undefined;
  const lifecycle = new PreparedLifecycle(async () => {
    active = await bind(await prepared.activate());
    await active.start();
    return active;
  }, async () => {
    const failures: unknown[] = [];
    try { await prepared.dispose(); } catch (error) { failures.push(error); }
    // Before registration the runtime owner has not acquired these factories.
    if (!registeredOwner && adapters) {
      try { await adapters.close(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Prepared application shutdown failed");
  });
  const requireActive = () => {
    if (lifecycle.state !== "active" || !active) {
      throw new StorageError("APPLICATION_NOT_ACTIVE", lifecycle.state);
    }
    return active;
  };
  const unavailable = () => new Response("Application is not active", { status: 503 });
  const websocket = {
    message: (socket, message) => requireActive().websocket.message(socket, message),
    open: socket => requireActive().websocket.open(socket),
    close: (socket, code, reason) => requireActive().websocket.close(socket, code, reason),
    drain: socket => requireActive().websocket.drain(socket),
    maxPayloadLength: 4 * 1024 * 1024,
  } satisfies WebSocketHandler<RealtimeSocketData>;
  const activate = async () => { await lifecycle.activate(); };
  return {
    get runtime() { return requireActive().runtime; },
    get adapters() { return requireActive().adapters; },
    get state() { return lifecycle.state; },
    check: () => lifecycle.state === "prepared" || lifecycle.state === "active"
      ? prepared.check() : Promise.reject(new StorageError("APPLICATION_NOT_ACTIVE", lifecycle.state)),
    websocket,
    fetch: (request: Request) => lifecycle.state === "active"
      ? requireActive().fetch(request) : Promise.resolve(unavailable()),
    handle: (request: Request, server: Server<RealtimeSocketData>) => lifecycle.state === "active"
      ? requireActive().handle(request, server) : unavailable(),
    start: activate, activate, close: () => lifecycle.dispose(), dispose: () => lifecycle.dispose(),
  };
}
