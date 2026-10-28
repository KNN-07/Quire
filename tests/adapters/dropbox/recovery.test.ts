import { expect, test } from "bun:test";
import { z } from "zod";
import { dropboxServer } from "./provider";
import { dropboxFixture, remotePath, scope, bounded } from "./harness";
import { localChange, localText } from "./local";

test("reconciles an uncertain remote upload without repeating it after restart", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.success("initialSync");
  await localChange(harness, { path: "uncertain.txt", text: "durable bytes" });
  provider.failNext("/2/files/upload", 500, true);
  const failed = await harness.action("sync");
  expect(failed.status).toBe(502);
  const count = provider.uploads;
  // When
  await harness.restart();
  // Then
  expect(provider.uploads).toBe(count);
  expect(provider.text(remotePath("uncertain.txt"))).toBe("durable bytes");
  expect(await localText(harness, "uncertain.txt")).toBe("durable bytes");
  expect(harness.integration.recoveryFailures).toEqual([]);
});

test("recovers prepared Git and original operation receipts when publication SQL rolls back", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.success("initialSync");
  const migrationsBefore = await harness.fixture.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id");
  const cursorBefore = await harness.fixture.runtime.db.all("SELECT * FROM adapter_cursors ORDER BY action");
  const key = crypto.randomUUID();
  provider.put(remotePath("recover.txt"), "from remote");
  await harness.fixture.runtime.db.exec(`CREATE TRIGGER fail_dropbox_publication BEFORE UPDATE ON operations
    WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'injected publication rollback'); END;`);
  const failure = await harness.action("sync", { key });
  expect(failure.status).toBe(502);
  expect(await localText(harness, "recover.txt")).toBeNull();
  expect(await harness.fixture.runtime.db.all("SELECT * FROM adapter_cursors ORDER BY action")).toEqual(cursorBefore);
  await harness.fixture.runtime.db.exec("DROP TRIGGER fail_dropbox_publication");
  // When
  await harness.restart();
  // Then
  expect(await localText(harness, "recover.txt")).toBe("from remote");
  expect(harness.integration.recoveryFailures).toEqual([]);
  expect(await harness.fixture.runtime.db.get<{ status: string }>("SELECT status FROM operations WHERE idempotency_key=?", [key]))
    .toEqual({ status: "succeeded" });
  expect(await harness.fixture.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id")).toEqual(migrationsBefore);
  await harness.fixture.runtime.repositories.assertReadable(scope.projectId);
});

test("honors persisted Retry-After before retrying after a controlled clock advance", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.success("initialSync");
  provider.failNext("/2/files/list_folder/continue", 429);
  expect((await harness.action("sync")).status).toBe(409);
  const count = provider.observed.length;
  await harness.restart();
  expect((await harness.action("sync")).status).toBe(409);
  expect(provider.observed.length).toBe(count);
  harness.fixture.clock.advance(30_000); provider.oauth.advance(30_000);
  // When
  await harness.success("sync");
  // Then
  expect(provider.observed.length).toBeGreaterThan(count);
});

test("rejects stale remote revision writes when a concurrent edit wins the Dropbox CAS", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await localChange(harness, { path: "race.txt", text: "base" });
  await harness.success("initialSync");
  await localChange(harness, { path: "race.txt", text: "local" });
  const barrier = provider.pause("/2/files/upload");
  const pending = harness.action("sync");
  await bounded(barrier.entered);
  provider.put(remotePath("race.txt"), "concurrent remote");
  barrier.release();
  expect((await pending).status).toBe(409);
  // When
  const recovered = await harness.success("sync");
  // Then
  expect(provider.text(remotePath("race.txt"))).toBe("concurrent remote");
  expect(await localText(harness, "race.txt")).toBe("local");
  expect(z.object({ conflicts: z.array(z.object({ kind: z.string() })) }).parse(recovered.result).conflicts[0]?.kind).toBe("content");
});
