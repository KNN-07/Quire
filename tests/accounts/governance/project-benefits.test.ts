import { expect, test } from "bun:test";
import { endpoints } from "@quire/contracts";
import { governanceFixture, data } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

const grant = { compileSeconds: 90, writableMembers: 3, historyDays: null, trackChanges: true } as const;
const output = endpoints.adminProjectBenefitsGet.output;
for (const scope of [`user/${ids.kien}`, "plan/configured:price-controlled"]) {
  test(`retains withdrawal counters and rejects stale resurrection for ${scope}`, async () => {
    // Given: a fresh operator and an absent optional contribution.
    await using app = await governanceFixture();
    const operator = await app.login("operator@quire.local");
    const path = `/api/admin/project-benefits/${scope}`;
    expect(await data(await operator.get(path), output)).toEqual({ benefits: null, version: 0 });
    // When: a grant is created, withdrawn, and a stale update arrives.
    expect(await data(await operator.write(path, { benefits: grant, expectedVersion: 0 }, { method: "PUT" }), output))
      .toEqual({ benefits: grant, version: 1 });
    expect(await data(await operator.write(path, { benefits: null, expectedVersion: 1 }, { method: "PUT" }), output))
      .toEqual({ benefits: null, version: 2 });
    const stale = await operator.write(path, { benefits: grant, expectedVersion: 1 }, { method: "PUT" });
    // Then: the withdrawn contribution remains withdrawn at its newer version.
    expect(stale.status).toBe(409);
    expect(await data(await operator.get(path), output)).toEqual({ benefits: null, version: 2 });
  });
}
test("denies ordinary administrators and invalid deployment or user grants", async () => {
  // Given: separate organization-admin and operator authority.
  await using app = await governanceFixture();
  const admin = await app.login();
  const operator = await app.login("operator@quire.local");
  const body = { benefits: grant, expectedVersion: 0 };
  // When: unprivileged or invalid configuration attempts reach real handlers.
  const denied = await admin.write(`/api/admin/project-benefits/user/${ids.kien}`, body, { method: "PUT" });
  const missing = await operator.write(`/api/admin/project-benefits/user/${crypto.randomUUID()}`, body, { method: "PUT" });
  const withdrawn = await operator.write("/api/admin/project-benefits/deployment/local",
    { benefits: null, expectedVersion: 0 }, { method: "PUT" });
  const invalid = await operator.write("/api/admin/project-benefits/deployment/other", body, { method: "PUT" });
  // Then: neither delegated administration nor malformed keys can grant benefits.
  expect(denied.status).toBe(403);
  expect(missing.status).toBe(404);
  expect(withdrawn.status).toBe(422);
  expect(invalid.status).toBe(400);
});
test("requires fresh authentication and CSRF for configuration", async () => {
  // Given: an authenticated operator with a controlled session clock.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  const path = `/api/admin/project-benefits/user/${ids.kien}`;
  // When: CSRF is omitted, then the authenticated session ages past the sensitive window.
  const csrf = await app.request(path, { method: "PUT", headers: { cookie: operator.headers.cookie },
    body: JSON.stringify({ benefits: grant, expectedVersion: 0 }) });
  app.setTime("2026-10-26T12:15:00.001Z");
  const stale = await operator.get(path);
  // Then: both boundary checks reject access without storing a grant.
  expect(csrf.status).toBe(403);
  expect(stale.status).toBe(403);
  expect(await app.runtime.db.all("SELECT scope_kind FROM account_project_benefits")).toEqual([{ scope_kind: "deployment" }]);
});
