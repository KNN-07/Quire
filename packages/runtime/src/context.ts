import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { InstantSchema, assertNever } from "@quire/contracts";
import type { Clock, BlobStore, Lane } from "@quire/contracts";
import type { RuntimeConfig } from "./config";
import { prepareData, loadSecretKey } from "./config";
import { openDatabase, foundationMigrations, migrateDatabase, SqliteUnitOfWork } from "./database";
import type { Migration, LocalUnitOfWork } from "./database";
import { DiskBlobStore } from "./blobs";
import { SqliteEventPort } from "./events";
import type { LocalEventPort } from "./events";
import { ServiceRegistry } from "./services";
import { RouteRegistry } from "./router";
import { StorageError } from "./errors";

export const systemClock: Clock = { now: () => InstantSchema.parse(new Date().toISOString()) };
export type Runtime = {
  readonly config: RuntimeConfig; readonly db: Database; readonly uow: LocalUnitOfWork;
  readonly blobs: BlobStore; readonly clock: Clock; readonly events: LocalEventPort;
  readonly services: ServiceRegistry; readonly routes: RouteRegistry; readonly secretKey: Uint8Array;
  readonly close: () => void;
};
export type ModuleContext = Omit<Runtime, "routes" | "close"> & {
  readonly routes: ReturnType<RouteRegistry["forLane"]>;
};
export type ServiceModule = {
  readonly id: string; readonly lane: Lane; readonly order: number;
  readonly migrations?: readonly Migration[];
  readonly register: (context: ModuleContext) => void | Promise<void>;
};
export async function createRuntime(config: RuntimeConfig, options: {
  readonly clock?: Clock; readonly modules?: readonly ServiceModule[];
} = {}): Promise<Runtime> {
  switch (config.profile) {
    case "local": break;
    case "scale": throw new StorageError("PROFILE_UNAVAILABLE", "Scale storage must be supplied by operations integration; refusing a silent SQLite fallback");
    default: assertNever(config.profile);
  }
  await prepareData(config);
  const secretKey = await loadSecretKey(config);
  const db = openDatabase(config.dataDir);
  const modules = [...options.modules ?? []].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const names = new Set<string>();
  for (const module of modules) {
    if (names.has(module.id)) { db.close(); throw new StorageError("DUPLICATE_MODULE", module.id); }
    names.add(module.id);
  }
  try {
    migrateDatabase(db, [...await foundationMigrations(), ...modules.flatMap((module) => module.migrations ?? [])]);
    const clock = options.clock ?? systemClock;
    const runtime: Runtime = {
      config, db, secretKey, clock, uow: new SqliteUnitOfWork(db),
      blobs: new DiskBlobStore(join(config.dataDir, "blobs")), services: new ServiceRegistry(),
      events: new SqliteEventPort(db, clock), routes: new RouteRegistry(),
      close: () => { db.close(); },
    };
    for (const module of modules) {
      await module.register({ ...runtime, routes: runtime.routes.forLane(module.lane) });
    }
    runtime.events.dispatch();
    return runtime;
  } catch (error) { db.close(); throw error; }
}
