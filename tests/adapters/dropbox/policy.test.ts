import { expect, test } from "bun:test";
import { fixtureIds } from "../../fixtures/foundation";
import { dropboxServer } from "./provider";
import { dropboxFixture, remotePath, scope, bounded } from "./harness";
import { localChange, localText } from "./local";

test("allows only outbound changes while the grant owner's project is archived", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await localChange(harness, { path: "outbound.txt", text: "before" });
  await harness.success("initialSync");
  await localChange(harness, { path: "outbound.txt", text: "after" });
  await harness.fixture.runtime.db.run(`INSERT INTO project_user_state(project_id,user_id,state,version,updated_at)
    VALUES(?,?,'archived',1,?) ON CONFLICT(project_id,user_id) DO UPDATE SET state='archived'`,
  [scope.projectId, harness.owner.user.id, harness.fixture.clock.now()]);
  provider.put(remotePath("inbound.txt"), "held remote source");
  // When
  await harness.success("sync");
  // Then
  expect(provider.text(remotePath("outbound.txt"))).toBe("after");
  expect(await localText(harness, "inbound.txt")).toBeNull();
});

test("applies delayed inbound edits when an archived project becomes active again", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await localChange(harness, { path: "held.txt", text: "before" });
  await harness.success("initialSync");
  await harness.fixture.runtime.db.run(`INSERT INTO project_user_state(project_id,user_id,state,version,updated_at)
    VALUES(?,?,'archived',1,?) ON CONFLICT(project_id,user_id) DO UPDATE SET state='archived'`,
  [scope.projectId, harness.owner.user.id, harness.fixture.clock.now()]);
  provider.put(remotePath("held.txt"), "remote edit");
  await harness.success("sync");
  await harness.fixture.runtime.db.run("UPDATE project_user_state SET state='active' WHERE project_id=? AND user_id=?",
    [scope.projectId, harness.owner.user.id]);
  // When
  await harness.success("sync");
  // Then
  expect(await localText(harness, "held.txt")).toBe("remote edit");
});

test("denies synchronization before HTTP dispatch when project policy disables Dropbox", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.integration.policies.set({ actorId: harness.owner.user.id,
    scope: { kind: "project", id: scope.projectId }, enabled: false, expectedVersion: 0 });
  const count = provider.observed.length;
  // When
  const response = await harness.action("initialSync");
  // Then
  expect(response.status).toBe(403);
  expect(provider.observed.length).toBe(count);
});

test("organization deny wins over project allow when a current member syncs", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.integration.policies.set({ actorId: fixtureIds.kien,
    scope: { kind: "organization", id: fixtureIds.team }, enabled: false, expectedVersion: 0 });
  await harness.integration.policies.set({ actorId: fixtureIds.kien,
    scope: { kind: "project", id: scope.projectId }, enabled: true, expectedVersion: 0 });
  // When
  const response = await harness.action("initialSync");
  // Then
  expect(response.status).toBe(403);
});

test("discards late inbound source when project policy is revoked during download", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.success("initialSync");
  provider.put(remotePath("blocked.txt"), "not published");
  const barrier = provider.pause("/2/files/download");
  const pending = harness.action("sync");
  await bounded(barrier.entered);
  await harness.integration.policies.set({ actorId: harness.owner.user.id,
    scope: { kind: "project", id: scope.projectId }, enabled: false, expectedVersion: 0 });
  // When
  barrier.release();
  const response = await pending;
  // Then
  expect(response.status).toBe(403);
  expect(await localText(harness, "blocked.txt")).toBeNull();
});

test("fences persisted source publication when grant ciphertext is revoked in flight", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.success("initialSync");
  provider.put(remotePath("revoked.txt"), "not published");
  const barrier = provider.pause("/2/files/download");
  const pending = harness.action("sync");
  await bounded(barrier.entered);
  await harness.fixture.runtime.db.run("UPDATE provider_grants SET state='disabled',encrypted_secret=NULL,version=version+1 WHERE id=?", [harness.grant.id]);
  // When
  barrier.release();
  const response = await pending;
  // Then
  expect(response.status).toBe(503);
  expect(await localText(harness, "revoked.txt")).toBeNull();
});
