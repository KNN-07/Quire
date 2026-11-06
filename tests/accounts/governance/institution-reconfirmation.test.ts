import { expect, test } from "bun:test";
import { endpoints, MembershipSchema, OrganizationSchema } from "@quire/contracts";
import { reconcileInstitutionEligibility } from "../../../services/accounts/governance/lifecycle";
import { data, governanceFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("institution periods are opt-in, versioned, authorized and prospective; members explicitly renew from the clock", async () => {
  await using app = await governanceFixture();
  const admin = await app.login("operator@quire.local");
  const user = await app.login("mai@quire.local");
  await app.runtime.db.run("UPDATE organizations SET domains_json=? WHERE id=?", ['["quire.local"]', ids.institution]);
  const org = await data(await admin.get(`/api/organizations/${ids.institution}`), OrganizationSchema);
  const policyPath = `/api/organizations/${org.id}/institution-policy`;
  const enrollPath = `/api/institutions/${org.slug}/enroll`;
  const statusPath = `/api/institutions/${org.slug}/eligibility`;
  expect(await data(await admin.get(policyPath), endpoints.institutionPolicyGet.output)).toEqual({ reconfirmationDays: null, version: 0 });
  expect((await user.get(policyPath)).status).toBe(403);
  expect((await user.write(policyPath, { reconfirmationDays: 1, expectedVersion: 0 }, { method: "PUT" })).status).toBe(403);
  const original = await data(await user.write(enrollPath), MembershipSchema);
  expect(await data(await user.get(statusPath), endpoints.institutionEligibility.output)).toMatchObject({ state: "current", expiresAt: null });
  expect((await admin.write(policyPath, { reconfirmationDays: 1, expectedVersion: 0 }, { method: "PUT" })).status).toBe(200);
  expect((await admin.write(policyPath, { reconfirmationDays: 2, expectedVersion: 0 }, { method: "PUT" })).status).toBe(409);
  expect((await admin.write(policyPath, { reconfirmationDays: 0, expectedVersion: 1 }, { method: "PUT" })).status).toBe(400);
  expect(await data(await user.get(statusPath), endpoints.institutionEligibility.output)).toMatchObject({ expiresAt: null });
  app.setTime("2026-10-26T13:00:00.000Z");
  const key = crypto.randomUUID();
  expect(await data(await user.write(enrollPath, {}, { key }), MembershipSchema)).toEqual(original);
  expect(await data(await user.get(statusPath), endpoints.institutionEligibility.output)).toMatchObject({
    checkedAt: "2026-10-26T13:00:00.000Z", expiresAt: "2026-10-27T13:00:00.000Z",
  });
  app.setTime("2026-10-26T14:00:00.000Z");
  expect((await user.write(enrollPath, {}, { key })).status).toBe(200);
  expect(await data(await user.get(statusPath), endpoints.institutionEligibility.output)).toMatchObject({ expiresAt: "2026-10-27T13:00:00.000Z" });
  expect((await user.write(enrollPath)).status).toBe(200);
  expect(await data(await user.get(statusPath), endpoints.institutionEligibility.output)).toMatchObject({ expiresAt: "2026-10-27T14:00:00.000Z" });
  app.setTime("2026-10-27T13:59:59.999Z");
  expect(await reconcileInstitutionEligibility(app.context)).toBe(0);
  app.setTime("2026-10-27T14:00:00.000Z");
  expect(await data(await user.get(statusPath), endpoints.institutionEligibility.output)).toMatchObject({ state: "expired", member: true });
  expect(await reconcileInstitutionEligibility(app.context)).toBe(1);
  expect(await reconcileInstitutionEligibility(app.context)).toBe(0);
  expect(await data(await user.get(statusPath), endpoints.institutionEligibility.output)).toMatchObject({ state: "expired", member: false });
  expect((await user.write(enrollPath)).status).toBe(200);
  expect(await data(await user.get(statusPath), endpoints.institutionEligibility.output)).toMatchObject({ state: "current", member: true });
  await app.runtime.db.run("DELETE FROM verified_emails WHERE user_id=?", [ids.mai]);
  expect((await user.write(enrollPath)).status).toBe(403);
  expect(await data(await user.get(statusPath), endpoints.institutionEligibility.output)).toMatchObject({ state: "ineligible" });
  expect(await reconcileInstitutionEligibility(app.context)).toBe(1);
  expect((await admin.write(policyPath, { reconfirmationDays: null, expectedVersion: 1 }, { method: "PUT" })).status).toBe(200);
  expect(await data(await admin.get(policyPath), endpoints.institutionPolicyGet.output)).toEqual({ reconfirmationDays: null, version: 2 });
});

test("renewal and expiry retain explicit institution administrator grants", async () => {
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  const user = await app.login("mai@quire.local");
  await app.runtime.db.run("UPDATE organizations SET domains_json=? WHERE id=?", ['["quire.local"]', ids.institution]);
  const org = await data(await operator.get(`/api/organizations/${ids.institution}`), OrganizationSchema);
  const path = `/api/institutions/${org.slug}/enroll`;
  const enrolled = await data(await user.write(path), MembershipSchema);
  expect((await operator.write(`/api/organizations/${ids.institution}/members/${enrolled.id}`,
    { role: "admin", expectedVersion: enrolled.version }, { method: "PATCH" })).status).toBe(200);
  expect((await user.write(`/api/organizations/${ids.institution}/institution-policy`,
    { reconfirmationDays: 1, expectedVersion: 0 }, { method: "PUT" })).status).toBe(200);
  expect(await data(await user.write(path), MembershipSchema)).toMatchObject({ id: enrolled.id, role: "admin", licensed: false });
  app.setTime("2026-10-27T12:00:00.000Z");
  expect(await reconcileInstitutionEligibility(app.context)).toBe(0);
  expect(await app.runtime.db.get("SELECT role FROM members WHERE id=?", [enrolled.id])).toMatchObject({ role: "admin" });
  expect(await data(await user.get(`/api/institutions/${org.slug}/eligibility`), endpoints.institutionEligibility.output))
    .toMatchObject({ state: "expired", member: true });
});
