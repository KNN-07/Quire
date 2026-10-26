import { expect, test } from "bun:test";
import { z } from "zod";
import { fixtureIds as ids } from "../fixtures/foundation";
import { runtimeFixture } from "../fixtures/runtime";
import { StorageError } from "@quire/runtime";

test("commits asynchronous SQL and outbox when the portable callback completes", async () => {
  // Given: the common async transaction port backed by SQLite.
  await using fixture = await runtimeFixture();
  // When: a row and its event are changed in one callback using only transaction awaits.
  const event = await fixture.uow.run(async (tx) => {
    await tx.execute("INSERT INTO operator_settings(key,value_json,updated_at) VALUES(?,?,?)", ["test", "1", fixture.clock.now()]);
    return fixture.events.record(tx, { topic: "policy.changed", aggregateId: ids.project,
      payload: { resourceId: ids.project, version: 1 } });
  });
  // Then: the state and durable notification both become visible.
  expect(fixture.db.query("SELECT value_json FROM operator_settings WHERE key='test'").get()).toEqual({ value_json: "1" });
  expect(await fixture.events.read(0)).toEqual([event]);
});
test("rolls back asynchronous SQL when the portable callback rejects", async () => {
  // Given: a transaction that has already performed a write.
  await using fixture = await runtimeFixture();
  // When: a later step in the same callback fails.
  const result = fixture.uow.run(async (tx) => {
    await tx.execute("INSERT INTO operator_settings(key,value_json,updated_at) VALUES(?,?,?)", ["test", "1", fixture.clock.now()]);
    throw new StorageError("TEST_FAILURE", "transaction");
  });
  // Then: the failure reaches the caller and no partial row survives.
  const failure = await result.then(() => null, (error: unknown) => error);
  expect(failure).toMatchObject({ code: "TEST_FAILURE" });
  expect(fixture.db.query("SELECT * FROM operator_settings").all()).toEqual([]);
});
test("serializes writers when async transactions enter concurrently", async () => {
  // Given: two transactions submitted without waiting for the first.
  await using fixture = await runtimeFixture();
  // When: both modify the same counter.
  await Promise.all([1, 2].map((index) => fixture.uow.run(async (tx) => {
    if (index === 1) await tx.execute("INSERT INTO operator_settings(key,value_json,updated_at) VALUES(?,?,?)", ["counter", "0", fixture.clock.now()]);
    const [row] = z.tuple([z.strictObject({ value_json: z.string() })]).parse(
      await tx.query("SELECT value_json FROM operator_settings WHERE key=?", ["counter"], z.strictObject({ value_json: z.string() })));
    await tx.execute("UPDATE operator_settings SET value_json=? WHERE key=?", [String(Number(row.value_json) + 1), "counter"]);
  })));
  // Then: the second writer observes the first committed value.
  expect(fixture.db.query("SELECT value_json FROM operator_settings WHERE key='counter'").get()).toEqual({ value_json: "2" });
});
