import { test } from "bun:test";
import { Database } from "bun:sqlite";
import { strict as assert } from "node:assert";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntime, loadConfig, migrateDatabase } from "@quire/runtime";
import { seed } from "../../scripts/seed";
import { migrations } from "../../services/compiler/store";
import { fixtureIds as ids, settings, fixturePassword } from "./fixtures";

test("compiler migration retains SQLite digests and explicit original queue ordering", async () => {
  const root = await mkdtemp(join(tmpdir(), "quire-p1s-compiler-migration-"));
  const original = migrations.find(item => item.id === "030-c-compiler");
  assert(original);
  const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: root }), {
    modules: [{ id: "030-c-compiler", lane: "C", order: 30, migrations: [original], register: () => {} }],
  });
  try {
    await seed(runtime, fixturePassword);
    const old = await runtime.db.all("SELECT * FROM schema_migrations ORDER BY id");
    for (const id of ["ffffffff-ffff-4fff-8fff-ffffffffffff", "00000000-0000-4000-8000-000000000099"]) {
      await runtime.db.run(`INSERT INTO compile_jobs(id,actor_id,snapshot_id,environment_id,settings_json,status,queued_at,idempotency_key)
        VALUES(?,?,?,?,?,'succeeded',?,?)`, [id, ids.kien, ids.snapshot, ids.environment, JSON.stringify(settings), runtime.clock.now(), id]);
    }
    const jobs = await runtime.db.all<{ id: string; order: number }>("SELECT id,rowid AS \"order\" FROM compile_jobs ORDER BY rowid");
    await migrateDatabase(runtime.uow, migrations);
    assert.deepEqual(await runtime.db.all("SELECT * FROM schema_migrations WHERE id<>? ORDER BY id", ["031-c-portable"]), old);
    assert.deepEqual(await runtime.db.all("SELECT id,queue_order AS \"order\" FROM compile_jobs ORDER BY queue_order"), jobs);
    assert.equal((await runtime.db.get<{ value: number }>("SELECT value FROM compiler_queue_counter"))?.value, jobs.at(-1)?.order);
    const applied = await runtime.db.all("SELECT * FROM schema_migrations ORDER BY id");
    await migrateDatabase(runtime.uow, migrations);
    assert.deepEqual(await runtime.db.all("SELECT * FROM schema_migrations ORDER BY id"), applied);
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
});

test("compiler reopens the accepted native baseline without rewriting original migration receipts", async () => {
  const fixture = new URL("../fixtures/portable-baseline.sqlite.fixture", import.meta.url).pathname;
  const native = new Database(fixture, { readonly: true });
  const receipts = native.query("SELECT * FROM schema_migrations ORDER BY id").all();
  const users = native.query("SELECT * FROM users ORDER BY id").all();
  native.close(true);
  const root = await mkdtemp(join(tmpdir(), "quire-p1s-compiler-baseline-"));
  try {
    await copyFile(fixture, join(root, "quire.sqlite"));
    const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: root }), {
      modules: [{ id: "030-c-compiler", lane: "C", order: 30, migrations, register: () => {} }],
    });
    try {
      assert.deepEqual(await runtime.db.all("SELECT * FROM schema_migrations WHERE id NOT IN (?,?) ORDER BY id",
        ["006-f-portable", "031-c-portable"]), receipts);
      assert.deepEqual(await runtime.db.all("SELECT * FROM users ORDER BY id"), users);
    } finally { await runtime.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
