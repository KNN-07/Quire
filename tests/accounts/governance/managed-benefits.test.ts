import { expect, test } from "bun:test";
import { z } from "zod";
import { MembershipSchema, ProjectSchema, IdSchema } from "@quire/contracts";
import { governanceFixture, data } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { applyBillingTransition } from "../../../services/accounts/governance";
import { ownerBenefits } from "../../../services/accounts/identity/project-benefits";

test("removes only the releasing organization's membership while independent grants and ownership survive", async () => {
  // Given: accepted management and two distinct active licensed sponsorships.
  await using app = await governanceFixture({ core: true });
  const operator = await app.login("operator@quire.local");
  const admin = await app.login();
  const user = await app.login("mai@quire.local");
  const basic = { compileSeconds: 12, writableMembers: 1, historyDays: 1, trackChanges: false };
  for (const [scope, benefits] of [
    ["deployment/local", basic], [`user/${ids.mai}`, { ...basic, compileSeconds: 30 }],
    ["plan/manual:team", { ...basic, compileSeconds: 90, writableMembers: 3 }],
    ["plan/manual:institution", { ...basic, compileSeconds: 60, writableMembers: 2 }],
  ] as const) expect((await operator.write(`/api/admin/project-benefits/${scope}`, { benefits, expectedVersion: 0 }, { method: "PUT" })).status).toBe(200);
  for (const [organizationId, planId] of [[ids.team, "team"], [ids.institution, "institution"]] as const) {
    await applyBillingTransition(app.context, operator.principal, { organizationId, planId, expectedVersion: 0,
      provider: "manual", period: "month", seats: 3, status: "active", renewsAt: null });
    if (organizationId === ids.team) {
      await data(await operator.write(`/api/organizations/${organizationId}/members`,
        { userId: ids.mai, role: "member", licensed: true, expectedVersion: 0 }), MembershipSchema);
    } else {
      await app.runtime.db.run("UPDATE organizations SET domains_json=? WHERE id=?", ['["quire.local"]', organizationId]);
      const institution = z.object({ slug: z.string() }).parse(await app.runtime.db.get("SELECT slug FROM organizations WHERE id=?", [organizationId]));
      const enrolled = await data(await user.write(`/api/institutions/${institution.slug}/enroll`), MembershipSchema);
      await data(await operator.write(`/api/organizations/${organizationId}/members/${enrolled.id}`,
        { licensed: true, expectedVersion: enrolled.version }, { method: "PATCH" }), MembershipSchema);
    }
  }
  expect((await admin.write(`/api/organizations/${ids.team}/managed/invite`, { userId: ids.mai, expectedVersion: 1 })).status).toBe(200);
  const invitation = z.object({ id: IdSchema }).parse(await app.runtime.db.get("SELECT id FROM managed_acceptances WHERE user_id=?", [ids.mai]));
  expect((await user.write(`/api/managed/${invitation.id}/accept`, { expectedVersion: 0 })).status).toBe(200);
  const owned = [];
  for (const workspaceId of [ids.team, null]) {
    owned.push(await data(await user.write("/api/projects", { name: "Retained owned project", origin: { kind: "blank" },
      ...(workspaceId ? { workspaceId } : {}) }), ProjectSchema));
  }
  expect((await ownerBenefits(app.context, ids.mai)).compileSeconds).toBe(90);
  const other = await app.runtime.db.get("SELECT * FROM members WHERE organization_id=? AND user_id=?", [ids.institution, ids.mai]);
  const cursor = Math.max(0, ...(await app.runtime.events.read(0, { limit: 1000 })).map(event => event.seq));
  // When: an actual administrator releases accepted management.
  const response = await admin.write(`/api/organizations/${ids.team}/managed/${ids.mai}/release`, { expectedVersion: 1 });
  // Then: the team's membership and license end without touching independent sponsorship.
  expect(response.status).toBe(200);
  expect(await app.runtime.db.get("SELECT role,licensed,version FROM members WHERE organization_id=? AND user_id=?", [ids.team, ids.mai]))
    .toBeNull();
  expect(await app.runtime.db.get("SELECT * FROM members WHERE organization_id=? AND user_id=?", [ids.institution, ids.mai])).toEqual(other);
  expect((await ownerBenefits(app.context, ids.mai)).compileSeconds).toBe(60);
  for (const project of owned) {
    expect(await app.runtime.db.get("SELECT owner_id,deleted_at FROM projects WHERE id=?", [project.id])).toEqual({ owner_id: ids.mai, deleted_at: null });
    expect((await app.runtime.events.read(cursor, { aggregateId: project.id })).some(event =>
      event.topic === "policy.changed" && event.payload.resourceId === project.id)).toBe(true);
  }
  expect((await user.get("/api/me")).status).toBe(401);
  expect((await (await app.login("mai@quire.local")).get("/api/me")).status).toBe(200);
});
