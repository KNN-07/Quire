import { expect, test } from "bun:test";
import { governanceFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test.each([
  ["mai", ids.mai, "member", false],
  ["sam", ids.sam, "manager", false],
  ["kien", ids.kien, "admin", false],
  ["operator", ids.operator, null, true],
  ["operator", ids.operator, "member", true],
  ["operator", ids.operator, "manager", true],
] as const)("organization access for %s (%s) retains role %s and operator=%s", async (name, userId, role, operator) => {
  // Given a real account with independently assigned membership and operator authority.
  await using app = await governanceFixture();
  if (role !== null) {
    await app.runtime.db.run(`INSERT INTO members(id,organization_id,user_id,role,licensed,created_at)
      VALUES(?,?,?,?,0,?) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=excluded.role`,
    [crypto.randomUUID(), ids.team, userId, role, app.runtime.clock.now()]);
  }
  const actor = await app.login(`${name}@quire.local`);
  // When the account reads its organization-specific authority.
  const response = await actor.get(`/api/organizations/${ids.team}/access`);
  // Then both dimensions are explicit; no directory scan or success/failure inference is needed.
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: { role, operator } });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("etag")).toBe('"v0"');
});

test("organization access rejects unauthenticated and unrelated accounts", async () => {
  // Given an existing organization and an unrelated ordinary account.
  await using app = await governanceFixture();
  const outsider = await app.login("outsider@quire.local");
  // When either caller requests its metadata.
  const anonymous = await app.request(`/api/organizations/${ids.team}/access`);
  const unrelated = await outsider.get(`/api/organizations/${ids.team}/access`);
  // Then organization data remains behind the existing membership/operator gate.
  expect(anonymous.status).toBe(401);
  expect(unrelated.status).toBe(403);
});
