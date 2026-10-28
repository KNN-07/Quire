import { expect, test } from "bun:test";
import { z } from "zod";
import { InstantSchema, SessionSchema } from "@quire/contracts";
import { identityFixture, password, meEnvelope } from "./harness";
import { fixtureIds } from "../../fixtures/foundation";

test("deletes an owned session and invalidates its bearer cookie", async () => {
  // Given: an authenticated user with an active session.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  const list = await fixture.request("/api/me/sessions", { headers: login.headers });
  expect(list.status, await list.clone().text()).toBe(200);
  const session = z.object({ data: z.object({ items: z.array(SessionSchema) }) }).parse(await list.json()).data.items[0];
  if (!session) throw new TypeError("Expected session");
  // When: the user deletes that session through its checked endpoint.
  const response = await fixture.request(`/api/me/sessions/${session.id}`, { method: "DELETE", headers: login.headers,
    body: JSON.stringify({ expectedVersion: 0 }) });
  // Then: the previously valid bearer is no longer accepted.
  expect(response.status).toBe(200);
  expect((await fixture.request("/api/me", { headers: login.headers })).status).toBe(401);
});

test("protects a mixed-case primary email from removal", async () => {
  // Given: an account whose persisted primary address has different casing.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  await fixture.runtime.db.run("UPDATE users SET primary_email=? WHERE id=?", [login.user.primaryEmail.toUpperCase(), login.user.id]);
  // When: the caller requests primary-address removal using email rather than a UUID.
  const denied = await fixture.request("/api/me/emails", { method: "DELETE", headers: login.headers,
    body: JSON.stringify({ email: login.user.primaryEmail.toUpperCase(), expectedVersion: 0 }) });
  // Then: the primary login route and account version are preserved.
  expect(denied.status).toBe(409);
  const current = await fixture.request("/api/me", { headers: login.headers });
  expect(meEnvelope.parse(await current.json()).data.user.verifiedEmails).toEqual([login.user.primaryEmail]);
  expect(current.headers.get("etag")).toBe('"v0"');
});

test("removes a secondary email case-insensitively", async () => {
  // Given: an account with a verified mixed-case secondary address.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  await fixture.runtime.db.run("INSERT INTO verified_emails(id,user_id,email,verified_at) VALUES(?,?,?,?)", [crypto.randomUUID(), login.user.id, "Secondary@Example.Test", fixture.runtime.clock.now()]);
  await fixture.runtime.db.run(
    "INSERT INTO one_time_tokens(id,user_id,token_hash,purpose,payload_json,expires_at,created_at) VALUES(?,?,?,'verify',?,?,?)",
    [crypto.randomUUID(), login.user.id, crypto.randomUUID(), JSON.stringify({ email: "Secondary@Example.Test" }),
      "2099-01-01T00:00:00.000Z", fixture.runtime.clock.now()]);
  // When: the caller submits the same secondary address with different casing.
  const removed = await fixture.request("/api/me/emails", { method: "DELETE", headers: login.headers,
    body: JSON.stringify({ email: "SECONDARY@EXAMPLE.TEST", expectedVersion: 0 }) });
  // Then: only the primary verified login address remains.
  expect(removed.status).toBe(200);
  const current = await fixture.request("/api/me", { headers: login.headers });
  const me = meEnvelope.parse(await current.json());
  expect(me.data.user.verifiedEmails).toEqual([login.user.primaryEmail]);
  expect(current.headers.get("etag")).toBe('"v1"');
  expect(await fixture.runtime.db.get<{ total: number }>("SELECT count(*) AS total FROM one_time_tokens WHERE user_id=? AND used_at IS NULL",
    [login.user.id])).toEqual({ total: 0 });
});

test("blocks local recovery and self-deletion of managed accounts", async () => {
  // Given: a user under an organization management agreement.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  await fixture.runtime.db.run("UPDATE users SET managed_by=? WHERE id=?", [fixtureIds.team, login.user.id]);
  // When: that account requests local recovery and self-deletion.
  const reset = await fixture.request("/api/auth/password-reset", { method: "POST", body: JSON.stringify({ email: login.user.primaryEmail }) });
  const deleted = await fixture.request("/api/me", { method: "DELETE", headers: login.headers,
    body: JSON.stringify({ confirmation: login.user.primaryEmail, password, expectedVersion: 0 }) });
  // Then: recovery remains non-enumerating with no issued token, and managed deletion is denied.
  expect(reset.status).toBe(200);
  expect((await fixture.runtime.db.all("SELECT id FROM one_time_tokens WHERE user_id=?", [login.user.id]))).toHaveLength(0);
  expect(deleted.status).toBe(403);
  expect((await fixture.request("/api/me", { headers: login.headers })).status).toBe(200);
});

test("expires sessions using an injected clock", async () => {
  // Given: a real authenticated session created at a fixed time.
  let now = InstantSchema.parse("2026-10-26T00:00:00.000Z");
  await using fixture = await identityFixture({ seed: true, clock: { now: () => now } });
  const login = await fixture.login();
  now = InstantSchema.parse("2026-11-03T00:00:00.000Z");
  // When: the expired session attempts to read its identity.
  const response = await fixture.request("/api/me", { headers: login.headers });
  // Then: time expiry is enforced without a delay.
  expect(response.status).toBe(401);
});

test("issues secure cookies when configured for an HTTPS public origin", async () => {
  // Given: a seeded deployment configured with a TLS public URL.
  await using fixture = await identityFixture({ seed: true, publicUrl: "https://quire.example.test" });
  // When: the user signs in through the actual HTTP handler.
  const login = await fixture.login();
  // Then: the browser cookie requires HTTPS.
  expect(login.response.headers.get("set-cookie")).toContain("; Secure");
});

test("cannot remove another user's email through a case-insensitive address lookup", async () => {
  // Given: two authenticated users with distinct primary addresses.
  await using fixture = await identityFixture({ seed: true });
  const owner = await fixture.login();
  const other = await fixture.login("mai@quire.local");
  // When: the first user submits the second user's address in a different case.
  const response = await fixture.request("/api/me/emails", { method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ email: "MAI@QUIRE.LOCAL", expectedVersion: 0 }) });
  // Then: caller scoping denies the deletion and leaves both accounts unchanged.
  expect(response.status).toBe(404);
  const account = await fixture.request("/api/me", { headers: other.headers });
  expect(meEnvelope.parse(await account.json()).data.user.verifiedEmails).toContain("mai@quire.local");
  const current = await fixture.request("/api/me", { headers: owner.headers });
  expect(current.headers.get("etag")).toBe('"v0"');
});

test("denies secondary email removal for a managed account", async () => {
  // Given: a managed user with a verified secondary email.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  await fixture.runtime.db.run("UPDATE users SET managed_by=? WHERE id=?", [fixtureIds.team, login.user.id]);
  await fixture.runtime.db.run("INSERT INTO verified_emails(id,user_id,email,verified_at) VALUES(?,?,?,?)", [crypto.randomUUID(), login.user.id, "secondary@example.test", fixture.runtime.clock.now()]);
  // When: the user attempts email-based removal with the current account version.
  const response = await fixture.request("/api/me/emails", { method: "DELETE", headers: login.headers,
    body: JSON.stringify({ email: "SECONDARY@EXAMPLE.TEST", expectedVersion: 0 }) });
  // Then: the management restriction preserves the address and account counter.
  expect(response.status).toBe(403);
  const current = await fixture.request("/api/me", { headers: login.headers });
  expect(meEnvelope.parse(await current.json()).data.user.verifiedEmails).toContain("secondary@example.test");
  expect(current.headers.get("etag")).toBe('"v0"');
});
