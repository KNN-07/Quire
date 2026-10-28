import { expect, test } from "bun:test";
import { z } from "zod";
import { FileEntrySchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { referencesFixture } from "./harness";
import { referenceProvider } from "./provider";

const fileEnvelope = z.object({ data: FileEntrySchema });
const errorEnvelope = z.object({ error: z.object({ code: z.string() }) });
const scope = { projectId: fixtureIds.project, branch: "main" };

test("creates and refreshes bibliography through the sole core/interchange dispatcher with restart-safe HTTP receipts", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin, { links: true });
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner);
  const createKey = crypto.randomUUID();
  const create = { method: "POST", headers: { ...owner.headers, "idempotency-key": createKey },
    body: JSON.stringify({ scope, path: "core-linked.bib", kind: "bibliography", grantId: grant.id,
      url: `${provider.origin}/users/123/collections/ABCD1234/items/top`, expectedVersion: (await fixture.service.getBranch(scope)).revision }) };
  const created = await fixture.request(`/api/projects/${scope.projectId}/links`, create);
  expect(created.status).toBe(200);
  const file = fileEnvelope.parse(await created.json()).data;
  expect(file).toMatchObject({ path: "core-linked.bib", editable: false, link: { kind: "bibliography" } });
  const original = file.blob;
  if (!original) throw new TypeError("Created source blob required");
  provider.state.title = "Refreshed through core";
  provider.state.version++;
  const refreshKey = crypto.randomUUID();
  const refresh = { method: "POST", headers: { ...owner.headers, "idempotency-key": refreshKey },
    body: JSON.stringify({ expectedDigest: original, expectedVersion: (await fixture.service.getBranch(scope)).revision }) };
  // When
  const refreshed = await fixture.request(`/api/projects/${scope.projectId}/links/${file.id}/refresh`, refresh);
  // Then
  expect(refreshed.status).toBe(200);
  const updated = fileEnvelope.parse(await refreshed.json()).data;
  expect(updated).toMatchObject({ id: file.id, editable: false, link: file.link });
  expect(updated.blob).not.toBe(original);
  expect(new TextDecoder().decode(await fixture.runtime.blobs.get(original))).toContain("Protocol paper");
  expect(await fixture.runtime.db.get<{ version: number; cursor: string }>("SELECT version,cursor FROM reference_links WHERE file_id=?", [file.id]))
    .toEqual({ version: 2, cursor: "8" });
  expect(await fixture.runtime.db.get<{ count: number }>("SELECT count(*) AS count FROM idempotency_results WHERE actor_id=? AND key IN (?,?)",
    [owner.user.id, createKey, refreshKey])).toEqual({ count: 2 });
  const calls = provider.state.requests.length;
  await fixture.restart();
  const replay = await fixture.request(`/api/projects/${scope.projectId}/links/${file.id}/refresh`, refresh);
  expect(fileEnvelope.parse(await replay.json()).data).toEqual(updated);
  const createReplay = await fixture.request(`/api/projects/${scope.projectId}/links`, create);
  expect(fileEnvelope.parse(await createReplay.json()).data).toEqual(file);
  expect(provider.state.requests).toHaveLength(calls);
  await fixture.runtime.repositories.assertReadable(scope.projectId);
});

test("keeps URL and bibliography links in the same dispatcher while checking current owner and grant ownership", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin, { links: true });
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const editor = await fixture.login("mai@quire.local");
  const ownerGrant = await fixture.connect(owner);
  const editorGrant = await fixture.connect(editor);
  const revision = (await fixture.service.getBranch(scope)).revision;
  const create = (headers: HeadersInit, grantId: string) => fixture.request(`/api/projects/${scope.projectId}/links`, {
    method: "POST", headers: { ...Object.fromEntries(new Headers(headers)), "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, kind: "bibliography", path: "denied.bib", grantId, expectedVersion: revision }),
  });
  // When
  const [editorDenied, foreignGrant] = await Promise.all([create(editor.headers, editorGrant.id), create(owner.headers, editorGrant.id)]);
  // Then
  expect(editorDenied.status).toBe(403);
  expect(errorEnvelope.parse(await foreignGrant.json()).error.code).toBe("GRANT_NOT_FOUND");
  const url = await fixture.request(`/api/projects/${scope.projectId}/links`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, kind: "url", path: "url-linked.bib", url: `${provider.origin}/source.bib`, expectedVersion: revision }) });
  expect(fileEnvelope.parse(await url.json()).data.link?.kind).toBe("url");
  const bibliography = await fixture.request(`/api/projects/${scope.projectId}/links`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, kind: "bibliography", path: "bibliography-linked.bib", grantId: ownerGrant.id,
      expectedVersion: (await fixture.service.getBranch(scope)).revision }) });
  expect(fileEnvelope.parse(await bibliography.json()).data.link?.kind).toBe("bibliography");
});

test("rejects stale core revision, stale digest and revoked provider authority without replacing current source", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin, { links: true });
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner);
  const revision = (await fixture.service.getBranch(scope)).revision;
  const created = await fixture.request(`/api/projects/${scope.projectId}/links`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, kind: "bibliography", path: "stale.bib", grantId: grant.id,
      url: `${provider.origin}/users/123/items`, expectedVersion: revision }) });
  const file = fileEnvelope.parse(await created.json()).data;
  const files = await fixture.service.listFiles(scope);
  const request = { method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ expectedDigest: file.blob, expectedVersion: revision }) };
  const stale = await fixture.request(`/api/projects/${scope.projectId}/links/${file.id}/refresh`, request);
  expect(stale.status).toBe(409);
  const wrongDigest = await fixture.request(`/api/projects/${scope.projectId}/links/${file.id}/refresh`, {
    ...request, headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ expectedDigest: "a".repeat(64), expectedVersion: (await fixture.service.getBranch(scope)).revision }) });
  expect(wrongDigest.status).toBe(409);
  provider.state.onRequest = () => fixture.runtime.uow.run(async tx => {
    await tx.run("UPDATE adapter_provider_configs SET version=version+1 WHERE kind='zotero'");
  });
  // When
  const changed = await fixture.request(`/api/projects/${scope.projectId}/links/${file.id}/refresh`, {
    ...request, headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ expectedDigest: file.blob, expectedVersion: (await fixture.service.getBranch(scope)).revision }) });
  // Then
  expect(errorEnvelope.parse(await changed.json()).error.code).toBe("PROVIDER_CHANGED");
  expect(await fixture.service.listFiles(scope)).toEqual(files);
  expect(await fixture.runtime.db.all("SELECT id FROM base_source_intents")).toEqual([]);
  await fixture.runtime.repositories.assertReadable(scope.projectId);
});
