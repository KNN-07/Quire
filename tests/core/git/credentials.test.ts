import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { gitFixture } from "./harness";
import { sshFingerprint, sshActor } from "../../../services/core/git";

test("T11 hashes one-time tokens and immediately enforces account suspension", async () => {
  // Given: a real account and a newly issued bearer credential.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const token = await fixture.token({ ...owner.headers, "idempotency-key": crypto.randomUUID() });
  const stored = z.object({ token_hash: z.string() }).parse(fixture.runtime.db.query("SELECT token_hash FROM git_tokens WHERE id=?").get(token.id));
  const auth = { authorization: `Basic ${Buffer.from(`git:${token.secretOnce}`).toString("base64")}` };
  const route = `/git/${project.id}.git/info/refs?service=git-upload-pack`;
  // When: the current user is suspended after the token successfully authenticates.
  const active = await fixture.request(route, { headers: auth });
  fixture.runtime.db.query("UPDATE users SET suspended=1 WHERE id=?").run(owner.user.id);
  const suspended = await fixture.request(route, { headers: auth });
  // Then: the stored value is not a bearer and the next request is denied.
  expect(stored.token_hash).not.toBe(token.secretOnce);
  expect(stored.token_hash).toHaveLength(64);
  expect(active.status).toBe(200);
  expect(suspended.status).toBe(401);
  expect(suspended.headers.get("www-authenticate")).toBe('Basic realm="Quire Git"');
});

test("T11 rejects expired Git tokens against the real HTTP bridge", async () => {
  // Given: an issued token whose stored expiry is now in the past.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const token = await fixture.token(owner.headers);
  fixture.runtime.db.query("UPDATE git_tokens SET expires_at='2026-10-25T00:00:00.000Z' WHERE id=?").run(token.id);
  // When: a Git client presents the expired bearer.
  const response = await fixture.request(`/git/${project.id}.git/info/refs?service=git-upload-pack`,
    { headers: { authorization: `Bearer ${token.secretOnce}` } });
  // Then: the bridge challenges the credential instead of disclosing refs.
  expect(response.status).toBe(401);
});

test("T11 refuses an eleventh stored Git token", async () => {
  // Given: a real account with the maximum ten persisted token hashes.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  for (let index = 0; index < 10; index++) fixture.runtime.db.query(
    "INSERT INTO git_tokens(id,user_id,name,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)")
    .run(crypto.randomUUID(), owner.user.id, `Token ${index}`, `fixture-hash-${index}`,
      "2027-01-01T00:00:00.000Z", "2026-10-26T12:00:00.000Z");
  // When: the authenticated client tries to issue another credential.
  const response = await fixture.request("/api/me/git-tokens", { method: "POST", headers: owner.headers,
    body: JSON.stringify({ name: "Eleventh", expiresAt: "2027-01-01T00:00:00.000Z" }) });
  // Then: quota enforcement refuses it without inserting another credential.
  expect(response.status).toBe(409);
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code).toBe("TOKEN_LIMIT");
});

test("T11 refuses a token lasting beyond one year", async () => {
  // Given: an authenticated real account.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  // When: the client requests a credential that lasts longer than a calendar year.
  const response = await fixture.request("/api/me/git-tokens", { method: "POST", headers: owner.headers,
    body: JSON.stringify({ name: "Too long", expiresAt: "2028-01-01T00:00:00.000Z" }) });
  // Then: the expiry boundary rejects the credential.
  expect(response.status).toBe(422);
});

test("T11 stores validated SSH public keys with scoped read update delete and live lookup", async () => {
  // Given: a real OpenSSH key pair generated only inside the fixture root.
  await using fixture = await gitFixture();
  const owner = await fixture.login();
  const other = await fixture.login("alex@quire.local");
  const path = join(fixture.path, "test-key");
  const child = Bun.spawn(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", path], { stdout: "ignore", stderr: "pipe" });
  expect(await child.exited).toBe(0);
  const publicKey = (await readFile(`${path}.pub`, "utf8")).trim();
  const created = await fixture.request("/api/me/ssh-keys", { method: "POST", headers: owner.headers,
    body: JSON.stringify({ name: "Laptop", publicKey }) });
  const key = z.object({ data: z.object({ id: z.string(), version: z.number() }) }).parse(await created.json()).data;
  const fingerprint = await sshFingerprint(publicKey);
  // When: another user reads it, its owner renames it and then removes it.
  const denied = await fixture.request(`/api/me/ssh-keys/${key.id}`, { headers: other.headers });
  const patched = await fixture.request(`/api/me/ssh-keys/${key.id}`, { method: "PATCH", headers: owner.headers,
    body: JSON.stringify({ name: "Renamed", expectedVersion: key.version }) });
  const lookup = sshActor(fixture.runtime, fingerprint);
  const removed = await fixture.request(`/api/me/ssh-keys/${key.id}`, { method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ expectedVersion: 1 }) });
  // Then: account scope and counters work, and key revocation invalidates SSH lookup.
  expect(denied.status).toBe(404);
  expect(patched.status).toBe(200);
  expect(lookup).toBe(owner.user.id);
  expect(removed.status).toBe(200);
  expect(sshActor(fixture.runtime, fingerprint)).toBeNull();
});
