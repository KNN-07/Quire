import { expect, test } from "bun:test";
import { identityFixture, password, errorEnvelope } from "./harness";
import { fixtureIds } from "../../fixtures/foundation";

test("preserves the last active operator when self-deletion is requested", async () => {
  // Given: the only active operator, authenticated with their real password.
  await using app = await identityFixture({ seed: true });
  const operator = await app.login("operator@quire.local");
  // When: they attempt to permanently delete their own account.
  const response = await app.request("/api/me", { method: "DELETE", headers: operator.headers,
    body: JSON.stringify({ confirmation: operator.user.primaryEmail, password, expectedVersion: 0 }) });
  // Then: the instance keeps its management access and unchanged account version.
  expect(response.status).toBe(409);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("LAST_OPERATOR");
  const profile = await app.request("/api/me", { headers: operator.headers });
  expect(profile.status).toBe(200);
  expect(profile.headers.get("etag")).toBe('"v0"');
});

test("allows operator self-deletion when another active operator remains", async () => {
  // Given: a second active operator can still administer the instance.
  await using app = await identityFixture({ seed: true });
  const operator = await app.login("operator@quire.local");
  app.runtime.db.query("UPDATE users SET operator=1 WHERE id=?").run(fixtureIds.mai);
  // When: the original operator deletes their account using fresh credentials.
  const response = await app.request("/api/me", { method: "DELETE", headers: operator.headers,
    body: JSON.stringify({ confirmation: operator.user.primaryEmail, password, expectedVersion: 0 }) });
  // Then: deletion succeeds and the deleted session stops authenticating.
  expect(response.status).toBe(200);
  expect((await app.request("/api/me", { headers: operator.headers })).status).toBe(401);
});
