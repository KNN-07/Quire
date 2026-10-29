import { expect, test } from "bun:test";
import { z } from "zod";
import { releaseFixture, releaseSnapshot } from "./release-fixture";
import { fixture, password } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { scimSchemas } from "../../../services/adapters/federation/scim-schema";

test("releases actual SCIM and OIDC group authority without erasing personal links or another organization's grants", async () => {
  await using app = await releaseFixture();
  const userId = app.managed.account.id;
  const second = await app.request("/scim/v2/Users", { method: "POST", headers: app.bearer,
    body: JSON.stringify({ ...app.input, externalId: "other-member", userName: "other@example.test" }) });
  expect(second.status).toBe(201);
  const otherResource = z.object({ id: z.string() }).parse(await second.json());
  expect((await app.request(`/scim/v2/Groups/${app.groupResource.id}`, { method: "PATCH",
    headers: { ...app.bearer, "if-match": app.groupResource.meta.version },
    body: JSON.stringify({ schemas: [scimSchemas.patch], Operations: [{ op: "replace", path: "members",
      value: [{ value: app.resource.id }, { value: otherResource.id }] }] }),
  })).status).toBe(200);
  const otherClaims = await app.runtime.db.get("SELECT * FROM federation_claims WHERE user_id=(SELECT user_id FROM federation_resources WHERE id=?)", [otherResource.id]);
  expect(await app.runtime.db.get("SELECT organization_id FROM federation_accounts WHERE user_id=?", [userId]))
    .toEqual({ organization_id: ids.team });
  expect(await app.runtime.db.get("SELECT authority_kind,organization_id FROM identities WHERE user_id=?", [userId]))
    .toEqual({ authority_kind: "organization", organization_id: ids.team });
  await app.runtime.db.run("UPDATE projects SET owner_id=? WHERE id=?", [userId, ids.project]);
  for (const [subject, kind, organizationId] of [
    ["personal", "personal", null], ["other-team", "organization", ids.institution],
  ] as const) await app.runtime.db.run("INSERT INTO identities(id,user_id,issuer,subject,created_at,authority_kind,organization_id) VALUES(?,?,?,?,?,?,?)",
    [crypto.randomUUID(), userId, app.provider.origin, subject, app.runtime.clock.now(), kind, organizationId]);
  await app.runtime.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',1,?)",
    [crypto.randomUUID(), ids.institution, userId, app.runtime.clock.now()]);
  const other = await app.runtime.db.get("SELECT * FROM members WHERE user_id=? AND organization_id=?", [userId, ids.institution]);
  const retained = await app.runtime.db.all("SELECT * FROM identities WHERE user_id=? AND subject<>? ORDER BY id", [userId, app.input.externalId]);
  const projects = await app.runtime.db.all("SELECT * FROM projects");
  const collaborations = await app.runtime.db.all("SELECT * FROM project_members");
  expect((await app.release()).status).toBe(200);
  expect(await app.runtime.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [ids.team, userId])).toBeNull();
  expect(await app.runtime.db.get("SELECT * FROM members WHERE organization_id=? AND user_id=?", [ids.institution, userId])).toEqual(other);
  expect(await app.runtime.db.all("SELECT * FROM identities WHERE user_id=? ORDER BY id", [userId])).toEqual(retained);
  expect(await app.runtime.db.get("SELECT user_id FROM federation_claims WHERE user_id=?", [userId])).toBeNull();
  expect(await app.runtime.db.get("SELECT user_id FROM federation_accounts WHERE user_id=?", [userId])).toBeNull();
  expect(await app.runtime.db.get("SELECT id FROM policy_sets WHERE scope_kind='federation-user' AND scope_id=?", [userId])).toBeNull();
  expect(await app.runtime.db.all("SELECT resource_id FROM federation_members WHERE group_id=?", [app.groupResource.id]))
    .toEqual([{ resource_id: otherResource.id }]);
  const releasedGroup = await app.request(`/scim/v2/Groups/${app.groupResource.id}`, { headers: app.bearer });
  expect(await releasedGroup.json()).toMatchObject({ members: [{ value: otherResource.id }], meta: { version: 'W/"2"' } });
  expect(await app.runtime.db.get("SELECT * FROM federation_claims WHERE user_id=(SELECT user_id FROM federation_resources WHERE id=?)", [otherResource.id])).toEqual(otherClaims);
  expect(await app.runtime.db.all("SELECT * FROM projects")).toEqual(projects);
  expect(await app.runtime.db.all("SELECT * FROM project_members")).toEqual(collaborations);
  expect((await app.request("/api/me", { headers: app.managed.headers })).status).toBe(401);
  const independent = await app.login(app.input.userName);
  expect((await app.request("/api/me", { headers: independent.headers })).status).toBe(200);
  const settings = await app.configurations.get();
  await app.runtime.uow.run(tx => app.configurations.save(tx, { ...settings,
    config: { ...settings.config, mappings: [{ group: "researchers", role: "admin", ai: "agent" }] } }));
  expect(await app.runtime.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [ids.team, userId])).toBeNull();
  expect(await app.runtime.db.get("SELECT id FROM policy_sets WHERE scope_kind='federation-user' AND scope_id=?", [userId])).toBeNull();
  // Signed provider proof cannot silently re-link the deleted group subject to the released account.
  const begin = await app.begin();
  expect((await app.request(begin.path, { headers: { cookie: begin.cookie } })).status).toBe(409);
  expect(app.provider.observations).toEqual(["token", "token"]);
  expect(await app.runtime.db.get("SELECT id FROM identities WHERE issuer=? AND subject=?", [app.provider.origin, app.input.externalId])).toBeNull();
});

