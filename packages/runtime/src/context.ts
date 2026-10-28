import { join } from "node:path";
import { InstantSchema } from "@quire/contracts";
import type { Clock, BlobStore, Lane, SqlExecutor, UnitOfWork, BranchCoordinator, RepositoryService, MutationAdmission } from "@quire/contracts";
import type { RuntimeConfig } from "./config";
import { prepareData, loadSecretKey } from "./config";
import { openDatabase, foundationMigrations, migrateDatabase, SqliteUnitOfWork, SqliteExecutor } from "./database";
import type { Migration } from "./database";
import { DiskBlobStore } from "./blobs";
import { SqliteEventPort } from "./events";
import type { EventPort } from "./events";
import { ServiceRegistry } from "./services";
import { RouteRegistry } from "./router";
import { StorageError } from "./errors";
import { LocalBranchCoordinator } from "./coordination";
import { LocalRepositoryService } from "./repository";
import { LocalMutationAdmission } from "./admission";
import { NativeMutationAdmission } from "./native-admission";
import { PreparedLifecycle } from "./lifecycle";
import { inspectPreparedData, prepareLocalBinding, verifyRuntimeSchema } from "./prepared";
import type { PreparedAdapterBinding, RuntimeReadiness } from "./prepared";
import type { PreparedState } from "./lifecycle";
export { PreparedLifecycle } from "./lifecycle";
export type { PreparedState } from "./lifecycle";
export type { PreparedAdapterBinding, RuntimeReadiness } from "./prepared";

export const systemClock: Clock = { now: () => InstantSchema.parse(new Date().toISOString()) };
export type RuntimeAdapters = {
  readonly db: SqlExecutor; readonly uow: UnitOfWork; readonly blobs: BlobStore;
  readonly events: EventPort; readonly branches: BranchCoordinator; readonly repositories: RepositoryService;
  readonly admission?: MutationAdmission;
  /** Drain all adapter work and close owned resources. */
  readonly close: () => Promise<void>;
};
export type Runtime = RuntimeAdapters & {
  readonly admission: MutationAdmission;
  readonly config: RuntimeConfig; readonly clock: Clock;
  readonly services: ServiceRegistry; readonly routes: RouteRegistry; readonly secretKey: Uint8Array;
};
export type ModuleContext = Omit<Runtime, "routes" | "close"> & {
  readonly routes: ReturnType<RouteRegistry["forLane"]>;
};
export type ServiceModule = {
  readonly id: string; readonly lane: Lane; readonly order: number;
  readonly migrations?: readonly Migration[];
  readonly register: (context: ModuleContext) => void | Promise<void>;
  /** Runs before adapter close, including partial registration failure. */
  readonly dispose?: (context: ModuleContext) => void | Promise<void>;
};
export type RuntimeOptions = {
  readonly clock?: Clock; readonly modules?: readonly ServiceModule[];
  readonly createAdapters?: (config: RuntimeConfig, clock: Clock) => Promise<RuntimeAdapters>;
  /** Allows the scale factory to supply explicit foundation PostgreSQL variants. */
  readonly foundation?: readonly Migration[];
  /** Explicit inert factory. A normal createAdapters callback is not a prepare capability. */
  readonly prepareAdapters?: (config: RuntimeConfig, clock: Clock) => Promise<PreparedAdapterBinding>;
};
export type PreparedRuntime = {
  readonly state: PreparedState;
  readonly check: () => Promise<RuntimeReadiness>;
  readonly activate: () => Promise<Runtime>;
  readonly dispose: () => Promise<void>;
};
export async function createLocalAdapters(config: RuntimeConfig, clock: Clock): Promise<RuntimeAdapters> {
  const native = openDatabase(config.dataDir);
  const admission = new LocalMutationAdmission(new NativeMutationAdmission(config.dataDir));
  const db = new SqliteExecutor(native, admission);
  const uow = new SqliteUnitOfWork(native);
  const events = new SqliteEventPort(db, clock);
  const branches = new LocalBranchCoordinator(uow, clock, config.dataDir);
  const repositories = new LocalRepositoryService(config.dataDir, { db, uow, branches, clock, admission });
  return {
    db, uow, events, branches, repositories, admission,
    blobs: new DiskBlobStore(join(config.dataDir, "blobs")),
    close: async () => {
      await admission.close();
      await repositories.close();
      await branches.close();
      await events.close();
      await db.close();
    },
  };
}
export function createRuntime(config: RuntimeConfig, options: RuntimeOptions & { readonly startup: "prepared" }): Promise<PreparedRuntime>;
export function createRuntime(config: RuntimeConfig, options?: RuntimeOptions): Promise<Runtime>;
export async function createRuntime(config: RuntimeConfig,
  options: RuntimeOptions & { readonly startup?: "prepared" } = {}): Promise<Runtime | PreparedRuntime> {
  if (options.startup === "prepared") return prepareRuntime(config, options);
  if (config.profile === "scale" && !options.createAdapters) {
    throw new StorageError("PROFILE_UNAVAILABLE", "Scale requires explicit PostgreSQL/Redis/S3/repository adapters");
  }
  await prepareData(config);
  const secretKey = await loadSecretKey(config);
  const clock = options.clock ?? systemClock;
  const adapters = await (options.createAdapters ?? createLocalAdapters)(config, clock);
  return registerRuntime(config, options, adapters, secretKey, clock, false);
}

