import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { z } from "zod";
import { StorageError } from "./errors";
import identitySql from "./migrations/001-f-identity.sql" with { type: "text" };
import projectsSql from "./migrations/002-f-projects.sql" with { type: "text" };
import reviewSql from "./migrations/003-f-review.sql" with { type: "text" };
import workSql from "./migrations/004-f-work.sql" with { type: "text" };
import governanceSql from "./migrations/005-f-governance.sql" with { type: "text" };

export type Migration = {
  readonly id: string; readonly sql: string;
};
export async function foundationMigrations(): Promise<readonly Migration[]> {
  return [
    { id: "001-f-identity", sql: identitySql }, { id: "002-f-projects", sql: projectsSql },
    { id: "003-f-review", sql: reviewSql }, { id: "004-f-work", sql: workSql },
    { id: "005-f-governance", sql: governanceSql },
  ];
}
export function openDatabase(dataDir: string): Database {
  const db = new Database(join(dataDir, "quire.sqlite"), { create: true, strict: true });
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
  return db;
}
export function migrateDatabase(db: Database, migrations: readonly Migration[]): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, digest TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT");
  const seen = new Set<string>();
  for (const migration of [...migrations].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!/^\d{3}-[fckaxuvo]-[a-z0-9-]+$/.test(migration.id) || seen.has(migration.id)) {
      throw new StorageError("INVALID_MIGRATION_ID", migration.id);
    }
    seen.add(migration.id);
    const digest = new Bun.CryptoHasher("sha256").update(migration.sql).digest("hex");
    const previous = db.query<{ digest: string }, [string]>("SELECT digest FROM schema_migrations WHERE id=?").get(migration.id);
    if (previous) {
      if (previous.digest !== digest) throw new StorageError("MIGRATION_CHANGED", migration.id);
      continue;
    }
    db.transaction(() => {
      db.exec(migration.sql);
      db.query("INSERT INTO schema_migrations(id,digest,applied_at) VALUES(?,?,?)")
        .run(migration.id, digest, new Date().toISOString());
    }).immediate();
  }
  const issues = db.query("PRAGMA foreign_key_check").all();
  if (issues.length) throw new StorageError("FOREIGN_KEY_CHECK_FAILED", JSON.stringify(issues));
}
export type SqlValue = string | number | bigint | boolean | Uint8Array | null;
export interface Transaction {
  execute(sql: string, parameters?: readonly SqlValue[]): Promise<number>;
  query<T extends z.ZodType>(sql: string, parameters: readonly SqlValue[], row: T): Promise<readonly z.output<T>[]>;
}
export interface UnitOfWork {
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
export interface LocalUnitOfWork extends UnitOfWork {
  local<T>(work: ((tx: Database) => T) & ([T] extends [never] ? unknown : T extends PromiseLike<unknown> ? never : unknown)): T;
}
class SqliteTransaction implements Transaction {
  constructor(readonly db: Database) {}
  async execute(sql: string, parameters: readonly SqlValue[] = []): Promise<number> {
    return this.db.query(sql).run(...parameters).changes;
  }
  async query<T extends z.ZodType>(sql: string, parameters: readonly SqlValue[], row: T): Promise<readonly z.output<T>[]> {
    return this.db.query(sql).all(...parameters).map((value) => row.parse(value));
  }
}
export class SqliteUnitOfWork implements LocalUnitOfWork {
  private tail: Promise<unknown> = Promise.resolve();
  private asyncActive = false;
  constructor(readonly db: Database) {}
  local<T>(work: ((tx: Database) => T) & ([T] extends [never] ? unknown : T extends PromiseLike<unknown> ? never : unknown)): T {
    if (this.asyncActive) throw new StorageError("SQLITE_TRANSACTION_BUSY", "Await the active UnitOfWork.run before using local");
    return this.db.transaction(() => {
      const result = work(this.db);
      if (result instanceof Promise) {
        throw new StorageError("ASYNC_SQLITE_TRANSACTION", "Use synchronous local SQL; perform I/O before entering the transaction");
      }
      return result;
    }).immediate();
  }
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    // Only await Transaction operations here. Network/blob/Git work belongs before this boundary.
    const result = this.tail.then(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      this.asyncActive = true;
      try {
        const value = await work(new SqliteTransaction(this.db));
        this.db.exec("COMMIT");
        return value;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      } finally { this.asyncActive = false; }
    });
    // Keep the writer queue usable after a caller-observed failure.
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
export function parseJson<T extends z.ZodType>(schema: T, value: string): z.output<T> {
  return schema.parse(JSON.parse(value));
}
