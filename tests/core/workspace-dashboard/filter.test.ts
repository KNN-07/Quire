import { expect, test } from "bun:test";
import { endpoints, IdSchema, resultSchema } from "@quire/contracts";
import { baseFixture, clock } from "../base/harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { workspaceProjects } from "./fixture";

test("workspace membership narrows the project ACL without granting hidden projects", async () => {
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const data = await workspaceProjects(fixture.service);
  async function list(query: string) {
    const response = await fixture.request(`/api/projects?sort=title&direction=asc&${query}`, { headers: owner.headers });
    expect(response.status).toBe(200);
    const result = resultSchema(endpoints.projectList.output).parse(await response.json());
    if ("error" in result) throw new Error(result.error.message);
    return result.data;
  }
  expect((await list("workspace=personal")).items.map(row => row.id)).toEqual([data.personal.id, data.shared.id]);
  expect((await list(`workspace=${ids.team}`)).items.map(row => row.id))
    .toEqual([ids.project, data.teamShared.id, data.team.id]);
  expect((await list(`workspace=${ids.institution}`)).items.map(row => row.id)).toEqual([data.institution.id]);
  expect((await list("workspace=all")).items).toHaveLength(6);
  expect((await list(`workspace=${ids.team}&owner=shared`)).items.map(row => row.id)).toEqual([data.teamShared.id]);
  expect((await list("workspace=personal&owner=me")).items.map(row => row.id)).toEqual([data.personal.id]);
  expect((await list(`workspace=${ids.team}&q=mai`)).items.map(row => row.id)).toEqual([data.teamShared.id]);
  const tag = IdSchema.parse(crypto.randomUUID());
  const otherTag = IdSchema.parse(crypto.randomUUID());
  await fixture.runtime.db.run("INSERT INTO tags(id,user_id,name,color_hex,created_at) VALUES(?,?,?,'#123456',?)", [tag, ids.kien, "Workspace tag", clock.now()]);
  await fixture.runtime.db.run("INSERT INTO tags(id,user_id,name,color_hex,created_at) VALUES(?,?,?,'#654321',?)", [otherTag, ids.mai, "Private tag", clock.now()]);
  for (const project of [data.team, data.personal]) {
    await fixture.runtime.db.run("INSERT INTO tag_assignments(tag_id,project_id) VALUES(?,?)", [tag, project.id]);
  }
  await fixture.runtime.db.run("INSERT INTO tag_assignments(tag_id,project_id) VALUES(?,?)", [otherTag, data.team.id]);
  const tagged = await list(`workspace=${ids.team}&tag=${tag}`);
  expect(tagged.items.map(row => row.id)).toEqual([data.team.id]);
  expect(tagged.items[0]?.tagIds).toEqual([tag]);
  expect((await list(`workspace=${ids.team}&tag=${otherTag}`)).items).toEqual([]);
  const first = await list(`workspace=${ids.team}&limit=1`);
  expect(first.items.map(row => row.id)).toEqual([ids.project]);
  expect(first.nextCursor).toBe(ids.project);
  const second = await list(`workspace=${ids.team}&limit=1&cursor=${first.nextCursor}`);
  expect(second.items.map(row => row.id)).toEqual([data.teamShared.id]);
  const last = await list(`workspace=${ids.team}&limit=1&cursor=${second.nextCursor}`);
  expect(last.items.map(row => row.id)).toEqual([data.team.id]);
  expect(last.nextCursor).toBeNull();
  for (const cursor of [data.personal.id, data.teamHidden.id, data.institutionHidden.id]) {
    const response = await fixture.request(`/api/projects?workspace=${ids.team}&cursor=${cursor}`, { headers: owner.headers });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_CURSOR", message: "Cursor not in this result set" } });
  }
  await fixture.runtime.db.run("INSERT INTO project_user_state(project_id,user_id,state,updated_at) VALUES(?,?,'archived',?)", [data.team.id, ids.kien, clock.now()]);
  expect((await list(`workspace=${ids.team}&state=archived`)).items.map(row => row.id)).toEqual([data.team.id]);
  expect((await list(`workspace=${ids.team}&state=trash`)).items).toEqual([]);
  await fixture.restart();
  expect((await list(`workspace=${ids.team}&state=archived`)).items.map(row => row.id)).toEqual([data.team.id]);
});

