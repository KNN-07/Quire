import { expect, test } from "bun:test";
import { z } from "zod";
import { TemplateVersionSchema } from "@quire/contracts";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { catalogFixture, templateEnvelope } from "./harness";

test("institution admins explicitly select published immutable versions without following later approval", async () => {
  await using app = await catalogFixture();
  const author = await app.login();
  const operator = await app.login("operator@quire.local");
  const admin = await app.login("mai@quire.local");
  const outsider = await app.login("outsider@quire.local");
  await app.runtime.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'admin',1,?)",
    [crypto.randomUUID(), ids.institution, ids.mai, app.runtime.clock.now()]);
  let version = templateEnvelope.parse(await (await app.mutate("/api/templates", author.headers, {
    name: "Selected public report", category: "", description: "", license: "MIT",
    visibility: "public", sourceProjectId: ids.project,
  })).json()).data;
  const portal = `/api/organizations/${ids.institution}/templates`;
  const select = async (headers: HeadersInit, expectedVersion = version.version) => {
    const response = await app.request(`${portal}/${version.templateId}`, {
      method: "PUT", headers, body: JSON.stringify({ versionId: version.id, expectedVersion }),
    });
    if (response.ok) version = templateEnvelope.parse(await response.clone().json()).data;
    return response;
  };
  const list = async () => z.object({ data: z.object({ items: z.array(TemplateVersionSchema) }) })
    .parse(await (await app.request(portal)).json()).data.items;
  expect((await select(admin.headers)).status).toBe(409);
  for (const action of ["submit", "approve", "publish"]) {
    version = templateEnvelope.parse(await (await app.mutate(`/api/templates/${version.templateId}/${action}`,
      action === "submit" ? author.headers : operator.headers,
      { expectedVersion: version.version, ...(action === "submit" ? {} : { versionId: version.id }) })).json()).data;
  }
  expect(await list()).toHaveLength(0);
  expect((await select(outsider.headers)).status).toBe(403);
  expect((await select(admin.headers, version.version - 1)).status).toBe(409);
  const beforeSelection = version.version;
  expect((await select(admin.headers)).status).toBe(200);
  expect(version.version).toBe(beforeSelection + 1);
  expect((await select(admin.headers, beforeSelection)).status).toBe(409);
  expect((await app.request(`${portal}/${version.templateId}`, { method: "DELETE", headers: admin.headers,
    body: JSON.stringify({ expectedVersion: beforeSelection }) })).status).toBe(409);
  const selected = version;
  expect((await list()).map(item => item.id)).toEqual([selected.id]);
  version = templateEnvelope.parse(await (await app.mutate(`/api/templates/${version.templateId}/versions`, author.headers,
    { snapshotId: version.snapshotId, expectedVersion: version.version })).json()).data;
  expect((await list()).map(item => item.id)).toEqual([selected.id]);
  for (const action of ["submit", "approve"]) {
    version = templateEnvelope.parse(await (await app.mutate(`/api/templates/${version.templateId}/${action}`,
      action === "submit" ? author.headers : operator.headers,
      { expectedVersion: version.version, ...(action === "submit" ? {} : { versionId: version.id }) })).json()).data;
  }
  expect((await list()).map(item => item.id)).toEqual([selected.id]);
  expect((await select(admin.headers)).status).toBe(409);
  version = templateEnvelope.parse(await (await app.mutate(`/api/templates/${version.templateId}/publish`, operator.headers,
    { expectedVersion: version.version, versionId: version.id })).json()).data;
  expect(await list()).toHaveLength(0);
  expect((await select(admin.headers)).status).toBe(200);
  await app.restart();
  expect((await list()).map(item => item.id)).toEqual([version.id]);
  expect((await app.request(`${portal}/${version.templateId}`, { method: "DELETE", headers: outsider.headers,
    body: JSON.stringify({ expectedVersion: version.version }) })).status).toBe(403);
  const removalVersion = version.version;
  const removal = await app.request(`${portal}/${version.templateId}`, { method: "DELETE", headers: admin.headers,
    body: JSON.stringify({ expectedVersion: removalVersion }) });
  expect(removal.status).toBe(200);
  const removed = z.object({ data: z.object({ version: z.number() }) }).parse(await removal.json()).data;
  expect(removed.version).toBe(removalVersion + 1);
  version = { ...version, version: removed.version };
  expect((await select(admin.headers, removalVersion)).status).toBe(409);
  expect(await list()).toHaveLength(0);
  expect((await select(admin.headers)).status).toBe(200);
  version = templateEnvelope.parse(await (await app.mutate(`/api/templates/${version.templateId}/unpublish`, author.headers,
    { expectedVersion: version.version })).json()).data;
  expect(await list()).toHaveLength(0);
  expect((await select(admin.headers)).status).toBe(409);
  expect((await app.mutate(`/api/templates/${version.templateId}/publish`, operator.headers,
    { expectedVersion: version.version, versionId: version.id })).status).toBe(409);
});