async function registerRuntime(config: RuntimeConfig, options: RuntimeOptions, adapters: RuntimeAdapters,
  secretKey: Uint8Array, clock: Clock, prepared: boolean): Promise<Runtime> {
  const registered: { module: ServiceModule; context: ModuleContext }[] = [];
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      const failures: unknown[] = [];
      for (const { module, context } of registered.toReversed()) {
        if (!module.dispose) continue;
        try { await module.dispose(context); } catch (error) { failures.push(error); }
      }
      try { await adapters.close(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, "Runtime shutdown failed");
    })();
    return closing;
  };
  try {
    if (config.profile === "scale" && adapters.db.dialect !== "postgres") {
      throw new StorageError("PROFILE_ADAPTER_MISMATCH", "Scale cannot use SQLite");
    }
    const modules = [...options.modules ?? []].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    if (modules.some(module => module.id === "041-o-backups") && !adapters.admission) {
      throw new StorageError("BACKUP_QUIESCENCE_REQUIRED", "Backup registration requires actual adapter admission");
    }
    const names = new Set<string>();
    for (const module of modules) {
      if (names.has(module.id)) throw new StorageError("DUPLICATE_MODULE", module.id);
      names.add(module.id);
    }
    const migrations = [
      ...options.foundation ?? await foundationMigrations(), ...modules.flatMap((module) => module.migrations ?? []),
    ];
    if (prepared) await verifyRuntimeSchema(adapters.db, migrations);
    else await migrateDatabase(adapters.uow, migrations);
    const admission = adapters.admission ?? {
      writer: <T>(work: () => Promise<T>) => work(),
      background: <T>(work: () => Promise<T>) => work(),
      exclusive: <T>(_work: () => Promise<T>): Promise<T> => Promise.reject(
        new StorageError("BACKUP_QUIESCENCE_REQUIRED", "The adapter factory did not supply all-writer admission")),
    };
    const runtime: Runtime = {
      ...adapters, close, admission, config, secretKey, clock, services: new ServiceRegistry(), routes: new RouteRegistry(undefined, admission),
    };
    for (const module of modules) {
      const context = { ...runtime, routes: runtime.routes.forLane(module.lane) };
      registered.push({ module, context });
      await module.register(context);
    }
    await runtime.events.dispatch();
    return runtime;
  } catch (error) {
    try { await close(); }
    catch (failure) { throw new AggregateError([error, failure], "Runtime construction and cleanup failed", { cause: failure }); }
    throw error;
  }
}

export async function prepareRuntime(config: RuntimeConfig, options: RuntimeOptions = {}): Promise<PreparedRuntime> {
  if ((config.profile === "scale" || options.createAdapters) && !options.prepareAdapters) {
    throw new StorageError("PREPARED_ADAPTERS_REQUIRED", "Custom storage must supply an explicit inert prepareAdapters factory");
  }
  const names = new Set<string>();
  for (const module of options.modules ?? []) {
    if (names.has(module.id)) throw new StorageError("DUPLICATE_MODULE", module.id);
    names.add(module.id);
  }
  const secretKey = await inspectPreparedData(config);
  const clock = options.clock ?? systemClock;
  const binding = options.prepareAdapters
    ? await options.prepareAdapters(config, clock)
    : await prepareLocalBinding(config, () => createLocalAdapters(config, clock));
  const migrations = [...options.foundation ?? await foundationMigrations(),
    ...(options.modules ?? []).flatMap(module => module.migrations ?? [])];
  let runtime: Runtime | undefined;
  let owned: Runtime | undefined;
  let adaptersClosed: Promise<void> | undefined;
  const closeBinding = () => adaptersClosed ??= binding.dispose();
  try {
    if (config.profile === "scale" && binding.db.dialect !== "postgres") {
      throw new StorageError("PROFILE_ADAPTER_MISMATCH", "Scale cannot use SQLite");
    }
    await verifyRuntimeSchema(binding.db, migrations);
  } catch (error) {
    try { await closeBinding(); }
    catch (failure) { throw new AggregateError([error, failure], "Preparation and cleanup failed", { cause: failure }); }
    throw error;
  }
  const lifecycle: PreparedLifecycle<Runtime> = new PreparedLifecycle(async (): Promise<Runtime> => {
    const adapters = await binding.activate();
    owned = await registerRuntime(config, options, { ...adapters, close: closeBinding }, secretKey, clock, true);
    runtime = { ...owned, close: () => lifecycle.dispose() };
    return runtime;
  }, () => owned ? owned.close() : closeBinding());
  return {
    get state() { return lifecycle.state; },
    async check() {
      if (lifecycle.state !== "prepared" && lifecycle.state !== "active") {
        throw new StorageError("RUNTIME_NOT_READY", lifecycle.state);
      }
      return verifyRuntimeSchema(runtime?.db ?? binding.db, migrations);
    },
    activate: () => lifecycle.activate(),
    dispose: () => lifecycle.dispose(),
  };
}
