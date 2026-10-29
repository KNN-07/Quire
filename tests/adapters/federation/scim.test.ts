import { expect, test } from "bun:test";
import { z } from "zod";
import { fixture, password } from "./harness";
import { scimSchemas } from "../../../services/adapters/federation/scim-schema";
import { fixtureIds } from "../../fixtures/foundation";
import { acceptManagement } from "./managed-fixture";

const resource = z.object({ id: z.string(), externalId: z.string(), active: z.boolean().optional(), meta: z.object({ version: z.string() }) });
const user = { schemas: [scimSchemas.Users], externalId: "immutable-subject", userName: "provisioned@example.test", active: true };

test("returns the existing user when externalId is retried with identical input", async () => {
  // Given
  await using app = await fixture();
  const headers = await app.token();
  const created = await app.request("/scim/v2/Users", { method: "POST", headers, body: JSON.stringify(user) });
  const first = resource.parse(await created.json());
  // When
  const retry = await app.request("/scim/v2/Users", { method: "POST", headers, body: JSON.stringify(user) });
  // Then
  expect(created.status).toBe(201);
  expect(retry.status).toBe(200);
  expect(resource.parse(await retry.json()).id).toBe(first.id);
});
test("rejects changed input when a create reuses an existing externalId", async () => {
  // Given
  await using app = await fixture();
  const headers = await app.token();
  await app.request("/scim/v2/Users", { method: "POST", headers, body: JSON.stringify(user) });
  // When
  const conflict = await app.request("/scim/v2/Users", { method: "POST", headers, body: JSON.stringify({ ...user, userName: "changed@example.test" }) });
  // Then
  expect(conflict.status).toBe(409);
});
test("filters and paginates users when an authorized SCIM client requests a window", async () => {
  // Given
  await using app = await fixture();
  const headers = await app.token();
  await app.request("/scim/v2/Users", { method: "POST", headers, body: JSON.stringify(user) });
  // When
  const response = await app.request(`/scim/v2/Users?count=0&filter=${encodeURIComponent('externalId eq "immutable-subject"')}`, { headers });
  // Then
  expect(response.headers.get("content-type")).toContain("application/scim+json");
  expect(await response.json()).toMatchObject({ totalResults: 1, startIndex: 1, itemsPerPage: 0, Resources: [] });
});
test("requires ETag when a user is deactivated", async () => {
  // Given
  await using app = await fixture();
  const headers = await app.token();
  const created = resource.parse(await (await app.request("/scim/v2/Users", { method: "POST", headers, body: JSON.stringify(user) })).json());
  // When
  const response = await app.request(`/scim/v2/Users/${created.id}`, { method: "PATCH", headers: { ...headers, "if-match": 'W/"999"' },
    body: JSON.stringify({ schemas: [scimSchemas.patch], Operations: [{ op: "replace", path: "active", value: false }] }) });
  // Then
  expect(response.status).toBe(412);
  expect(z.object({ suspended: z.number() }).parse(await app.runtime.db.get("SELECT suspended FROM users WHERE primary_email=?", [user.userName]))).toEqual({ suspended: 0 });
});
test("disables login without deleting the account when active is replaced with false", async () => {
  // Given
  await using app = await fixture();
  const headers = await app.token();
  const created = resource.parse(await (await app.request("/scim/v2/Users", { method: "POST", headers, body: JSON.stringify(user) })).json());
  app.provider.state.subject = user.externalId;
  app.provider.state.email = user.userName;
  // When
  const response = await app.request(`/scim/v2/Users/${created.id}`, { method: "PATCH", headers: { ...headers, "if-match": created.meta.version },
    body: JSON.stringify({ schemas: [scimSchemas.patch], Operations: [{ op: "replace", path: "active", value: false }] }) });
  // Then
  expect(response.status).toBe(200);
  expect(resource.parse(await response.json()).active).toBe(false);
  const authorization = await app.begin();
  expect((await app.request(authorization.path, { headers: { cookie: authorization.cookie } })).status).toBe(401);
  expect(z.object({ suspended: z.number(), deleted_at: z.string().nullable(), managed_by: z.string().nullable() }).parse(await app.runtime.db.get("SELECT suspended,deleted_at,managed_by FROM users WHERE primary_email=?", [user.userName])))
    .toEqual({ suspended: 1, deleted_at: null, managed_by: null });
});
test("keeps project ownership when deactivation has no explicit transfer target", async () => {
  // Given
  await using app = await fixture();
  const headers = await app.token();
  const created = resource.parse(await (await app.request("/scim/v2/Users", { method: "POST", headers, body: JSON.stringify(user) })).json());
  await app.runtime.db.run("UPDATE projects SET owner_id=(SELECT user_id FROM federation_resources WHERE id=?) WHERE id=?", [created.id, fixtureIds.project]);
  // When
  const response = await app.request(`/scim/v2/Users/${created.id}`, { method: "DELETE", headers: { ...headers, "if-match": created.meta.version } });
  // Then
  expect(response.status).toBe(409);
  expect(z.object({ suspended: z.number() }).parse(await app.runtime.db.get("SELECT suspended FROM users WHERE primary_email=?", [user.userName]))).toEqual({ suspended: 0 });
  expect(await app.runtime.db.get("SELECT id FROM projects WHERE id=? AND owner_id=(SELECT user_id FROM federation_resources WHERE id=?)", [fixtureIds.project, created.id])).not.toBeNull();
});
test("transfers projects before disabling an accepted managed owner with an explicit verified target", async () => {
  // Given
  await using app = await fixture({ organizationId: fixtureIds.team, transferTo: fixtureIds.kien });
  const headers = await app.token();
  const created = resource.parse(await (await app.request("/scim/v2/Users", { method: "POST", headers, body: JSON.stringify(user) })).json());
  const managed = await acceptManagement(app, created.id);
  await app.runtime.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',0,?) ON CONFLICT DO NOTHING",
    [crypto.randomUUID(), fixtureIds.team, fixtureIds.kien, app.runtime.clock.now()]);
  await app.runtime.db.run("UPDATE projects SET owner_id=(SELECT user_id FROM federation_resources WHERE id=?) WHERE id=?", [created.id, fixtureIds.project]);
  const denied = await app.request(`/scim/v2/Users/${created.id}`, { method: "DELETE", headers: { ...headers, "if-match": created.meta.version } });
  expect(denied.status).toBe(409);
  expect(await app.runtime.db.get("SELECT id FROM projects WHERE id=? AND owner_id=?", [fixtureIds.project, managed.account.id])).not.toBeNull();
  const organization = z.object({ version: z.number() }).parse(await app.runtime.db.get("SELECT version FROM organizations WHERE id=?", [fixtureIds.team]));
  const invitation = await app.request(`/api/organizations/${fixtureIds.team}/managed/invite`, {
    method: "POST", headers: { ...managed.operator.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ userId: fixtureIds.kien, expectedVersion: organization.version }),
  });
  expect(invitation.status).toBe(200);
  expect((await app.request(`/scim/v2/Users/${created.id}`, { method: "DELETE", headers: { ...headers, "if-match": created.meta.version } })).status).toBe(409);
  const acceptance = z.object({ id: z.string(), version: z.number() }).parse(await app.runtime.db.get(
    "SELECT id,version FROM managed_acceptances WHERE organization_id=? AND user_id=?", [fixtureIds.team, fixtureIds.kien]));
  const recipient = await app.login("kien@quire.local");
  expect((await app.request(`/api/managed/${acceptance.id}/accept`, {
    method: "POST", headers: { ...recipient.headers, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ expectedVersion: acceptance.version }),
  })).status).toBe(200);
  // When
  const response = await app.request(`/scim/v2/Users/${created.id}`, { method: "DELETE", headers: { ...headers, "if-match": created.meta.version } });
  // Then
  expect(response.status).toBe(204);
  expect(z.object({ owner_id: z.string() }).parse(await app.runtime.db.get("SELECT owner_id FROM projects WHERE id=?", [fixtureIds.project]))).toEqual({ owner_id: fixtureIds.kien });
  expect(z.object({ suspended: z.number(), deleted_at: z.string().nullable() }).parse(await app.runtime.db.get("SELECT suspended,deleted_at FROM users WHERE primary_email=?", [user.userName]))).toEqual({ suspended: 1, deleted_at: null });
});
test("denies project transfer when the user has never accepted institutional management", async () => {
  // Given
  await using app = await fixture({ transferTo: fixtureIds.kien });
  const headers = await app.token();
  const created = resource.parse(await (await app.request("/scim/v2/Users", { method: "POST", headers, body: JSON.stringify(user) })).json());
  await app.runtime.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',0,?) ON CONFLICT DO NOTHING",
    [crypto.randomUUID(), fixtureIds.institution, fixtureIds.kien, app.runtime.clock.now()]);
  await app.runtime.db.run("UPDATE projects SET owner_id=(SELECT user_id FROM federation_resources WHERE id=?) WHERE id=?", [created.id, fixtureIds.project]);
  // When
  const response = await app.request(`/scim/v2/Users/${created.id}`, { method: "DELETE", headers: { ...headers, "if-match": created.meta.version } });
  // Then
  expect(response.status).toBe(409);
  expect(await app.runtime.db.get("SELECT id FROM projects WHERE id=? AND owner_id=(SELECT user_id FROM federation_resources WHERE id=?)", [fixtureIds.project, created.id])).not.toBeNull();
});
test("preserves independent recovery after the managed owner is explicitly released", async () => {
  // Given
  await using app = await fixture({ organizationId: fixtureIds.team, transferTo: fixtureIds.kien });
  const headers = await app.token();
  const created = resource.parse(await (await app.request("/scim/v2/Users", { method: "POST", headers, body: JSON.stringify(user) })).json());
  const managed = await acceptManagement(app, created.id);
  const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 });
  await app.runtime.db.run("UPDATE users SET password_hash=? WHERE id=?", [passwordHash, managed.account.id]);
  const version = z.object({ version: z.number() }).parse(await app.runtime.db.get("SELECT version FROM users WHERE id=?", [managed.account.id]));
  const released = await app.request(`/api/organizations/${fixtureIds.team}/managed/${managed.account.id}/release`, {
    method: "POST", headers: managed.operator.headers, body: JSON.stringify({ expectedVersion: version.version }) });
  expect(released.status).toBe(200);
  // When
  const response = await app.request(`/scim/v2/Users/${created.id}`, { method: "DELETE", headers: { ...headers, "if-match": created.meta.version } });
  // Then
  expect(response.status).toBe(409);
  expect(z.object({ suspended: z.number(), managed_by: z.string().nullable() }).parse(
    await app.runtime.db.get("SELECT suspended,managed_by FROM users WHERE id=?", [managed.account.id]))).toEqual({ suspended: 0, managed_by: null });
});
test("revokes the old bearer when the operator rotates SCIM credentials", async () => {
  // Given
  await using app = await fixture();
  const old = await app.token();
  const current = await app.token();
  // When
  const response = await app.request("/scim/v2/Users", { headers: old });
  // Then
  expect(response.status).toBe(401);
  expect((await app.request("/scim/v2/Users", { headers: current })).status).toBe(200);
});
test("protects an explicitly enrolled break-glass user from SCIM deactivation", async () => {
  // Given
  await using app = await fixture();
  const headers = await app.token();
  const created = resource.parse(await (await app.request("/scim/v2/Users", { method: "POST", headers, body: JSON.stringify(user) })).json());
  const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 });
  await app.runtime.db.run("UPDATE users SET operator=1,password_hash=? WHERE primary_email=?", [passwordHash, user.userName]);
  const operator = await app.login(user.userName);
  const enrolled = await app.request("/api/admin/identity/break-glass", { method: "POST", headers: operator.headers, body: JSON.stringify({ password }) });
  expect(enrolled.status).toBe(200);
  // When
  const response = await app.request(`/scim/v2/Users/${created.id}`, { method: "PATCH", headers: { ...headers, "if-match": created.meta.version },
    body: JSON.stringify({ schemas: [scimSchemas.patch], Operations: [{ op: "replace", path: "active", value: false }] }) });
  // Then
  expect(response.status).toBe(403);
  expect(z.object({ suspended: z.number() }).parse(await app.runtime.db.get("SELECT suspended FROM users WHERE primary_email=?", [user.userName]))).toEqual({ suspended: 0 });
});
