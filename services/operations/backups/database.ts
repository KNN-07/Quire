import { z } from "zod";
import type { Id, SqlExecutor, SqlValue } from "@quire/contracts";
import { BackupError, identifier, databaseSchema } from "./model";
import type { BackupContext, Cell, DatabaseImage } from "./model";

export async function tableNames(db: SqlExecutor): Promise<readonly string[]> {
  let sql: string;
  switch (db.dialect) {
    case "sqlite": sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"; break;
    case "postgres": sql = "SELECT tablename AS name FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename"; break;
    default: { const exhaustive: never = db.dialect; throw new BackupError("BACKUP_DIALECT_INVALID", exhaustive); }
  }
  return (await db.query(sql, [], z.object({ name: z.string() }))).map(row => row.name);
}
export async function assertSettled(db: SqlExecutor, activeBackupId?: Id): Promise<void> {
  const tables = new Set(await tableNames(db));
  const checks = [
    ["base_source_intents", ""], ["repository_intents", " WHERE state<>'finalized'"],
    ["core_git_intents", ""], ["git_intents", " WHERE state<>'finalized'"],
    ["review_decision_intents", ""], ["review_restore_intents", ""],
    ["compile_jobs", " WHERE status IN ('queued','running')"],
  ] as const;
  for (const [table, condition] of checks) {
    if (tables.has(table) && await db.get(`SELECT 1 FROM ${identifier(table)}${condition} LIMIT 1`)) {
      throw new BackupError("BACKUP_RECOVERY_REQUIRED", `Finish or explicitly recover ${table} before backup`);
    }
  }
  if (await db.get(`SELECT id FROM operations WHERE status IN ('queued','running')
    AND NOT EXISTS (SELECT 1 FROM backups b WHERE b.operation_id=operations.id AND b.id=? AND b.status='running') LIMIT 1`,
  [activeBackupId ?? null])) {
    throw new BackupError("BACKUP_RECOVERY_REQUIRED", "Finish or explicitly recover outstanding operations before backup");
  }
}
export async function exportDatabase(context: BackupContext, activeBackupId?: Id): Promise<DatabaseImage> {
  return context.uow.run(async tx => {
    await assertSettled(tx, activeBackupId);
    const tables = [];
    for (const name of await tableNames(tx)) {
      let dependencies: readonly string[];
      switch (tx.dialect) {
        case "sqlite":
          dependencies = (await tx.query(`PRAGMA foreign_key_list(${identifier(name)})`, [], z.object({ table: z.string() }))).map(row => row.table);
          break;
        case "postgres":
          dependencies = (await tx.query(`SELECT DISTINCT ccu.table_name AS name FROM information_schema.table_constraints tc
            JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema
            WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema=current_schema() AND tc.table_name=?`, [name],
          z.object({ name: z.string() }))).map(row => row.name);
          break;
        default: { const exhaustive: never = tx.dialect; throw new BackupError("BACKUP_DIALECT_INVALID", exhaustive); }
      }
      const rows = (await tx.all<Record<string, SqlValue>>(`SELECT * FROM ${identifier(name)}`)).map(row =>
        Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [
          key, value instanceof Uint8Array ? { binary: Buffer.from(value).toString("base64") }
            : typeof value === "bigint" ? { integer: value.toString() } : value,
        ]))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      tables.push({ name, dependencies: [...new Set(dependencies)].sort(), rows });
    }
    return databaseSchema.parse({ dialect: tx.dialect, tables });
  });
}
export function orderedTables(image: DatabaseImage) {
  const remaining = new Map(image.tables.map(table => [table.name, table]));
  const ordered: Array<DatabaseImage["tables"][number]> = [];
  while (remaining.size) {
    let progress = false;
    for (const [name, table] of remaining) {
      if (table.dependencies.some(dep => dep !== name && remaining.has(dep))) continue;
      ordered.push(table); remaining.delete(name); progress = true;
    }
    if (!progress) throw new BackupError("BACKUP_SCHEMA_CYCLE", [...remaining.keys()].join(","));
  }
  return ordered;
}
export function decodeCell(value: Cell): SqlValue {
  if (value === null || typeof value !== "object") return value;
  if ("binary" in value) return Buffer.from(value.binary, "base64");
  return BigInt(value.integer);
}
