import { expect, test } from "bun:test";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { ReferenceTransport } from "../../../services/adapters/references/transport";
import { Crossref } from "../../../services/adapters/references/crossref";
import { Arxiv } from "../../../services/adapters/references/arxiv";
import { SemanticScholar } from "../../../services/adapters/references/semantic-scholar";
import { Zotero } from "../../../services/adapters/references/zotero";
import { Mendeley } from "../../../services/adapters/references/mendeley";
import { controlledClock } from "../shared/harness";
import { referenceProvider, zoteroKey, mendeleyToken } from "./provider";
import { rejection } from "./assertions";
import { singleRecord } from "../../../services/core/catalog";

test("returns Crossref metadata and cursor when a query spans pages", async () => {
  // Given
  await using server = referenceProvider();
  const transport = new ReferenceTransport(new SafeHttpClient({ fixtureOrigins: [server.origin] }), controlledClock());
  // When
  const result = await new Crossref(transport).search({ baseUrl: server.origin, query: "protocol",
    cursor: null, limit: 1, signal: AbortSignal.timeout(2000) });
  // Then
  expect(result.publications[0]).toMatchObject({ provider: "crossref", providerId: "10.1234/protocol",
    authors: ["Grace Hopper"], year: 2026 });
  expect(result.nextCursor).toBe("page-two");
  expect(new URL(result.response.endpoint).searchParams.get("query.bibliographic")).toBe("protocol");
});

test("parses arXiv namespace metadata and enforces controlled-clock request spacing", async () => {
  // Given
  await using server = referenceProvider();
  const clock = controlledClock();
  const client = new Arxiv(new ReferenceTransport(new SafeHttpClient({ fixtureOrigins: [server.origin] }), clock));
  const input = { baseUrl: server.origin, query: "all:protocol", cursor: null, limit: 5, signal: AbortSignal.timeout(2000) };
  // When
  const result = await client.search(input);
  // Then
  expect(result.publications[0]).toMatchObject({ provider: "arxiv", providerId: "2610.12345v1", authors: ["Emmy Noether"], doi: "10.1234/arxiv" });
  expect(result.nextCursor).toBeNull();
  expect(await rejection(client.search(input))).toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
  clock.advance(3000);
  expect((await client.search(input)).publications).toHaveLength(1);
});

test("returns Semantic Scholar provider identity and paged offset when authenticated", async () => {
  // Given
  await using server = referenceProvider();
  const client = new SemanticScholar(new ReferenceTransport(new SafeHttpClient({ fixtureOrigins: [server.origin] }), controlledClock()));
  // When
  const result = await client.search({ baseUrl: server.origin, query: "protocol", cursor: null, limit: 1,
    apiKey: "semantic-fixture-key", signal: AbortSignal.timeout(2000) });
  // Then
  expect(result.publications[0]).toMatchObject({ provider: "semanticScholar", providerId: "semantic-paper-1", doi: "10.1234/semantic" });
  expect(result.nextCursor).toBe("1");
  expect(server.state.requests[0]?.headers.get("x-api-key")).toBe("semantic-fixture-key");
});

test("preserves Zotero export keys across all pages when the library version is stable", async () => {
  // Given
  await using server = referenceProvider();
  const client = new Zotero(new ReferenceTransport(new SafeHttpClient({ fixtureOrigins: [server.origin] }), controlledClock()));
  // When
  const result = await client.read({ baseUrl: server.origin, apiKey: zoteroKey,
    selection: { libraryType: "users", libraryId: "123", collectionKey: "ABCD1234" }, signal: AbortSignal.timeout(2000) });
  // Then
  expect(result.publications.map(item => item.providerId)).toEqual(["users/123/ITEM0000", "users/123/ITEM0001"]);
  expect(result.publications[0]?.bibtex).toBe("@article{stable_key_0,\n title = {Protocol paper},\n year = {2026}\n}");
  expect(result.responses).toHaveLength(2);
  expect(result.cursor).toBe("7");
});

