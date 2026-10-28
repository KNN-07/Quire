import { test, expect } from "bun:test";
import { catalogFixture, templateEnvelope } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("publishes organization content when separate scoped curator and publisher grants authorize the version", async () => {
  // Given: distinct principals with only the assigned catalog role for this organization.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const curator = await fixture.login("outsider@quire.local");
  const publisher = await fixture.login("mai@quire.local");
  (await fixture.runtime.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',1,?)", [crypto.randomUUID(), ids.team, publisher.user.id, fixture.runtime.clock.now()]));
  (await fixture.runtime.db.run("INSERT INTO catalog_roles(user_id,role,scope) VALUES(?,'curator',?)", [curator.user.id, ids.team]));
  (await fixture.runtime.db.run("INSERT INTO catalog_roles(user_id,role,scope) VALUES(?,'template-publisher',?)", [publisher.user.id, ids.team]));
  let version = templateEnvelope.parse(await (await fixture.mutate("/api/templates", owner.headers, {
    name: "Team", category: "", description: "", license: "MIT", visibility: "organization", sourceProjectId: ids.project,
  })).json()).data;
  version = templateEnvelope.parse(await (await fixture.mutate(`/api/templates/${version.templateId}/submit`, owner.headers,
    { expectedVersion: version.version })).json()).data;
  version = templateEnvelope.parse(await (await fixture.mutate(`/api/templates/${version.templateId}/approve`, curator.headers,
    { expectedVersion: version.version, versionId: version.id })).json()).data;
  // When: a separately granted organization publisher publishes the approved source.
  const response = await fixture.mutate(`/api/templates/${version.templateId}/publish`, publisher.headers,
    { expectedVersion: version.version, versionId: version.id, workspaceId: ids.team });
  // Then: the approved source is available to members, not the non-member curator.
  expect(templateEnvelope.parse(await response.json()).data.status).toBe("published");
  expect((await fixture.request(`/api/templates/${version.templateId}`, { headers: publisher.headers })).status).toBe(200);
  expect((await fixture.request(`/api/templates/${version.templateId}`, { headers: curator.headers })).status).toBe(404);
});

test("denies cross-organization approval when a curator grant belongs to a different organization", async () => {
  // Given: an institution-only curator and a team template.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const curator = await fixture.login("outsider@quire.local");
  (await fixture.runtime.db.run("INSERT INTO catalog_roles(user_id,role,scope) VALUES(?,'curator',?)", [curator.user.id, ids.institution]));
  let version = templateEnvelope.parse(await (await fixture.mutate("/api/templates", owner.headers, {
    name: "Team", category: "", description: "", license: "MIT", visibility: "organization", sourceProjectId: ids.project,
  })).json()).data;
  version = templateEnvelope.parse(await (await fixture.mutate(`/api/templates/${version.templateId}/submit`, owner.headers,
    { expectedVersion: version.version })).json()).data;
  // When: the curator attempts to approve content outside that scope.
  const response = await fixture.mutate(`/api/templates/${version.templateId}/approve`, curator.headers,
    { expectedVersion: version.version, versionId: version.id });
  // Then: organization roles do not spill into another organization.
  expect(response.status).toBe(403);
});

test("requires an explicit license when creating a template", async () => {
  // Given: real source without supplied licensing permission.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const source = await fixture.create(owner.headers);
  // When: that source is submitted as an unlicensed public template.
  const response = await fixture.mutate("/api/templates", owner.headers,
    { name: "No license", category: "", description: "", license: " ", visibility: "public", sourceProjectId: source.id });
  // Then: it cannot enter the publishing workflow.
  expect(response.status).toBe(422);
});
