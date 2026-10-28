import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { Database } from "bun:sqlite";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, loadConfig, foundationMigrations, migrateDatabase, migrationSql } from "@quire/runtime";
import type { Runtime } from "@quire/runtime";
import { fixtureIds } from "../../fixtures/foundation";
import { fixture } from "./fixture";

test("the isolated 3fe3a23 fixture reopens without changing any applied hash or row", async () => {
  const root = await mkdtemp(join(tmpdir(), "quire-p1s-contract-reopen-"));
  let runtime: Runtime | undefined;
  try {
    await cp(new URL("../../fixtures/portable-baseline.sqlite.fixture", import.meta.url), join(root, "quire.sqlite"));
    const native = new Database(join(root, "quire.sqlite"), { strict: true });
    const original = native.query<Record<string, unknown>, []>("SELECT * FROM schema_migrations ORDER BY id").all();
    const users = native.query<Record<string, unknown>, []>("SELECT * FROM users ORDER BY id").all();
    const documents = native.query<Record<string, unknown>, []>("SELECT * FROM document_states ORDER BY doc_id").all();
    // Existing order is insertion order, deliberately opposite to ID sorting.
    native.query("INSERT INTO suggestions(id,project_id,branch,author_id,origin,created_at) VALUES(?,?,'main',?,'human',?)")
      .run("existing-suggestion", fixtureIds.project, fixtureIds.kien, "2026-10-27T00:00:00.000Z");
    for (const id of ["z-last-by-id", "a-first-by-id"]) {
      native.query("INSERT INTO suggestion_edits(id,suggestion_id,file_id,anchor_json,before_text,after_text,base_revision) VALUES(?,? ,?,'{}','before','after',0)")
        .run(id, "existing-suggestion", fixtureIds.mainFile);
    }
    native.query("INSERT INTO events(seq,id,topic,aggregate_id,at,payload_json) VALUES(42,?,'session.revoked',?,?,?)")
      .run(crypto.randomUUID(), fixtureIds.kien, "2026-10-27T00:00:00.000Z",
        JSON.stringify({ userId: fixtureIds.kien, sessionId: null }));
    native.query("INSERT INTO outbox(event_seq) VALUES(42)").run();
    native.close();
    runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: root }));
    expect(original).toHaveLength(12);
    expect(await runtime.db.all("SELECT * FROM schema_migrations WHERE id<>'006-f-portable' ORDER BY id")).toEqual(original);
    expect(await runtime.db.all("SELECT * FROM users ORDER BY id")).toEqual(users);
    expect(await runtime.db.all("SELECT * FROM document_states ORDER BY doc_id")).toEqual(documents);
    expect(await runtime.db.all("SELECT id,edit_order FROM suggestion_edits ORDER BY edit_order")).toEqual([
      { id: "z-last-by-id", edit_order: 0 }, { id: "a-first-by-id", edit_order: 1 },
    ]);
    expect(await runtime.db.all("PRAGMA foreign_key_check")).toEqual([]);
    expect(await runtime.db.get<{ value: number }>("SELECT value FROM event_counter")).toEqual({ value: 42 });
    const active = runtime;
    const next = await active.uow.run((tx) => active.events.record(tx, {
      topic: "session.revoked", aggregateId: fixtureIds.kien, payload: { userId: fixtureIds.kien, sessionId: null },
    }));
    expect(next.seq).toBe(43);
    const after = await runtime.db.all("SELECT * FROM schema_migrations ORDER BY id");
    await runtime.close();
    runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: root }));
    expect(await runtime.db.all("SELECT * FROM schema_migrations ORDER BY id")).toEqual(after);
    expect(await runtime.db.get<{ journal_mode: string }>("PRAGMA journal_mode")).toEqual({ journal_mode: "wal" });
    expect(await runtime.db.get<{ synchronous: number }>("PRAGMA synchronous")).toEqual({ synchronous: 2 });
    expect(await runtime.db.get<{ foreign_keys: number }>("PRAGMA foreign_keys")).toEqual({ foreign_keys: 1 });
  } finally {
    if (runtime) await runtime.close();
    await rm(root, { recursive: true, force: true });
    console.info("fixture.cleaned", root);
  }
});

test("changed migrations fail without rewriting receipts and missing dialects never fall back", async () => {
  const f = await fixture();
  try {
    const original = await foundationMigrations();
    const first = original[0];
    if (!first) throw new Error("Missing foundation migration");
    const before = await f.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id");
    await rejects(migrateDatabase(f.runtime.uow, [{ ...first, sql: `${first.sql}\n` }]), { code: "MIGRATION_CHANGED" });
    expect(await f.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id")).toEqual(before);
    expect(() => migrationSql({ id: first.id, sql: first.sql }, "postgres")).toThrow(first.id);
    expect(migrationSql({ ...first, postgres: "SELECT 42" }, "postgres")).toBe("SELECT 42");
    expect(migrationSql({ ...first, postgres: "SELECT 42" }, "sqlite")).toBe(first.sql);
  } finally { await f.close(); }
});

test("concurrent native migration calls serialize and record the additive DDL once", async () => {
  const f = await fixture();
  try {
    const migration = { id: "090-f-portable-test", sql: "CREATE TABLE migration_probe(id INTEGER PRIMARY KEY) STRICT" };
    await Promise.all([migrateDatabase(f.runtime.uow, [migration]), migrateDatabase(f.runtime.uow, [migration])]);
    expect(await f.runtime.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM schema_migrations WHERE id=?", [migration.id])).toEqual({ count: 1 });
  } finally { await f.close(); }
});
