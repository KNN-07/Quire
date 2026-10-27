import { expect, test } from "bun:test";
import { z } from "zod";
import { AuditEntrySchema, IdSchema, UserSchema } from "@quire/contracts";
import { governanceFixture, data } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("transfers only the selected owned project through the operator endpoint", async () => {
  // Given: a true operator and an ordinary owner's selected project.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  // When: the operator transfers that project to a verified recipient.
  const response = await operator.write(`/api/admin/users/${ids.kien}/transfer`,
    { projectId: ids.project, to: ids.mai, expectedVersion: 0 });
  // Then: the project survives with its new owner and duplicate ownership ACL is removed.
  expect(response.status).toBe(200);
  expect(z.object({ owner_id: IdSchema }).parse(app.runtime.db.query("SELECT owner_id FROM projects WHERE id=?").get(ids.project)).owner_id).toBe(ids.mai);
  expect(app.runtime.db.query("SELECT id FROM project_members WHERE user_id=? AND project_id=?").get(ids.mai, ids.project)).toBeNull();
});
test("revokes user sessions without suspension through the operator endpoint", async () => {
  // Given: an independent signed-in account and operator.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  const user = await app.login("mai@quire.local");
  // When: the operator revokes that account's sessions at its aggregate version.
  const response = await operator.write(`/api/admin/users/${ids.mai}/revoke-sessions`, { expectedVersion: 0 });
  // Then: the bearer stops authenticating without suspending the underlying account.
  expect(response.status).toBe(200);
  expect((await user.get("/api/me")).status).toBe(401);
  expect(z.object({ suspended: z.number() }).parse(app.runtime.db.query("SELECT suspended FROM users WHERE id=?").get(ids.mai)).suspended).toBe(0);
});
test("returns operator user details with their real account ETag", async () => {
  // Given: a real user with a persisted nonzero version.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  app.runtime.db.query("UPDATE users SET version=7 WHERE id=?").run(ids.mai);
  // When: the operator reads its details.
  const response = await operator.get(`/api/admin/users/${ids.mai}`);
  // Then: the public profile is paired with the actual concurrency counter.
  expect(response.headers.get("etag")).toBe('"v7"');
  expect((await data(response, UserSchema)).id).toBe(ids.mai);
});
test("exports all matching users with safe CSV cells and without credential columns", async () => {
  // Given: an operator and a persisted formula-leading multiline display name.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  app.runtime.db.query("UPDATE users SET name=? WHERE id=?").run('=formula,"quoted"\nline', ids.mai);
  // When: all matching users are exported as CSV.
  const response = await operator.get("/api/admin/users.csv?q=mai");
  // Then: the actual data is quoted and formula-neutralized, without secret material.
  expect(response.status).toBe(200);
  const csv = await response.text();
  expect(csv).toContain(`"'=formula,""quoted""\nline"`);
  expect(csv).not.toContain("password_hash");
  expect(csv).not.toContain("token_hash");
});
test("redacts credential-shaped audit fields in authorized HTTP reads", async () => {
  // Given: an audit record from another producer with a sensitive scalar field.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  app.runtime.db.query("INSERT INTO audit_entries(id,at,event,target_id,details_json) VALUES(?,?,'provider.changed',?,?)")
    .run(crypto.randomUUID(), app.runtime.clock.now(), ids.team, JSON.stringify({ access_token: "credential-value", enabled: true }));
  // When: an operator reads audit history.
  const response = await data(await operator.get("/api/admin/audit"), z.object({ items: z.array(AuditEntrySchema) }));
  // Then: nonsecret fields remain useful while credentials do not cross the HTTP boundary.
  expect(response.items[0]?.details).toEqual({ access_token: "[redacted]", enabled: true });
});
test("restores retained managed soft deletion without restoring a permanently deleted principal", async () => {
  // Given: a retained managed soft-deletion record and an operator.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  app.runtime.db.query("UPDATE users SET managed_by=?,suspended=1,deleted_at=? WHERE id=?")
    .run(ids.team, app.runtime.clock.now(), ids.mai);
  app.runtime.db.query("INSERT INTO managed_acceptances(id,organization_id,user_id,state,created_at) VALUES(?,?,?,'soft_deleted',?)")
    .run(crypto.randomUUID(), ids.team, ids.mai, app.runtime.clock.now());
  // When: the operator restores the retained principal.
  const response = await operator.write(`/api/admin/users/${ids.mai}/restore`, { expectedVersion: 0 });
  // Then: the account is active and management returns to accepted rather than disappearing.
  expect((await data(response, UserSchema)).managedBy).toBe(ids.team);
  expect(z.object({ state: z.string() }).parse(app.runtime.db.query("SELECT state FROM managed_acceptances WHERE user_id=?").get(ids.mai)).state).toBe("accepted");
  expect(z.object({ suspended: z.number(), deleted_at: z.null() }).parse(app.runtime.db.query("SELECT suspended,deleted_at FROM users WHERE id=?").get(ids.mai)).suspended).toBe(0);
});
