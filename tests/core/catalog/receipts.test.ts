import { test } from "bun:test";
import { strict as assert } from "node:assert";
import type { ModuleContext } from "@quire/runtime";
import { Library, Templates } from "../../../services/core/catalog";
import { bib, catalogFixture } from "./harness";
import { fixtureIds } from "../../fixtures/foundation";

test("rolls back catalog creations with failed receipt insertion and persists successful receipts atomically", async () => {
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const root: ModuleContext = { ...fixture.runtime, routes: fixture.runtime.routes.forLane("K") };
  const receipt = { actorId: owner.user.id, key: crypto.randomUUID(), route: "catalog:receipt-test", digest: "test" };
  const context: ModuleContext = {
    ...root,
    uow: {
      run: work => root.uow.run(async tx => work({
        transaction: true,
        dialect: tx.dialect,
        lock: key => tx.lock(key),
        get: (sql, parameters) => tx.get(sql, parameters),
        all: (sql, parameters) => tx.all(sql, parameters),
        query: (sql, parameters, row) => tx.query(sql, parameters, row),
        exec: sql => tx.exec(sql),
        execute: (sql, parameters) => tx.execute(sql, parameters),
        run: async (sql, parameters) => {
          if (sql.includes("INSERT INTO idempotency_results")) throw new Error("catalog receipt fault");
          return tx.run(sql, parameters);
        },
      })),
    },
  };
  await assert.rejects(new Library(context).create(owner.user.id, { bibtex: bib, origin: "manual" }, receipt), /catalog receipt fault/);
  assert.equal((await new Library(root).list(owner.user.id)).length, 0);
  const fields = {
    name: "Receipt publication", category: "", description: "", license: "MIT",
    visibility: "private" as const, sourceProjectId: fixtureIds.project,
  };
  await assert.rejects(new Templates(context).create(owner.user.id, fields, receipt), /catalog receipt fault/);
  assert.equal((await root.db.all("SELECT id FROM templates")).length, 0);
  const version = await new Templates(root).create(owner.user.id, fields, receipt);
  const stored = await root.db.get<{ response_json: string }>(
    "SELECT response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?",
    [receipt.actorId, receipt.key, receipt.route]);
  assert(stored);
  assert.deepEqual(JSON.parse(stored.response_json), { data: version, etag: `"v${version.version}"` });
});
