import { expect, test } from "bun:test";
import { z } from "zod";
import { FileEntrySchema } from "@quire/contracts";
import { Library } from "../../../services/core/catalog";
import { fixtureIds } from "../../fixtures/foundation";
import { referencesFixture } from "./harness";
import { referenceProvider, linkResult } from "./provider";

test("copies retrieved records into real editable core bibliography without linking or back-syncing", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner);
  const scope = { projectId: fixtureIds.project, branch: "main" };
  const selection = { libraryType: "users", libraryId: "123" } as const;
  const bulk = await fixture.action(owner, grant, { action: "bulkBib", projectId: scope.projectId,
    parameters: { scope, path: "linked.bib", selection } });
  const linked = z.object({ data: z.object({ result: linkResult }) }).parse(await bulk.json()).data.result;
  await fixture.action(owner, grant, { action: "librarySync", parameters: { selection } });
  const publication = (await new Library({ ...fixture.runtime, routes: fixture.runtime.routes.forLane("X") }).list(owner.user.id))
    .find(item => item.citationKey === "stable_key_0")?.publication;
  if (!publication) throw new TypeError("Retrieved Zotero record required");
  const revision = (await fixture.service.getBranch(scope)).revision;
  const denied = await fixture.request(`/api/projects/${scope.projectId}/citations`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, publication, targetFileId: linked.fileId, command: "cite", expectedVersion: revision }) });
  expect(denied.status).toBe(403);
  // When
  const response = await fixture.request(`/api/projects/${scope.projectId}/citations`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, publication, command: "cite", expectedVersion: revision }) });
  // Then
  expect(response.status).toBe(200);
  const copied = z.object({ data: FileEntrySchema }).parse(await response.json()).data;
  expect(copied).toMatchObject({ path: "refs.bib", editable: true, link: null });
  const originalText = (await fixture.service.readDocument(scope, copied.id)).text;
  expect(originalText).toContain(publication.bibtex);
  provider.state.title = "Changed remotely";
  provider.state.version++;
  const refreshed = await fixture.action(owner, grant, { action: "refresh", projectId: scope.projectId,
    parameters: { linkId: linked.linkId, expectedDigest: linked.digest, expectedVersion: 1 } });
  expect(refreshed.status).toBe(202);
  expect((await fixture.service.readDocument(scope, copied.id)).text).toBe(originalText);
});
