import { expect, test } from "bun:test";
import { z } from "zod";
import { ProjectSummarySchema, TagSchema, OperationSchema } from "@quire/contracts";
import { baseFixture, projectEnvelope, okEnvelope } from "./base/harness";
import { fixtureIds as ids } from "../fixtures/foundation";

test("T02 creates independent projects and persists idempotent creation across restart", async () => {
  // Given: a real authenticated API with durable SQLite and Git.
  await using fixture = await baseFixture();
  const login = await fixture.login();
  const headers = { ...login.headers, "idempotency-key": crypto.randomUUID() };
  const body = JSON.stringify({ name: "Durable example", origin: { kind: "example" } });
  // When: the same creation request is retried after restarting the runtime.
  const first = await fixture.request("/api/projects", { method: "POST", headers, body });
  const project = projectEnvelope.parse(await first.json()).data;
  await fixture.restart();
  const retry = await fixture.request("/api/projects", { method: "POST", headers, body });
  // Then: the project and its bytes survive without a second project.
  expect(projectEnvelope.parse(await retry.json()).data.id).toBe(project.id);
  const files = fixture.service.listFiles({ projectId: project.id, branch: "main" });
  expect(files.map((file) => file.path)).toEqual(["main.tex", "sections/introduction.tex"]);
  expect(fixture.service.readDocument({ projectId: project.id, branch: "main" }, project.settings.mainFileId).text)
    .toContain("\\input{sections/introduction}");
  expect(project.ownerId).toBe(login.user.id);
});

test("T02 archives selected projects per user without changing collaborator visibility", async () => {
  // Given: an owner and viewer of the same seeded project.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const viewer = await fixture.login("alex@quire.local");
  // When: the viewer archives that project in their own dashboard.
  const result = await fixture.request("/api/projects/bulk", { method: "POST",
    headers: { ...viewer.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ items: [{ id: ids.project, expectedVersion: 0 }], action: "archive" }) });
  // Then: only the viewer's active list changes.
  expect(result.status).toBe(202);
  const schema = z.object({ data: z.object({ items: z.array(ProjectSummarySchema) }) });
  const active = schema.parse(await (await fixture.request("/api/projects", { headers: viewer.headers })).json()).data.items;
  const ownerActive = schema.parse(await (await fixture.request("/api/projects", { headers: owner.headers })).json()).data.items;
  const archived = schema.parse(await (await fixture.request("/api/projects?state=archived", { headers: viewer.headers })).json()).data.items;
  expect(active.map((project) => project.id)).not.toContain(ids.project);
  expect(ownerActive.map((project) => project.id)).toContain(ids.project);
  expect(archived.map((project) => project.id)).toContain(ids.project);
});

test("T02 normalizes tags and exposes title owner filters with deterministic pagination", async () => {
  // Given: a project and an authenticated owner.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers, "A tagged paper");
  const tagResponse = await fixture.request("/api/tags", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ name: "Research", colorHex: "#aabbcc" }) });
  const tag = z.object({ data: TagSchema }).parse(await tagResponse.json()).data;
  // When: the user assigns the tag and filters the dashboard.
  const assignment = await fixture.request(`/api/projects/${project.id}/tags`, { method: "PUT",
    headers: { ...owner.headers, "if-match": `"v${project.version}"` }, body: JSON.stringify({ tagIds: [tag.id], expectedVersion: project.version }) });
  const response = await fixture.request(`/api/projects?tag=${tag.id}&q=Kien&sort=title&direction=asc&limit=1`, { headers: owner.headers });
  // Then: the summary carries the actual owner, role and assigned tag.
  expect(assignment.status).toBe(200);
  expect(tag.colorHex).toBe("#AABBCC");
  const items = z.object({ data: z.object({ items: z.array(ProjectSummarySchema) }) }).parse(await response.json()).data.items;
  expect(items.map((item) => ({ id: item.id, role: item.role, tags: item.tagIds })))
    .toEqual([{ id: project.id, role: "owner", tags: [tag.id] }]);
});

