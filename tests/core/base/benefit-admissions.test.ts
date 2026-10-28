import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import { baseFixture } from "./harness";
import { fixtureIds as ids, defaultPolicy } from "../../fixtures/foundation";

type Fixture = Awaited<ReturnType<typeof baseFixture>>;
async function invited(app: Fixture, headers: Record<string, string>, email: string) {
  const project = await app.service.getProject(ids.project);
  const response = await app.request(`/api/projects/${ids.project}/invitations`, { method: "POST",
    headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ email, role: "reviewer", expectedVersion: project.version }) });
  expect(response.status).toBe(200);
  const invitation = z.object({ data: endpoints.invitationCreate.output }).parse(await response.json()).data;
  const mail = z.object({ body: z.string() }).parse(await app.runtime.db.get(
    "SELECT body FROM mail_outbox WHERE dedupe_key=?", [`base-invite:${invitation.id}:0`]));
  const token = new URL(mail.body).searchParams.get("token");
  if (!token) throw new TypeError("Real invitation token missing");
  return { invitation, token };
}
test("keeps actor-specific seat ceilings local to that actor", async () => {
  // Given: two selected assignments, with a lower ceiling belonging only to the Editor.
  await using app = await baseFixture();
  await app.setPolicy(ids.project, { writableMembers: 2 });
  await app.runtime.db.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'user',?,?,?)",
    [crypto.randomUUID(), ids.mai, JSON.stringify({ ...defaultPolicy, writableMembers: 1 }), app.runtime.clock.now()]);
  // When: each selected actor's effective authority is independently resolved.
  const editor = await app.service.effectiveRole(ids.mai, ids.project);
  const reviewer = await app.service.effectiveRole(ids.sam, ids.project);
  // Then: the Editor's restriction cannot evict the other selected actor.
  expect(editor).toBe("viewer");
  expect(reviewer).toBe("reviewer");
  expect(await app.service.role(ids.mai, ids.project)).toBe("editor");
});
for (const capacity of [1, 2]) {
  test(`counts Reviewers and blocks editor-link self-admission at capacity ${capacity}`, async () => {
    // Given: an Editor and Reviewer, plus a real link that admits Editors only when a seat fits.
    await using app = await baseFixture();
    const owner = await app.login();
    const outsider = await app.login("outsider@quire.local");
    await app.setPolicy(ids.project, { sharing: "anyone", writableMembers: capacity, anonymousRead: true });
    const response = await app.request(`/api/projects/${ids.project}/link`, { method: "PUT",
      headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": '"v0"' },
      body: JSON.stringify({ role: "editor", expectedVersion: 0 }) });
    const link = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await response.json()).data.urlOnce;
    const token = new URL(link).searchParams.get("share");
    if (!token) throw new TypeError("Link token missing");
    const headers = { ...outsider.headers, "x-project-token": token };
    // When: the outsider discovers and then attempts the real join operation.
    const discovered = await app.request(`/api/projects/${ids.project}/effective-access?branch=main`, { headers });
    const joined = await app.request(`/api/projects/${ids.project}/join`, { method: "POST", headers,
      body: JSON.stringify({ scope: { projectId: ids.project, branch: "main" } }) });
    // Then: a full or overfull candidate set never elects the joining actor as its survivor.
    expect(z.object({ data: endpoints.projectAccess.output }).parse(await discovered.json()).data.capabilities.join).toBe(false);
    expect(joined.status).toBe(403);
    expect(await app.runtime.db.get("SELECT id FROM project_members WHERE project_id=? AND user_id=?", [ids.project, ids.outsider])).toBeNull();
  });
}
test("reserves no seats for invitations and appends only the actually admitted member ID", async () => {
  // Given: two existing assignments, one remaining seat, and two pending promotions.
  await using app = await baseFixture();
  const owner = await app.login();
  await app.setPolicy(ids.project, { writableMembers: 3 });
  const first = await invited(app, owner.headers, "outsider@quire.local");
  const second = await invited(app, owner.headers, "alex@quire.local");
  const members = z.array(z.object({ id: IdSchema })).parse(await app.runtime.db.all(
    "SELECT id FROM project_members WHERE project_id=? AND role IN ('editor','reviewer')", [ids.project]));
  expect((await app.request(`/api/projects/${ids.project}/writable-members`, { method: "PUT", headers: owner.headers,
    body: JSON.stringify({ memberIds: members.map(member => member.id), expectedVersion: (await app.service.getProject(ids.project)).version }) })).status).toBe(200);
  const outsider = await app.login("outsider@quire.local");
  const viewer = await app.login("alex@quire.local");
  // When: actual acceptance consumes the last seat before the other pending invitation is accepted.
  const accepted = await app.request(`/api/invitations/${first.invitation.id}/accept`, { method: "POST",
    headers: { ...outsider.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ token: first.token, expectedVersion: 0 }) });
  const rejected = await app.request(`/api/invitations/${second.invitation.id}/accept`, { method: "POST",
    headers: { ...viewer.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ token: second.token, expectedVersion: 0 }) });
  // Then: selection contains the created membership identity, not a user ID or reserved invitation.
  expect(accepted.status).toBe(200);
  expect(rejected.status).toBe(403);
  const admitted = z.object({ id: IdSchema }).parse(await app.runtime.db.get(
    "SELECT id FROM project_members WHERE project_id=? AND user_id=?", [ids.project, ids.outsider]));
  const selection = z.object({ writable_member_ids_json: z.string() }).parse(await app.runtime.db.get(
    "SELECT writable_member_ids_json FROM projects WHERE id=?", [ids.project]));
  expect(z.array(IdSchema).parse(JSON.parse(selection.writable_member_ids_json))).toEqual([...members.map(member => member.id), admitted.id]);
});
test("rejects invitation acceptance while automatic selection is over capacity", async () => {
  // Given: a pending invitation created before a live capacity downgrade.
  await using app = await baseFixture();
  const owner = await app.login();
  const outsider = await app.login("outsider@quire.local");
  await app.setPolicy(ids.project, { writableMembers: 3 });
  const item = await invited(app, owner.headers, "outsider@quire.local");
  await app.setPolicy(ids.project, { writableMembers: 1 });
  // When: the invited account accepts against the overfull current candidate set.
  const response = await app.request(`/api/invitations/${item.invitation.id}/accept`, { method: "POST",
    headers: { ...outsider.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ token: item.token, expectedVersion: 0 }) });
  // Then: no invitation or self-admission can choose the survivor.
  expect(response.status).toBe(403);
  expect(await app.runtime.db.get("SELECT status FROM invitations WHERE id=?", [item.invitation.id])).toEqual({ status: "pending" });
  expect(await app.runtime.db.get("SELECT id FROM project_members WHERE project_id=? AND user_id=?", [ids.project, ids.outsider])).toBeNull();
});
test("rechecks the current owner's sharing ceiling during invitation acceptance after transfer", async () => {
  // Given: an invitation whose original-owner preflight is permissive.
  await using app = await baseFixture();
  const owner = await app.login();
  const outsider = await app.login("outsider@quire.local");
  await app.setPolicy(ids.project, { writableMembers: 3, sharing: "anyone" });
  await app.runtime.db.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'user',?,?,?)",
    [crypto.randomUUID(), ids.mai, JSON.stringify({ ...defaultPolicy, sharing: "organization" }), app.runtime.clock.now()]);
  const item = await invited(app, owner.headers, "outsider@quire.local");
  await using replica = await app.replica();
  const capacity = app.service.checkCapacity.bind(app.service);
  const barrier = spyOn(app.service, "checkCapacity").mockImplementationOnce(async (...args) => {
    await capacity(...args);
    const transferred = await replica.request(`/api/projects/${ids.project}/transfer`, { method: "POST",
      headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ newOwnerId: ids.mai, expectedVersion: (await app.service.getProject(ids.project)).version }) });
    expect(transferred.status).toBe(200);
  });
  try {
    // When: acceptance resumes after the current owner changed to a stricter actor.
    const response = await app.request(`/api/invitations/${item.invitation.id}/accept`, { method: "POST",
      headers: { ...outsider.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ token: item.token, expectedVersion: 0 }) });
    // Then: former-owner policy cannot admit the new member.
    expect(response.status).toBe(403);
    expect(await app.runtime.db.get("SELECT id FROM project_members WHERE project_id=? AND user_id=?", [ids.project, ids.outsider])).toBeNull();
    expect((await app.service.getProject(ids.project)).ownerId).toBe(ids.mai);
  } finally { barrier.mockRestore(); }
}, 30000);
test("rechecks the current owner's link policy inside editor-link admission after transfer", async () => {
  // Given: a permissive current owner and a recipient with a distinct named-only ceiling.
  await using app = await baseFixture();
  const owner = await app.login();
  const outsider = await app.login("outsider@quire.local");
  await app.setPolicy(ids.project, { writableMembers: 3, sharing: "anyone", anonymousRead: true });
  await app.runtime.db.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'user',?,?,?)",
    [crypto.randomUUID(), ids.mai, JSON.stringify({ ...defaultPolicy, sharing: "named" }), app.runtime.clock.now()]);
  const linked = await app.request(`/api/projects/${ids.project}/link`, { method: "PUT",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": '"v0"' },
    body: JSON.stringify({ role: "editor", expectedVersion: 0 }) });
  const url = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await linked.json()).data.urlOnce;
  const token = new URL(url).searchParams.get("share");
  if (!token) throw new TypeError("Real link token required");
  const check = app.service.checkCapacity.bind(app.service);
  const barrier = spyOn(app.service, "checkCapacity").mockImplementationOnce(async (...args) => {
    await check(...args);
    expect((await app.request(`/api/projects/${ids.project}/transfer`, { method: "POST",
      headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ newOwnerId: ids.mai, expectedVersion: (await app.service.getProject(ids.project)).version }) })).status).toBe(200);
  });
  try {
    // When: the original link preflight resumes after the ordinary transfer committed.
    const response = await app.request(`/api/projects/${ids.project}/join`, { method: "POST",
      headers: { ...outsider.headers, "x-project-token": token },
      body: JSON.stringify({ scope: { projectId: ids.project, branch: "main" } }) });
    // Then: the former owner's permissive policy cannot admit an Editor under the new owner.
    expect(response.status).toBe(403);
    expect(await app.runtime.db.get("SELECT id FROM project_members WHERE project_id=? AND user_id=?", [ids.project, ids.outsider])).toBeNull();
    expect((await app.service.getProject(ids.project)).ownerId).toBe(ids.mai);
  } finally { barrier.mockRestore(); }
});
