import { expect, test } from "bun:test";
import { endpoints, resultSchema, resourceVersionTag } from "@quire/contracts";
import { baseFixture, okEnvelope } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

async function deleteProject(fixture: Awaited<ReturnType<typeof baseFixture>>) {
  const owner = await fixture.login();
  const project = await fixture.service.getProject(ids.project);
  const response = await fixture.request(`/api/projects/${ids.project}`, {
    method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ confirmation: project.name, expectedVersion: project.version }),
  });
  expect(response.status).toBe(200);
  return { owner, name: project.name, version: okEnvelope.parse(await response.json()).data.version };
}

test("operator restores retained project data without restoring revoked share links", async () => {
  // Given: genuine source/history/member state and a shared link before owner deletion.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  await fixture.setPolicy(ids.project, { sharing: "anyone", anonymousRead: true });
  const project = await fixture.service.getProject(ids.project);
  const link = await fixture.request(`/api/projects/${ids.project}/link`, {
    method: "PUT", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": resourceVersionTag(project.version) },
    body: JSON.stringify({ role: "viewer", expectedVersion: project.version }),
  });
  expect(link.status).toBe(200);
  const shared = resultSchema(endpoints.accessLinkPut.output).parse(await link.json());
  if ("error" in shared || !shared.data.urlOnce) throw new TypeError("Share link was not created");
  const token = new URL(shared.data.urlOnce).searchParams.get("share");
  if (!token) throw new TypeError("Share token was not returned");
  const files = await fixture.runtime.db.all("SELECT * FROM files ORDER BY id");
  const history = await fixture.runtime.db.all("SELECT * FROM snapshots ORDER BY id");
  const members = await fixture.runtime.db.all("SELECT * FROM project_members ORDER BY id");
  const deleted = await deleteProject(fixture);
  const operator = await fixture.login("operator@quire.local");
  const listed = await fixture.request(`/api/admin/projects/deleted?ownerId=${ids.kien}`, { headers: operator.headers });
  expect(listed.status).toBe(200);
  const page = resultSchema(endpoints.adminDeletedProjects.output).parse(await listed.json());
  if ("error" in page) throw new TypeError(page.error.message);
  expect(page.data.items[0]).toMatchObject({ id: ids.project, version: deleted.version });
  const headers = { ...operator.headers, "idempotency-key": crypto.randomUUID() };
  const body = JSON.stringify({ confirmation: deleted.name, expectedVersion: deleted.version });
  // When: the operator confirms restoration, retries the same request and the runtime reopens.
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fixture.request(`/api/admin/projects/${ids.project}/restore`, { method: "POST", headers, body });
    expect(response.status).toBe(200);
  }
  await fixture.restart();
  // Then: bytes, history and assigned membership are unchanged, links stay revoked, and one audit exists.
  expect(await fixture.runtime.db.all("SELECT * FROM files ORDER BY id")).toEqual(files);
  expect(await fixture.runtime.db.all("SELECT * FROM snapshots ORDER BY id")).toEqual(history);
  expect(await fixture.runtime.db.all("SELECT * FROM project_members ORDER BY id")).toEqual(members);
  expect(await fixture.runtime.db.get("SELECT id FROM share_tokens WHERE project_id=? AND revoked_at IS NULL", [ids.project])).toBeNull();
  expect((await fixture.request(`/api/projects/${ids.project}/effective-access?branch=main`, {
    headers: { "x-project-token": token },
  })).status).toBe(404);
  expect(await fixture.runtime.db.get("SELECT count(*) AS total FROM audit_entries WHERE event='project.restored' AND target_id=?", [ids.project])).toEqual({ total: 1 });
  expect((await fixture.service.getProject(ids.project)).version).toBe(deleted.version + 1);
  expect((await fixture.request(`/api/projects/${ids.project}/files?branch=main`, { headers: deleted.owner.headers })).status).toBe(200);
  expect((await fixture.request(`/api/projects/${ids.project}/files?branch=main`, { headers: operator.headers })).status).toBe(404);
  await fixture.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [ids.operator]);
  expect((await fixture.request(`/api/admin/projects/${ids.project}/restore`, { method: "POST", headers, body })).status).toBe(403);
});

test("project recovery requires operator authority, fresh authentication, CSRF and exact current confirmation", async () => {
  // Given: a deleted project and separately authenticated owner/operator.
  await using fixture = await baseFixture();
  const deleted = await deleteProject(fixture);
  const operator = await fixture.login("operator@quire.local");
  const route = `/api/admin/projects/${ids.project}/restore`;
  const body = { confirmation: deleted.name, expectedVersion: deleted.version };
  const send = (headers: HeadersInit, value = body) => fixture.request(route, {
    method: "POST", headers: { ...Object.fromEntries(new Headers(headers)), "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(value),
  });
  // When / Then: each missing authority leaves the project deleted.
  expect((await fixture.request("/api/admin/projects/deleted", { headers: deleted.owner.headers })).status).toBe(403);
  expect((await send(deleted.owner.headers)).status).toBe(403);
  expect((await send({ cookie: operator.headers.cookie })).status).toBe(403);
  expect((await send(operator.headers, { ...body, expectedVersion: deleted.version - 1 })).status).toBe(409);
  expect((await send(operator.headers, { ...body, confirmation: "wrong name" })).status).toBe(422);
  await fixture.runtime.db.run("UPDATE sessions SET created_at=? WHERE user_id=?", ["2026-10-25T00:00:00.000Z", ids.operator]);
  expect((await send(operator.headers)).status).toBe(403);
  expect(await fixture.runtime.db.get("SELECT id FROM projects WHERE id=? AND deleted_at IS NULL", [ids.project])).toBeNull();
});

test("audit persistence failure rolls back project recovery and its receipt", async () => {
  // Given: a real database rejecting the recovery audit entry.
  await using fixture = await baseFixture();
  const deleted = await deleteProject(fixture);
  const operator = await fixture.login("operator@quire.local");
  await fixture.runtime.db.exec(`CREATE TRIGGER recovery_audit_failure BEFORE INSERT ON audit_entries
    WHEN NEW.event='project.restored' BEGIN SELECT RAISE(ABORT,'recovery audit unavailable'); END`);
  // When: an otherwise authorized restore attempts publication.
  const response = await fixture.request(`/api/admin/projects/${ids.project}/restore`, {
    method: "POST", headers: { ...operator.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ confirmation: deleted.name, expectedVersion: deleted.version }),
  });
  // Then: neither recovery nor its successful replay receipt escapes the transaction.
  expect(response.status).toBe(500);
  expect(await fixture.runtime.db.get("SELECT id FROM projects WHERE id=? AND deleted_at IS NULL", [ids.project])).toBeNull();
  expect(await fixture.runtime.db.get("SELECT actor_id FROM idempotency_results WHERE route=?", [`adminProjectRestore:${ids.project}`])).toBeNull();
});
