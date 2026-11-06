import { expect, test } from "bun:test";
import { z } from "zod";
import type { Id, Policy } from "@quire/contracts";
import { baseFixture, projectEnvelope } from "./harness";
import { defaultPolicy, fixtureIds as ids } from "../../fixtures/foundation";
import { postgresFixture } from "../review/postgres-fixture";

type Fixture = Awaited<ReturnType<typeof baseFixture>>;
type Actor = Awaited<ReturnType<Fixture["login"]>>;
async function fixture(resources: AsyncDisposableStack) {
  const url = process.env["QUIRE_SHARING_POSTGRES_URL"];
  const postgres = url ? await postgresFixture(url) : null;
  if (postgres) resources.defer(() => postgres.close());
  return resources.use(await baseFixture(postgres ? { createAdapters: postgres.createAdapters } : {}));
}
async function policy(app: Fixture, actor: Actor, patch: Partial<Policy>) {
  const organization = await app.runtime.db.get<{ version: number }>("SELECT version FROM organizations WHERE id=?", [ids.team]);
  const response = await app.request(`/api/organizations/${ids.team}/policy`, {
    method: "PATCH", headers: { ...actor.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ ...patch, expectedVersion: organization?.version }),
  });
  expect(response.status).toBe(200);
}
async function create(app: Fixture, actor: Actor) {
  const response = await app.request("/api/projects", {
    method: "POST", headers: { ...actor.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ name: "Prospective sharing", workspaceId: ids.team, origin: { kind: "blank" } }),
  });
  expect(response.status).toBe(200);
  return projectEnvelope.parse(await response.json()).data;
}
async function link(app: Fixture, actor: Actor, projectId: Id, role: "viewer" | "editor" | "off" = "viewer") {
  const project = await app.service.getProject(projectId);
  return app.request(`/api/projects/${projectId}/link`, {
    method: "PUT", headers: { ...actor.headers, "idempotency-key": crypto.randomUUID(), "if-match": `"v${project.version}"` },
    body: JSON.stringify({ role, expectedVersion: project.version }),
  });
}
async function joinOrganization(app: Fixture, admin: Actor, userId: Id, role: "admin" | "member" = "member") {
  const organization = await app.runtime.db.get<{ version: number }>("SELECT version FROM organizations WHERE id=?", [ids.team]);
  const response = await app.request(`/api/organizations/${ids.team}/members`, {
    method: "POST", headers: { ...admin.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ userId, role, licensed: false, expectedVersion: organization?.version }),
  });
  expect(response.status).toBe(200);
}
async function leaveOrganization(app: Fixture, admin: Actor, userId: Id) {
  const member = z.object({ id: z.string(), version: z.number() }).parse(await app.runtime.db.get(
    "SELECT id,version FROM members WHERE organization_id=? AND user_id=?", [ids.team, userId]));
  const response = await app.request(`/api/organizations/${ids.team}/members/${member.id}`, {
    method: "DELETE", headers: admin.headers, body: JSON.stringify({ expectedVersion: member.version }),
  });
  expect(response.status).toBe(200);
}
async function token(response: Response) {
  expect(response.status).toBe(200);
  const url = z.object({ data: z.object({ urlOnce: z.string() }) }).parse(await response.json()).data.urlOnce;
  return z.string().parse(new URL(url).searchParams.get("share"));
}

