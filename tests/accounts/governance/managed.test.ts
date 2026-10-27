import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, MembershipSchema } from "@quire/contracts";
import { governanceFixture, data } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { transitionManaged } from "../../../services/accounts/governance";

async function managedFixture() {
  const app = await governanceFixture();
  const admin = await app.login();
  const user = await app.login("mai@quire.local");
  await data(await admin.write(`/api/organizations/${ids.team}/members`,
    { userId: ids.mai, role: "member", licensed: false, expectedVersion: 0 }), MembershipSchema);
  const invitation = await admin.write(`/api/organizations/${ids.team}/managed/invite`,
    { userId: ids.mai, expectedVersion: 1 });
  if (!invitation.ok) throw new TypeError(await invitation.text());
  const row = z.object({ id: IdSchema }).parse(app.runtime.db.query(
    "SELECT id FROM managed_acceptances WHERE user_id=? AND organization_id=?").get(ids.mai, ids.team));
  return { ...app, admin, user, acceptanceId: row.id };
}
test("requires the invited account to accept management before any account control", async () => {
  // Given: an invitation that has not changed user ownership.
  await using app = await managedFixture();
  const attacker = await app.login("sam@quire.local");
  expect(z.object({ managed_by: z.null() }).parse(app.runtime.db.query("SELECT managed_by FROM users WHERE id=?").get(ids.mai)).managed_by).toBeNull();
  // When: another account tries to accept the invitation.
  const response = await attacker.write(`/api/managed/${app.acceptanceId}/accept`, { expectedVersion: 0 });
  // Then: the account remains unmanaged; only its own authenticated acceptance works.
  expect(response.status).toBe(404);
  expect((await app.user.write(`/api/managed/${app.acceptanceId}/accept`, { expectedVersion: 0 })).status).toBe(200);
  expect(z.object({ managed_by: IdSchema }).parse(app.runtime.db.query("SELECT managed_by FROM users WHERE id=?").get(ids.mai)).managed_by).toBe(ids.team);
});

test("preserves projects when accepted management is released", async () => {
  // Given: accepted management and personal ownership independent of organization membership.
  await using app = await managedFixture();
  await app.user.write(`/api/managed/${app.acceptanceId}/accept`, { expectedVersion: 0 });
  app.runtime.db.query("UPDATE projects SET owner_id=? WHERE id=?").run(ids.mai, ids.project);
  // When: the administrator releases the managed account using its account counter.
  const response = await app.admin.write(`/api/organizations/${ids.team}/managed/${ids.mai}/release`, { expectedVersion: 1 });
  // Then: ownership, password and account survive; management alone ends.
  expect(response.status).toBe(200);
  const owner = z.object({ owner_id: IdSchema, deleted_at: z.null() }).parse(app.runtime.db.query("SELECT owner_id,deleted_at FROM projects WHERE id=?").get(ids.project));
  expect(owner.owner_id).toBe(ids.mai);
  expect(z.object({ managed_by: z.null(), suspended: z.literal(0) }).parse(app.runtime.db.query("SELECT managed_by,suspended FROM users WHERE id=?").get(ids.mai)).managed_by).toBeNull();
  expect(z.object({ state: z.string() }).parse(app.runtime.db.query("SELECT state FROM managed_acceptances WHERE id=?").get(app.acceptanceId)).state).toBe("released");
});

test("reassigns every owned project before managed deletion and immediately revokes sessions", async () => {
  // Given: a managed owner, an unrelated project and a valid target.
  await using app = await managedFixture();
  await app.user.write(`/api/managed/${app.acceptanceId}/accept`, { expectedVersion: 0 });
  const second = IdSchema.parse(crypto.randomUUID());
  app.runtime.db.query("INSERT INTO projects(id,name,owner_id,settings_json,created_at,updated_at) SELECT ?,'Personal',?,'{}',created_at,updated_at FROM projects WHERE id=?")
    .run(second, ids.mai, ids.project);
  // When: a valid administrator deletes the managed account with reassignment.
  const response = await app.admin.write(`/api/organizations/${ids.team}/managed/${ids.mai}/delete`,
    { transferTo: ids.kien, expectedVersion: 1 });
  // Then: its project survives under the target, unrelated ownership is intact and its session dies.
  expect(response.status).toBe(200);
  expect(z.object({ owner_id: IdSchema }).parse(app.runtime.db.query("SELECT owner_id FROM projects WHERE id=?").get(second)).owner_id).toBe(ids.kien);
  expect(z.object({ owner_id: IdSchema, deleted_at: z.null() }).parse(app.runtime.db.query("SELECT owner_id,deleted_at FROM projects WHERE id=?").get(ids.project)).owner_id).toBe(ids.kien);
  expect((await app.user.get("/api/me")).status).toBe(401);
});

