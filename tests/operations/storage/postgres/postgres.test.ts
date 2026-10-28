import { afterAll, beforeAll, expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import type { Migration, Transaction, UnitOfWork } from "@quire/contracts";
import { migrateDatabase } from "@quire/runtime";
import { createPostgresStorage } from "../../../../services/operations/storage/postgres";
import type { PostgresStorage } from "../../../../services/operations/storage/postgres";

const url = process.env["QUIRE_TEST_POSTGRES_URL"];
if (!url) throw new Error("QUIRE_TEST_POSTGRES_URL must name an owned disposable PostgreSQL database");
const databaseName = `quire_p1s_${crypto.randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(url);
databaseUrl.pathname = `/${databaseName}`;
const options = { url: databaseUrl.toString(), maxConnections: 4 };
let storage: PostgresStorage;
let other: PostgresStorage;
let admin: PostgresStorage;
beforeAll(async () => {
  admin = await createPostgresStorage({ url });
  await admin.db.exec(`CREATE DATABASE "${databaseName}"`);
  storage = await createPostgresStorage(options);
  other = await createPostgresStorage(options);
});
afterAll(async () => {
  await Promise.all([storage.close(), other.close()]);
  await admin.db.exec(`DROP DATABASE "${databaseName}"`);
  await admin.close();
});

test("real PostgreSQL preserves numeric, binary, booleans and parameter data", async () => {
  await storage.db.exec("CREATE TABLE adapter_values (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, bytes BYTEA, label TEXT, enabled BOOLEAN)");
  const bytes = new Uint8Array([0, 127, 128, 255]);
  const label = "'; DROP TABLE adapter_values; -- ?";
  expect(await storage.db.run("INSERT INTO adapter_values(bytes,label,enabled) VALUES(?,?,?)", [bytes, label, true])).toEqual({ changes: 1 });
  expect(await storage.db.query("SELECT id,bytes,label,enabled FROM adapter_values", [], z.object({
    id: z.number().int(), bytes: z.instanceof(Uint8Array), label: z.string(), enabled: z.boolean(),
  }))).toEqual([{ id: 1, bytes, label, enabled: true }]);
  expect(await storage.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM adapter_values")).toEqual({ count: 1 });
  expect(await storage.db.get<{ counter: number }>("SELECT ?::bigint AS counter", [2147483649n])).toEqual({ counter: 2147483649 });
  await rejects(storage.db.get("SELECT 9007199254740992::bigint AS counter"), { code: "SQL_INTEGER_UNSAFE" });
  expect(await storage.db.get<{ literal: string; value: string; present: boolean }>("SELECT '?' AS literal, ?::text AS value, '{\"key\":1}'::jsonb ?? 'key' AS present", ["?"])).toEqual({
    literal: "?", value: "?", present: true,
  });
  expect(await storage.db.execute("UPDATE adapter_values SET label=? WHERE id=?", ["updated", 1])).toBe(1);
  expect(await storage.db.get("SELECT id FROM adapter_values WHERE id=?", [999])).toBeNull();
});

test("reserved connection spans awaits; unrelated root work cannot enter its transaction", async () => {
  await storage.db.exec("CREATE TABLE adapter_isolation (id INTEGER PRIMARY KEY)");
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let escaped: Transaction | undefined;
  const transaction = storage.uow.run(async (tx) => {
    escaped = tx;
    const first = await tx.get<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await tx.run("INSERT INTO adapter_isolation VALUES(?)", [1]);
    entered.resolve();
    await release.promise;
    expect(await tx.get<{ pid: number }>("SELECT pg_backend_pid() AS pid")).toEqual(first);
    await rejects(storage.db.get("SELECT 1"), { code: "ROOT_SQL_IN_TRANSACTION" });
    await rejects(storage.uow.run(async () => undefined), { code: "ROOT_SQL_IN_TRANSACTION" });
    await rejects(storage.close(), { code: "ROOT_SQL_IN_TRANSACTION" });
    throw new Error("rollback barrier");
  });
  // Install the rejection handler before opening the rollback barrier.
  const rejected = rejects(transaction, /rollback barrier/);
  await entered.promise;
  try {
    expect(await storage.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM adapter_isolation")).toEqual({ count: 0 });
    expect(await storage.db.run("INSERT INTO adapter_isolation VALUES(?)", [2])).toEqual({ changes: 1 });
  } finally { release.resolve(); }
  await rejected;
  expect(await storage.db.all("SELECT id FROM adapter_isolation ORDER BY id")).toEqual([{ id: 2 }]);
  if (!escaped) throw new Error("Transaction did not start");
  await rejects(escaped.get("SELECT 1"), { code: "TRANSACTION_CLOSED" });
});

test("SQL errors cannot silently commit an aborted transaction and pool remains reusable", async () => {
  await rejects(storage.uow.run(async (tx) => {
    await tx.run("INSERT INTO adapter_isolation VALUES(?)", [3]);
    await tx.exec("SELECT missing_column").catch(() => undefined);
  }));
  expect(await storage.db.get("SELECT id FROM adapter_isolation WHERE id=3")).toBeNull();
  expect(await storage.uow.run(async (tx) => {
    await tx.lock("adapter:success");
    await tx.run("INSERT INTO adapter_isolation VALUES(?)", [4]);
    return "committed";
  })).toBe("committed");
  expect(await storage.db.get<{ id: number }>("SELECT id FROM adapter_isolation WHERE id=4")).toEqual({ id: 4 });
});

test("concurrent migrations serialize on a transaction-held database lock", async () => {
  const locked = Promise.withResolvers<void>();
  const attempted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const migration: Migration = {
    id: "900-o-postgres-test",
    sql: "THIS IS INTENTIONALLY NOT POSTGRES SQL",
    postgres: "CREATE TABLE adapter_migrated (id INTEGER PRIMARY KEY); INSERT INTO adapter_migrated VALUES(1);",
  };
  const first: UnitOfWork = {
    run: (work) => storage.uow.run(async (tx) => {
      await tx.lock("quire:schema-migrations");
      locked.resolve();
      await release.promise;
      return work(tx);
    }),
  };
  const second: UnitOfWork = {
    run: (work) => other.uow.run(async (tx) => {
      // Root-independent transaction has started before the first can commit.
      attempted.resolve();
      return work(tx);
    }),
  };
  const a = migrateDatabase(first, [migration]);
  await locked.promise;
  const b = migrateDatabase(second, [migration]);
  const both = Promise.all([a, b]);
  try { await attempted.promise; } finally { release.resolve(); }
  await both;
  expect(await storage.db.all("SELECT id FROM adapter_migrated")).toEqual([{ id: 1 }]);
  const rows = await storage.db.all<{ id: string; digest: string; applied_at: string }>("SELECT * FROM schema_migrations");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.digest).toBe(new Bun.CryptoHasher("sha256").update(migration.postgres ?? "").digest("hex"));
  await migrateDatabase(storage.uow, [{ ...migration, sql: "changed SQLite variant only" }]);
  expect(await storage.db.all("SELECT * FROM schema_migrations")).toEqual(rows);
  await rejects(migrateDatabase(storage.uow, [{ ...migration, postgres: `${migration.postgres ?? ""}\n` }]), { code: "MIGRATION_CHANGED" });
  expect(await storage.db.all("SELECT * FROM schema_migrations")).toEqual(rows);
  await rejects(migrateDatabase(storage.uow, [{ id: "901-o-no-variant", sql: "SELECT 1" }]), { code: "MIGRATION_DIALECT_MISSING" });
  expect(await storage.db.all("SELECT * FROM schema_migrations")).toEqual(rows);
});

test("migration failure rolls back both DDL and earlier migration bookkeeping", async () => {
  await rejects(migrateDatabase(storage.uow, [
    { id: "902-o-atomic", sql: "", postgres: "CREATE TABLE adapter_atomic (id INTEGER)" },
    { id: "903-o-fails", sql: "", postgres: "SELECT missing_column" },
  ]));
  expect(await storage.db.get<{ name: string | null }>("SELECT to_regclass('adapter_atomic') AS name")).toEqual({ name: null });
  expect(await storage.db.all("SELECT id FROM schema_migrations WHERE id=?", ["902-o-atomic"])).toEqual([]);
});

test("close drains an admitted reserved transaction and rejects new admissions", async () => {
  const owned = await createPostgresStorage(options);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const transaction = owned.uow.run(async (tx) => {
    entered.resolve();
    await release.promise;
    return tx.get<{ value: number }>("SELECT 42 AS value");
  });
  await entered.promise;
  const closed = owned.close();
  try { await rejects(owned.db.get("SELECT 1"), { code: "DATABASE_CLOSED" }); }
  finally { release.resolve(); }
  expect(await transaction).toEqual({ value: 42 });
  await closed;
  await owned.close();
  await rejects(owned.uow.run(async () => undefined), { code: "DATABASE_CLOSED" });
});