test("institution featuring preserves organization/private audiences and refuses team portals", async () => {
  await using app = await catalogFixture();
  const author = await app.login();
  const operator = await app.login("operator@quire.local");
  const outsider = await app.login("outsider@quire.local");
  for (const visibility of ["private", "organization"]) {
    let version = templateEnvelope.parse(await (await app.mutate("/api/templates", author.headers, {
      name: "Restricted report", category: "", description: "", license: "MIT",
      visibility, sourceProjectId: ids.project,
    })).json()).data;
    for (const action of ["submit", "approve", "publish"]) {
      version = templateEnvelope.parse(await (await app.mutate(`/api/templates/${version.templateId}/${action}`,
        action === "submit" ? author.headers : operator.headers,
        { expectedVersion: version.version, ...(action === "submit" ? {} : { versionId: version.id }) })).json()).data;
    }
    expect((await app.request(`/api/organizations/${ids.institution}/templates/${version.templateId}`, {
      method: "PUT", headers: operator.headers, body: JSON.stringify({ versionId: version.id, expectedVersion: version.version }),
    })).status).toBe(403);
  }
  expect((await app.request(`/api/organizations/${ids.team}/templates`, { headers: outsider.headers })).status).toBe(404);
});

test("institution selections expose organization content only to current members", async () => {
  await using app = await catalogFixture();
  const author = await app.login();
  const operator = await app.login("operator@quire.local");
  const member = await app.login("mai@quire.local");
  const outsider = await app.login("outsider@quire.local");
  for (const userId of [ids.kien, ids.mai]) await app.runtime.db.run(
    "INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',1,?)",
    [crypto.randomUUID(), ids.institution, userId, app.runtime.clock.now()]);
  const response = await app.mutate("/api/projects", author.headers,
    { name: "Institution source", workspaceId: ids.institution, origin: { kind: "blank" } });
  const project = z.object({ data: z.object({ id: z.string() }) }).parse(await response.json()).data;
  let version = templateEnvelope.parse(await (await app.mutate("/api/templates", author.headers, {
    name: "Institution report", category: "", description: "", license: "MIT",
    visibility: "organization", sourceProjectId: project.id,
  })).json()).data;
  for (const action of ["submit", "approve", "publish"]) {
    version = templateEnvelope.parse(await (await app.mutate(`/api/templates/${version.templateId}/${action}`,
      action === "submit" ? author.headers : operator.headers,
      { expectedVersion: version.version, ...(action === "submit" ? {} : { versionId: version.id }) })).json()).data;
  }
  const portal = `/api/organizations/${ids.institution}/templates`;
  expect((await app.request(`${portal}/${version.templateId}`, {
    method: "PUT", headers: operator.headers,
    body: JSON.stringify({ versionId: version.id, expectedVersion: version.version }),
  })).status).toBe(200);
  const list = async (headers: HeadersInit = {}) => z.object({ data: z.object({ items: z.array(TemplateVersionSchema) }) })
    .parse(await (await app.request(portal, { headers })).json()).data.items;
  expect(await list()).toHaveLength(0);
  expect(await list(outsider.headers)).toHaveLength(0);
  expect((await list(member.headers)).map(item => item.id)).toEqual([version.id]);
  expect((await app.request(`${portal}/${version.templateId}`, {
    method: "PUT", headers: member.headers,
    body: JSON.stringify({ versionId: version.id, expectedVersion: version.version }),
  })).status).toBe(403);
  await app.runtime.db.run("DELETE FROM members WHERE organization_id=? AND user_id=?", [ids.institution, ids.mai]);
  expect(await list(member.headers)).toHaveLength(0);
});