test("fences a real OIDC callback whose token exchange overlaps the release transaction", async () => {
  await using app = await releaseFixture();
  const authorization = await app.begin();
  app.provider.state.beforeToken = async () => { expect((await app.release()).status).toBe(200); };
  const response = await app.request(authorization.path, { headers: { cookie: authorization.cookie } });
  expect(response.status).toBe(409);
  expect(await app.runtime.db.get("SELECT id FROM sessions WHERE user_id=?", [app.managed.account.id])).toBeNull();
  expect(await app.runtime.db.get("SELECT user_id FROM federation_claims WHERE user_id=?", [app.managed.account.id])).toBeNull();
  expect(await app.runtime.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [ids.team, app.managed.account.id])).toBeNull();
});

test("blocks SCIM profile updates deactivation and reprovisioning after release including after a new management invitation", async () => {
  await using app = await releaseFixture();
  expect((await app.release()).status).toBe(200);
  const before = await releaseSnapshot(app);
  for (const next of [{ path: "displayName", value: "IdP takeover" }, { path: "active", value: false }]) {
    const response = await app.request(`/scim/v2/Users/${app.resource.id}`, { method: "PATCH",
      headers: { ...app.bearer, "if-match": app.resource.meta.version },
      body: JSON.stringify({ schemas: [scimSchemas.patch], Operations: [{ op: "replace", ...next }] }) });
    expect(response.status).toBe(409);
    expect(await releaseSnapshot(app)).toEqual(before);
  }
  const groups = await app.request("/scim/v2/Groups", { method: "POST", headers: app.bearer,
    body: JSON.stringify({ schemas: [scimSchemas.Groups], externalId: "new-group", displayName: "researchers", members: [{ value: app.resource.id }] }) });
  expect(groups.status).toBe(409);
  expect(await releaseSnapshot(app)).toEqual(before);
  // Reinvitation alone must not reset the permanent authority fence.
  await app.runtime.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',0,?)",
    [crypto.randomUUID(), ids.team, app.managed.account.id, app.runtime.clock.now()]);
  const organization = z.object({ version: z.number() }).parse(await app.runtime.db.get("SELECT version FROM organizations WHERE id=?", [ids.team]));
  expect((await app.request(`/api/organizations/${ids.team}/managed/invite`, {
    method: "POST", headers: { ...app.managed.operator.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ userId: app.managed.account.id, expectedVersion: organization.version }),
  })).status).toBe(200);
  const reinvited = await releaseSnapshot(app);
  expect((await app.request(`/scim/v2/Users/${app.resource.id}`, { method: "DELETE",
    headers: { ...app.bearer, "if-match": app.resource.meta.version } })).status).toBe(409);
  expect(await releaseSnapshot(app)).toEqual(reinvited);
});

test("denies release under real configured requireSso before changing any release state", async () => {
  await using app = await releaseFixture();
  expect((await app.request("/api/admin/identity/break-glass", { method: "POST",
    headers: app.managed.operator.headers, body: JSON.stringify({ password }) })).status).toBe(200);
  const settings = await app.configurations.get();
  await app.runtime.uow.run(tx => app.configurations.save(tx, { ...settings, config: { ...settings.config, requireSso: true } }));
  const before = await releaseSnapshot(app);
  const response = await app.release();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "SSO_REQUIRED" } });
  expect(await releaseSnapshot(app)).toEqual(before);
  expect((await app.request("/api/auth/login", { method: "POST",
    body: JSON.stringify({ email: app.input.userName, password }) })).status).toBe(403);
  expect((await app.configurations.get()).config.requireSso).toBe(true);
});

test("rolls back federation cleanup and release fences when a later audit write fails", async () => {
  await using app = await releaseFixture();
  await app.runtime.db.exec(`CREATE TRIGGER fail_release_audit BEFORE INSERT ON audit_entries
    WHEN NEW.event='managed.released' BEGIN SELECT RAISE(ABORT,'release audit failure'); END;`);
  const before = await releaseSnapshot(app);
  expect((await app.release()).status).toBe(500);
  expect(await releaseSnapshot(app)).toEqual(before);
  expect((await app.request("/api/me", { headers: app.managed.headers })).status).toBe(200);
});

test("records organization provenance for a real OIDC-created identity and refuses a personal authority collision", async () => {
  await using app = await fixture({ organizationId: ids.team });
  const first = await app.begin();
  expect((await app.request(first.path, { headers: { cookie: first.cookie } })).status).toBe(303);
  const identity = await app.runtime.db.get("SELECT authority_kind,organization_id FROM identities WHERE issuer=? AND subject=?",
    [app.provider.origin, app.provider.state.subject]);
  expect(identity).toEqual({ authority_kind: "organization", organization_id: ids.team });
  // A distinct pre-existing personal link at the same issuer is not federation-owned.
  app.provider.state.subject = "personal-subject";
  await app.runtime.db.run("INSERT INTO identities(id,user_id,issuer,subject,created_at,authority_kind) VALUES(?,?,?,?,?,'personal')",
    [crypto.randomUUID(), ids.mai, app.provider.origin, app.provider.state.subject, app.runtime.clock.now()]);
  const personal = await app.runtime.db.get("SELECT * FROM identities WHERE issuer=? AND subject=?", [app.provider.origin, app.provider.state.subject]);
  const next = await app.begin();
  expect((await app.request(next.path, { headers: { cookie: next.cookie } })).status).toBe(409);
  expect(await app.runtime.db.get("SELECT * FROM identities WHERE issuer=? AND subject=?", [app.provider.origin, app.provider.state.subject])).toEqual(personal);
  expect(await app.runtime.db.get("SELECT user_id FROM federation_claims WHERE user_id=?", [ids.mai])).toBeNull();
});
