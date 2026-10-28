import { expect, test } from "bun:test";
import { z } from "zod";
import { AuthOptionsSchema, CapabilitySchema, IdSchema, LinkedIdentitySchema, SessionSchema } from "@quire/contracts";
import { registerAuthProviderCapability } from "../../../services/accounts/identity";
import { fixtureIds } from "../../fixtures/foundation";
import { identityFixture } from "./harness";

test("reports implemented local authentication without inventing external providers", async () => {
  // Given: a local runtime with no external identity adapter registered.
  await using fixture = await identityFixture();
  // When: an unauthenticated client reads authentication options over HTTP.
  const response = await fixture.request("/api/auth/options");
  // Then: the implemented password/registration flows are available and there are no invented providers.
  expect(response.status).toBe(200);
  const options = z.object({ data: AuthOptionsSchema }).parse(await response.json()).data;
  expect(options).toEqual({ passwordEnabled: true, registrationEnabled: true, providers: [] });
});

test("reads registered external capabilities from their current configuration without cross-runtime leakage", async () => {
  // Given: one runtime whose adapter capability reader consumes real persisted configuration.
  await using fixture = await identityFixture();
  await using independent = await identityFixture();
  const { db, clock } = fixture.runtime;
  await db.run("INSERT INTO operator_settings(key,value_json,updated_at) VALUES('test-auth-provider',?,?)", [JSON.stringify({ enabled: false, state: "unconfigured" }), clock.now()]);
  registerAuthProviderCapability(fixture.runtime, {
    id: "test-idp", label: "Configured test IdP",
    read: async () => {
      const row = z.object({ value_json: z.string() }).parse(
        (await db.get("SELECT value_json FROM operator_settings WHERE key='test-auth-provider'", [])));
      return CapabilitySchema.parse(JSON.parse(row.value_json));
    },
  });
  const initial = z.object({ data: AuthOptionsSchema }).parse(
    await (await fixture.request("/api/auth/options")).json()).data;
  expect(initial.providers[0]?.capability.state).toBe("unconfigured");
  // When: the adapter's persisted configuration becomes explicitly disabled.
  await db.run("UPDATE operator_settings SET value_json=? WHERE key='test-auth-provider'", [JSON.stringify({ enabled: false, state: "disabled" })]);
  // Then: the endpoint reflects that state, while the independent runtime remains unconfigured.
  const current = z.object({ data: AuthOptionsSchema }).parse(
    await (await fixture.request("/api/auth/options")).json()).data;
  expect(current.providers).toEqual([{ id: "test-idp", label: "Configured test IdP",
    capability: { enabled: false, state: "disabled" } }]);
  const isolated = z.object({ data: AuthOptionsSchema }).parse(
    await (await independent.request("/api/auth/options")).json()).data;
  expect(isolated.providers).toEqual([]);
});

test("denies unauthenticated linked identity reads", async () => {
  // Given: an identity runtime without a session.
  await using fixture = await identityFixture();
  // When: a client requests linked identity records.
  const response = await fixture.request("/api/me/identities");
  // Then: no identity metadata is disclosed.
  expect(response.status).toBe(401);
});

test("paginates only the current user's immutable linked identities and exposes the account ETag", async () => {
  // Given: two linked identities belonging to the caller and one belonging to another user.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  const createdAt = fixture.runtime.clock.now();
  const ids = [
    IdSchema.parse("00000000-0000-4000-8000-000000000901"),
    IdSchema.parse("00000000-0000-4000-8000-000000000902"),
  ] as const;
  await fixture.runtime.db.run("INSERT INTO identities(id,user_id,issuer,subject,created_at) VALUES(?,?,?,?,?)", [ids[0], login.user.id, "https://first.example.test", "first-subject", createdAt]);
  await fixture.runtime.db.run("INSERT INTO identities(id,user_id,issuer,subject,created_at) VALUES(?,?,?,?,?)", [ids[1], login.user.id, "https://second.example.test", "second-subject", createdAt]);
  await fixture.runtime.db.run("INSERT INTO identities(id,user_id,issuer,subject,created_at) VALUES(?,?,?,?,?)", [crypto.randomUUID(), fixtureIds.mai, "https://private.example.test", "other-subject", createdAt]);
  const profile = await fixture.request("/api/me", { method: "PATCH", headers: login.headers,
    body: JSON.stringify({ affiliation: "Updated organization", expectedVersion: 0 }) });
  expect(profile.status).toBe(200);
  // When: the caller walks the linked identity collection one item at a time.
  const first = await fixture.request("/api/me/identities?limit=1", { headers: login.headers });
  const schema = z.object({ data: z.object({ items: z.array(LinkedIdentitySchema), nextCursor: z.string().nullable() }) });
  const page = schema.parse(await first.json()).data;
  const second = await fixture.request(`/api/me/identities?limit=1&cursor=${page.nextCursor ?? ""}`, { headers: login.headers });
  const next = schema.parse(await second.json()).data;
  // Then: the stable pages contain only the caller's records, without a fabricated identity version.
  expect(first.status).toBe(200);
  expect(first.headers.get("etag")).toBe('"v1"');
  expect(profile.headers.get("etag")).toBe('"v1"');
  expect(page.items).toEqual([{ id: ids[0], issuer: "https://first.example.test", subject: "first-subject", createdAt }]);
  expect(page.nextCursor).toBe(ids[0]);
  expect(next.items).toEqual([{ id: ids[1], issuer: "https://second.example.test", subject: "second-subject", createdAt }]);
  expect(next.nextCursor).toBeNull();
});

test("serializes the persisted session version instead of a fabricated initial counter", async () => {
  // Given: an authenticated session with an existing nonzero optimistic counter.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  await fixture.runtime.db.run("UPDATE sessions SET version=7 WHERE user_id=?", [login.user.id]);
  // When: the client reads sessions over HTTP.
  const response = await fixture.request("/api/me/sessions", { headers: login.headers });
  // Then: clients receive the exact counter needed for a checked session mutation.
  expect(response.status).toBe(200);
  const value = z.object({ data: z.object({ items: z.array(SessionSchema) }) }).parse(await response.json()).data;
  expect(value.items[0]?.version).toBe(7);
});
