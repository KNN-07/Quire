import { expect, test } from "bun:test";
import { z } from "zod";
import { MembershipSchema, OrganizationSchema, PolicySchema, UserSchema, IdSchema } from "@quire/contracts";
import { fixtureIds as ids } from "../fixtures/foundation";
import { governanceFixture, data } from "./governance/harness";
import { applyBillingTransition, reconcileInstitutionEligibility } from "../../services/accounts/governance";

test("separates management roles, seats and project access when a manager administers members", async () => {
  // Given: a real admin, a manager with no seat, and independent project ACLs.
  await using app = await governanceFixture({ core: true });
  const admin = await app.login();
  const manager = await data(await admin.write(`/api/organizations/${ids.team}/members`,
    { userId: ids.outsider, role: "manager", licensed: false, expectedVersion: 0 }), MembershipSchema);
  const outsider = await app.login("outsider@quire.local");
  // When: the manager creates a licensed ordinary membership.
  const created = await outsider.write(`/api/organizations/${ids.team}/members`,
    { userId: ids.sam, role: "member", licensed: true, expectedVersion: 1 });
  // Then: membership works without project access, billing access or admin escalation.
  expect((await data(created, MembershipSchema)).licensed).toBe(true);
  expect(manager.licensed).toBe(false);
  expect(app.runtime.db.query("SELECT id FROM project_members WHERE user_id=?").get(ids.outsider)).toBeNull();
  expect((await outsider.get(`/api/projects/${ids.project}?branch=main`)).status).toBe(404);
  expect((await outsider.get(`/api/organizations/${ids.team}/billing`)).status).toBe(403);
  expect((await outsider.write(`/api/organizations/${ids.team}/members/${manager.id}`,
    { role: "admin", expectedVersion: 0 }, { method: "PATCH" })).status).toBe(403);
});

test("serializes seat allocation when two members race for one available seat", async () => {
  // Given: one available manual billing seat and two unlicensed members.
  await using app = await governanceFixture();
  const admin = await app.login();
  const operator = await app.login("operator@quire.local");
  const first = await data(await admin.write(`/api/organizations/${ids.team}/members`,
    { userId: ids.mai, role: "member", licensed: false, expectedVersion: 0 }), MembershipSchema);
  const second = await data(await admin.write(`/api/organizations/${ids.team}/members`,
    { userId: ids.sam, role: "member", licensed: false, expectedVersion: 1 }), MembershipSchema);
  applyBillingTransition(app.context, operator.principal, { organizationId: ids.team, expectedVersion: 0,
    planId: "manual-contract", seats: 2, status: "active", period: "year", renewsAt: null });
  // When: both independent HTTP mutations claim the last seat.
  const responses = await Promise.all([first, second].map((member) => admin.write(
    `/api/organizations/${ids.team}/members/${member.id}`, { licensed: true, expectedVersion: 0 }, { method: "PATCH" })));
  // Then: exactly one wins, and a stale retry cannot overwrite it.
  expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([200, 409]);
  expect(z.object({ total: z.number() }).parse(app.runtime.db.query(
    "SELECT count(*) AS total FROM members WHERE organization_id=? AND licensed=1").get(ids.team)).total).toBe(2);
});

test("persists policy changes in the real identity policy port without replacing project ACLs", async () => {
  // Given: an admin and project viewer authenticated through the real identity service.
  await using app = await governanceFixture();
  const admin = await app.login();
  const viewer = await app.login("alex@quire.local");
  // When: the admin changes organization policy while a viewer tries the same action.
  const response = await admin.write(`/api/organizations/${ids.team}/policy`,
    { compileSeconds: 42, chat: false, expectedVersion: 0 }, { method: "PATCH" });
  // Then: policy reads are authoritative, role checks survive, and existing ACLs remain.
  expect((await data(response, PolicySchema)).compileSeconds).toBe(42);
  expect((await app.runtime.services.get("policy").forProject(ids.alex, ids.project)).chat).toBe(false);
  expect((await viewer.write(`/api/organizations/${ids.team}/policy`,
    { chat: true, expectedVersion: 1 }, { method: "PATCH" })).status).toBe(403);
  expect(z.object({ role: z.string() }).parse(app.runtime.db.query(
    "SELECT role FROM project_members WHERE project_id=? AND user_id=?").get(ids.project, ids.alex)).role).toBe("viewer");
});

test("keeps explicit management acceptance separate from institution enrollment and membership", async () => {
  // Given: a verified institutional domain and an ordinary self-enrolled account.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  const user = await app.login("mai@quire.local");
  await operator.write(`/api/organizations/${ids.institution}`, { domains: ["quire.local"], expectedVersion: 0 }, { method: "PATCH" });
  const org = await data(await user.get(`/api/institutions/quire-institute`), OrganizationSchema);
  // When: the verified user enrolls in the institution.
  const response = await user.write(`/api/institutions/${org.slug}/enroll`);
  // Then: no seat, project ownership or managed-account control is implicitly granted.
  expect((await data(response, MembershipSchema)).licensed).toBe(false);
  const me = await data(await user.get("/api/me"), z.object({ user: UserSchema }));
  expect(me.user.managedBy).toBeNull();
  expect(app.runtime.db.query("SELECT id FROM managed_acceptances WHERE user_id=?").get(ids.mai)).toBeNull();
});

test("removes only self-enrolled eligibility when a verified domain is lost", async () => {
  // Given: self-enrollment, plus an unrelated project role.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  const user = await app.login("mai@quire.local");
  await operator.write(`/api/organizations/${ids.institution}`, { domains: ["quire.local"], expectedVersion: 0 }, { method: "PATCH" });
  await user.write("/api/institutions/quire-institute/enroll");
  app.runtime.db.query("DELETE FROM verified_emails WHERE user_id=?").run(ids.mai);
  // When: the deterministic eligibility reconciliation runs.
  const removed = reconcileInstitutionEligibility(app.context);
  // Then: institution eligibility is withdrawn without destroying unrelated access or content.
  expect(removed).toBe(1);
  expect(app.runtime.db.query("SELECT id FROM members WHERE organization_id=? AND user_id=?").get(ids.institution, ids.mai)).toBeNull();
  expect(app.runtime.db.query("SELECT id FROM project_members WHERE project_id=? AND user_id=?").get(ids.project, ids.mai)).not.toBeNull();
});

test("replays organization creation but rejects changed input and stale membership counters", async () => {
  // Given: a real signed-in user and a stable idempotency key.
  await using app = await governanceFixture();
  const user = await app.login();
  const body = { name: "Independent team", kind: "team", domains: [] };
  const key = crypto.randomUUID();
  const original = await data(await user.write("/api/organizations", body, { key }), OrganizationSchema);
  // When: the same creation is retried.
  const replay = await data(await user.write("/api/organizations", body, { key }), OrganizationSchema);
  // Then: one aggregate exists and a conflicting payload is rejected.
  expect(replay.id).toBe(original.id);
  expect((await user.write("/api/organizations", { ...body, name: "Different" }, { key })).status).toBe(409);
  expect((await user.write(`/api/organizations/${original.id}/members`,
    { userId: IdSchema.parse(ids.mai), role: "member", licensed: false, expectedVersion: 99 })).status).toBe(409);
});