for (const issue of ["pageVersionChanged", "duplicateKey", "duplicateId", "repeatPage"] as const) {
  test(`rejects Zotero ${issue} without returning a partial library`, async () => {
    // Given
    await using server = referenceProvider();
    server.state[issue] = true;
    const client = new Zotero(new ReferenceTransport(new SafeHttpClient({ fixtureOrigins: [server.origin] }), controlledClock()));
    // When
    const pending = client.read({ baseUrl: server.origin, apiKey: zoteroKey,
      selection: { libraryType: "users", libraryId: "123" }, signal: AbortSignal.timeout(2000) });
    // Then
    expect(await rejection(pending)).toMatchObject({ code: issue === "pageVersionChanged" ? "PROVIDER_CHANGED" :
      issue === "duplicateKey" ? "INVALID_BIBTEX" : "PROVIDER_DUPLICATE_ID" });
  });
}

test("collects Mendeley documents using vendor media type and marker links", async () => {
  // Given
  await using server = referenceProvider();
  const client = new Mendeley(new ReferenceTransport(new SafeHttpClient({ fixtureOrigins: [server.origin] }), controlledClock()));
  // When
  const result = await client.read({ baseUrl: server.origin, accessToken: mendeleyToken, signal: AbortSignal.timeout(2000) });
  // Then
  expect(result.publications.map(item => item.providerId)).toEqual(["mendeley-1", "mendeley-2"]);
  expect(result.responses).toHaveLength(2);
  const first = result.publications[0];
  if (!first) throw new TypeError("Mendeley record required");
  expect(singleRecord(first.bibtex).citationKey.startsWith("mendeley_")).toBe(true);
});

for (const status of [401, 403, 404, 429, 500]) {
  test(`reports provider HTTP ${status} when the provider rejects a read`, async () => {
    // Given
    await using server = referenceProvider();
    server.state.status = status;
    const client = new Crossref(new ReferenceTransport(new SafeHttpClient({ fixtureOrigins: [server.origin] }), controlledClock()));
    // When
    const result = client.lookup({ baseUrl: server.origin, doi: "10.1234/protocol", signal: AbortSignal.timeout(2000) });
    // Then
    expect(await rejection(result)).toMatchObject({ code: new Map([[401, "PROVIDER_AUTH_REQUIRED"], [403, "PROVIDER_ACCESS_DENIED"],
      [404, "PUBLICATION_NOT_FOUND"], [429, "PROVIDER_RATE_LIMITED"], [500, "PROVIDER_HTTP_ERROR"]]).get(status) });
  });
}

test("holds Retry-After cooldown until the injected clock advances", async () => {
  // Given
  await using server = referenceProvider();
  const clock = controlledClock();
  const transport = new ReferenceTransport(new SafeHttpClient({ fixtureOrigins: [server.origin] }), clock);
  const target = new URL("/works", server.origin);
  server.state.status = 429;
  expect(await rejection(transport.get(target))).toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
  server.state.status = 200;
  // When
  const result = transport.get(target);
  // Then
  expect(await rejection(result)).toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
  expect(server.state.requests).toHaveLength(1);
  clock.advance(5000);
  expect((await transport.get(target)).bytes.byteLength).toBeGreaterThan(0);
});

test("rejects malformed provider JSON instead of fabricating a publication", async () => {
  // Given
  await using server = referenceProvider();
  server.state.malformed = true;
  const client = new Crossref(new ReferenceTransport(new SafeHttpClient({ fixtureOrigins: [server.origin] }), controlledClock()));
  // When
  const result = client.lookup({ baseUrl: server.origin, doi: "10.1234/protocol", signal: AbortSignal.timeout(2000) });
  // Then
  expect(await rejection(result)).toMatchObject({ code: "PROVIDER_RESPONSE_INVALID" });
});
