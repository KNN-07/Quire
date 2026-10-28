import { expect, test } from "bun:test";
import { z } from "zod";
import { MembershipSchema, OrganizationSchema } from "@quire/contracts";
import { identityFixture, password } from "./identity/harness";
import { governanceFixture, data } from "./governance/harness";
import { fixtureIds as ids } from "../fixtures/foundation";
import { readLocalMail } from "../../services/accounts/identity/mail";
import { transitionManaged } from "../../services/accounts/governance";

test("concurrent registration retries commit one account, receipt and verification mail", async () => {
  await using app = await identityFixture();
  const email = "concurrent@example.test";
  const headers = { "idempotency-key": crypto.randomUUID() };
  const body = JSON.stringify({ name: "Concurrent", email, password });
  const responses = await Promise.all([0, 1].map(() =>
    app.request("/api/auth/register", { method: "POST", headers, body })));
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  for (const table of ["users", "preferences", "identity_requests", "one_time_tokens", "mail_outbox"]) {
    expect(await app.runtime.db.get<{ total: number }>(`SELECT count(*) AS total FROM ${table}`)).toEqual({ total: 1 });
  }
});

test("concurrent verification consumers admit one token use and one account version increment", async () => {
  await using app = await identityFixture();
  await app.request("/api/auth/register", { method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ name: "Verify", email: "verify-race@example.test", password }) });
  const mail = readLocalMail(app.path)[0];
  if (!mail) throw new Error("Verification mail missing");
  const token = new URL(mail.body.split("\n")[0] ?? "").searchParams.get("token");
  const responses = await Promise.all([0, 1].map(() =>
    app.request("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })));
  expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([200, 400]);
  expect(await app.runtime.db.get<{ version: number }>("SELECT version FROM users")).toEqual({ version: 1 });
  expect(await app.runtime.db.get<{ total: number }>("SELECT count(*) AS total FROM verified_emails")).toEqual({ total: 1 });
});

test("concurrent recovery consumers commit exactly one password and wildcard revocation", async () => {
  await using app = await identityFixture({ seed: true });
  const user = await app.login();
  await app.request("/api/auth/password-reset", { method: "POST",
    body: JSON.stringify({ email: user.user.primaryEmail }) });
  const mail = readLocalMail(app.path)[0];
  if (!mail) throw new Error("Recovery mail missing");
  const token = new URL(mail.body.split("\n")[0] ?? "").searchParams.get("token");
  const credentials = [`${password}-one`, `${password}-two`];
  const responses = await Promise.all(credentials.map((credential) =>
    app.request("/api/auth/password-reset/confirm", { method: "POST",
      body: JSON.stringify({ token, password: credential }) })));
  expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([200, 400]);
  const winner = credentials[responses.findIndex((response) => response.status === 200)];
  if (!winner) throw new Error("Recovery winner missing");
  const row = z.object({ password_hash: z.string() }).parse(
    await app.runtime.db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=?", [ids.kien]));
  expect(await Bun.password.verify(winner, row.password_hash)).toBe(true);
  const events = (await app.runtime.events.read(0)).filter((event) => event.topic === "session.revoked");
  expect(events.map((event) => event.payload)).toEqual([{ userId: ids.kien, sessionId: null }]);
  expect((await app.request("/api/me", { headers: user.headers })).status).toBe(401);
});

test("concurrent operator self-deletions cannot remove both remaining operators", async () => {
  await using app = await identityFixture({ seed: true });
  await app.runtime.db.run("UPDATE users SET operator=1 WHERE id=?", [ids.outsider]);
  const users = await Promise.all([app.login("operator@quire.local"), app.login("outsider@quire.local")]);
  const responses = await Promise.all(users.map((user) =>
    app.request("/api/me", { method: "DELETE", headers: user.headers,
      body: JSON.stringify({ confirmation: user.user.primaryEmail, password, expectedVersion: 0 }) })));
  expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([200, 409]);
  expect(await app.runtime.db.get<{ total: number }>(
    "SELECT count(*) AS total FROM users WHERE operator=1 AND suspended=0 AND deleted_at IS NULL")).toEqual({ total: 1 });
});

test("concurrent idempotent organization creates return one aggregate and one audit", async () => {
  await using app = await governanceFixture();
  const user = await app.login();
  const key = crypto.randomUUID();
  const body = { name: "Concurrent organization", kind: "team", domains: [] };
  const responses = await Promise.all([0, 1].map(() => user.write("/api/organizations", body, { key })));
  const organizations = await Promise.all(responses.map((response) => data(response, OrganizationSchema)));
  expect(organizations[0]?.id).toBe(organizations[1]?.id);
  expect(await app.runtime.db.get<{ total: number }>("SELECT count(*) AS total FROM audit_entries WHERE event='organization.created'")).toEqual({ total: 1 });
  expect((await user.write("/api/organizations", { ...body, name: "Changed" }, { key })).status).toBe(409);
});

test("concurrent administrator demotions retain one administrator even with independent member versions", async () => {
  await using app = await governanceFixture();
  const admin = await app.login();
  const operator = await app.login("operator@quire.local");
  const added = await data(await admin.write(`/api/organizations/${ids.team}/members`,
    { userId: ids.mai, role: "admin", licensed: false, expectedVersion: 0 }), MembershipSchema);
  const members = await data(await admin.get(`/api/organizations/${ids.team}/members`),
    z.object({ items: z.array(MembershipSchema) }));
  const previous = members.items.find((member) => member.userId === ids.kien);
  if (!previous) throw new Error("Original administrator missing");
  const responses = await Promise.all([previous, added].map((member) =>
    operator.write(`/api/organizations/${ids.team}/members/${member.id}`,
      { role: "member", expectedVersion: member.version }, { method: "PATCH" })));
  expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([200, 409]);
  expect(await app.runtime.db.get<{ total: number }>("SELECT count(*) AS total FROM members WHERE organization_id=? AND role='admin'",
    [ids.team])).toEqual({ total: 1 });
});

test("concurrent managed lapses cannot suspend both remaining operators", async () => {
  await using app = await governanceFixture();
  const admin = await app.login();
  for (const userId of [ids.mai, ids.operator]) {
    await app.runtime.db.run("UPDATE users SET operator=1,managed_by=? WHERE id=?", [ids.team, userId]);
    await app.runtime.db.run(
      "INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',0,?)",
      [crypto.randomUUID(), ids.team, userId, app.runtime.clock.now()]);
    await app.runtime.db.run(
      "INSERT INTO managed_acceptances(id,organization_id,user_id,state,accepted_at,created_at) VALUES(?,?,?,'accepted',?,?)",
      [crypto.randomUUID(), ids.team, userId, app.runtime.clock.now(), app.runtime.clock.now()]);
  }
  const results = await Promise.allSettled([ids.mai, ids.operator].map((userId) =>
    transitionManaged(app.context, admin.principal,
      { organizationId: ids.team, userId, expectedVersion: 0, action: "lapse" })));
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({ code: "LAST_OPERATOR" });
  expect(await app.runtime.db.get<{ total: number }>(
    "SELECT count(*) AS total FROM users WHERE operator=1 AND suspended=0 AND deleted_at IS NULL")).toEqual({ total: 1 });
});
