import { expect, test } from "bun:test";
import { z } from "zod";
import { LibraryEntrySchema } from "@quire/contracts";
import { Library } from "../../../services/core/catalog";
import { ReferenceLibrary } from "../../../services/adapters/references";
import { fixtureIds } from "../../fixtures/foundation";
import { referencesFixture } from "./harness";
import { referenceProvider, linkResult } from "./provider";
import { rejection } from "./assertions";

const scope = { projectId: fixtureIds.project, branch: "main" };
const selection = { libraryType: "users", libraryId: "123", collectionKey: "ABCD1234" } as const;
const operationLink = z.object({ data: z.object({ status: z.literal("succeeded"), result: linkResult }) });

test("publishes bulk bibliography read-only while individual Library copies stay independent across refresh and restart", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner);
  const key = crypto.randomUUID();
  const response = await fixture.action(owner, grant, { action: "bulkBib", projectId: scope.projectId,
    parameters: { scope, path: "linked.bib", selection }, key });
  const link = operationLink.parse(await response.json()).data.result;
  const files = await fixture.service.listFiles(scope);
  const file = files.find(item => item.id === link.fileId);
  expect(file).toMatchObject({ editable: false, link: { kind: "bibliography", sourceId: link.linkId } });
  const original = new TextDecoder().decode(await fixture.runtime.blobs.get(link.digest));
  expect(original).toContain("@article{stable_key_0,");
  expect(await rejection(fixture.service.readDocument(scope, file?.id ?? fixtureIds.mainFile))).toMatchObject({ code: "NOT_EDITABLE" });
  const context = { ...fixture.runtime, routes: fixture.runtime.routes.forLane("X") };
  const synced = await fixture.action(owner, grant, { action: "librarySync", parameters: { selection } });
  expect(synced.status).toBe(202);
  const entry = (await new Library(context).list(owner.user.id)).find(item => item.citationKey === "stable_key_0");
  if (!entry?.publication) throw new TypeError("Synced provider publication required");
  const copyPublication = { ...entry.publication, providerId: "independent-copy",
    bibtex: entry.bibtex.replace("stable_key_0", "independent_key") };
  const copy = await new ReferenceLibrary(context).copy({ actorId: owner.user.id, publication: copyPublication, origin: "provider" });
  provider.state.title = "Upstream changed";
  provider.state.version++;
  // When
  const refreshed = await fixture.action(owner, grant, { action: "refresh", projectId: scope.projectId,
    parameters: { linkId: link.linkId, expectedDigest: link.digest, expectedVersion: 1 } });
  // Then
  expect(refreshed.status).toBe(202);
  const updated = operationLink.parse(await refreshed.json()).data.result;
  expect(updated.digest).not.toBe(link.digest);
  expect(new TextDecoder().decode(await fixture.runtime.blobs.get(link.digest))).toBe(original);
  expect((await new Library(context).get(owner.user.id, copy.id)).bibtex).toBe(copy.bibtex);
  const bytes = new TextDecoder().decode(await fixture.runtime.blobs.get(updated.digest));
  expect(bytes).toContain("Upstream changed");
  await fixture.restart();
  expect((await fixture.service.getFile(scope, file?.id ?? fixtureIds.mainFile)).blob).toBe(updated.digest);
  await fixture.runtime.repositories.assertReadable(scope.projectId);
  expect(await fixture.runtime.db.all("SELECT id FROM reference_source_journal")).toEqual([]);
  const beforeReplay = provider.state.requests.length;
  const replayed = await fixture.action(owner, grant, { action: "bulkBib", projectId: scope.projectId,
    parameters: { scope, path: "linked.bib", selection }, key });
  expect(operationLink.parse(await replayed.json()).data.result.digest).toBe(link.digest);
  expect(provider.state.requests).toHaveLength(beforeReplay);
});

test("keeps account collection sync separate from project source and rejects local linked-record edits", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner);
  const before = await fixture.service.listFiles(scope);
  // When
  const response = await fixture.action(owner, grant, { action: "librarySync", parameters: { selection } });
  // Then
  expect(response.status).toBe(202);
  const library = new Library({ ...fixture.runtime, routes: fixture.runtime.routes.forLane("X") });
  const entries = await library.list(owner.user.id);
  expect(entries.map(entry => entry.citationKey)).toEqual(expect.arrayContaining(["stable_key_0", "stable_key_1"]));
  expect(entries.every(entry => entry.readonly)).toBe(true);
  expect(await fixture.service.listFiles(scope)).toEqual(before);
  const entry = entries[0];
  if (!entry) throw new TypeError("Synced record required");
  expect(await rejection(library.patch(owner.user.id, { id: entry.id, expectedVersion: entry.version, bibtex: "@misc{changed,}" })))
    .toMatchObject({ code: "READ_ONLY_BIBLIOGRAPHY" });
  await fixture.restart();
  expect((await new Library({ ...fixture.runtime, routes: fixture.runtime.routes.forLane("X") }).list(owner.user.id))).toHaveLength(2);
});

test("retains prior bytes on stale refresh and prevents a non-owner from configuring a project link", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner);
  const bulk = await fixture.action(owner, grant, { action: "bulkBib", projectId: scope.projectId, parameters: { scope, path: "linked.bib", selection } });
  const link = operationLink.parse(await bulk.json()).data.result;
  // When
  const response = await fixture.action(owner, grant, { action: "refresh", projectId: scope.projectId,
    parameters: { linkId: link.linkId, expectedDigest: "a".repeat(64), expectedVersion: 1 } });
  // Then
  expect(response.status).toBe(409);
  expect((await fixture.service.getFile(scope, link.fileId)).blob).toBe(link.digest);
  const viewer = await fixture.login("alex@quire.local");
  const viewerGrant = await fixture.connect(viewer);
  const denied = await fixture.action(viewer, viewerGrant, { action: "bulkBib", projectId: scope.projectId,
    parameters: { scope, path: "denied.bib", selection } });
  expect(denied.status).toBe(403);
});

test("publishes Mendeley bulk exports with stable citation keys and independent editable individual imports", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("mendeley");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner, "mendeley");
  // When
  const response = await fixture.action(owner, grant, { action: "bulkBib", projectId: scope.projectId,
    parameters: { scope, path: "mendeley.bib" } });
  // Then
  expect(response.status).toBe(202);
  const link = operationLink.parse(await response.json()).data.result;
  expect((await fixture.service.getFile(scope, link.fileId)).editable).toBe(false);
  const search = await fixture.action(owner, grant, { action: "search", parameters: { query: "protocol" } });
  const result = z.object({ data: z.object({ result: z.object({ items: z.array(z.object({ bibtex: z.string() })) }) }) }).parse(await search.json());
  const bibtex = result.data.result.items[0]?.bibtex;
  if (!bibtex) throw new TypeError("Mendeley result required");
  const imported = await fixture.request("/api/me/library", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ bibtex, origin: "provider", providerId: "mendeley-1" }) });
  expect(z.object({ data: LibraryEntrySchema }).parse(await imported.json()).data.readonly).toBe(false);
});
