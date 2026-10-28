import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { z } from "zod";
import type { Migration, SqlDialect, UnitOfWork } from "@quire/contracts";
import { StorageError } from "./errors";
import identitySql from "./migrations/001-f-identity.sql" with { type: "text" };
import projectsSql from "./migrations/002-f-projects.sql" with { type: "text" };
import reviewSql from "./migrations/003-f-review.sql" with { type: "text" };
import workSql from "./migrations/004-f-work.sql" with { type: "text" };
import governanceSql from "./migrations/005-f-governance.sql" with { type: "text" };
import identityPostgres from "./migrations/001-f-identity.postgres.sql" with { type: "text" };
import projectsPostgres from "./migrations/002-f-projects.postgres.sql" with { type: "text" };
import reviewPostgres from "./migrations/003-f-review.postgres.sql" with { type: "text" };
import workPostgres from "./migrations/004-f-work.postgres.sql" with { type: "text" };
import governancePostgres from "./migrations/005-f-governance.postgres.sql" with { type: "text" };
import portableSql from "./migrations/006-f-portable.sql" with { type: "text" };
import portablePostgres from "./migrations/006-f-portable.postgres.sql" with { type: "text" };

export type { Migration, SqlDialect, SqlValue, SqlResult, SqlExecutor, Transaction, UnitOfWork } from "@quire/contracts";
export { SqliteExecutor, SqliteUnitOfWork } from "./sqlite";
export async function foundationMigrations(): Promise<readonly Migration[]> {
  return [
    { id: "001-f-identity", sql: identitySql, postgres: identityPostgres },
    { id: "002-f-projects", sql: projectsSql, postgres: projectsPostgres },
    { id: "003-f-review", sql: reviewSql, postgres: reviewPostgres },
    { id: "004-f-work", sql: workSql, postgres: workPostgres },
    { id: "005-f-governance", sql: governanceSql, postgres: governancePostgres },
    { id: "006-f-portable", sql: portableSql, postgres: portablePostgres },
  ];
}
/** Native tooling only. Production services receive SqlExecutor, never this handle. */
export function openDatabase(dataDir: string): Database {
  const db = new Database(join(dataDir, "quire.sqlite"), { create: true, strict: true });
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
  return db;
}
export function migrationSql(migration: Migration, dialect: SqlDialect): string {
  if (dialect === "sqlite") return migration.sql;
  if (migration.postgres === undefined) throw new StorageError("MIGRATION_DIALECT_MISSING", migration.id);
  return migration.postgres;
}
export async function migrateDatabase(uow: UnitOfWork, migrations: readonly Migration[]): Promise<void> {
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (!/^\d{3}-[fckaxuvo]-[a-z0-9-]+$/.test(migration.id) || seen.has(migration.id)) {
      throw new StorageError("INVALID_MIGRATION_ID", migration.id);
    }
    seen.add(migration.id);
  }
  await uow.run(async (tx) => {
    await tx.lock("quire:schema-migrations");
    await tx.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, digest TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (const migration of [...migrations].sort((a, b) => a.id.localeCompare(b.id))) {
      const sql = migrationSql(migration, tx.dialect);
      const digest = new Bun.CryptoHasher("sha256").update(sql).digest("hex");
      const previous = await tx.get<{ digest: string }>("SELECT digest FROM schema_migrations WHERE id=?", [migration.id]);
      if (previous) {
        if (previous.digest !== digest) throw new StorageError("MIGRATION_CHANGED", migration.id);
        continue;
      }
      await tx.exec(sql);
      await tx.run("INSERT INTO schema_migrations(id,digest,applied_at) VALUES(?,?,?)", [migration.id, digest, new Date().toISOString()]);
    }
    if (tx.dialect === "sqlite") {
      const issues = await tx.all("PRAGMA foreign_key_check");
      if (issues.length) throw new StorageError("FOREIGN_KEY_CHECK_FAILED", JSON.stringify(issues));
    }
  });
}
export function parseJson<T extends z.ZodType>(schema: T, value: string): z.output<T> {
  return schema.parse(JSON.parse(value));
}
