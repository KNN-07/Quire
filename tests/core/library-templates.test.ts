import { test, expect } from "bun:test";
import { LibraryEntrySchema } from "@quire/contracts";
import { z } from "zod";
import { catalogFixture, bib, secondBib, publication, entryEnvelope, fileEnvelope, projectEnvelope, templateEnvelope } from "./catalog/harness";

test("persists uploaded bibliography copies independently across Library and two projects when their sources change", async () => {
  // Given: real multipart .bib bytes uploaded to the account Library.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const form = new FormData();
  form.set("file", new File([`${bib}\n${secondBib}`], "uploaded.bib"));
  const response = await fixture.request("/api/me/library/import", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() }, body: form });
  const entries = z.object({ data: z.array(LibraryEntrySchema) }).parse(await response.json()).data;
  const entry = entries.find(item => item.citationKey === "first");
  if (!entry) throw new TypeError("Expected uploaded citation");
  const a = await fixture.create(owner.headers, "A");
  const b = await fixture.create(owner.headers, "B");
  const copied = [];
  for (const project of [a, b]) {
    const scope = { projectId: project.id, branch: "main" };
    const citation = await fixture.mutate(`/api/projects/${project.id}/citations`, owner.headers,
      { scope, publication: { ...publication, bibtex: entry.bibtex }, command: "cite", expectedVersion: fixture.service.getBranch(scope).revision });
    copied.push({ scope, file: fileEnvelope.parse(await citation.json()).data });
  }
  // When: the Library record changes and one project's actual .bib source changes, then the runtime restarts.
  const changed = await fixture.request(`/api/me/library/${entry.id}`, { method: "PATCH", headers: owner.headers,
    body: JSON.stringify({ bibtex: "@article{first,title={Library only}}", expectedVersion: entry.version }) });
  expect(entryEnvelope.parse(await changed.json()).data.bibtex).toContain("Library only");
  const first = copied[0];
  const other = copied[1];
  if (!first || !other) throw new TypeError("Expected two copied projects");
  await fixture.service.serialized(first.scope, () => fixture.service.commitSource({
    actorId: owner.user.id, scope: first.scope, expectedRevision: fixture.service.getBranch(first.scope).revision,
    inputs: fixture.service.listFiles(first.scope).map(file => file.id === first.file.id
      ? { file, bytes: new TextEncoder().encode("@article{first,title={Project A only}}") } : { file }),
  }));
  await fixture.restart();
  // Then: independently persistent project bytes and the account record retain their own edits.
  expect(fixture.service.readDocument(first.scope, first.file.id).text).toContain("Project A only");
  expect(fixture.service.readDocument(other.scope, other.file.id).text.trim()).toBe(bib);
  const persisted = await fixture.request(`/api/me/library/${entry.id}`, { headers: owner.headers });
  expect(entryEnvelope.parse(await persisted.json()).data.bibtex).toContain("Library only");
});

test("copies approved uploaded template source into independent projects when a later version is published", async () => {
  // Given: actual uploaded TeX and bibliography source, followed by public approval and publication.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const operator = await fixture.login("operator@quire.local");
  const source = await fixture.create(owner.headers);
  const scope = { projectId: source.id, branch: "main" };
  const form = new FormData();
  form.set("scope", JSON.stringify(scope));
  form.set("expectedVersion", String(fixture.service.getBranch(scope).revision));
  form.append("files", new File(["\\documentclass{article}\n\\begin{document}Uploaded original\\end{document}"], "uploaded.tex"));
  form.append("files", new File([bib], "actual.bib"));
  form.set("paths", JSON.stringify(["uploaded.tex", "actual.bib"]));
  const upload = await fixture.request(`/api/projects/${source.id}/uploads`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() }, body: form });
  expect(upload.status).toBe(200);
  const created = await fixture.mutate("/api/templates", owner.headers, { name: "Uploaded", category: "Article",
    description: "Real source", license: "CC-BY-4.0", visibility: "public", sourceProjectId: source.id });
  let version = templateEnvelope.parse(await created.json()).data;
  const firstVersionId = version.id;
  for (const action of ["submit", "approve", "publish"]) {
    const result = await fixture.mutate(`/api/templates/${version.templateId}/${action}`,
      action === "submit" ? owner.headers : operator.headers,
      { expectedVersion: version.version, ...(action === "submit" ? {} : { versionId: version.id }) });
    version = templateEnvelope.parse(await result.json()).data;
  }
  const copyResponse = await fixture.mutate("/api/projects", owner.headers, {
    name: "Pinned copy", origin: { kind: "template", templateVersionId: firstVersionId },
  });
  const copy = projectEnvelope.parse(await copyResponse.json()).data;
  // When: the source changes and a new immutable snapshot version is approved and published.
  const main = fixture.service.listFiles(scope).find(file => file.path === "uploaded.tex");
  if (!main) throw new TypeError("Expected uploaded source");
  const snapshot = await fixture.service.serialized(scope, () => fixture.service.commitSource({
    actorId: owner.user.id, scope, expectedRevision: fixture.service.getBranch(scope).revision,
    inputs: fixture.service.listFiles(scope).map(file => file.id === main.id
      ? { file, bytes: new TextEncoder().encode("\\documentclass{article}\n\\begin{document}New version\\end{document}") } : { file }),
  }));
  const next = await fixture.mutate(`/api/templates/${version.templateId}/versions`, owner.headers,
    { snapshotId: snapshot.id, expectedVersion: version.version });
  version = templateEnvelope.parse(await next.json()).data;
  for (const action of ["submit", "approve", "publish"]) {
    version = templateEnvelope.parse(await (await fixture.mutate(`/api/templates/${version.templateId}/${action}`,
      action === "submit" ? owner.headers : operator.headers,
      { expectedVersion: version.version, ...(action === "submit" ? {} : { versionId: version.id }) })).json()).data;
  }
  await fixture.restart();
  // Then: copied uploaded bytes remain pinned and independently editable after restart.
  const copyScope = { projectId: copy.id, branch: "main" };
  const uploaded = fixture.service.listFiles(copyScope).find(file => file.path === "uploaded.tex");
  if (!uploaded) throw new TypeError("Expected copied uploaded source");
  expect(fixture.service.readDocument(copyScope, uploaded.id).text).toContain("Uploaded original");
  const bibliography = fixture.service.listFiles(copyScope).find(file => file.path === "actual.bib");
  if (!bibliography) throw new TypeError("Expected copied bibliography");
  expect(fixture.service.readDocument(copyScope, bibliography.id).text).toBe(bib);
  expect(bibliography.link).toBeNull();
  expect(bibliography.editable).toBe(true);
});
