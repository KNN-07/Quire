import { expect, test } from "bun:test";
import { z } from "zod";
import { PreferencesSchema, UserSchema } from "@quire/contracts";
import { identityFixture, meEnvelope, okEnvelope } from "./harness";
import { readLocalMail } from "../../../services/accounts/identity/mail";

test("persists profile changes with optimistic version conflicts", async () => {
  // Given: a seeded account.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  // When: profile fields are changed and a stale writer attempts an overwrite.
  const patched = await fixture.request("/api/me", { method: "PATCH", headers: login.headers,
    body: JSON.stringify({ name: "New Name", latexName: "LaTeX Name", interfaceLanguage: "vi", expectedVersion: 0 }) });
  const stale = await fixture.request("/api/me", { method: "PATCH", headers: login.headers,
    body: JSON.stringify({ name: "Stale Name", expectedVersion: 0 }) });
  // Then: only the version-matching mutation persists.
  expect(patched.status).toBe(200);
  expect(patched.headers.get("etag")).toBe('"v1"');
  expect(z.object({ data: UserSchema }).parse(await patched.json()).data.name).toBe("New Name");
  expect(stale.status).toBe(409);
  const me = meEnvelope.parse(await (await fixture.request("/api/me", { headers: login.headers })).json());
  expect(me.data.user.name).toBe("New Name");
  expect(me.data.user.interfaceLanguage).toBe("vi");
});

test("persists preferences under their independent version counter", async () => {
  // Given: a seeded account and default preferences.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  // When: preference changes are submitted with the current counter.
  const response = await fixture.request("/api/me/preferences", { method: "PATCH", headers: login.headers,
    body: JSON.stringify({ theme: "dark", bindings: "vim", customWords: ["Quire"], expectedVersion: 0 }) });
  // Then: a subsequent read returns the saved settings and new counter.
  expect(response.status).toBe(200);
  const read = await fixture.request("/api/me/preferences", { headers: login.headers });
  const value = z.object({ data: PreferencesSchema }).parse(await read.json()).data;
  expect(value.theme).toBe("dark");
  expect(value.bindings).toBe("vim");
  expect(value.customWords).toEqual(["Quire"]);
  expect(value.version).toBe(1);
  expect(read.headers.get("etag")).toBe('"v1"');
});

test("requires secondary email verification and keeps primary-only password login", async () => {
  // Given: a logged-in account.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  const email = "secondary@example.test";
  const body = JSON.stringify({ email, expectedVersion: 0 });
  const headers = { ...login.headers, "idempotency-key": crypto.randomUUID() };
  // When: a secondary address is added, retried, and verified from the real local mail.
  const added = await fixture.request("/api/me/emails", { method: "POST", headers, body });
  const retried = await fixture.request("/api/me/emails", { method: "POST", headers, body });
  const before = meEnvelope.parse(await (await fixture.request("/api/me", { headers: login.headers })).json()).data;
  const mail = readLocalMail(fixture.path).find((entry) => entry.recipient === email);
  if (!mail) throw new TypeError("Expected email verification mail");
  const token = new URL(mail.body.split("\n")[0] ?? "").searchParams.get("token");
  const verified = await fixture.request("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });
  // Then: verification is required, idempotent retry sends no duplicate, and secondaries never become password login aliases.
  expect(added.status).toBe(200);
  expect(retried.status).toBe(200);
  expect(readLocalMail(fixture.path).filter((entry) => entry.recipient === email)).toHaveLength(1);
  expect(before.user.verifiedEmails).not.toContain(email);
  expect(verified.status).toBe(200);
  const after = meEnvelope.parse(await (await fixture.request("/api/me", { headers: login.headers })).json()).data;
  expect(after.user.verifiedEmails).toContain(email);
  const aliasLogin = await fixture.request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "identity-test-password-2026" }) });
  expect(aliasLogin.status).toBe(401);
});

test("stores actual avatar bytes and clears the profile reference on delete", async () => {
  // Given: a PNG file and a verified account.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8WQAAAAASUVORK5CYII=", "base64");
  const form = new FormData();
  form.set("file", new File([bytes], "avatar.png", { type: "image/png" }));
  form.set("expectedVersion", "0");
  // When: the avatar is uploaded through multipart HTTP, then deleted with its new version.
  const upload = await fixture.request("/api/me/avatar", { method: "PUT",
    headers: { ...login.headers, "if-match": '"v0"' }, body: form });
  const value = z.object({ data: UserSchema }).parse(await upload.json()).data;
  const download = await fixture.request("/api/me/avatar", { headers: login.headers });
  const unauthorized = await fixture.request("/api/me/avatar");
  const deleted = await fixture.request("/api/me/avatar", { method: "DELETE", headers: login.headers,
    body: JSON.stringify({ expectedVersion: 1 }) });
  // Then: durable bytes are unchanged and the profile no longer references them.
  expect(upload.status).toBe(200);
  if (!value.avatarBlob) throw new TypeError("Expected avatar digest");
  expect(download.status).toBe(200);
  expect(download.headers.get("content-type")).toBe("image/png");
  expect(download.headers.get("cache-control")).toBe("private, no-store");
  expect(download.headers.get("x-content-type-options")).toBe("nosniff");
  expect(download.headers.get("etag")).toBe(`"${value.avatarBlob}"`);
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array(bytes));
  expect(unauthorized.status).toBe(401);
  expect(okEnvelope.parse(await deleted.json()).data.version).toBe(2);
  const me = meEnvelope.parse(await (await fixture.request("/api/me", { headers: login.headers })).json()).data;
  expect(me.user.avatarBlob).toBeNull();
});
