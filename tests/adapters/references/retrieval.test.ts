import { expect, test } from "bun:test";
import { z } from "zod";
import { LibraryEntrySchema, PublicationSchema, IdSchema } from "@quire/contracts";
import { referencesFixture } from "./harness";
import { referenceProvider } from "./provider";
import { fixtureIds } from "../../fixtures/foundation";
import { DoiSchema } from "../../../services/adapters/references";

test("persists DOI provenance and an editable copy with restart-safe idempotency", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("doi");
  const owner = await fixture.login();
  const headers = { ...owner.headers, "idempotency-key": crypto.randomUUID() };
  const request = { method: "POST", headers, body: JSON.stringify({ doi: "https://doi.org/10.1234/PROTOCOL" }) };
  // When
  const response = await fixture.request("/api/me/library/doi", request);
  // Then
  expect(response.status).toBe(200);
  const entry = z.object({ data: LibraryEntrySchema }).parse(await response.json()).data;
  expect(entry).toMatchObject({ origin: "doi", readonly: false, publication: { providerId: "10.1234/protocol" } });
  if (!entry.publication) throw new TypeError("Retrieved publication required");
  const retained = await fixture.references.retrieval.provenance(owner.user.id, entry.publication);
  expect(retained).toHaveLength(1);
  const provenance = retained[0]?.provenance;
  if (!provenance) throw new TypeError("Provenance required");
  const raw = await fixture.runtime.blobs.get(provenance.responseDigest);
  expect(JSON.parse(new TextDecoder().decode(raw))).toMatchObject({ message: { DOI: "10.1234/protocol" } });
  expect(await fixture.references.retrieval.provenance(owner.user.id, { ...entry.publication, title: "Invented title" })).toEqual([]);
  const migrations = await fixture.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id");
  const count = provider.state.requests.length;
  await fixture.restart();
  const replay = await fixture.request("/api/me/library/doi", request);
  expect(z.object({ data: LibraryEntrySchema }).parse(await replay.json()).data.id).toBe(entry.id);
  expect(provider.state.requests).toHaveLength(count);
  expect(await fixture.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id")).toEqual(migrations);
  const duplicate = await fixture.request("/api/me/library/doi", { ...request, headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() } });
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(await duplicate.json()).error.code).toBe("CITATION_KEY_CONFLICT");
});

test("searches through the authenticated route and denies another project's metadata context", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("crossref");
  const owner = await fixture.login();
  const query = `/api/references/search?projectId=${fixtureIds.project}&provider=crossref&query=protocol&limit=1`;
  // When
  const response = await fixture.request(query, { headers: owner.headers });
  // Then
  expect(response.status).toBe(200);
  expect(z.object({ data: z.object({ items: z.array(PublicationSchema), nextCursor: z.string() }) }).parse(await response.json()).data.nextCursor).toBe("page-two");
  const anonymous = await fixture.request(query);
  expect(anonymous.status).toBe(401);
  const inaccessible = await fixture.request(query.replace(fixtureIds.project, IdSchema.parse(crypto.randomUUID())), { headers: owner.headers });
  expect(inaccessible.status).toBe(404);
  const operator = await fixture.login("operator@quire.local");
  const tested = await fixture.request("/api/admin/providers/crossref/test", { method: "POST", headers: operator.headers,
    body: JSON.stringify({ expectedVersion: 1 }) });
  expect(z.object({ data: z.object({ ok: z.boolean() }) }).parse(await tested.json()).data.ok).toBe(true);
});

test("reports exact private-provider prerequisites and missing configuration", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  const owner = await fixture.login();
  // When
  const response = await fixture.request("/api/connections/availability", { headers: owner.headers });
  // Then
  const capabilities = z.object({ data: z.record(z.string(), z.object({ state: z.string(), reason: z.string().optional() })) }).parse(await response.json()).data;
  expect(capabilities["readcube"]?.state).toBe("unconfigured");
  expect(capabilities["dimensions"]?.state).toBe("unconfigured");
  expect(capabilities["crossref"]?.state).toBe("unconfigured");
  expect(capabilities["readcube"]?.reason).toContain("partner/developer API access agreement");
  expect(capabilities["dimensions"]?.reason).toContain("license permitting citation retrieval");
  const doi = await fixture.request("/api/me/library/doi", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ doi: "10.1234/protocol" }) });
  expect(doi.status).toBe(503);
});

test("normalizes DOI transport prefixes and rejects malformed DOI input", () => {
  // Given
  const value = " DOI:10.1234/Protocol ";
  // When
  const result = DoiSchema.parse(value);
  // Then
  expect(result).toBe("10.1234/protocol");
  expect(DoiSchema.safeParse("https://localhost/metadata").success).toBe(false);
});
