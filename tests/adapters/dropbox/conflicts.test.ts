import { expect, test } from "bun:test";
import { z } from "zod";
import { dropboxServer } from "./provider";
import { dropboxFixture, remotePath, scope } from "./harness";
import { localChange, localText } from "./local";

test("keeps both versions as persisted source when local and remote content diverge", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await localChange(harness, { path: "conflict.txt", text: "base" });
  await harness.success("initialSync");
  await localChange(harness, { path: "conflict.txt", text: "local" });
  provider.put(remotePath("conflict.txt"), "remote");
  // When
  const result = await harness.success("sync");
  // Then
  expect(await localText(harness, "conflict.txt")).toBe("local");
  expect(provider.text(remotePath("conflict.txt"))).toBe("remote");
  const copy = (await harness.fixture.service.listFiles(scope)).find(file => file.path.startsWith("conflict.txt.dropbox-conflict-"));
  if (!copy) throw new TypeError("Conflict copy missing");
  expect(await localText(harness, copy.path)).toBe("remote");
  expect(z.object({ conflicts: z.array(z.object({ kind: z.string() })) }).parse(result.result).conflicts[0]?.kind).toBe("content");
  await harness.fixture.restart();
  expect(await localText(harness, copy.path)).toBe("remote");
});

test("records explicit rename metadata without replacing local paths when Dropbox renames a file", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await localChange(harness, { path: "before.txt", text: "retained" });
  await harness.success("initialSync");
  provider.rename(remotePath("before.txt"), remotePath("after.txt"));
  // When
  const result = await harness.success("sync");
  // Then
  expect(await localText(harness, "before.txt")).toBe("retained");
  const conflicts = z.object({ conflicts: z.array(z.object({ kind: z.string(), path: z.string(), remotePath: z.string().nullable() })) })
    .parse(result.result).conflicts;
  expect(conflicts).toContainEqual(expect.objectContaining({ kind: "rename", path: "before.txt", remotePath: "after.txt" }));
});

test("preserves the remote edit when a locally deleted file changes remotely", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await localChange(harness, { path: "deleted.txt", text: "base" });
  await harness.success("initialSync");
  await localChange(harness, { path: "deleted.txt", text: null });
  provider.put(remotePath("deleted.txt"), "remote edit");
  // When
  const result = await harness.success("sync");
  // Then
  expect(provider.text(remotePath("deleted.txt"))).toBe("remote edit");
  expect(z.object({ conflicts: z.array(z.object({ kind: z.string() })) }).parse(result.result).conflicts[0]?.kind).toBe("delete");
  const copy = (await harness.fixture.service.listFiles(scope)).find(file => file.path.startsWith("deleted.txt.dropbox-conflict-"));
  if (!copy) throw new TypeError("Deleted-file conflict copy missing");
  expect(await localText(harness, copy.path)).toBe("remote edit");
});

test("retains the required main document when Dropbox deletes it", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.success("initialSync");
  const original = await localText(harness, "main.tex");
  provider.remove(remotePath("main.tex"));
  // When
  const result = await harness.success("sync");
  // Then
  expect(await localText(harness, "main.tex")).toBe(original);
  expect(z.object({ conflicts: z.array(z.object({ kind: z.string() })) }).parse(result.result).conflicts[0]?.kind).toBe("main-delete");
});
