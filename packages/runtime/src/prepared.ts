import { Database } from "bun:sqlite";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { SqlExecutor, SqlDialect } from "@quire/contracts";
import type { RuntimeConfig } from "./config";
import type { Migration } from "./database";
import { migrationSql, SqliteExecutor } from "./database";
import type { RuntimeAdapters } from "./context";
import { StorageError } from "./errors";

export type RuntimeReadiness = {
  readonly database: SqlDialect;
  readonly migrations: readonly { readonly id: string; readonly digest: string }[];
};
/** Factory-owned storage: no producer starts until activate; dispose owns both phases. */
export type PreparedAdapterBinding = {
  readonly db: SqlExecutor;
  readonly activate: () => Promise<RuntimeAdapters>;
  readonly dispose: () => Promise<void>;
};

export async function verifyRuntimeSchema(db: SqlExecutor, migrations: readonly Migration[]): Promise<RuntimeReadiness> {
  const expected = new Map<string, string>();
  for (const migration of migrations) {
    if (!/^\d{3}-[fckaxuvo]-[a-z0-9-]+$/.test(migration.id) || expected.has(migration.id)) {
      throw new StorageError("INVALID_MIGRATION_ID", migration.id);
    }
    expected.set(migration.id, new Bun.CryptoHasher("sha256").update(migrationSql(migration, db.dialect)).digest("hex"));
  }
  const rows = await db.query("SELECT id,digest FROM schema_migrations ORDER BY id", [],
    z.strictObject({ id: z.string(), digest: z.string() }));
  for (const row of rows) {
    if (!expected.has(row.id)) throw new StorageError("MIGRATION_UNEXPECTED", row.id);
    if (row.digest !== expected.get(row.id)) throw new StorageError("MIGRATION_CHANGED", row.id);
  }
  for (const id of expected.keys()) {
    if (!rows.some(row => row.id === id)) throw new StorageError("MIGRATION_REQUIRED", id);
  }
  return Object.freeze({ database: db.dialect, migrations: Object.freeze(rows.map(row => Object.freeze(row))) });
}

/** Unlike loadSecretKey/prepareData, this never provisions or repairs a binding. */
export async function inspectPreparedData(config: RuntimeConfig): Promise<Uint8Array> {
  const root = await stat(config.dataDir);
  if (!root.isDirectory()) throw new StorageError("DATA_DIRECTORY_REQUIRED", config.dataDir);
  const configured = process.env["QUIRE_SECRET_KEY"];
  if (!configured && config.production) throw new StorageError("SECRET_KEY_REQUIRED", config.dataDir);
  const key = configured ?? (await readFile(join(config.dataDir, "secret.key"), "utf8")).trim();
  if (!/^[0-9a-f]{64}$/.test(key)) throw new StorageError("SECRET_KEY_INVALID", config.dataDir);
  if (config.profile === "local") {
    for (const name of ["blobs", "git", "mail", "work"]) {
      if (!(await stat(join(config.dataDir, name))).isDirectory()) {
        throw new StorageError("DATA_DIRECTORY_REQUIRED", name);
      }
    }
  }
  return Buffer.from(key, "hex");
}

export async function prepareLocalBinding(config: RuntimeConfig,
  activate: () => Promise<RuntimeAdapters>): Promise<PreparedAdapterBinding> {
  const path = join(config.dataDir, "quire.sqlite");
  const identity = await stat(path, { bigint: true });
  const native = new Database(path, { readonly: true, strict: true });
  const db = new SqliteExecutor(native);
  let active: RuntimeAdapters | undefined;
  return {
    db,
    async activate() {
      const current = await stat(path, { bigint: true });
      if (current.dev !== identity.dev || current.ino !== identity.ino) {
        throw new StorageError("RUNTIME_BINDING_CHANGED", path);
      }
      await db.close();
      active = await activate();
      return active;
    },
    async dispose() {
      await db.close();
      if (active) await active.close();
    },
  };
}
