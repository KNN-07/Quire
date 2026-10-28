import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrateDatabase, SqliteExecutor, SqliteUnitOfWork } from "@quire/runtime";
import { migrations } from "../../../services/core/review";

test("backfills explicit history order from the accepted native snapshot order", async () => {
  const native = new Database(":memory:");
  const db = new SqliteExecutor(native);
  const uow = new SqliteUnitOfWork(native);
  try {
    await db.exec("CREATE TABLE snapshots(id TEXT PRIMARY KEY); CREATE TABLE history_versions(id TEXT PRIMARY KEY,snapshot_id TEXT);");
    await db.run("INSERT INTO snapshots(id) VALUES(?),(?),(?)", ["z", "a", "m"]);
    await db.run("INSERT INTO history_versions(id,snapshot_id) VALUES(?,?),(?,?)", ["last", "m", "first", "z"]);
    await migrateDatabase(uow, [migrations[1]]);
    expect(await db.all("SELECT id,history_order FROM history_versions ORDER BY history_order")).toEqual([
      { id: "first", history_order: 1 }, { id: "last", history_order: 3 },
    ]);
    await migrateDatabase(uow, [migrations[1]]);
    expect(await db.all("SELECT id,history_order FROM history_versions ORDER BY history_order")).toEqual([
      { id: "first", history_order: 1 }, { id: "last", history_order: 3 },
    ]);
  } finally { await db.close(); }
});
