import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, MembershipSchema } from "@quire/contracts";
import { governanceFixture, data } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { registerIdentityPolicy } from "../../../services/accounts/identity";

async function fixture() {
  const app = await governanceFixture();
  const admin = await app.login();
  const user = await app.login("mai@quire.local");
  await data(await admin.write(`/api/organizations/${ids.team}/members`,
    { userId: ids.mai, role: "member", licensed: false, expectedVersion: 0 }), MembershipSchema);
  expect((await admin.write(`/api/organizations/${ids.team}/managed/invite`,
    { userId: ids.mai, expectedVersion: 1 })).status).toBe(200);
  const invitation = z.object({ id: IdSchema }).parse(await app.runtime.db.get(
    "SELECT id FROM managed_acceptances WHERE user_id=? AND organization_id=?", [ids.mai, ids.team]));
  expect((await user.write(`/api/managed/${invitation.id}/accept`, { expectedVersion: 0 })).status).toBe(200);
  return { ...app, admin, user, release: (version = 1, key = crypto.randomUUID()) =>
    admin.write(`/api/organizations/${ids.team}/managed/${ids.mai}/release`, { expectedVersion: version }, { key }) };
}
async function snapshot(app: Awaited<ReturnType<typeof fixture>>) {
  const tables = ["users", "members", "managed_acceptances", "identities", "identity_organization_releases",
    "sessions", "one_time_tokens", "provider_grants", "projects", "project_members", "policy_sets", "events", "audit_entries", "idempotency_results"];
  return Promise.all(tables.map(table => app.runtime.db.all(`SELECT * FROM ${table}`)));
}
test("removes team authority and stale sessions while retaining personal identities grants projects and independent login", async () => {
  await using app = await fixture();
  const now = app.runtime.clock.now();
  for (const [subject, kind, organizationId] of [
    ["personal-subject", "personal", null],
    ["other-subject", "organization", ids.institution],
  ] as const) await app.runtime.db.run(`INSERT INTO identities(id,user_id,issuer,subject,created_at,authority_kind,organization_id)
    VALUES(?,?,'https://shared-issuer.example',?,?,?,?)`, [crypto.randomUUID(), ids.mai, subject, now, kind, organizationId]);
  await app.runtime.db.run("INSERT INTO members(id,user_id,organization_id,role,licensed,created_at) VALUES(?,?,?,'member',1,?)",
    [crypto.randomUUID(), ids.mai, ids.institution, now]);
  await app.runtime.db.run("INSERT INTO provider_grants(id,provider,owner_id,label,state,scopes_json,encrypted_secret,created_at) VALUES(?,'github',?,'Personal','active','[]',?,?)",
    [crypto.randomUUID(), ids.mai, new Uint8Array([1, 2, 3]), now]);
  await app.runtime.db.run("INSERT INTO one_time_tokens(id,user_id,token_hash,purpose,expires_at,created_at) VALUES(?,?,?,'reset',?,?)",
    [crypto.randomUUID(), ids.mai, crypto.randomUUID(), "2027-01-01T00:00:00.000Z", now]);
  await app.runtime.db.run("UPDATE projects SET owner_id=? WHERE id=?", [ids.mai, ids.project]);
  const projects = await app.runtime.db.all("SELECT * FROM projects");
  const collaborations = await app.runtime.db.all("SELECT * FROM project_members");
  const grants = await app.runtime.db.all("SELECT * FROM provider_grants");
  const other = await app.runtime.db.get("SELECT * FROM members WHERE user_id=? AND organization_id=?", [ids.mai, ids.institution]);
  const retained = await app.runtime.db.all("SELECT * FROM identities WHERE user_id=? ORDER BY id", [ids.mai]);
  const key = crypto.randomUUID();
  expect((await app.release(1, key)).status).toBe(200);
  expect(await app.runtime.db.get("SELECT * FROM members WHERE user_id=? AND organization_id=?", [ids.mai, ids.team])).toBeNull();
  expect(await app.runtime.db.get("SELECT * FROM members WHERE user_id=? AND organization_id=?", [ids.mai, ids.institution])).toEqual(other);
  expect(await app.runtime.db.all("SELECT * FROM identities WHERE user_id=? ORDER BY id", [ids.mai])).toEqual(retained);
  expect(await app.runtime.db.all("SELECT * FROM projects")).toEqual(projects);
  expect(await app.runtime.db.all("SELECT * FROM project_members")).toEqual(collaborations);
  expect(await app.runtime.db.all("SELECT * FROM provider_grants")).toEqual(grants);
  expect(await app.runtime.db.get("SELECT id FROM sessions WHERE user_id=?", [ids.mai])).toBeNull();
  expect(await app.runtime.db.get("SELECT id FROM one_time_tokens WHERE user_id=?", [ids.mai])).toBeNull();
  expect((await app.user.get("/api/me")).status).toBe(401);
  expect((await (await app.login("mai@quire.local")).get("/api/me")).status).toBe(200);
  expect(await app.runtime.db.get("SELECT managed_by,suspended,deleted_at,version FROM users WHERE id=?", [ids.mai]))
    .toEqual({ managed_by: null, suspended: 0, deleted_at: null, version: 2 });
  expect(await app.runtime.db.get("SELECT state,lapse_at,version FROM managed_acceptances WHERE user_id=?", [ids.mai]))
    .toEqual({ state: "released", lapse_at: null, version: 2 });
  // The existing release contract is not idempotent; a second mutation finds no managed account.
  expect((await app.release(1, key)).status).toBe(404);
  expect(await app.runtime.db.all("SELECT actor_id,organization_id,target_id FROM audit_entries WHERE event='managed.released'"))
    .toEqual([{ actor_id: ids.kien, organization_id: ids.team, target_id: ids.mai }]);
  const events = await app.runtime.events.read(0, { limit: 1000 });
  expect(events.some(event => event.topic === "session.revoked" && event.aggregateId === ids.mai)).toBe(true);
  expect(events.some(event => event.topic === "policy.changed" && event.aggregateId === ids.project)).toBe(true);
});
test("denies releasing the team's sole administrator before any domain mutation", async () => {
  await using app = await fixture();
  await app.runtime.db.run("UPDATE members SET role='member' WHERE organization_id=? AND user_id=?", [ids.team, ids.kien]);
  await app.runtime.db.run("UPDATE members SET role='admin' WHERE organization_id=? AND user_id=?", [ids.team, ids.mai]);
  const operator = await app.login("operator@quire.local");
  const before = await snapshot(app);
  const response = await operator.write(`/api/organizations/${ids.team}/managed/${ids.mai}/release`, { expectedVersion: 1 });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "LAST_ADMIN" } });
  expect(await snapshot(app)).toEqual(before);
});
for (const gate of ["password", "verified-email", "global-sso", "legacy", "stale-version", "missing-adapter", "missing-owner-adapter"] as const) {
  test(`denies unsafe release without mutation for ${gate}`, async () => {
    await using app = await fixture();
    if (gate === "password") await app.runtime.db.run("UPDATE users SET password_hash=NULL WHERE id=?", [ids.mai]);
    if (gate === "verified-email") await app.runtime.db.run("DELETE FROM verified_emails WHERE user_id=?", [ids.mai]);
    if (gate === "global-sso") registerIdentityPolicy(app.context, async () => ({ requireSso: true, breakGlassUserId: ids.operator }));
    if (gate === "legacy") await app.runtime.db.run("INSERT INTO identities(id,user_id,issuer,subject,created_at) VALUES(?,?,'https://personal.example','legacy',?)",
      [crypto.randomUUID(), ids.mai, app.runtime.clock.now()]);
    if (gate === "missing-adapter") await app.runtime.db.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'federation-user',?,'{}',?)",
      [crypto.randomUUID(), ids.mai, app.runtime.clock.now()]);
    if (gate === "missing-owner-adapter") await app.runtime.db.run(
      "INSERT INTO identities(id,user_id,issuer,subject,created_at,authority_kind,organization_id) VALUES(?,?,'https://group.example','owned',?,'organization',?)",
      [crypto.randomUUID(), ids.mai, app.runtime.clock.now(), ids.team]);
    const before = await snapshot(app);
    const response = await app.release(gate === "stale-version" ? 0 : 1);
    const codes = { password: "RECOVERY_REQUIRED", "verified-email": "RECOVERY_REQUIRED", "global-sso": "SSO_REQUIRED",
      legacy: "IDENTITY_PROVENANCE_REQUIRED", "stale-version": "VERSION_CONFLICT", "missing-adapter": "RELEASE_AUTHORITY_UNAVAILABLE",
      "missing-owner-adapter": "RELEASE_AUTHORITY_UNAVAILABLE" };
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: codes[gate] } });
    expect(await snapshot(app)).toEqual(before);
  });
}
test("rolls back release membership identities sessions events and receipts when the final audit fails", async () => {
  await using app = await fixture();
  await app.runtime.db.run("INSERT INTO identities(id,user_id,issuer,subject,created_at,authority_kind) VALUES(?,?,'https://personal.example','personal',?,'personal')",
    [crypto.randomUUID(), ids.mai, app.runtime.clock.now()]);
  await app.runtime.db.exec(`CREATE TRIGGER fail_release_audit BEFORE INSERT ON audit_entries
    WHEN NEW.event='managed.released' BEGIN SELECT RAISE(ABORT,'release audit failure'); END;`);
  const before = await snapshot(app);
  expect((await app.release()).status).toBe(500);
  expect(await snapshot(app)).toEqual(before);
  expect((await app.user.get("/api/me")).status).toBe(200);
});
test("releases a retained suspended account without transferring or deleting its projects", async () => {
  await using app = await fixture();
  await app.runtime.db.run("UPDATE users SET suspended=1 WHERE id=?", [ids.mai]);
  await app.runtime.db.run("UPDATE managed_acceptances SET state='soft_deleted',lapse_at=? WHERE user_id=?", [app.runtime.clock.now(), ids.mai]);
  const projects = await app.runtime.db.all("SELECT * FROM projects");
  expect((await app.release()).status).toBe(200);
  expect(await app.runtime.db.all("SELECT * FROM projects")).toEqual(projects);
  expect((await (await app.login("mai@quire.local")).get("/api/me")).status).toBe(200);
});
