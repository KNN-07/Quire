import { expect, test } from "bun:test";
import { z } from "zod";
import { OperationSchema } from "@quire/contracts";
import { identityFixture, password, errorEnvelope, okEnvelope } from "./harness";
import { readLocalMail } from "../../../services/accounts/identity/mail";
import { fixtureIds } from "../../fixtures/foundation";

test("registers without a session and consumes verification exactly once", async () => {
  // Given: an empty real database.
  await using fixture = await identityFixture();
  const email = "new@example.test";
  // When: registration creates a local email, followed by verification and replay.
  const registration = await fixture.request("/api/auth/register", { method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ name: "New User", email, password }) });
  const unverifiedLogin = await fixture.request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const mail = readLocalMail(fixture.path)[0];
  if (!mail) throw new TypeError("Expected registration mail");
  const token = new URL(mail.body.split("\n")[0] ?? "").searchParams.get("token");
  const body = JSON.stringify({ token });
  const verified = await fixture.request("/api/auth/verify-email", { method: "POST", body });
  const replay = await fixture.request("/api/auth/verify-email", { method: "POST", body });
  // Then: no magic login occurs, unverified login is denied, and the verified password authenticates.
  expect(registration.status).toBe(200);
  expect(registration.headers.get("set-cookie")).toBeNull();
  expect(unverifiedLogin.status).toBe(403);
  expect(verified.status).toBe(200);
  expect(verified.headers.get("set-cookie")).toBeNull();
  expect(replay.status).toBe(400);
  expect((await fixture.login(email)).user.primaryEmail).toBe(email);
});

test("exports real account metadata without credentials and deduplicates retries", async () => {
  // Given: a seeded user with project ownership.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  const headers = { ...login.headers, "idempotency-key": crypto.randomUUID() };
  // When: an account export is requested twice using the same key.
  const first = await fixture.request("/api/me/export", { method: "POST", headers, body: "{}" });
  const second = await fixture.request("/api/me/export", { method: "POST", headers, body: "{}" });
  // Then: the actual completed account metadata operation is stable and contains no authentication secrets.
  expect(first.status).toBe(202);
  const one = z.object({ data: OperationSchema }).parse(await first.json()).data;
  const two = z.object({ data: OperationSchema }).parse(await second.json()).data;
  expect(one.id).toBe(two.id);
  expect(one.status).toBe("succeeded");
  const result = z.object({
    user: z.object({ id: z.string() }), projects: z.array(z.object({ id: z.string() })),
  }).parse(one.result);
  expect(result.user.id).toBe(login.user.id);
  expect(result.projects.map((project) => project.id)).toContain(fixtureIds.project);
  const exported = JSON.stringify(one.result);
  expect(exported).not.toContain("password_hash");
  expect(exported).not.toContain("token_hash");
  expect(exported).not.toContain(login.cookie.split("=")[1] ?? "missing-session");
});

test("requires complete project reassignment before anonymizing and revoking a deleted account", async () => {
  // Given: a seeded project owner whose organization retains another active administrator.
  await using fixture = await identityFixture({ seed: true });
  const login = await fixture.login();
  await fixture.runtime.db.run(`INSERT INTO members(id,organization_id,user_id,role,licensed,created_at)
    VALUES(?,?,?,'admin',0,?)`,
  [crypto.randomUUID(), fixtureIds.team, fixtureIds.mai, fixture.runtime.clock.now()]);
  const body = { confirmation: login.user.primaryEmail, password, expectedVersion: 0 };
  // When: deletion without reassignment is rejected, then a complete reassignment is submitted.
  const blocked = await fixture.request("/api/me", { method: "DELETE", headers: login.headers, body: JSON.stringify(body) });
  const deleted = await fixture.request("/api/me", { method: "DELETE", headers: login.headers,
    body: JSON.stringify({ ...body, reassignment: { [fixtureIds.project]: fixtureIds.mai } }) });
  // Then: ownership is preserved and the old account can no longer authenticate.
  expect(blocked.status).toBe(409);
  expect(errorEnvelope.parse(await blocked.json()).error.code).toBe("REASSIGNMENT_REQUIRED");
  expect(deleted.status).toBe(200);
  expect(okEnvelope.parse(await deleted.json()).data.version).toBe(1);
  const project = z.object({ owner_id: z.string() }).parse((await fixture.runtime.db.get("SELECT owner_id FROM projects WHERE id=?", [fixtureIds.project])));
  expect(project.owner_id).toBe(fixtureIds.mai);
  expect((await fixture.request("/api/me", { headers: login.headers })).status).toBe(401);
  const user = z.object({ name: z.string(), password_hash: z.null(), deleted_at: z.string() })
    .parse((await fixture.runtime.db.get("SELECT * FROM users WHERE id=?", [fixtureIds.kien])));
  expect(user.name).toBe("Deleted account");
});
