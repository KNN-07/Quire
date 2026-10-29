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
  const row = z.object({ id: IdSchema }).parse((await app.runtime.db.get("SELECT id FROM managed_acceptances WHERE user_id=? AND organization_id=?", [ids.mai, ids.team])));
  return { ...app, admin, user, acceptanceId: row.id };
}
async function configureManagedOwnerBenefits(app: Awaited<ReturnType<typeof managedFixture>>) {
  const operator = await app.login("operator@quire.local");
  for (const [scope, benefits] of [
    ["deployment/local", { compileSeconds: 12, writableMembers: 1, historyDays: 1, trackChanges: false }],
    [`user/${ids.mai}`, { compileSeconds: 90, writableMembers: 3, historyDays: null, trackChanges: true }],
  ] as const) expect((await operator.write(`/api/admin/project-benefits/${scope}`,
    { benefits, expectedVersion: 0 }, { method: "PUT" })).status).toBe(200);
}
async function acceptTransferRecipient(app: Awaited<ReturnType<typeof managedFixture>>) {
  expect((await app.admin.write(`/api/organizations/${ids.team}/managed/invite`,
    { userId: ids.kien, expectedVersion: 1 })).status).toBe(200);
  const recipient = z.object({ id: IdSchema }).parse(await app.runtime.db.get(
    "SELECT id FROM managed_acceptances WHERE organization_id=? AND user_id=?", [ids.team, ids.kien]));
  expect((await app.admin.write(`/api/managed/${recipient.id}/accept`, { expectedVersion: 0 })).status).toBe(200);
}
test("requires the invited account to accept management before any account control", async () => {
  // Given: an invitation that has not changed user ownership.
  await using app = await managedFixture();
  const attacker = await app.login("sam@quire.local");
  expect(z.object({ managed_by: z.null() }).parse((await app.runtime.db.get("SELECT managed_by FROM users WHERE id=?", [ids.mai]))).managed_by).toBeNull();
  // When: another account tries to accept the invitation.
  const response = await attacker.write(`/api/managed/${app.acceptanceId}/accept`, { expectedVersion: 0 });
  // Then: the account remains unmanaged; only its own authenticated acceptance works.
  expect(response.status).toBe(404);
  expect((await app.user.write(`/api/managed/${app.acceptanceId}/accept`, { expectedVersion: 0 })).status).toBe(200);
  expect(z.object({ managed_by: IdSchema }).parse((await app.runtime.db.get("SELECT managed_by FROM users WHERE id=?", [ids.mai]))).managed_by).toBe(ids.team);
});

test("preserves projects when accepted management is released", async () => {
  // Given: accepted management and personal ownership independent of organization membership.
  await using app = await managedFixture();
  await app.user.write(`/api/managed/${app.acceptanceId}/accept`, { expectedVersion: 0 });
  await app.runtime.db.run("UPDATE projects SET owner_id=? WHERE id=?", [ids.mai, ids.project]);
  // When: the administrator releases the managed account using its account counter.
  const response = await app.admin.write(`/api/organizations/${ids.team}/managed/${ids.mai}/release`, { expectedVersion: 1 });
  // Then: ownership, password and account survive; management alone ends.
  expect(response.status).toBe(200);
  const owner = z.object({ owner_id: IdSchema, deleted_at: z.null() }).parse((await app.runtime.db.get("SELECT owner_id,deleted_at FROM projects WHERE id=?", [ids.project])));
  expect(owner.owner_id).toBe(ids.mai);
  expect(z.object({ managed_by: z.null(), suspended: z.literal(0) }).parse((await app.runtime.db.get("SELECT managed_by,suspended FROM users WHERE id=?", [ids.mai]))).managed_by).toBeNull();
  expect(z.object({ state: z.string() }).parse((await app.runtime.db.get("SELECT state FROM managed_acceptances WHERE id=?", [app.acceptanceId]))).state).toBe("released");
});