test("workspace listing is membership-only even for operators and denies unknown filters identically", async () => {
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const viewer = await fixture.login("alex@quire.local");
  const operator = await fixture.login("operator@quire.local");
  await workspaceProjects(fixture.service);
  const listing = await fixture.request("/api/project-workspaces?limit=1", { headers: owner.headers });
  expect(listing.headers.get("cache-control")).toBe("private, no-store");
  const first = resultSchema(endpoints.projectWorkspaces.output).parse(await listing.json());
  if ("error" in first) throw new Error(first.error.message);
  expect(first.data).toEqual({ items: [{ id: ids.team, name: "Robotics Lab", kind: "team" }], nextCursor: ids.team });
  const second = await fixture.request(`/api/project-workspaces?limit=1&cursor=${ids.team}`, { headers: owner.headers });
  expect(await second.json()).toMatchObject({ data: { items: [{ id: ids.institution, name: "Quire Institute", kind: "institution" }], nextCursor: null } });
  for (const session of [viewer, operator]) {
    const response = await fixture.request("/api/project-workspaces", { headers: session.headers });
    const result = resultSchema(endpoints.projectWorkspaces.output).parse(await response.json());
    if ("error" in result) throw new Error(result.error.message);
    expect(result.data).toEqual({ items: [], nextCursor: null });
    for (const workspace of [ids.team, crypto.randomUUID()]) {
      const denied = await fixture.request(`/api/projects?workspace=${workspace}&cursor=${ids.project}&limit=1`, { headers: session.headers });
      expect(denied.status).toBe(404);
      expect(resultSchema(endpoints.projectList.output).parse(await denied.json())).toMatchObject({ error: { code: "NOT_FOUND", message: "Workspace not found" } });
      const cursor = await fixture.request(`/api/project-workspaces?cursor=${workspace}`, { headers: session.headers });
      expect(cursor.status).toBe(400);
    }
  }
  const all = await fixture.request("/api/projects?workspace=all", { headers: viewer.headers });
  expect(await all.json()).toMatchObject({ data: { items: [{ id: ids.project, role: "viewer" }], nextCursor: null } });
  expect((await fixture.request("/api/project-workspaces")).status).toBe(401);
  expect((await fixture.request("/api/projects?workspace=not-a-workspace", { headers: owner.headers })).status).toBe(400);
});

test("policy-revoked link grants contribute neither workspace rows nor cursors", async () => {
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const outsider = await fixture.login("outsider@quire.local");
  await fixture.runtime.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',0,?)",
    [crypto.randomUUID(), ids.team, ids.outsider, clock.now()]);
  await fixture.setPolicy(ids.project, { sharing: "anyone", anonymousRead: true });
  const project = await fixture.service.getProject(ids.project);
  const enabled = await fixture.request(`/api/projects/${ids.project}/link`, {
    method: "PUT", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(), "if-match": `"v${project.version}"` },
    body: JSON.stringify({ role: "editor", expectedVersion: project.version }),
  });
  const link = resultSchema(endpoints.accessLinkPut.output).parse(await enabled.json());
  if ("error" in link) throw new Error(link.error.message);
  const token = new URL(link.data.urlOnce ?? "").searchParams.get("share");
  if (!token) throw new Error("Expected real share credential");
  const write = await fixture.request(`/api/projects/${ids.project}/files`, {
    method: "POST", headers: { ...outsider.headers, "x-project-token": token, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope: { projectId: ids.project, branch: "main" }, path: "grant.txt", kind: "file", text: "real grant",
      expectedVersion: (await fixture.service.getBranch({ projectId: ids.project, branch: "main" })).revision }),
  });
  expect(write.status).toBe(200);
  const before = await fixture.request(`/api/projects?workspace=${ids.team}&limit=1`, { headers: outsider.headers });
  expect(await before.json()).toMatchObject({ data: { items: [{ id: ids.project }], nextCursor: null } });
  await fixture.setPolicy(ids.project, { sharing: "named" });
  const after = await fixture.request(`/api/projects?workspace=${ids.team}&limit=1`, { headers: outsider.headers });
  expect(after.status).toBe(200);
  expect(await after.json()).toMatchObject({ data: { items: [], nextCursor: null } });
  const cursor = await fixture.request(`/api/projects?workspace=${ids.team}&limit=1&cursor=${ids.project}`, { headers: outsider.headers });
  expect(cursor.status).toBe(400);
  await fixture.runtime.db.run("DELETE FROM members WHERE organization_id=? AND user_id=?", [ids.team, ids.outsider]);
  const denied = await fixture.request(`/api/projects?workspace=${ids.team}`, { headers: outsider.headers });
  expect(denied.status).toBe(404);
});
