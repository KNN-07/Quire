import { test, expect } from "bun:test";
import { z } from "zod";
import { ProjectSummarySchema, ProjectSchema, OperationSchema } from "@quire/contracts";
import { baseFixture, clock } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("serializes dashboard tags for only the requesting actor without a list ETag", async () => {
  // Given: two collaborators with distinct private tags on the same project.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const viewer = await fixture.login("alex@quire.local");
  const ownerTag = crypto.randomUUID();
  const viewerTag = crypto.randomUUID();
  fixture.runtime.uow.local((tx) => {
    tx.query("INSERT INTO tags(id,user_id,name,color_hex,created_at) VALUES(?,?,?,'#123456',?)")
      .run(ownerTag, owner.user.id, "Owner tag", clock.now());
    tx.query("INSERT INTO tags(id,user_id,name,color_hex,created_at) VALUES(?,?,?,'#654321',?)")
      .run(viewerTag, viewer.user.id, "Viewer tag", clock.now());
    tx.query("INSERT INTO tag_assignments(tag_id,project_id) VALUES(?,?)").run(ownerTag, ids.project);
    tx.query("INSERT INTO tag_assignments(tag_id,project_id) VALUES(?,?)").run(viewerTag, ids.project);
  });
  // When: each actor reads the shared dashboard.
  const responses = await Promise.all([
    fixture.request("/api/projects", { headers: owner.headers }),
    fixture.request("/api/projects", { headers: viewer.headers }),
  ]);
  const schema = z.object({ data: z.object({ items: z.array(ProjectSummarySchema) }) });
  const [ownerResponse, viewerResponse] = responses;
  if (!ownerResponse || !viewerResponse) throw new TypeError("Expected both dashboard responses");
  const ownerItems = schema.parse(await ownerResponse.json()).data.items;
  const viewerItems = schema.parse(await viewerResponse.json()).data.items;
  // Then: owner names and effective roles are correct, and tags never cross actors.
  expect(ownerItems.find((project) => project.id === ids.project))
    .toMatchObject({ ownerName: owner.user.name, role: "owner", tagIds: [ownerTag] });
  expect(viewerItems.find((project) => project.id === ids.project))
    .toMatchObject({ ownerName: owner.user.name, role: "viewer", tagIds: [viewerTag] });
  expect(responses.map((response) => response.headers.get("etag"))).toEqual([null, null]);
});

test("keeps the project detail DTO unchanged when the dashboard uses summaries", async () => {
  // Given: an authenticated project viewer.
  await using fixture = await baseFixture();
  const viewer = await fixture.login("alex@quire.local");
  // When: the client reads project detail rather than its dashboard summary.
  const response = await fixture.request(`/api/projects/${ids.project}?branch=main`, { headers: viewer.headers });
  const result = z.object({ data: ProjectSchema }).parse(await response.json()).data;
  // Then: strict detail parsing succeeds and the explicit project version remains available.
  expect(result.id).toBe(ids.project);
  expect(response.headers.get("etag")).toBe(`"v${result.version}"`);
});

test("archives projects with different current versions in one bulk mutation", async () => {
  // Given: two accessible projects with different counters.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const created = await fixture.create(owner.headers, "Second bulk member");
  const seeded = fixture.service.getProject(ids.project);
  // When: the client sends each selected project's own expected version.
  const response = await fixture.request("/api/projects/bulk", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ items: [
      { id: seeded.id, expectedVersion: seeded.version },
      { id: created.id, expectedVersion: created.version },
    ], action: "archive" }) });
  // Then: both per-user states commit and each project counter advances once.
  expect(response.status).toBe(202);
  expect(z.object({ data: OperationSchema }).parse(await response.json()).data.status).toBe("succeeded");
  expect(fixture.runtime.db.query("SELECT project_id,state FROM project_user_state WHERE user_id=? ORDER BY project_id")
    .all(owner.user.id)).toEqual([seeded.id, created.id].sort().map((project_id) => ({ project_id, state: "archived" })));
  expect(fixture.service.getProject(seeded.id).version).toBe(seeded.version + 1);
  expect(fixture.service.getProject(created.id).version).toBe(created.version + 1);
});

