import { test, expect } from "bun:test";
import { z } from "zod";
import { AccessRequestSchema, IdSchema } from "@quire/contracts";
import { baseFixture, projectEnvelope, clock } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("creates an independent project from a published database template version", async () => {
  // Given: a published catalog version bound to an immutable source snapshot.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const templateId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  (await fixture.runtime.uow.run(async (tx) => {
    await tx.lock("quire:accounts");

    (await tx.run(`INSERT INTO templates(id,author_id,name,category,description,license,visibility,created_at)
      VALUES(?,?,'Catalog paper','article','','MIT','public',?)`, [templateId, ids.kien, clock.now()]));
    (await tx.run(`INSERT INTO template_versions(id,template_id,snapshot_id,name,category,description,license,visibility,status,created_at)
      VALUES(?,?,?,'Catalog paper','article','','MIT','public','published',?)`, [versionId, templateId, ids.snapshot, clock.now()]));

  }));
  // When: an authenticated client creates from that exact version.
  const response = await fixture.request("/api/projects", {
    method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ name: "From catalog", origin: { kind: "template", templateVersionId: versionId } })
  });
  // Then: the new project owns independent files, not mutable catalog pointers.
  const project = projectEnvelope.parse(await response.json()).data;
  expect(project.id).not.toBe(ids.project);
  expect(project.settings.mainFileId).not.toBe(ids.mainFile);
  expect((await fixture.service.readDocument({ projectId: project.id, branch: "main" }, project.settings.mainFileId)).text)
    .toBe((await fixture.service.readDocument({ projectId: ids.project, branch: "main" }, ids.mainFile)).text);
});

test("accepts an access request only after owner decision and applies its requested role", async () => {
  // Given: an outsider requesting editor access.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const outsider = await fixture.login("outsider@quire.local");
  const response = await fixture.request(`/api/projects/${ids.project}/access-requests`, {
    method: "POST",
    headers: { ...outsider.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ role: "editor", message: "Collaborate", expectedVersion: 0 })
  });
  const item = z.object({ data: AccessRequestSchema }).parse(await response.json()).data;
  expect((await fixture.request(`/api/projects/${ids.project}?branch=main`, { headers: outsider.headers })).status).toBe(404);
  // When: the owner accepts the pending request.
  const decision = await fixture.request(`/api/projects/${ids.project}/access-requests/${item.id}/decide`, {
    method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ accept: true, expectedVersion: item.version })
  });
  // Then: the status and authoritative membership change together.
  expect(z.object({ data: AccessRequestSchema }).parse(await decision.json()).data.status).toBe("accepted");
  expect((await fixture.service.role(outsider.user.id, ids.project))).toBe("editor");
});

test("new projects use the available default without changing existing environment pins", async () => {
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const original = await fixture.service.getProject(ids.project);
  const selected = IdSchema.parse(crypto.randomUUID());
  await fixture.runtime.db.run("UPDATE environments SET is_default=0");
  await fixture.runtime.db.run("UPDATE environments SET available=1 WHERE id=?", [original.settings.environmentId]);
  await fixture.runtime.db.run(`INSERT INTO environments
    (id,label,release,backend,manifest_json,available,is_default,probe_at,created_at)
    SELECT ?,'Selected default',release,backend,manifest_json,1,1,probe_at,created_at
    FROM environments WHERE id=?`, [selected, original.settings.environmentId]);
  const created = await fixture.create(owner.headers, "Selected default");
  expect(created.settings.environmentId).toBe(selected);
  expect((await fixture.service.getProject(ids.project)).settings.environmentId).toBe(original.settings.environmentId);
  await fixture.runtime.db.run("UPDATE environments SET available=0 WHERE id=?", [selected]);
  expect((await fixture.create(owner.headers, "Unavailable default")).settings.environmentId).toBe(original.settings.environmentId);
  await fixture.runtime.db.run("UPDATE environments SET available=1,retired_at=? WHERE id=?", [clock.now(), selected]);
  expect((await fixture.create(owner.headers, "Retired default")).settings.environmentId).toBe(original.settings.environmentId);
  expect((await fixture.service.getProject(created.id)).settings.environmentId).toBe(selected);
});
