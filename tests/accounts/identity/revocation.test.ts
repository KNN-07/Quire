import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { z } from "zod";
import { SessionSchema } from "@quire/contracts";
import type { Event } from "@quire/contracts";
import { readLocalMail } from "../../../services/accounts/identity/mail";
import { identityFixture, password } from "./harness";

type Fixture = Awaited<ReturnType<typeof identityFixture>>;
async function currentSession(fixture: Fixture, headers: HeadersInit) {
  const response = await fixture.request("/api/me/sessions", { headers });
  const page = z.object({ data: z.object({ items: z.array(SessionSchema) }) }).parse(await response.json()).data;
  const session = page.items.find((item) => item.current);
  if (!session) throw new TypeError("Expected current HTTP session");
  return session;
}
const revocations = async (fixture: Fixture) =>
  (await fixture.runtime.events.read(0)).filter((event) => event.topic === "session.revoked");

test("publishes logout revocation durably only after the session deletion commits", async () => {
  // Given: a session and an event subscriber observing committed state from a separate connection.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  const session = await currentSession(fixture, login.headers);
  using reader = new Database(join(fixture.path, "quire.sqlite"), { readonly: true });
  const delivered: { readonly event: Event; readonly sessionPresent: boolean }[] = [];
  using subscription = { delivered, [Symbol.dispose]: fixture.runtime.events.subscribe((event) => {
    delivered.push({ event, sessionPresent: reader.query("SELECT id FROM sessions WHERE id=?").get(session.id) !== null });
  }) };
  // When: the client logs out through HTTP.
  const response = await fixture.request("/api/auth/logout", { method: "POST", headers: login.headers, body: "{}" });
  // Then: the matching durable event is delivered after deletion is visible to another connection.
  expect(response.status).toBe(200);
  const events = (await revocations(fixture));
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ aggregateId: login.user.id, payload: { userId: login.user.id, sessionId: session.id } });
  const observed = subscription.delivered.filter((receipt) => receipt.event.topic === "session.revoked");
  expect(observed.map((receipt) => receipt.event)).toEqual(events);
  expect(observed.map((receipt) => receipt.sessionPresent)).toEqual([false]);
  expect((await fixture.request("/api/me", { headers: login.headers })).status).toBe(401);
});

test("records the exact session ID on checked session deletion", async () => {
  // Given: an authenticated session with its persisted version.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  const session = await currentSession(fixture, login.headers);
  // When: the caller deletes that session over HTTP.
  const response = await fixture.request(`/api/me/sessions/${session.id}`, { method: "DELETE", headers: login.headers,
    body: JSON.stringify({ expectedVersion: session.version }) });
  // Then: a durable session-specific revocation is available to transport consumers.
  expect(response.status).toBe(200);
  expect((await revocations(fixture)).map((event) => ({ aggregateId: event.aggregateId, payload: event.payload })))
    .toEqual([{ aggregateId: login.user.id, payload: { userId: login.user.id, sessionId: session.id } }]);
});

test("revokes other sessions individually without broadcasting an all-session revocation", async () => {
  // Given: three live sessions for one user.
  await using fixture = await identityFixture({ seed: true });
  const first = await fixture.login();
  const firstSession = await currentSession(fixture, first.headers);
  const second = await fixture.login();
  const secondSession = await currentSession(fixture, second.headers);
  const current = await fixture.login();
  const currentId = (await currentSession(fixture, current.headers)).id;
  // When: the current client revokes all other sessions over HTTP.
  const response = await fixture.request("/api/me/sessions/revoke-others", { method: "POST", headers: current.headers, body: "{}" });
  // Then: events name exactly the removed sessions and the requesting session stays authenticated.
  expect(response.status).toBe(200);
  const events = (await revocations(fixture));
  expect(events).toHaveLength(2);
  expect(events.map((event) => event.payload.sessionId)).toEqual(expect.arrayContaining([firstSession.id, secondSession.id]));
  expect(events.every((event) => event.aggregateId === current.user.id && event.payload.userId === current.user.id)).toBe(true);
  expect(events.map((event) => event.payload.sessionId)).not.toContain(currentId);
  expect((await fixture.request("/api/me", { headers: current.headers })).status).toBe(200);
  expect((await fixture.request("/api/me", { headers: first.headers })).status).toBe(401);
  expect((await fixture.request("/api/me", { headers: second.headers })).status).toBe(401);
});

