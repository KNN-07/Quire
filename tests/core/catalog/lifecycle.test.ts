import { test, expect } from "bun:test";
import { z } from "zod";
import { LibraryEntrySchema } from "@quire/contracts";
import { catalogFixture, templateEnvelope, entryEnvelope, fileEnvelope, bib, publication } from "./harness";

test("replays a multipart import when the same uploaded bytes are retried", async () => {
  // Given: an actual upload and one idempotency key.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const key = crypto.randomUUID();
  const upload = () => {
    const form = new FormData();
    form.set("file", new File([bib], "actual.bib"));
    return fixture.request("/api/me/library/import", { method: "POST", headers: { ...owner.headers, "idempotency-key": key }, body: form });
  };
  const first = z.object({ data: z.array(LibraryEntrySchema) }).parse(await (await upload()).json()).data;
  await fixture.restart();
  // When: the transport retries the same bytes after process restart.
  const second = z.object({ data: z.array(LibraryEntrySchema) }).parse(await (await upload()).json()).data;
  // Then: persisted replay returns the original record IDs, not duplicates.
  expect(second.map(entry => entry.id)).toEqual(first.map(entry => entry.id));
  const listed = await fixture.request("/api/me/library", { headers: owner.headers });
  expect(z.object({ data: z.object({ items: z.array(LibraryEntrySchema) }) }).parse(await listed.json()).data.items).toHaveLength(1);
});

test("rejects malformed uploaded records atomically when an earlier record is valid", async () => {
  // Given: an upload whose second record is structurally invalid.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const form = new FormData();
  form.set("file", new File([`${bib}\n@book{bad,title={unterminated`], "invalid.bib"));
  // When: the whole uploaded bibliography is imported.
  const result = await fixture.request("/api/me/library/import", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() }, body: form });
  // Then: no prefix of the invalid import is persisted.
  expect(result.status).toBe(422);
  const list = await fixture.request("/api/me/library", { headers: owner.headers });
  expect(z.object({ data: z.object({ items: z.array(LibraryEntrySchema) }) }).parse(await list.json()).data.items).toEqual([]);
});

test("uses the selected bibliography when several targets exist", async () => {
  // Given: two editable bibliographies.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const files = [];
  for (const path of ["a.bib", "b.bib"]) {
    files.push(fileEnvelope.parse(await (await fixture.mutate(`/api/projects/${project.id}/files`, owner.headers,
      { scope, path, kind: "file", text: "", expectedVersion: fixture.service.getBranch(scope).revision })).json()).data);
  }
  const selected = files[1];
  const untouched = files[0];
  if (!selected || !untouched) throw new TypeError("Expected two bibliography files");
  // When: an explicit target is chosen.
  const response = await fixture.mutate(`/api/projects/${project.id}/citations`, owner.headers,
    { scope, publication, targetFileId: selected.id, command: "cite", expectedVersion: fixture.service.getBranch(scope).revision });
  // Then: only that project's selected source file gains the copied record.
  expect(fileEnvelope.parse(await response.json()).data.id).toBe(selected.id);
  expect(fixture.service.readDocument(scope, selected.id).text.trim()).toBe(bib);
  expect(fixture.service.readDocument(scope, untouched.id).text).toBe("");
});

test("removes a Library entry when the current owner deletes its current version", async () => {
  // Given: an editable account-owned record.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const entry = entryEnvelope.parse(await (await fixture.mutate("/api/me/library", owner.headers, { bibtex: bib, origin: "manual" })).json()).data;
  // When: its current version is deleted.
  const result = await fixture.request(`/api/me/library/${entry.id}`, { method: "DELETE", headers: owner.headers, body: JSON.stringify({ expectedVersion: entry.version }) });
  // Then: the endpoint reports the next version.
  expect(z.object({ data: z.object({ ok: z.literal(true), version: z.number() }) }).parse(await result.json()).data).toEqual({ ok: true, version: 1 });
  expect(result.headers.get("etag")).toBe('"v1"');
});

test("revokes gallery and copy access when an author unpublishes a version", async () => {
  // Given: a published public template.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const operator = await fixture.login("operator@quire.local");
  const outsider = await fixture.login("outsider@quire.local");
  const source = await fixture.create(owner.headers);
  let version = templateEnvelope.parse(await (await fixture.mutate("/api/templates", owner.headers, {
    name: "Lifecycle", category: "", description: "", license: "MIT", visibility: "public", sourceProjectId: source.id,
  })).json()).data;
  for (const action of ["submit", "approve", "publish"]) {
    version = templateEnvelope.parse(await (await fixture.mutate(`/api/templates/${version.templateId}/${action}`,
      action === "submit" ? owner.headers : operator.headers,
      { expectedVersion: version.version, ...(action === "submit" ? {} : { versionId: version.id }) })).json()).data;
  }
  // When: the author withdraws the published version.
  const response = await fixture.mutate(`/api/templates/${version.templateId}/unpublish`, owner.headers, { expectedVersion: version.version });
  // Then: the real gallery and native project-copy consumer both enforce withdrawal.
  expect(templateEnvelope.parse(await response.json()).data.status).toBe("unpublished");
  expect((await fixture.request(`/api/templates/${version.templateId}`)).status).toBe(404);
  const copy = await fixture.mutate("/api/projects", outsider.headers,
    { name: "Unauthorized copy", origin: { kind: "template", templateVersionId: version.id } });
  expect(copy.status).toBe(404);
});

test("updates draft metadata and deletes the catalog when the author supplies current versions", async () => {
  // Given: an editable draft.
  await using fixture = await catalogFixture();
  const owner = await fixture.login();
  const source = await fixture.create(owner.headers);
  const initial = templateEnvelope.parse(await (await fixture.mutate("/api/templates", owner.headers, {
    name: "Draft", category: "", description: "", license: "MIT", visibility: "private", sourceProjectId: source.id,
  })).json()).data;
  const changed = templateEnvelope.parse(await (await fixture.request(`/api/templates/${initial.templateId}`, { method: "PATCH", headers: owner.headers,
    body: JSON.stringify({ name: "Edited draft", expectedVersion: initial.version }) })).json()).data;
  // When: the author deletes that updated draft.
  const result = await fixture.request(`/api/templates/${changed.templateId}`, { method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ expectedVersion: changed.version }) });
  // Then: deletion reports the current aggregate successor.
  expect(z.object({ data: z.object({ ok: z.literal(true), version: z.number() }) }).parse(await result.json()).data.version).toBe(changed.version + 1);
  expect(result.headers.get("etag")).toBe(`"v${changed.version + 1}"`);
});
