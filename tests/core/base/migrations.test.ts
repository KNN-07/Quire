import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntime, loadConfig, migrationSql } from "@quire/runtime";
import { migrations } from "../../../services/core/base";

test("accepted SQLite migrations and source rows survive additive base migration", async () => {
  const path = await mkdtemp(join(tmpdir(), "quire-p1s-core-base-migration-"));
  try {
    await cp(new URL("../../fixtures/portable-baseline.sqlite.fixture", import.meta.url), join(path, "quire.sqlite"));
    const native = new Database(join(path, "quire.sqlite"), { strict: true });
    const capture = (sql: string) => {
      const statement = native.query<Record<string, unknown>, []>(sql);
      try { return statement.all(); } finally { statement.finalize(); }
    };
    const original = capture("SELECT * FROM schema_migrations ORDER BY id");
    const projects = capture("SELECT * FROM projects ORDER BY id");
    const files = capture("SELECT * FROM files ORDER BY branch_id,id");
    const documents = capture("SELECT * FROM document_states ORDER BY doc_id");
    native.close(true);
    const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: path }), {
      modules: [{
        id: "base-migration-proof", lane: "K", order: 21, migrations, register: () => undefined,
      }]
    });
    try {
      expect(original).toHaveLength(12);
      expect(await runtime.db.all(`SELECT * FROM schema_migrations
        WHERE id NOT IN ('006-f-portable','026-k-base-portable-intents') ORDER BY id`)).toEqual(original);
      expect(await runtime.db.all("SELECT * FROM projects ORDER BY id")).toEqual(projects);
      expect(await runtime.db.all("SELECT * FROM files ORDER BY branch_id,id")).toEqual(files);
      expect(await runtime.db.all("SELECT * FROM document_states ORDER BY doc_id")).toEqual(documents);
      expect(await runtime.db.all("PRAGMA foreign_key_check")).toEqual([]);
      for (const migration of migrations) {
        if (!migration.postgres) throw new Error(`Missing PostgreSQL variant: ${migration.id}`);
        expect(migrationSql(migration, "postgres")).toBe(migration.postgres);
        expect(migrationSql(migration, "sqlite")).toBe(migration.sql);
      }
    } finally { await runtime.close(); }
  } finally { await rm(path, { recursive: true, force: true }); }
});
