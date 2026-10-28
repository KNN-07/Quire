import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntime, loadConfig, migrationSql } from "@quire/runtime";
import { migrations } from "../../../services/core/catalog";

test("preserves accepted catalog SQLite digest and applied rows with an explicit PostgreSQL variant", async () => {
  const path = await mkdtemp(join(tmpdir(), "quire-p1s-catalog-migration-"));
  try {
    await cp(new URL("../../fixtures/portable-baseline.sqlite.fixture", import.meta.url), join(path, "quire.sqlite"));
    const native = new Database(join(path, "quire.sqlite"), { strict: true });
    const statement = native.query<Record<string, unknown>, []>("SELECT * FROM schema_migrations ORDER BY id");
    let original: Record<string, unknown>[];
    try { original = statement.all(); } finally { statement.finalize(); native.close(true); }
    const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: path }), {
      modules: [{ id: "catalog-migration-proof", lane: "K", order: 24, migrations, register: () => undefined }],
    });
    try {
      expect(original).toHaveLength(12);
      expect(await runtime.db.all("SELECT * FROM schema_migrations WHERE id <> '006-f-portable' ORDER BY id")).toEqual(original);
      expect(await runtime.db.all("PRAGMA foreign_key_check")).toEqual([]);
      for (const migration of migrations) {
        if (!migration.postgres) throw new Error(`Missing PostgreSQL variant: ${migration.id}`);
        expect(migrationSql(migration, "sqlite")).toBe(migration.sql);
        expect(migrationSql(migration, "postgres")).toBe(migration.postgres);
      }
    } finally { await runtime.close(); }
  } finally {
    await rm(path, { recursive: true, force: true });
    console.info("catalog.migration.cleaned", path);
  }
});
