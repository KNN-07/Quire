import { expect, test } from "bun:test";
import { z } from "zod";
import { SessionSchema } from "@quire/contracts";
import { identityFixture, password, meEnvelope, errorEnvelope } from "./identity/harness";
import { readLocalMail } from "../../services/accounts/identity/mail";

test("T01 authenticates a seeded user and rejects CSRF writes over live HTTP", async () => {
  // Given: a real seed and an ephemeral HTTP server.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  expect(login.response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(login.response.headers.get("set-cookie")).toContain("SameSite=Lax");
  // When: the authenticated client reads its identity and attempts an unprotected write.
  const me = await fixture.request("/api/me", { headers: { cookie: login.cookie } });
  const denied = await fixture.request("/api/me", { method: "PATCH", headers: { cookie: login.cookie },
    body: JSON.stringify({ name: "Imposter", expectedVersion: 0 }) });
  // Then: identity is real and the forbidden mutation changes nothing.
  expect(meEnvelope.parse(await me.json()).data.user.primaryEmail).toBe("kien@quire.local");
  expect(me.headers.get("etag")).toBe('"v0"');
  expect(denied.status).toBe(403);
  expect(errorEnvelope.parse(await denied.json()).error.code).toBe("CSRF_DENIED");
  const unchanged = await fixture.request("/api/me", { headers: { cookie: login.cookie } });
  expect(meEnvelope.parse(await unchanged.json()).data.user.name).toBe("Kien Nguyen");
});

test("rejects forged origins even when the CSRF token is valid", async () => {
  // Given: a real authenticated session.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  // When: a foreign-origin browser sends an otherwise valid write.
  const response = await fixture.request("/api/me", { method: "PATCH",
    headers: { ...login.headers, origin: "https://attacker.invalid" },
    body: JSON.stringify({ name: "Wrong", expectedVersion: 0 }) });
  // Then: origin validation denies it.
  expect(response.status).toBe(403);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("ORIGIN_DENIED");
});

test("consumes reset tokens once and revokes existing sessions", async () => {
  // Given: a verified seeded account with an active session and a requested recovery email.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  const reset = await fixture.request("/api/auth/password-reset", { method: "POST", body: JSON.stringify({ email: login.user.primaryEmail }) });
  expect(reset.status).toBe(200);
  const mail = readLocalMail(fixture.path).find((item) => item.recipient === login.user.primaryEmail);
  if (!mail) throw new TypeError("Expected persisted reset mail");
  const token = new URL(mail.body.split("\n")[0] ?? "").searchParams.get("token");
  const body = JSON.stringify({ token, password: `${password}-changed` });
  // When: the same reset credential is submitted twice.
  const confirmed = await fixture.request("/api/auth/password-reset/confirm", { method: "POST", body });
  const replay = await fixture.request("/api/auth/password-reset/confirm", { method: "POST", body });
  // Then: only the first reset succeeds, old sessions cannot authenticate, and the new password works.
  expect(confirmed.status).toBe(200);
  expect(replay.status).toBe(400);
  expect(errorEnvelope.parse(await replay.json()).error.code).toBe("INVALID_TOKEN");
  expect((await fixture.request("/api/me", { headers: login.headers })).status).toBe(401);
  const newLogin = await fixture.login(login.user.primaryEmail, `${password}-changed`);
  expect(newLogin.user.id).toBe(login.user.id);
});

test("revokes other sessions without revoking the requesting session", async () => {
  // Given: two independently authenticated sessions for the same user.
  await using fixture = await identityFixture({ seed: true });
  const first = await fixture.login();
  const second = await fixture.login();
  // When: the second session revokes all other sessions.
  const response = await fixture.request("/api/me/sessions/revoke-others", { method: "POST", headers: second.headers, body: "{}" });
  // Then: the first session is unauthorized and the second remains the sole live session.
  expect(response.status).toBe(200);
  expect((await fixture.request("/api/me", { headers: first.headers })).status).toBe(401);
  const sessions = await fixture.request("/api/me/sessions", { headers: second.headers });
  expect(sessions.status, await sessions.clone().text()).toBe(200);
  const page = z.object({ data: z.object({ items: z.array(SessionSchema) }) }).parse(await sessions.json());
  expect(page.data.items).toHaveLength(1);
  expect(page.data.items[0]?.current).toBe(true);
});
