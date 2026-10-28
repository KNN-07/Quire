import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { fixture } from "./harness";
import { errorSchema } from "./provider-fixture";

test("links ORCID only after explicit CSRF authorization and rotates the durable session", async () => {
  // Given: a local authenticated account and an explicit ORCID link authorization.
  await using app = await fixture();
  const local = await app.login();
  const start = await app.request("/api/me/identities/orcid/link", { method: "POST", headers: local.headers,
    body: JSON.stringify({ expectedVersion: 0 }) });
  const authorized = await app.authorize(start);
  const delivered: string[] = [];
  using subscription = { delivered, [Symbol.dispose]: app.runtime.events.subscribe((event) => {
    if (event.topic === "session.revoked") delivered.push(event.aggregateId);
  }) };
  // When: ORCID returns its signed subject to the initiating local session.
  const response = await app.request(authorized.path, { headers: { cookie: `${local.cookie}; ${authorized.cookie}` } });
  // Then: the same account owns ORCID, the old cookie is revoked, and revocation is durable.
  expect(response.status, await response.clone().text()).toBe(303);
  expect(z.object({ user_id: IdSchema, subject: z.string() }).parse(
    await app.runtime.db.get("SELECT user_id,subject FROM identities WHERE issuer=?", [app.provider.origin])))
    .toEqual({ user_id: local.user.id, subject: "subject-one" });
  expect((await app.request("/api/me", { headers: local.headers })).status).toBe(401);
  expect(subscription.delivered).toContain(local.user.id);
  expect((await app.runtime.events.read(0)).some((event) => event.topic === "session.revoked" && event.aggregateId === local.user.id)).toBe(true);
});

test("does not let a login GET silently link an identity to an existing session", async () => {
  // Given: a local browser that also authenticates a different external account.
  await using app = await fixture();
  const local = await app.login();
  const authorized = await app.begin();
  // When: the login callback carries the old session without an explicit link action.
  const response = await app.request(authorized.path, { headers: { cookie: `${local.cookie}; ${authorized.cookie}` } });
  // Then: a separate ordinary account owns that external identity.
  expect(response.status).toBe(303);
  const identity = z.object({ user_id: IdSchema }).parse(await app.runtime.db.get("SELECT user_id FROM identities"));
  expect(identity.user_id).not.toBe(local.user.id);
});

test("rejects linking when the initiating session was revoked during provider authentication", async () => {
  // Given: a link state whose local session is subsequently logged out.
  await using app = await fixture();
  const local = await app.login();
  const start = await app.request("/api/me/identities/google/link", { method: "POST", headers: local.headers,
    body: JSON.stringify({ expectedVersion: 0 }) });
  const authorized = await app.authorize(start);
  await app.request("/api/auth/logout", { method: "POST", headers: local.headers, body: "{}" });
  // When: the delayed provider callback arrives.
  const response = await app.request(authorized.path, { headers: { cookie: `${local.cookie}; ${authorized.cookie}` } });
  // Then: a valid provider proof cannot recreate the revoked local authority.
  expect(response.status).toBe(401);
  expect(await app.runtime.db.get("SELECT id FROM identities")).toBeNull();
});

test("rejects linking an external subject already owned by another account", async () => {
  // Given: one account already owns the provider subject and another begins linking.
  await using app = await fixture();
  const owner = await app.login();
  await app.runtime.db.run("INSERT INTO identities(id,user_id,issuer,subject,created_at) VALUES(?,?,?,?,?)",
    [crypto.randomUUID(), owner.user.id, app.provider.origin, "subject-one", app.runtime.clock.now()]);
  const other = await app.login("mai@quire.local");
  const start = await app.request("/api/me/identities/google/link", { method: "POST", headers: other.headers,
    body: JSON.stringify({ expectedVersion: 0 }) });
  const authorized = await app.authorize(start);
  // When: the other account presents the same provider identity.
  const response = await app.request(authorized.path, { headers: { cookie: `${other.cookie}; ${authorized.cookie}` } });
  // Then: immutable issuer/subject ownership is preserved.
  expect(response.status).toBe(409);
  expect(errorSchema.parse(await response.json()).error.code).toBe("IDENTITY_COLLISION");
});

test("revokes every account session when a linked provider is unlinked", async () => {
  // Given: a password-backed account with a linked identity and two sessions.
  await using app = await fixture();
  const first = await app.login();
  const second = await app.login();
  const id = crypto.randomUUID();
  await app.runtime.db.run("INSERT INTO identities(id,user_id,issuer,subject,created_at) VALUES(?,?,?,?,?)",
    [id, first.user.id, app.provider.origin, "subject-one", app.runtime.clock.now()]);
  // When: the caller explicitly unlinks the provider.
  const response = await app.request(`/api/me/identities/${id}`, { method: "DELETE", headers: first.headers,
    body: JSON.stringify({ expectedVersion: 0 }) });
  // Then: both old sessions are invalid and an all-session revocation is persisted.
  expect(response.status).toBe(200);
  expect((await app.request("/api/me", { headers: first.headers })).status).toBe(401);
  expect((await app.request("/api/me", { headers: second.headers })).status).toBe(401);
  expect((await app.runtime.events.read(0)).some((event) => event.topic === "session.revoked" &&
    event.payload.userId === first.user.id && event.payload.sessionId === null)).toBe(true);
});

test("preserves the last identity when an OAuth-only account attempts unlinking", async () => {
  // Given: an account created through OAuth without a local password.
  await using app = await fixture();
  const start = await app.begin();
  const callback = await app.request(start.path, { headers: { cookie: start.cookie } });
  const cookie = callback.headers.getSetCookie().find((entry) => entry.startsWith("quire_session="))?.split(";")[0] ?? "";
  const me = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await (await app.request("/api/me", { headers: { cookie } })).json());
  const identity = z.object({ id: IdSchema }).parse(await app.runtime.db.get("SELECT id FROM identities"));
  // When: the only usable identity is removed.
  const response = await app.request(`/api/me/identities/${identity.id}`, { method: "DELETE",
    headers: { cookie, "x-csrf-token": me.data.csrfToken }, body: JSON.stringify({ expectedVersion: 0 }) });
  // Then: the account remains accessible.
  expect(response.status).toBe(409);
  expect(errorSchema.parse(await response.json()).error.code).toBe("LAST_IDENTITY_REQUIRED");
  expect((await app.request("/api/me", { headers: { cookie } })).status).toBe(200);
});