test("rejects a stale later bulk member without changing any selected project", async () => {
  // Given: a valid first item followed by a stale project counter.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const second = await fixture.create(owner.headers, "Stale bulk member");
  const first = fixture.service.getProject(ids.project);
  // When: the complete selected set is submitted.
  const response = await fixture.request("/api/projects/bulk", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ items: [
      { id: first.id, expectedVersion: first.version },
      { id: second.id, expectedVersion: second.version + 1 },
    ], action: "trash" }) });
  // Then: no state, project counter or operation is partially committed.
  expect(response.status).toBe(409);
  expect(fixture.runtime.db.query("SELECT * FROM project_user_state WHERE user_id=?").all(owner.user.id)).toEqual([]);
  expect(fixture.service.getProject(first.id).version).toBe(first.version);
  expect(fixture.service.getProject(second.id).version).toBe(second.version);
  expect(fixture.runtime.db.query("SELECT * FROM operations WHERE kind='bulk-trash'").all()).toEqual([]);
});

test("rolls back earlier bulk writes when a later project becomes stale at its write", async () => {
  // Given: a real SQLite trigger introducing a later-row version change during the transaction.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const second = await fixture.create(owner.headers, "Concurrent bulk member");
  const first = fixture.service.getProject(ids.project);
  fixture.runtime.db.exec(`CREATE TEMP TRIGGER dashboard_version_change AFTER INSERT ON project_user_state
    WHEN new.project_id='${first.id}' BEGIN
      UPDATE projects SET version=version+1 WHERE id='${second.id}';
    END`);
  // When: one bulk transaction reaches the now-stale second item.
  const response = await fixture.request("/api/projects/bulk", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ items: [
      { id: first.id, expectedVersion: first.version },
      { id: second.id, expectedVersion: second.version },
    ], action: "archive" }) });
  // Then: the entire transaction, including the trigger and first item's write, rolls back.
  expect(response.status).toBe(409);
  expect(fixture.runtime.db.query("SELECT * FROM project_user_state WHERE user_id=?").all(owner.user.id)).toEqual([]);
  expect(fixture.service.getProject(first.id).version).toBe(first.version);
  expect(fixture.service.getProject(second.id).version).toBe(second.version);
});

test("preflights duplicate bulk IDs before changing project state", async () => {
  // Given: a current project submitted twice in one selection.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const project = fixture.service.getProject(ids.project);
  const item = { id: project.id, expectedVersion: project.version };
  // When: duplicate IDs cross the HTTP boundary.
  const response = await fixture.request("/api/projects/bulk", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ items: [item, item], action: "archive" }) });
  // Then: invalid selection input cannot advance a counter or state twice.
  expect(response.status).toBe(400);
  expect(fixture.service.getProject(project.id).version).toBe(project.version);
  expect(fixture.runtime.db.query("SELECT * FROM project_user_state WHERE user_id=?").all(owner.user.id)).toEqual([]);
});

test("authorizes every bulk member before changing an accessible first project", async () => {
  // Given: one owned project followed by a project belonging to an unrelated actor.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const hidden = await fixture.service.create(ids.outsider, { name: "Private bulk member", origin: { kind: "blank" } });
  const first = fixture.service.getProject(ids.project);
  // When: the owner tries to archive the mixed-access selection.
  const response = await fixture.request("/api/projects/bulk", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ items: [
      { id: first.id, expectedVersion: first.version },
      { id: hidden.id, expectedVersion: hidden.version },
    ], action: "archive" }) });
  // Then: inaccessible later members prevent any first-project mutation.
  expect(response.status).toBe(404);
  expect(fixture.service.getProject(first.id).version).toBe(first.version);
  expect(fixture.runtime.db.query("SELECT * FROM project_user_state WHERE user_id=?").all(owner.user.id)).toEqual([]);
});

test("bulk source download leaves selected project counters and checkpoints unchanged", async () => {
  // Given: two current finalized source trees.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const second = await fixture.create(owner.headers, "Download bulk member");
  const first = fixture.service.getProject(ids.project);
  const snapshots = fixture.runtime.db.query("SELECT id FROM snapshots ORDER BY id").all();
  // When: the selected source set is downloaded.
  const response = await fixture.request("/api/projects/bulk", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ items: [
      { id: first.id, expectedVersion: first.version },
      { id: second.id, expectedVersion: second.version },
    ], action: "download" }) });
  // Then: the operation succeeds without hidden project mutations.
  expect(response.status).toBe(202);
  expect(fixture.service.getProject(first.id).version).toBe(first.version);
  expect(fixture.service.getProject(second.id).version).toBe(second.version);
  expect(fixture.runtime.db.query("SELECT id FROM snapshots ORDER BY id").all()).toEqual(snapshots);
});