test("reassigns every owned project before managed deletion and immediately revokes sessions", async () => {
  // Given: a managed owner, an unrelated project and a valid target.
  await using app = await managedFixture();
  await app.user.write(`/api/managed/${app.acceptanceId}/accept`, { expectedVersion: 0 });
  await configureManagedOwnerBenefits(app);
  await acceptTransferRecipient(app);
  const second = IdSchema.parse(crypto.randomUUID());
  await app.runtime.db.run("INSERT INTO projects(id,name,owner_id,settings_json,created_at,updated_at) SELECT ?,'Personal',?,'{}',created_at,updated_at FROM projects WHERE id=?", [second, ids.mai, ids.project]);
  // When: a valid administrator deletes the managed account with reassignment.
  const response = await app.admin.write(`/api/organizations/${ids.team}/managed/${ids.mai}/delete`,
    { transferTo: ids.kien, expectedVersion: 1 });
  // Then: its project survives under the target, unrelated ownership is intact and its session dies.
  expect(response.status).toBe(200);
  expect(z.object({ owner_id: IdSchema }).parse((await app.runtime.db.get("SELECT owner_id FROM projects WHERE id=?", [second]))).owner_id).toBe(ids.kien);
  expect(z.object({ owner_id: IdSchema, deleted_at: z.null() }).parse((await app.runtime.db.get("SELECT owner_id,deleted_at FROM projects WHERE id=?", [ids.project]))).owner_id).toBe(ids.kien);
  expect((await app.user.get("/api/me")).status).toBe(401);
  expect(await app.runtime.services.get("policy").forProject(ids.kien, second)).toMatchObject({
    compileSeconds: 12, writableMembers: 1, historyDays: 1, trackChanges: false,
  });
  expect(await app.runtime.db.get("SELECT writable_member_ids_json FROM projects WHERE id=?", [second]))
    .toEqual({ writable_member_ids_json: "[]" });
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
  await transitionManaged(app.context, app.admin.principal, { organizationId: ids.team, userId: ids.mai, expectedVersion: 1, action: "lapse" });
  app.setTime("2026-12-25T12:00:00.000Z");
  // When: the clock reaches exactly the 60-day managed lapse boundary.
  await transitionManaged(app.context, app.admin.principal, { organizationId: ids.team, userId: ids.mai, expectedVersion: 2,
    action: "advance", transferTo: ids.kien });
  // Then: recoverable soft deletion is distinct from principal destruction.
  expect(z.object({ state: z.string() }).parse((await app.runtime.db.get("SELECT state FROM managed_acceptances WHERE id=?", [app.acceptanceId]))).state).toBe("soft_deleted");
  expect((await app.runtime.db.get("SELECT id FROM projects WHERE id=?", [ids.project]))).not.toBeNull();
});
test("recovers a retained lapsed account without changing project ownership", async () => {
  // Given: a real managed acceptance followed by a recoverable lapse.
  await using app = await managedFixture();
  await app.user.write(`/api/managed/${app.acceptanceId}/accept`, { expectedVersion: 0 });
  await transitionManaged(app.context, app.admin.principal, { organizationId: ids.team, userId: ids.mai, expectedVersion: 1, action: "lapse" });
  // When: the administrator explicitly recovers the suspended account.
  await transitionManaged(app.context, app.admin.principal, { organizationId: ids.team, userId: ids.mai, expectedVersion: 2, action: "recover" });
  // Then: recovery preserves content and clears suspension.
  expect(z.object({ suspended: z.number(), deleted_at: z.null() }).parse((await app.runtime.db.get("SELECT suspended,deleted_at FROM users WHERE id=?", [ids.mai]))).suspended).toBe(0);
  expect(z.object({ owner_id: IdSchema }).parse((await app.runtime.db.get("SELECT owner_id FROM projects WHERE id=?", [ids.project]))).owner_id).toBe(ids.kien);
});
test("reassigns before terminal deletion exactly at the 90-day lifecycle boundary", async () => {
  // Given: a lapsed managed account that owns a retained project.
  await using app = await managedFixture();
  await app.user.write(`/api/managed/${app.acceptanceId}/accept`, { expectedVersion: 0 });
  await configureManagedOwnerBenefits(app);
  await acceptTransferRecipient(app);
  await app.runtime.db.run("UPDATE projects SET owner_id=? WHERE id=?", [ids.mai, ids.project]);
  await transitionManaged(app.context, app.admin.principal, { organizationId: ids.team, userId: ids.mai, expectedVersion: 1, action: "lapse" });
  app.setTime("2027-01-24T12:00:00.000Z");
  // When: lifecycle reconciliation reaches the exact 90-day boundary.
  await transitionManaged(app.context, app.admin.principal, { organizationId: ids.team, userId: ids.mai, expectedVersion: 2,
    action: "advance", transferTo: ids.kien, lapseDays: 60, deletionDays: 90 });
  // Then: the principal is terminally deleted only after its content has a surviving owner.
  expect(z.object({ state: z.string() }).parse((await app.runtime.db.get("SELECT state FROM managed_acceptances WHERE id=?", [app.acceptanceId]))).state).toBe("deleted");
  expect(z.object({ owner_id: IdSchema, deleted_at: z.null() }).parse((await app.runtime.db.get("SELECT owner_id,deleted_at FROM projects WHERE id=?", [ids.project]))).owner_id).toBe(ids.kien);
  expect(await app.runtime.services.get("policy").forProject(ids.kien, ids.project)).toMatchObject({
    compileSeconds: 12, writableMembers: 1, historyDays: 1, trackChanges: false,
  });
  expect(await app.runtime.db.get("SELECT writable_member_ids_json FROM projects WHERE id=?", [ids.project]))
    .toEqual({ writable_member_ids_json: "[]" });
});
