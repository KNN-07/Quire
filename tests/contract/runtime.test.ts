import { expect, test } from "bun:test";
import { writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, migrateDatabase, StorageError, ServiceError } from "@quire/runtime";
import { fixtureIds as ids } from "../fixtures/foundation";
import { isolatedData, runtimeFixture } from "../fixtures/runtime";

test("uses durable connection settings when SQLite opens", async () => {
  // Given: a newly opened foundation database.
  await using fixture = await runtimeFixture();
  // When: its effective connection policy is queried.
  const actual = [
    await fixture.db.get("PRAGMA journal_mode"),
    await fixture.db.get("PRAGMA foreign_keys"),
    await fixture.db.get("PRAGMA synchronous"),
  ];
  // Then: WAL, referential integrity and full durability are active.
  expect(actual).toEqual([{ journal_mode: "wal" }, { foreign_keys: 1 }, { synchronous: 2 }]);
});
test("retains blobs and key when the database is reopened", async () => {
  // Given: a fresh owned data directory.
  await using sandbox = await isolatedData();
  const first = await createRuntime(sandbox.config);
  const bytes = new TextEncoder().encode("persistent bytes 😀");
  // When: durable data is written and the runtime is reopened.
  const digest = await first.blobs.put(bytes);
  const key = first.secretKey;
  await first.close();
  const second = await createRuntime(sandbox.config);
  try {
    // Then: both bytes and encryption identity survive.
    expect(await second.blobs.get(digest)).toEqual(bytes);
    expect(second.secretKey).toEqual(key);
    expect((await stat(join(sandbox.path, "secret.key"))).mode & 0o777).toBe(0o600);
  } finally { await second.close(); }
});
test("rolls back SQL and outbox when a transaction fails", async () => {
  // Given: a real SQLite transaction and subscribed event listener.
  await using fixture = await runtimeFixture();
  const events: number[] = [];
  const unsubscribe = fixture.events.subscribe((event) => { events.push(event.seq); });
  // When: a change fails before commit.
  const failure = await fixture.uow.run(async (tx) => {
    await fixture.events.record(tx, { topic: "tree.changed", aggregateId: ids.project, payload: { resourceId: ids.project, version: 1 } });
    throw new StorageError("TEST_ROLLBACK", "fixture");
  }).then(() => null, (error: unknown) => error);
  expect(failure).toBeInstanceOf(StorageError);
  await fixture.events.dispatch();
  unsubscribe();
  // Then: neither replay nor live delivery exposes uncommitted state.
  expect(await fixture.events.read(0)).toEqual([]);
  expect(events).toEqual([]);
});
test("delivers committed events when the outbox is dispatched", async () => {
  // Given: a subscriber installed before the mutation.
  await using fixture = await runtimeFixture();
  const seen: number[] = [];
  const unsubscribe = fixture.events.subscribe((event) => { seen.push(event.seq); });
  // When: the aggregate mutation and outbox commit.
  const event = await fixture.uow.run((tx) => fixture.events.record(tx, {
    topic: "document.saved", aggregateId: ids.project, payload: { resourceId: ids.mainFile, revision: 1, epoch: 0 },
  }));
  await fixture.events.dispatch();
  unsubscribe();
  // Then: delivery and durable replay refer to the same sequence.
  expect(seen).toEqual([event.seq]);
  expect(await fixture.events.read(0)).toEqual([event]);
});
test("refuses changed migrations when an applied migration is edited", async () => {
  // Given: an already migrated database.
  await using fixture = await runtimeFixture();
  // When: the same migration ID is supplied with different SQL.
  const failure = await migrateDatabase(fixture.uow, [{ id: "001-f-identity", sql: "SELECT 1;" }])
    .then(() => null, (error: unknown) => error);
  // Then: immutable migration history is enforced.
  expect(failure).toMatchObject({ code: "MIGRATION_CHANGED" });
});
test("detects damaged blob bytes when content is retrieved", async () => {
  // Given: a blob stored under its content digest.
  await using fixture = await runtimeFixture();
  const hash = await fixture.blobs.put(new TextEncoder().encode("original"));
  const path = join(fixture.config.dataDir, "blobs", hash.slice(0, 2), hash);
  // When: the disk content is corrupted outside the blob store.
  await writeFile(path, "damaged");
  // Then: corrupt bytes never pass as the referenced immutable object.
  const failure = await fixture.blobs.get(hash).then(() => null, (error: unknown) => error);
  expect(failure).toMatchObject({ code: "BLOB_CORRUPTED" });
});
test("exposes unavailable services when no feature module is registered", async () => {
  // Given: the foundation with no compiler implementation.
  await using fixture = await runtimeFixture();
  // When: a consumer resolves the compiler port.
  const resolve = () => fixture.services.get("compiler");
  // Then: absence is an explicit unavailable error, not a success stub.
  expect(resolve).toThrow(ServiceError);
});
