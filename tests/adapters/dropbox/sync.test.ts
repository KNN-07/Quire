import { expect, test } from "bun:test";
import { dropboxServer } from "./provider";
import { dropboxFixture, remotePath, scope } from "./harness";
import { localChange, localText } from "./local";

test("uploads actual project bytes when initialSync is configured", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  const before = await localText(harness, "main.tex");
  // When
  const operation = await harness.success("initialSync");
  // Then
  expect(operation.status).toBe("succeeded");
  expect(provider.text(remotePath("main.tex"))).toBe(before);
  expect(provider.uploads).toBe(6);
  expect(await harness.fixture.runtime.db.get("SELECT 1 FROM dropbox_sync WHERE grant_id=?", [harness.grant.id])).not.toBeNull();
});

test("persists inbound additions when Dropbox cursor changes", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.success("initialSync");
  provider.put(remotePath("new.tex"), "first version");
  // When
  await harness.success("sync");
  // Then
  await harness.fixture.restart();
  expect(await localText(harness, "new.tex")).toBe("first version");
});

test("persists inbound edits when Dropbox revision changes", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  provider.put(remotePath("new.tex"), "first version");
  await harness.success("initialSync");
  provider.put(remotePath("new.tex"), "updated version");
  // When
  await harness.success("sync");
  // Then
  expect(await localText(harness, "new.tex")).toBe("updated version");
});

test("persists inbound deletions when Dropbox removes a file", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  provider.put(remotePath("new.tex"), "first version");
  await harness.success("initialSync");
  provider.remove(remotePath("new.tex"));
  // When
  await harness.success("sync");
  // Then
  await harness.fixture.restart();
  expect(await localText(harness, "new.tex")).toBeNull();
});

test("conditionally publishes local edits when the remote base is unchanged", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await localChange(harness, { path: "local.txt", text: "original" });
  await harness.success("initialSync");
  await localChange(harness, { path: "local.txt", text: "edited" });
  // When
  await harness.success("sync");
  // Then
  expect(provider.text(remotePath("local.txt"))).toBe("edited");
});

test("conditionally deletes remote files when a local file is removed", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await localChange(harness, { path: "local.txt", text: "original" });
  await harness.success("initialSync");
  await localChange(harness, { path: "local.txt", text: null });
  // When
  await harness.success("sync");
  // Then
  expect(provider.deletes).toBe(1);
});

test("rescans without losing source history when a paginated cursor resets", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.success("initialSync");
  for (let index = 0; index < 5; index++) provider.put(remotePath(`reset-${index}.txt`), `entry ${index}`);
  provider.resetCursor();
  // When
  await harness.success("sync");
  // Then
  const files = await harness.fixture.service.listFiles(scope);
  expect(files.filter(file => file.path.startsWith("reset-")).length).toBe(5);
  expect(provider.observed.filter(route => route === "/2/files/list_folder").length).toBe(2);
  await harness.fixture.runtime.repositories.assertReadable(scope.projectId);
});

test("ignores generated namespaces but retains PDF source assets when generated output is off", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  provider.put(remotePath(".quire-generated/output.pdf"), "generated");
  provider.put(remotePath("figures/plot.pdf"), "source figure");
  // When
  await harness.success("initialSync");
  // Then
  expect(await localText(harness, ".quire-generated/output.pdf")).toBeNull();
  expect(await localText(harness, "figures/plot.pdf")).toBe("source figure");
});
