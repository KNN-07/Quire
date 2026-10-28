import { expect, test } from "bun:test";
import { z } from "zod";
import { dropboxServer } from "./provider";
import { dropboxFixture, remotePath, scope, bounded } from "./harness";
import { localChange, localText } from "./local";

test("preserves newer local source as conflict copies when a prepared import becomes stale before restart", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await localChange(harness, { path: "stale.txt", text: "base" });
  await harness.success("initialSync");
  provider.put(remotePath("stale.txt"), "prepared remote");
  await harness.fixture.runtime.db.exec(`CREATE TRIGGER fail_stale_import BEFORE INSERT ON repository_intents
    BEGIN SELECT RAISE(ABORT,'injected pre-publication failure'); END;`);
  expect((await harness.action("sync")).status).toBe(502);
  await harness.fixture.runtime.db.exec("DROP TRIGGER fail_stale_import");
  await localChange(harness, { path: "stale.txt", text: "newer local" });
  // When
  await harness.restart();
  // Then
  expect(harness.integration.recoveryFailures).toEqual([]);
  expect(await localText(harness, "stale.txt")).toBe("newer local");
  const copy = (await harness.fixture.service.listFiles(scope)).find(file => file.path.startsWith("stale.txt.dropbox-recovery-"));
  if (!copy) throw new TypeError("Stale recovery copy missing");
  expect(await localText(harness, copy.path)).toBe("prepared remote");
  await harness.fixture.runtime.repositories.assertReadable(scope.projectId);
});

test("returns the durable receipt without remote redispatch when an action key is replayed", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  const key = crypto.randomUUID();
  const original = await harness.success("initialSync", { key });
  const count = provider.observed.length;
  // When
  const replay = await harness.success("initialSync", { key, expectedCursor: null });
  // Then
  expect(replay.id).toBe(original.id);
  expect(provider.observed.length).toBe(count);
});

test("rejects a stale action cursor before any Dropbox request", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.success("initialSync");
  await harness.success("sync");
  const count = provider.observed.length;
  // When
  const response = await harness.action("sync", { expectedCursor: "stale-cursor" });
  // Then
  expect(response.status).toBe(409);
  expect(provider.observed.length).toBe(count);
});

test("preserves edited local bytes when Dropbox concurrently deletes the same file", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await localChange(harness, { path: "keep.txt", text: "base" });
  await harness.success("initialSync");
  await localChange(harness, { path: "keep.txt", text: "local edit" });
  provider.remove(remotePath("keep.txt"));
  // When
  const operation = await harness.success("sync");
  // Then
  expect(await localText(harness, "keep.txt")).toBe("local edit");
  expect(z.object({ conflicts: z.array(z.object({ kind: z.string() })) }).parse(operation.result).conflicts[0]?.kind).toBe("delete");
  expect(provider.text(remotePath("keep.txt"))).toBeNull();
});

test("rejects a conditional delete when the provider revision changes after listing", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await localChange(harness, { path: "delete-race.txt", text: "base" });
  await harness.success("initialSync");
  await localChange(harness, { path: "delete-race.txt", text: null });
  const barrier = provider.pause("/2/files/delete_v2");
  const pending = harness.action("sync");
  await bounded(barrier.entered);
  provider.put(remotePath("delete-race.txt"), "new remote revision");
  // When
  barrier.release();
  const response = await pending;
  // Then
  expect(response.status).toBe(409);
  expect(provider.text(remotePath("delete-race.txt"))).toBe("new remote revision");
});