test("records all-session revocation when a recovery token changes the password", async () => {
  // Given: two sessions and an actual local recovery email.
  await using fixture = await identityFixture({ seed: true });
  const first = await fixture.login();
  const second = await fixture.login();
  await fixture.request("/api/auth/password-reset", { method: "POST", body: JSON.stringify({ email: first.user.primaryEmail }) });
  const mail = readLocalMail(fixture.path)[0];
  if (!mail) throw new TypeError("Expected recovery mail");
  const token = new URL(mail.body.split("\n")[0] ?? "").searchParams.get("token");
  // When: the recovery token is confirmed over HTTP.
  const response = await fixture.request("/api/auth/password-reset/confirm", { method: "POST",
    body: JSON.stringify({ token, password: `${password}-changed` }) });
  // Then: one durable wildcard revocation identifies that user and both old sessions stop authenticating.
  expect(response.status).toBe(200);
  expect((await revocations(fixture)).map((event) => ({ aggregateId: event.aggregateId, payload: event.payload })))
    .toEqual([{ aggregateId: first.user.id, payload: { userId: first.user.id, sessionId: null } }]);
  expect((await fixture.request("/api/me", { headers: first.headers })).status).toBe(401);
  expect((await fixture.request("/api/me", { headers: second.headers })).status).toBe(401);
});

test("records all-session revocation in the account deletion transaction", async () => {
  // Given: a user without owned projects and two active sessions.
  await using fixture = await identityFixture({ seed: true });
  const first = await fixture.login("outsider@quire.local");
  const second = await fixture.login("outsider@quire.local");
  // When: that account is deleted over HTTP with current credentials.
  const response = await fixture.request("/api/me", { method: "DELETE", headers: second.headers,
    body: JSON.stringify({ confirmation: second.user.primaryEmail, password, expectedVersion: 0 }) });
  // Then: the durable wildcard event closes every session for the tombstoned user.
  expect(response.status).toBe(200);
  expect((await revocations(fixture)).map((event) => ({ aggregateId: event.aggregateId, payload: event.payload })))
    .toEqual([{ aggregateId: second.user.id, payload: { userId: second.user.id, sessionId: null } }]);
  expect((await fixture.request("/api/me", { headers: first.headers })).status).toBe(401);
  expect((await fixture.request("/api/me", { headers: second.headers })).status).toBe(401);
});

test("rotates an existing cookie with a revocation scoped to its actual previous user", async () => {
  // Given: an authenticated user's existing cookie.
  await using fixture = await identityFixture({ seed: true });
  const previous = await fixture.login();
  const session = await currentSession(fixture, previous.headers);
  // When: that browser signs in to a different local account.
  const response = await fixture.request("/api/auth/login", { method: "POST", headers: { cookie: previous.cookie },
    body: JSON.stringify({ email: "mai@quire.local", password }) });
  // Then: only the previous user's session is named in the durable rotation event.
  expect(response.status).toBe(200);
  expect((await revocations(fixture)).map((event) => ({ aggregateId: event.aggregateId, payload: event.payload })))
    .toEqual([{ aggregateId: previous.user.id, payload: { userId: previous.user.id, sessionId: session.id } }]);
  expect((await fixture.request("/api/me", { headers: previous.headers })).status).toBe(401);
});

test("rolls back session removal when durable revocation persistence fails", async () => {
  // Given: a live session and an actual SQLite failure at the event insertion boundary.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  await fixture.runtime.db.run("CREATE TRIGGER identity_test_revocation_failure BEFORE INSERT ON events WHEN NEW.topic='session.revoked' BEGIN SELECT RAISE(ABORT,'identity revocation persistence failure'); END");
  // When: logout cannot append its durable revocation event.
  const response = await fixture.request("/api/auth/logout", { method: "POST", headers: login.headers, body: "{}" });
  // Then: the failed write cannot silently remove a session without its event.
  expect(response.status).toBe(500);
  expect((await revocations(fixture))).toEqual([]);
  expect((await fixture.request("/api/me", { headers: login.headers })).status).toBe(200);
});
