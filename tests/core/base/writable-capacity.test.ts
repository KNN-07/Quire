import { expect, spyOn, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import { baseFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

const scope = { projectId: ids.project, branch: "main" };
const route = `/api/projects/${ids.project}`;
async function baseline(app: Awaited<ReturnType<typeof baseFixture>>, capacity: number | null) {
  await app.runtime.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await tx.run("UPDATE account_project_benefits SET benefits_json=? WHERE scope_kind='deployment'",
      [JSON.stringify({ compileSeconds: 12, writableMembers: capacity, historyDays: 1, trackChanges: false })]);
  });
}
async function access(app: Awaited<ReturnType<typeof baseFixture>>, email: string) {
  const user = await app.login(email);
  const response = await app.request(`${route}/effective-access?branch=main`, { headers: user.headers });
  return z.object({ data: endpoints.projectAccess.output }).parse(await response.json()).data;
}
async function select(app: Awaited<ReturnType<typeof baseFixture>>, memberIds: readonly string[] | null) {
  const owner = await app.login();
  return app.request(`${route}/writable-members`, { method: "PUT", headers: owner.headers,
    body: JSON.stringify({ memberIds, expectedVersion: (await app.service.getProject(ids.project)).version }) });
}
test("suspends every over-capacity writable assignment without deleting roles or read access", async () => {
  // Given: an Editor, Reviewer, Viewer, and a newly lowered common capacity.
  await using app = await baseFixture();
  const before = await app.runtime.db.all("SELECT id,role,version FROM project_members WHERE project_id=? ORDER BY id", [ids.project]);
  await baseline(app, 1);
  // When: existing writable members authorize under the current benefit boundary.
  const editor = await access(app, "mai@quire.local");
  const reviewer = await access(app, "sam@quire.local");
  // Then: no arbitrary survivor is selected, and assigned roles remain intact.
  expect(editor).toMatchObject({ role: "editor", effectiveRole: "viewer", capacityLimited: true,
    capabilities: { read: true, edit: false, compile: false, review: false, chat: true } });
  expect(reviewer).toMatchObject({ role: "reviewer", effectiveRole: "viewer", capacityLimited: true });
  expect(await app.runtime.db.all("SELECT id,role,version FROM project_members WHERE project_id=? ORDER BY id", [ids.project])).toEqual(before);
  for (const action of ["write", "compile", "comment", "suggestion.create", "history.restore"]) {
    await rejects(app.service.authorize(ids.mai, scope, action), { code: "FORBIDDEN" });
  }
  await app.service.authorize(ids.mai, scope, "copy");
});
test("selects current membership IDs and preserves dormant state during same-seat conversion", async () => {
  // Given: suspended Editor and Reviewer assignments.
  await using app = await baseFixture();
  await baseline(app, 1);
  const reviewer = z.object({ id: IdSchema, version: z.number() }).parse(await app.runtime.db.get(
    "SELECT id,version FROM project_members WHERE project_id=? AND user_id=?", [ids.project, ids.sam]));
  const owner = await app.login();
  // When: the owner chooses the Reviewer and converts the dormant Editor to Reviewer.
  expect((await select(app, [reviewer.id])).status).toBe(200);
  const converted = await app.request(`${route}/members/${ids.mai}`, { method: "PATCH", headers: owner.headers,
    body: JSON.stringify({ role: "reviewer", expectedVersion: 0 }) });
  // Then: selection alone controls authority and membership version changes remain separate.
  expect(converted.status).toBe(200);
  expect(await access(app, "sam@quire.local")).toMatchObject({ effectiveRole: "reviewer",
    benefits: { trackChanges: false }, capabilities: { review: true, edit: false } });
  expect(await access(app, "mai@quire.local")).toMatchObject({ role: "reviewer", effectiveRole: "viewer" });
  expect(await app.runtime.db.get("SELECT version FROM project_members WHERE id=?", [reviewer.id])).toEqual({ version: reviewer.version });
});
test("restores fitting automatic selections while keeping explicit subsets explicit across restart", async () => {
  // Given: a common capacity too small for the automatic candidate set.
  await using app = await baseFixture();
  await baseline(app, 1);
  // When: capacity grows and then the owner explicitly chooses nobody.
  await baseline(app, 2);
  expect((await access(app, "mai@quire.local")).effectiveRole).toBe("editor");
  expect((await access(app, "sam@quire.local")).effectiveRole).toBe("reviewer");
  expect((await select(app, [])).status).toBe(200);
  await app.restart();
  // Then: explicit selection remains explicit even with sufficient capacity.
  expect((await access(app, "mai@quire.local")).effectiveRole).toBe("viewer");
  const owner = await app.login();
  const response = await app.request(`${route}/access?branch=main`, { headers: owner.headers });
  expect(z.object({ data: endpoints.accessGet.output }).parse(await response.json()).data.writableSelection)
    .toEqual({ memberIds: [], capacity: 2, effectiveCount: 0, selectionRequired: false });
});
test("rejects duplicate foreign Viewer and oversized selections atomically", async () => {
  // Given: current membership identities under finite capacity.
  await using app = await baseFixture();
  await baseline(app, 1);
  const members = z.array(z.object({ id: IdSchema, role: z.string() })).parse(
    await app.runtime.db.all("SELECT id,role FROM project_members WHERE project_id=?", [ids.project]));
  const editor = members.find(member => member.role === "editor");
  const reviewer = members.find(member => member.role === "reviewer");
  const viewer = members.find(member => member.role === "viewer");
  if (!editor || !reviewer || !viewer) throw new TypeError("Seed members missing");
  // When: each invalid selection reaches the actual owner endpoint.
  for (const memberIds of [[editor.id, editor.id], [crypto.randomUUID()], [viewer.id], [ids.kien], [editor.id, reviewer.id], null]) {
    expect((await select(app, memberIds)).status).toBeGreaterThanOrEqual(400);
  }
  // Then: no failed selection rewrites the stored automatic mode or counter.
  expect(await app.runtime.db.get("SELECT writable_member_ids_json,version FROM projects WHERE id=?", [ids.project]))
    .toEqual({ writable_member_ids_json: null, version: 0 });
});
test("admits exactly one competing promotion into the last selected seat", async () => {
  // Given: explicit empty selection and one free seat.
  await using app = await baseFixture();
  await baseline(app, 1);
  expect((await select(app, [])).status).toBe(200);
  const owner = await app.login();
  await app.runtime.db.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'viewer',?)",
    [crypto.randomUUID(), ids.project, ids.outsider, app.runtime.clock.now()]);
  const ready = Promise.withResolvers<void>();
  const deadline = setTimeout(() => ready.reject(new Error("Admission preflights did not meet")), 5000);
  const check = app.service.checkCapacity.bind(app.service);
  let arrivals = 0;
  const barrier = spyOn(app.service, "checkCapacity").mockImplementation(async (...args) => {
    await check(...args);
    if (++arrivals === 2) ready.resolve();
    await ready.promise;
  });
  try {
    // When: two preflight-approved promotions contend on the real account lock.
    const results = await Promise.all([ids.alex, ids.outsider].map(userId =>
      app.request(`${route}/members/${userId}`, { method: "PATCH", headers: owner.headers,
        body: JSON.stringify({ role: "editor", expectedVersion: 0 }) })));
    // Then: only the transaction that actually admitted first consumes the seat.
    expect(results.map(result => result.status).sort((left, right) => left - right)).toEqual([200, 403]);
    const row = z.object({ writable_member_ids_json: z.string() }).parse(
      await app.runtime.db.get("SELECT writable_member_ids_json FROM projects WHERE id=?", [ids.project]));
    expect(z.array(IdSchema).parse(JSON.parse(row.writable_member_ids_json))).toHaveLength(1);
  } finally { clearTimeout(deadline); barrier.mockRestore(); }
});
test("suspends an oversized explicit selection until that same selection fits again", async () => {
  // Given: a fitting explicit set containing both assigned writable identities.
  await using app = await baseFixture();
  await baseline(app, 2);
  const members = z.array(z.object({ id: IdSchema })).parse(await app.runtime.db.all(
    "SELECT id FROM project_members WHERE project_id=? AND role IN ('editor','reviewer') ORDER BY id", [ids.project]));
  expect((await select(app, members.map(member => member.id))).status).toBe(200);
  // When: capacity shrinks below the stored set and subsequently recovers.
  await baseline(app, 1);
  expect((await access(app, "mai@quire.local")).effectiveRole).toBe("viewer");
  expect((await access(app, "sam@quire.local")).effectiveRole).toBe("viewer");
  await baseline(app, 2);
  // Then: no selection is erased or replaced with arbitrary survivors.
  expect((await access(app, "mai@quire.local")).effectiveRole).toBe("editor");
  expect((await access(app, "sam@quire.local")).effectiveRole).toBe("reviewer");
  expect(await app.runtime.db.get("SELECT writable_member_ids_json FROM projects WHERE id=?", [ids.project]))
    .toEqual({ writable_member_ids_json: JSON.stringify(members.map(member => member.id)) });
});
test("does not restore a deleted membership's selection through a replacement user membership", async () => {
  // Given: an explicitly selected Editor membership that is deleted and recreated.
  await using app = await baseFixture();
  await baseline(app, 2);
  const original = z.object({ id: IdSchema }).parse(await app.runtime.db.get(
    "SELECT id FROM project_members WHERE project_id=? AND user_id=?", [ids.project, ids.mai]));
  expect((await select(app, [original.id])).status).toBe(200);
  const owner = await app.login();
  expect((await app.request(`/api/projects/${ids.project}/members/${original.id}`, { method: "DELETE",
    headers: owner.headers, body: JSON.stringify({ expectedVersion: 0 }) })).status).toBe(200);
  await app.runtime.db.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'editor',?)",
    [crypto.randomUUID(), ids.project, ids.mai, app.runtime.clock.now()]);
  // When: the replacement assignment authorizes with the stale selection still stored.
  const current = await access(app, "mai@quire.local");
  // Then: user identity cannot stand in for the removed membership identity.
  expect(current).toMatchObject({ role: "editor", effectiveRole: "viewer", capacityLimited: true });
  expect((await select(app, [original.id])).status).toBe(422);
});
test("does not let an effective Editor select the owner's writable memberships", async () => {
  // Given: an Editor who is otherwise effective and can edit ordinary source.
  await using app = await baseFixture();
  const editor = await app.login("mai@quire.local");
  // When: that collaborator invokes the owner selection endpoint.
  const response = await app.request(`/api/projects/${ids.project}/writable-members`, {
    method: "PUT", headers: editor.headers, body: JSON.stringify({ memberIds: [], expectedVersion: 0 }),
  });
  // Then: benefit ownership does not become project administration authority.
  expect(response.status).toBe(403);
  expect((await app.service.getProject(ids.project)).version).toBe(0);
});
