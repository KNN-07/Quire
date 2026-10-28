import { describe, expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { Database } from "bun:sqlite";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import type { Transaction } from "@quire/contracts";
import { fixture, barrier } from "./fixture";

describe("portable SQLite transaction ownership", () => {
  test("awaited writes roll back and expired callback executors cannot escape", async () => {
    const f = await fixture();
    try {
      await f.runtime.db.exec("CREATE TABLE probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT");
      let escaped: Transaction | undefined;
      await rejects(f.runtime.uow.run(async (tx) => {
        escaped = tx;
        await tx.run("INSERT INTO probe VALUES(?,?)", [1, "rollback"]);
        expect(await tx.get<{ value: string }>("SELECT value FROM probe WHERE id=?", [1])).toEqual({ value: "rollback" });
        throw new Error("abort");
      }), /abort/);
      expect(await f.runtime.db.all("SELECT * FROM probe")).toEqual([]);
      if (!escaped) throw new Error("Transaction did not start");
      await rejects(escaped.run("INSERT INTO probe VALUES(2,'escaped')"), { code: "TRANSACTION_CLOSED" });
      await f.runtime.uow.run(async (tx) => { await tx.run("INSERT INTO probe VALUES(3,'committed')"); });
      expect(await f.runtime.db.get<{ id: number }>("SELECT id FROM probe")).toEqual({ id: 3 });
    } finally { await f.close(); }
  });

  test("unrelated root readers and writers queue outside an async rollback", async () => {
    const f = await fixture();
    const entered = barrier();
    const release = barrier();
    try {
      await f.runtime.db.exec("CREATE TABLE probe(id INTEGER PRIMARY KEY) STRICT");
      const transaction = f.runtime.uow.run(async (tx) => {
        await tx.run("INSERT INTO probe VALUES(1)");
        entered.release();
        await release.promise;
        throw new Error("rollback");
      });
      const rejected = rejects(transaction, /rollback/);
      await entered.promise;
      const reader = f.runtime.db.all("SELECT id FROM probe");
      const writer = f.runtime.db.run("INSERT INTO probe VALUES(2)");
      release.release();
      await rejected;
      expect(await reader).toEqual([]);
      expect(await writer).toEqual({ changes: 1 });
      expect(await f.runtime.db.all("SELECT id FROM probe")).toEqual([{ id: 2 }]);
    } finally { release.release(); await f.close(); }
  });

  test("root helper mistakes and nested transactions fail instead of deadlocking", async () => {
    const f = await fixture();
    try {
      await f.runtime.uow.run(async (tx) => {
        await rejects(f.runtime.db.get("SELECT 1"), { code: "ROOT_SQL_IN_TRANSACTION" });
        await rejects(f.runtime.uow.run(async () => undefined), { code: "ROOT_SQL_IN_TRANSACTION" });
        await tx.lock("one");
        expect(await tx.get<{ value: number }>("SELECT 1 AS value")).toEqual({ value: 1 });
      });
    } finally { await f.close(); }
  });

  test("awaitable close drains admitted work and rejects new root operations", async () => {
    const f = await fixture();
    const entered = barrier();
    const release = barrier();
    try {
      const transaction = f.runtime.uow.run(async (tx) => {
        entered.release();
        await release.promise;
        return tx.get<{ value: number }>("SELECT 2 AS value");
      });
      await entered.promise;
      const closing = f.runtime.close();
      release.release();
      expect(await transaction).toEqual({ value: 2 });
      await closing;
      await rejects(f.runtime.db.get("SELECT 1"), { code: "DATABASE_CLOSED" });
    } finally { release.release(); await f.close(); }
  });

  test("closing releases evicted statements and checkpoints the standalone database", async () => {
    const f = await fixture();
    try {
      await f.runtime.db.exec("CREATE TABLE close_probe(value TEXT NOT NULL) STRICT");
      await f.runtime.db.run("INSERT INTO close_probe VALUES(?)", ["durable"]);
      for (let i = 0; i < 50; i++) await f.runtime.db.get(`SELECT ${i} AS value`);
      await f.runtime.close();
      const copied = join(f.root, "closed-copy.sqlite");
      await cp(join(f.root, "quire.sqlite"), copied);
      const native = new Database(copied, { readonly: true });
      try {
        expect(native.query<{ value: string }, []>("SELECT value FROM close_probe").get()).toEqual({ value: "durable" });
      } finally { native.close(true); }
    } finally { await f.close(); }
  });
});