test("freezes workspace sharing at creation while owner membership restrictions remain live", async () => {
  await using resources = new AsyncDisposableStack();
  const app = await fixture(resources);
  const owner = await app.login();
  const admin = await app.login("operator@quire.local");
  await joinOrganization(app, owner, ids.operator, "admin");
  await policy(app, admin, { sharing: "anyone", anonymousRead: true });
  const permissive = await create(app, owner);
  const origin = await app.runtime.db.get("SELECT created_at,updated_at FROM projects WHERE id=?", [permissive.id]);
  const baseline = await app.runtime.db.get("SELECT * FROM account_project_sharing WHERE project_id=?", [permissive.id]);
  expect(baseline).toMatchObject({ sharing: "anyone", provenance: "creation", workspace_id: ids.team });

  await policy(app, admin, { sharing: "named" });
  const restrictive = await create(app, owner);
  // The owner is still a member: live actor restrictions deny even the permissive project.
  expect((await link(app, owner, permissive.id)).status).toBe(403);
  await leaveOrganization(app, admin, ids.kien);
  const existingToken = await token(await link(app, owner, permissive.id));
  expect((await link(app, owner, restrictive.id)).status).toBe(403);
  expect((await app.request(`/api/projects/${permissive.id}/files?branch=main`,
    { headers: { "x-project-token": existingToken } })).status).toBe(200);

  await policy(app, admin, { sharing: "anyone" });
  // Relaxing the workspace cannot widen a project's captured restrictive ceiling.
  expect((await link(app, owner, restrictive.id)).status).toBe(403);
  await joinOrganization(app, admin, ids.kien);
  const later = await create(app, owner);
  expect((await link(app, owner, later.id)).status).toBe(200);
  await app.restart();
  expect(await app.runtime.db.get("SELECT * FROM account_project_sharing WHERE project_id=?", [permissive.id])).toEqual(baseline);
  expect(await app.runtime.db.get("SELECT created_at FROM projects WHERE id=?", [permissive.id]))
    .toEqual({ created_at: z.object({ created_at: z.string() }).parse(origin).created_at });
});

test("keeps actor joins, leaves, independent ceilings, anonymous controls and link revocation live over HTTP", async () => {
  await using resources = new AsyncDisposableStack();
  const app = await fixture(resources);
  const owner = await app.login();
  const admin = await app.login("operator@quire.local");
  const outsider = await app.login("outsider@quire.local");
  await joinOrganization(app, owner, ids.operator, "admin");
  await policy(app, admin, { sharing: "anyone", anonymousRead: true, chat: true });
  const project = await create(app, owner);
  await leaveOrganization(app, admin, ids.kien);
  const share = await token(await link(app, owner, project.id, "editor"));
  const route = `/api/projects/${project.id}/files?branch=main`;
  const anonymous = () => app.request(route, { headers: { "x-project-token": share } });
  const member = () => app.request(route, { headers: outsider.headers });
  const joined = await app.request(`/api/projects/${project.id}/files`, {
    method: "POST", headers: { ...outsider.headers, "x-project-token": share, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope: { projectId: project.id, branch: "main" },
      path: "joined.txt", kind: "file", text: "joined via link", expectedVersion: 1 }),
  });
  expect(joined.status).toBe(200);
  expect((await member()).status).toBe(200);
  await policy(app, admin, { sharing: "named", chat: false });
  expect((await member()).status).toBe(200);
  expect((await anonymous()).status).toBe(200);
  const access = await app.request(`/api/projects/${project.id}/effective-access?branch=main`, { headers: outsider.headers });
  expect(z.object({ data: z.object({ capabilities: z.object({ chat: z.boolean() }) }) }).parse(await access.json()).data.capabilities.chat).toBe(false);
  await joinOrganization(app, admin, ids.outsider);
  expect((await member()).status).toBe(403);
  await leaveOrganization(app, admin, ids.outsider);
  expect((await member()).status).toBe(200);

  for (const scope of ["project", "global", "user", "federation-user"] as const) {
    const scopeId = scope === "project" ? project.id : scope === "global" ? "deployment" : ids.kien;
    const id = crypto.randomUUID();
    await app.runtime.db.run(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,?,?,?,?)`,
      [id, scope, scopeId, JSON.stringify({ ...defaultPolicy, sharing: "named", anonymousRead: true }), app.runtime.clock.now()]);
    expect((await link(app, owner, project.id)).status).toBe(403);
    expect((await anonymous()).status).toBe(403);
    await app.runtime.db.run("DELETE FROM policy_sets WHERE id=?", [id]);
  }
  await policy(app, admin, { anonymousRead: false });
  expect((await anonymous()).status).toBe(401);
  expect((await member()).status).toBe(200);
  await policy(app, admin, { anonymousRead: true });
  expect((await anonymous()).status).toBe(200);
  expect((await link(app, owner, project.id, "off")).status).toBe(200);
  expect((await anonymous()).status).toBe(404);
  expect((await member()).status).toBe(404);
});
