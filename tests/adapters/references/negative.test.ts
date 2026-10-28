import { expect, test } from "bun:test";
import { z } from "zod";
import { fixtureIds } from "../../fixtures/foundation";
import { ReferenceTransport } from "../../../services/adapters/references/transport";
import { Crossref } from "../../../services/adapters/references/crossref";
import { Arxiv } from "../../../services/adapters/references/arxiv";
import { Zotero } from "../../../services/adapters/references/zotero";
import { Mendeley } from "../../../services/adapters/references/mendeley";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { referenceProvider, mendeleyToken } from "./provider";
import { referencesFixture } from "./harness";
import { rejection } from "./assertions";
import { controlledClock } from "../shared/harness";

test("refuses an incorrectly resolved DOI instead of importing another record", async () => {
  // Given
  await using provider = referenceProvider();
  const client = new Crossref(new ReferenceTransport(new SafeHttpClient({ fixtureOrigins: [provider.origin] }), controlledClock()));
  // When
  const error = await rejection(client.lookup({ baseUrl: provider.origin, doi: "10.1234/another", signal: AbortSignal.timeout(2000) }));
  // Then
  expect(error.code).toBe("PROVIDER_RESPONSE_INVALID");
});

test("rejects an invalid Zotero key at the actual provider authentication boundary", async () => {
  // Given
  await using provider = referenceProvider();
  const client = new Zotero(new ReferenceTransport(new SafeHttpClient({ fixtureOrigins: [provider.origin] }), controlledClock()));
  // When
  const error = await rejection(client.key({ baseUrl: provider.origin, apiKey: "invalid-api-key", signal: AbortSignal.timeout(2000) }));
  // Then
  expect(error.code).toBe("PROVIDER_AUTH_REQUIRED");
});

test("rejects repeated Mendeley pagination rather than returning an incomplete library", async () => {
  // Given
  await using provider = referenceProvider();
  provider.state.repeatPage = true;
  const client = new Mendeley(new ReferenceTransport(new SafeHttpClient({ fixtureOrigins: [provider.origin] }), controlledClock()));
  // When
  const error = await rejection(client.read({ baseUrl: provider.origin, accessToken: mendeleyToken, signal: AbortSignal.timeout(2000) }));
  // Then
  expect(error.code).toBe("PROVIDER_PAGING_INVALID");
});

test("rejects malformed arXiv XML rather than inventing empty search results", async () => {
  // Given
  await using provider = referenceProvider();
  provider.state.malformed = true;
  const client = new Arxiv(new ReferenceTransport(new SafeHttpClient({ fixtureOrigins: [provider.origin] }), controlledClock()));
  // When
  const error = await rejection(client.search({ baseUrl: provider.origin, query: "all:protocol", cursor: null, limit: 10, signal: AbortSignal.timeout(2000) }));
  // Then
  expect(error.code).toBe("PROVIDER_RESPONSE_INVALID");
});

test("fences a revoked grant before source preparation and retains project bytes", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner);
  const scope = { projectId: fixtureIds.project, branch: "main" };
  const before = await fixture.service.listFiles(scope);
  provider.state.onRequest = () => fixture.runtime.uow.run(async tx => {
    await tx.run("UPDATE provider_grants SET state='disabled',version=version+1 WHERE id=?", [grant.id]);
  });
  // When
  const response = await fixture.action(owner, grant, { action: "bulkBib", projectId: scope.projectId, parameters: {
    scope, path: "revoked.bib", selection: { libraryType: "users", libraryId: "123" },
  } });
  // Then
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code).toBe("GRANT_UNAVAILABLE");
  expect(await fixture.service.listFiles(scope)).toEqual(before);
  expect(await fixture.runtime.db.all("SELECT id FROM reference_source_journal")).toEqual([]);
  await fixture.runtime.repositories.assertReadable(scope.projectId);
});

test("rolls back account collection key conflicts without changing original manual entries", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const grant = await fixture.connect(owner);
  const created = await fixture.request("/api/me/library", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ origin: "manual", bibtex: "@misc{stable_key_1,title={Original manual entry}}" }) });
  expect(created.status).toBe(200);
  const before = await fixture.runtime.db.all("SELECT * FROM library_entries WHERE owner_id=? ORDER BY id", [owner.user.id]);
  // When
  const response = await fixture.action(owner, grant, { action: "librarySync", parameters: {
    selection: { libraryType: "users", libraryId: "123" },
  } });
  // Then
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code).toBe("CITATION_KEY_CONFLICT");
  expect(await fixture.runtime.db.all("SELECT * FROM library_entries WHERE owner_id=? ORDER BY id", [owner.user.id])).toEqual(before);
  expect(await fixture.runtime.db.all("SELECT * FROM reference_library_sources")).toEqual([]);
});