test("rolls back managed deletion when reassignment cannot retain an active owner", async () => {
  // Given: a managed owner and an ineligible target.
  await using app = await managedFixture();
  await app.user.write(`/api/managed/${app.acceptanceId}/accept`, { expectedVersion: 0 });
  // When: deletion tries to reassign the account to itself.
  const response = await app.admin.write(`/api/organizations/${ids.team}/managed/${ids.mai}/delete`,
    { transferTo: ids.mai, expectedVersion: 1 });
  // Then: the account and live session survive the failed transaction.
  expect(response.status).toBe(409);
  expect((await app.user.get("/api/me")).status).toBe(200);
});

test("uses the injected clock for the exact managed soft-deletion boundary", async () => {
  // Given: accepted management and an explicit lapse.
  await using app = await managedFixture();
  await app.user.write(`/api/managed/${app.acceptanceId}/accept`, { expectedVersion: 0 });
  transitionManaged(app.context, app.admin.principal, { organizationId: ids.team, userId: ids.mai, expectedVersion: 1, action: "lapse" });
  app.setTime("2026-12-25T12:00:00.000Z");
  // When: the clock reaches exactly the 60-day managed lapse boundary.
  transitionManaged(app.context, app.admin.principal, { organizationId: ids.team, userId: ids.mai, expectedVersion: 2,
    action: "advance", transferTo: ids.kien });
  // Then: recoverable soft deletion is distinct from principal destruction.
  expect(z.object({ state: z.string() }).parse(app.runtime.db.query("SELECT state FROM managed_acceptances WHERE id=?").get(app.acceptanceId)).state).toBe("soft_deleted");
  expect(app.runtime.db.query("SELECT id FROM projects WHERE id=?").get(ids.project)).not.toBeNull();
});
test("recovers a retained lapsed account without changing project ownership", async () => {
  // Given: a real managed acceptance followed by a recoverable lapse.
  await using app = await managedFixture();
  await app.user.write(`/api/managed/${app.acceptanceId}/accept`, { expectedVersion: 0 });
  transitionManaged(app.context, app.admin.principal, { organizationId: ids.team, userId: ids.mai, expectedVersion: 1, action: "lapse" });
  // When: the administrator explicitly recovers the suspended account.
  transitionManaged(app.context, app.admin.principal, { organizationId: ids.team, userId: ids.mai, expectedVersion: 2, action: "recover" });
  // Then: recovery preserves content and clears suspension.
  expect(z.object({ suspended: z.number(), deleted_at: z.null() }).parse(app.runtime.db.query("SELECT suspended,deleted_at FROM users WHERE id=?").get(ids.mai)).suspended).toBe(0);
  expect(z.object({ owner_id: IdSchema }).parse(app.runtime.db.query("SELECT owner_id FROM projects WHERE id=?").get(ids.project)).owner_id).toBe(ids.kien);
});
test("reassigns before terminal deletion exactly at the 90-day lifecycle boundary", async () => {
  // Given: a lapsed managed account that owns a retained project.
  await using app = await managedFixture();
  await app.user.write(`/api/managed/${app.acceptanceId}/accept`, { expectedVersion: 0 });
  app.runtime.db.query("UPDATE projects SET owner_id=? WHERE id=?").run(ids.mai, ids.project);
  transitionManaged(app.context, app.admin.principal, { organizationId: ids.team, userId: ids.mai, expectedVersion: 1, action: "lapse" });
  app.setTime("2027-01-24T12:00:00.000Z");
  // When: lifecycle reconciliation reaches the exact 90-day boundary.
  transitionManaged(app.context, app.admin.principal, { organizationId: ids.team, userId: ids.mai, expectedVersion: 2,
    action: "advance", transferTo: ids.kien, lapseDays: 60, deletionDays: 90 });
  // Then: the principal is terminally deleted only after its content has a surviving owner.
  expect(z.object({ state: z.string() }).parse(app.runtime.db.query("SELECT state FROM managed_acceptances WHERE id=?").get(app.acceptanceId)).state).toBe("deleted");
  expect(z.object({ owner_id: IdSchema, deleted_at: z.null() }).parse(app.runtime.db.query("SELECT owner_id,deleted_at FROM projects WHERE id=?").get(ids.project)).owner_id).toBe(ids.kien);
});
