import { expect, test } from "bun:test";
import { baseFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("only the project owner may rename while editors may change compiler settings", async () => {
  // Given: an existing project with a named Editor.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const editor = await fixture.login("mai@quire.local");
  const original = await fixture.service.getProject(ids.project);
  // When: the Editor attempts rename and then a settings-only edit.
  const rename = await fixture.request(`/api/projects/${ids.project}`, {
    method: "PATCH", headers: editor.headers,
    body: JSON.stringify({ name: "Unauthorized rename", expectedVersion: original.version }),
  });
  expect(rename.status).toBe(403);
  const settings = await fixture.request(`/api/projects/${ids.project}`, {
    method: "PATCH", headers: editor.headers,
    body: JSON.stringify({ settings: { ...original.settings, draft: true }, expectedVersion: original.version }),
  });
  expect(settings.status).toBe(200);
  const current = await fixture.service.getProject(ids.project);
  const allowed = await fixture.request(`/api/projects/${ids.project}`, {
    method: "PATCH", headers: owner.headers,
    body: JSON.stringify({ name: "Owner renamed", expectedVersion: current.version }),
  });
  // Then: the owner rename and editor setting persist without granting rename authority.
  expect(allowed.status).toBe(200);
  expect(await fixture.service.getProject(ids.project)).toMatchObject({ name: "Owner renamed", settings: { draft: true } });
});

test("Reviewer seats count toward capacity without charging a second seat for role changes", async () => {
  // Given: the seeded project has one Editor and one Reviewer.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  await fixture.setPolicy(ids.project, { writableMembers: 2 });
  const project = await fixture.service.getProject(ids.project);
  // When: its owner tries to invite a third writable/review collaborator.
  const invitation = await fixture.request(`/api/projects/${ids.project}/invitations`, {
    method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ email: "outsider@quire.local", role: "reviewer", expectedVersion: project.version }),
  });
  expect(invitation.status).toBe(403);
  const reviewer = await fixture.runtime.db.get<{ id: string; version: number }>(
    "SELECT id,version FROM project_members WHERE project_id=? AND role='reviewer'", [ids.project]);
  if (!reviewer) throw new TypeError("Expected seeded Reviewer");
  const upgraded = await fixture.request(`/api/projects/${ids.project}/members/${reviewer.id}`, {
    method: "PATCH", headers: owner.headers,
    body: JSON.stringify({ role: "editor", expectedVersion: reviewer.version }),
  });
  // Then: the existing Reviewer's conversion uses its already counted seat.
  expect(upgraded.status).toBe(200);
  expect(await fixture.runtime.db.get<{ role: string }>("SELECT role FROM project_members WHERE id=?", [reviewer.id])).toEqual({ role: "editor" });
});