test("T02 copy drops collaborators history and user state while preserving source", async () => {
  // Given: a viewer of a seeded project with immutable source.
  await using fixture = await baseFixture();
  const viewer = await fixture.login("alex@quire.local");
  const source = fixture.service.getProject(ids.project);
  // When: the viewer copies the source project.
  const response = await fixture.request(`/api/projects/${source.id}/copy`, { method: "POST",
    headers: { ...viewer.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ name: "Independent copy", expectedVersion: source.version }) });
  const copy = projectEnvelope.parse(await response.json()).data;
  // Then: the viewer owns a fresh aggregate and the source is not modified.
  expect(copy.ownerId).toBe(viewer.user.id);
  expect(copy.id).not.toBe(source.id);
  expect(fixture.runtime.db.query("SELECT * FROM project_members WHERE project_id=?").all(copy.id)).toEqual([]);
  expect(fixture.runtime.db.query("SELECT * FROM suggestions WHERE project_id=?").all(copy.id)).toEqual([]);
  expect(fixture.service.readDocument({ projectId: copy.id, branch: "main" }, copy.settings.mainFileId).text)
    .toBe(fixture.service.readDocument({ projectId: source.id, branch: "main" }, source.settings.mainFileId).text);
});

test("T02 rejects stale project mutation and leaves a non-owner unable to delete", async () => {
  // Given: an owner, viewer and a current project version.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const viewer = await fixture.login("alex@quire.local");
  const project = fixture.service.getProject(ids.project);
  // When: clients attempt a stale rename and a viewer deletion.
  const stale = await fixture.request(`/api/projects/${project.id}`, { method: "PATCH", headers: owner.headers,
    body: JSON.stringify({ name: "Wrong", expectedVersion: project.version + 1 }) });
  const denied = await fixture.request(`/api/projects/${project.id}`, { method: "DELETE", headers: viewer.headers,
    body: JSON.stringify({ confirmation: project.name, expectedVersion: project.version }) });
  // Then: neither request changes the durable project.
  expect(stale.status).toBe(409);
  expect(denied.status).toBe(403);
  expect(fixture.service.getProject(project.id).name).toBe(project.name);
});

test("T02 transfers ownership only to a collaborator and allows the former owner to leave", async () => {
  // Given: an owned project with an existing editor.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const project = fixture.service.getProject(ids.project);
  // When: ownership transfers to Mai and the former owner leaves.
  const transfer = await fixture.request(`/api/projects/${project.id}/transfer`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ newOwnerId: ids.mai, expectedVersion: project.version }) });
  const left = await fixture.request(`/api/projects/${project.id}/leave`, { method: "POST", headers: owner.headers,
    body: JSON.stringify({ expectedVersion: 0 }) });
  // Then: Mai is the sole owner and the former owner has no project membership.
  expect(okEnvelope.parse(await transfer.json()).data.ok).toBe(true);
  expect(left.status).toBe(200);
  expect(fixture.service.getProject(project.id).ownerId).toBe(ids.mai);
  expect((await fixture.request(`/api/projects/${project.id}?branch=main`, { headers: owner.headers })).status).toBe(404);
});

test("T02 records bulk source download as a durable operation", async () => {
  // Given: a real source project and owner session.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  // When: the selected project set is exported.
  const response = await fixture.request("/api/projects/bulk", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ items: [{ id: ids.project, expectedVersion: 0 }], action: "download" }) });
  // Then: the operation is durable and points at actual downloadable ZIP bytes.
  const operation = z.object({ data: OperationSchema }).parse(await response.json()).data;
  await fixture.restart();
  const download = await fixture.request(`/api/operations/${operation.id}/download`, { headers: owner.headers });
  expect(operation.status).toBe("succeeded");
  expect(download.status).toBe(200);
  expect(new Uint8Array(await download.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([80, 75, 3, 4]));
});
