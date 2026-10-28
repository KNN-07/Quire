import { test, expect } from "bun:test";
import { z } from "zod";
import { TemplateVersionSchema } from "@quire/contracts";
import { catalogFixture, templateEnvelope } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("denies publication when an author has no publisher role", async () => {
  // Given: an author's submitted template and an operator-approved version.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const operator = await fixture.login("operator@quire.local");
  const source = await fixture.create(owner.headers);
  let version = templateEnvelope.parse(await (await fixture.mutate("/api/templates", owner.headers, {
    name: "Public", category: "Article", description: "", license: "MIT", visibility: "public", sourceProjectId: source.id,
  })).json()).data;
  version = templateEnvelope.parse(await (await fixture.mutate(`/api/templates/${version.templateId}/submit`, owner.headers,
    { expectedVersion: version.version })).json()).data;
  version = templateEnvelope.parse(await (await fixture.mutate(`/api/templates/${version.templateId}/approve`, operator.headers,
    { expectedVersion: version.version, versionId: version.id })).json()).data;
  // When: the ordinary author tries to publish.
  const result = await fixture.mutate(`/api/templates/${version.templateId}/publish`, owner.headers,
    { expectedVersion: version.version, versionId: version.id });
  // Then: authorship alone does not grant publishing authority.
  expect(result.status).toBe(403);
});

test("denies approval when an actor has only a publisher grant", async () => {
  // Given: a submitted template and a separate publisher-only actor.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const publisher = await fixture.login("outsider@quire.local");
  const source = await fixture.create(owner.headers);
  let version = templateEnvelope.parse(await (await fixture.mutate("/api/templates", owner.headers, {
    name: "Public", category: "", description: "", license: "MIT", visibility: "public", sourceProjectId: source.id,
  })).json()).data;
  version = templateEnvelope.parse(await (await fixture.mutate(`/api/templates/${version.templateId}/submit`, owner.headers,
    { expectedVersion: version.version })).json()).data;
  (await fixture.runtime.db.run("INSERT INTO catalog_roles(user_id,role) VALUES(?,'template-publisher')", [publisher.user.id]));
  // When: publishing authority is presented as approval authority.
  const result = await fixture.mutate(`/api/templates/${version.templateId}/approve`, publisher.headers,
    { expectedVersion: version.version, versionId: version.id });
  // Then: the independent curator grant remains required.
  expect(result.status).toBe(403);
});

test("denies publishing an unapproved draft when the actor is an operator", async () => {
  // Given: a real draft snapshot and a privileged operator.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const operator = await fixture.login("operator@quire.local");
  const source = await fixture.create(owner.headers);
  const version = templateEnvelope.parse(await (await fixture.mutate("/api/templates", owner.headers, {
    name: "Draft", category: "", description: "", license: "MIT", visibility: "public", sourceProjectId: source.id,
  })).json()).data;
  // When: the operator bypasses submission and approval.
  const result = await fixture.mutate(`/api/templates/${version.templateId}/publish`, operator.headers,
    { expectedVersion: version.version, versionId: version.id });
  // Then: even operator authority cannot bypass approval.
  expect(result.status).toBe(409);
});

for (const visibility of ["private", "organization", "public"]) {
  test(`enforces ${visibility} gallery visibility when an approved template is published`, async () => {
    // Given: a template snapshot from a real organization project.
    await using fixture = await catalogFixture();
    const owner = await fixture.login();
    const outsider = await fixture.login("outsider@quire.local");
    const operator = await fixture.login("operator@quire.local");
    let version = templateEnvelope.parse(await (await fixture.mutate("/api/templates", owner.headers, {
      name: "Scoped", category: "", description: "", license: "CC-BY-4.0", visibility, sourceProjectId: ids.project,
    })).json()).data;
    for (const action of ["submit", "approve", "publish"]) {
      version = templateEnvelope.parse(await (await fixture.mutate(`/api/templates/${version.templateId}/${action}`,
        action === "submit" ? owner.headers : operator.headers,
        { expectedVersion: version.version, ...(action === "submit" ? {} : { versionId: version.id }) })).json()).data;
    }
    // When: outsider and anonymous users inspect the gallery through HTTP.
    const stranger = await fixture.request(`/api/templates/${version.templateId}`, { headers: outsider.headers });
    const anonymous = await fixture.request("/api/templates");
    const listed = z.object({ data: z.object({ items: z.array(TemplateVersionSchema) }) }).parse(await anonymous.json()).data.items;
    // Then: only public source is exposed beyond the author or organization boundary.
    expect(stranger.status).toBe(visibility === "public" ? 200 : 404);
    expect(listed.some(item => item.id === version.id)).toBe(visibility === "public");
  });
}

test("rejects editing approved metadata when a draft has not been created", async () => {
  // Given: a submitted version whose content and license are frozen.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const source = await fixture.create(owner.headers);
  let version = templateEnvelope.parse(await (await fixture.mutate("/api/templates", owner.headers, {
    name: "Draft", category: "", description: "", license: "MIT", visibility: "private", sourceProjectId: source.id,
  })).json()).data;
  version = templateEnvelope.parse(await (await fixture.mutate(`/api/templates/${version.templateId}/submit`, owner.headers,
    { expectedVersion: version.version })).json()).data;
  // When: the author changes the license without a new version.
  const result = await fixture.request(`/api/templates/${version.templateId}`, { method: "PATCH", headers: owner.headers,
    body: JSON.stringify({ expectedVersion: version.version, license: "UNLICENSED" }) });
  // Then: submitted content cannot mutate under an approval decision.
  expect(result.status).toBe(409);
});

test("rejects version snapshots when they belong to another project", async () => {
  // Given: two actual independently persistent projects.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const a = await fixture.create(owner.headers, "A");
  const b = await fixture.create(owner.headers, "B");
  const scope = { projectId: b.id, branch: "main" };
  const snapshot = await fixture.service.snapshot(owner.user.id, scope, (await fixture.service.getBranch(scope)).revision);
  const version = templateEnvelope.parse(await (await fixture.mutate("/api/templates", owner.headers, {
    name: "A", category: "", description: "", license: "MIT", visibility: "private", sourceProjectId: a.id,
  })).json()).data;
  // When: a version claims unrelated snapshot bytes.
  const response = await fixture.mutate(`/api/templates/${version.templateId}/versions`, owner.headers,
    { expectedVersion: version.version, snapshotId: snapshot.id });
  // Then: the template source binding rejects it.
  expect(response.status).toBe(422);
});
