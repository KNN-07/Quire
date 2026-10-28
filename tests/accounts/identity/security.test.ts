import { expect, test } from "bun:test";
import { z } from "zod";
import { InstantSchema, SessionSchema } from "@quire/contracts";
import { identityFixture, password, errorEnvelope } from "./harness";
import { readLocalMail } from "../../../services/accounts/identity/mail";
import { fixtureIds, defaultPolicy } from "../../fixtures/foundation";

test("stores Argon2id credentials and hashes session secrets instead of persisting them", async () => {
  // Given: a seeded user with a live session.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  // When: the persisted credential records are inspected at the adapter boundary.
  const user = z.object({ password_hash: z.string() }).parse((await fixture.runtime.db.get("SELECT password_hash FROM users WHERE id=?", [login.user.id])));
  const session = z.object({ token_hash: z.string(), csrf_hash: z.string() }).parse((await fixture.runtime.db.get("SELECT token_hash,csrf_hash FROM sessions WHERE user_id=?", [login.user.id])));
  // Then: password verification uses Argon2id and neither bearer secret appears in storage.
  expect(user.password_hash.startsWith("$argon2id$")).toBe(true);
  expect(await Bun.password.verify(password, user.password_hash)).toBe(true);
  expect(session.token_hash).not.toBe(login.cookie.split("=")[1]);
  expect(session.csrf_hash).not.toBe(login.csrf);
  expect(session.token_hash).toMatch(/^[a-f0-9]{64}$/);
});

test("denies expired recovery tokens using an injected clock", async () => {
  // Given: a real reset email created at a fixed time.
  let now = InstantSchema.parse("2026-10-26T00:00:00.000Z");
  await using fixture = await identityFixture({ seed: true, clock: { now: () => now } });
  await fixture.request("/api/auth/password-reset", { method: "POST", body: JSON.stringify({ email: "kien@quire.local" }) });
  const mail = readLocalMail(fixture.path)[0];
  if (!mail) throw new TypeError("Expected reset mail");
  const token = new URL(mail.body.split("\n")[0] ?? "").searchParams.get("token");
  now = InstantSchema.parse("2026-10-26T00:31:00.000Z");
  // When: the expired credential is submitted without waiting for wall time.
  const response = await fixture.request("/api/auth/password-reset/confirm", { method: "POST", body: JSON.stringify({ token, password }) });
  // Then: expiry is enforced.
  expect(response.status).toBe(400);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("INVALID_TOKEN");
});

test("deletes only the authorized user's session and logout removes the current session", async () => {
  // Given: two users with active sessions.
  await using fixture = await identityFixture({ seed: true });
  const owner = await fixture.login();
  const other = await fixture.login("mai@quire.local");
  const listing = await fixture.request("/api/me/sessions", { headers: other.headers });
  expect(listing.status, await listing.clone().text()).toBe(200);
  const session = z.object({ data: z.object({ items: z.array(SessionSchema) }) }).parse(await listing.json()).data.items[0];
  if (!session) throw new TypeError("Expected active session");
  // When: the owner attempts to delete the other user's session and then logs out.
  const denied = await fixture.request(`/api/me/sessions/${session.id}`, { method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ expectedVersion: 0 }) });
  const logout = await fixture.request("/api/auth/logout", { method: "POST", headers: owner.headers, body: "{}" });
  // Then: cross-user revocation fails and logout revokes just the requesting session.
  expect(denied.status).toBe(409);
  expect(logout.status).toBe(200);
  expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  expect((await fixture.request("/api/me", { headers: owner.headers })).status).toBe(401);
  expect((await fixture.request("/api/me", { headers: other.headers })).status).toBe(200);
});

test("intersects persisted project and organization policies with deny winning", async () => {
  // Given: accepted user consent, an organization allowing Agent, and a project limited to Ask.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  await fixture.runtime.db.run("UPDATE organizations SET policy_json=?", [JSON.stringify({ ...defaultPolicy, ai: "agent" })]);
  await fixture.runtime.db.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'project',?,?,?)", [crypto.randomUUID(), fixtureIds.project, JSON.stringify({ ...defaultPolicy, ai: "ask" }), fixture.runtime.clock.now()]);
  const consent = await fixture.request("/api/me/ai-consent", { method: "POST", headers: login.headers,
    body: JSON.stringify({ termsVersion: "2026-10-26", accepted: true, expectedVersion: 0 }) });
  expect(consent.status).toBe(200);
  const policy = fixture.runtime.services.get("policy");
  expect((await policy.forProject(fixtureIds.kien, fixtureIds.project)).ai).toBe("ask");
  // When: a persisted organization deny replaces its grant.
  await fixture.runtime.db.run("UPDATE organizations SET policy_json=? WHERE id=?", [JSON.stringify({ ...defaultPolicy, ai: "off" }), fixtureIds.team]);
  // Then: the broader grant cannot override that deny.
  expect((await policy.forProject(fixtureIds.kien, fixtureIds.project)).ai).toBe("off");
});

test("runs the operator mail retrieval command against the persisted local sink", async () => {
  // Given: a persisted real registration email.
  await using fixture = await identityFixture();
  await fixture.request("/api/auth/register", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ email: "operator-retrieval@example.test", name: "Mailbox", password }) });
  // When: the operator executes the owned CLI with the private data directory.
  const child = Bun.spawn(["bun", "services/accounts/identity/mail.ts", "--data-dir", fixture.path],
    { stdout: "pipe", stderr: "pipe" });
  const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  // Then: retrieval succeeds and contains the actual token-bearing mail.
  expect(code).toBe(0);
  expect(errors).toBe("");
  const messages = z.array(z.object({ recipient: z.string(), body: z.string() })).parse(JSON.parse(output));
  expect(messages[0]?.recipient).toBe("operator-retrieval@example.test");
  const token = new URL(messages[0]?.body.split("\n")[0] ?? "").searchParams.get("token");
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
});
