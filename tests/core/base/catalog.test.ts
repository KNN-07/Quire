import { test, expect } from "bun:test";
import { z } from "zod";
import { AccessRequestSchema } from "@quire/contracts";
import { baseFixture, projectEnvelope, clock } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("creates an independent project from a published database template version", async () => {
  // Given: a published catalog version bound to an immutable source snapshot.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const templateId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  fixture.runtime.uow.local((tx) => {
    tx.query(`INSERT INTO templates(id,author_id,name,category,description,license,visibility,created_at)
      VALUES(?,?,'Catalog paper','article','','MIT','public',?)`).run(templateId, ids.kien, clock.now());
    tx.query(`INSERT INTO template_versions(id,template_id,snapshot_id,name,category,description,license,visibility,status,created_at)
      VALUES(?,?,?,'Catalog paper','article','','MIT','public','published',?)`).run(versionId, templateId, ids.snapshot, clock.now());
  });
  // When: an authenticated client creates from that exact version.
  const response = await fixture.request("/api/projects", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ name: "From catalog", origin: { kind: "template", templateVersionId: versionId } }) });
  // Then: the new project owns independent files, not mutable catalog pointers.
  const project = projectEnvelope.parse(await response.json()).data;
  expect(project.id).not.toBe(ids.project);
  expect(project.settings.mainFileId).not.toBe(ids.mainFile);
  expect(fixture.service.readDocument({ projectId: project.id, branch: "main" }, project.settings.mainFileId).text)
    .toBe(fixture.service.readDocument({ projectId: ids.project, branch: "main" }, ids.mainFile).text);
});

test("accepts an access request only after owner decision and applies its requested role", async () => {
  // Given: an outsider requesting editor access.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const outsider = await fixture.login("outsider@quire.local");
  const response = await fixture.request(`/api/projects/${ids.project}/access-requests`, { method: "POST",
    headers: { ...outsider.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ role: "editor", message: "Collaborate", expectedVersion: 0 }) });
  const item = z.object({ data: AccessRequestSchema }).parse(await response.json()).data;
  expect((await fixture.request(`/api/projects/${ids.project}?branch=main`, { headers: outsider.headers })).status).toBe(404);
  // When: the owner accepts the pending request.
  const decision = await fixture.request(`/api/projects/${ids.project}/access-requests/${item.id}/decide`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ accept: true, expectedVersion: item.version }) });
  // Then: the status and authoritative membership change together.
  expect(z.object({ data: AccessRequestSchema }).parse(await decision.json()).data.status).toBe("accepted");
  expect(fixture.service.role(outsider.user.id, ids.project)).toBe("editor");
});
