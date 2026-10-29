import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { PublicationSchema } from "@quire/contracts";
import { referencesFixture } from "./harness";
import { referenceProvider } from "./provider";
import { heldReferenceProvider, lifecycleGate } from "./inline-lifecycle-provider";
import { fixtureIds } from "../../fixtures/foundation";

const errorEnvelope = z.object({ error: z.object({ code: z.string() }) });
const pageEnvelope = z.object({ data: z.object({ items: z.array(PublicationSchema) }) });
const route = `/api/references/search?projectId=${fixtureIds.project}&provider=crossref&query=lifecycle`;

test("cancels the actual HTTP provider when the authenticated request aborts", async () => {
  // Given
  await using provider = await heldReferenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("crossref");
  const owner = await fixture.login();
  const controller = new AbortController();
  const entered = provider.entered.wait();
  const disconnected = provider.disconnected.wait();
  const request = new Request(`http://quire.local${route}`, { headers: owner.headers, signal: controller.signal });
  const pending = fixture.runtime.routes.fetch(request);
  await entered;
  // When
  controller.abort();
  await disconnected;
  provider.release.resolve();
  const response = await pending;
  // Then
  expect(response.status).toBe(502);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("EGRESS_TIMEOUT");
  expect(await fixture.runtime.db.all("SELECT * FROM reference_provenance")).toEqual([]);
});

test("keeps the provider deadline when the caller supplies a live signal", async () => {
  // Given
  await using provider = await heldReferenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("crossref");
  const owner = await fixture.login();
  const deadline = new AbortController();
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(ms =>
    ms === 30_000 ? deadline.signal : originalTimeout(ms));
  try {
    const entered = provider.entered.wait();
    const disconnected = provider.disconnected.wait();
    const pending = fixture.runtime.routes.fetch(new Request(`http://quire.local${route}`,
      { headers: owner.headers, signal: new AbortController().signal }));
    await entered;
    // When
    deadline.abort();
    await disconnected;
    provider.release.resolve();
    const response = await pending;
    // Then
    expect(response.status).toBe(502);
    expect(errorEnvelope.parse(await response.json()).error.code).toBe("EGRESS_TIMEOUT");
    expect(await fixture.runtime.db.all("SELECT * FROM reference_provenance")).toEqual([]);
  } finally { timeout.mockRestore(); }
});

test("discards a successful transport response released after cancellation", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("crossref");
  const owner = await fixture.login();
  const controller = new AbortController();
  const entered = lifecycleGate<void>();
  const release = lifecycleGate<void>();
  const transport = fixture.references.retrieval.transport;
  const original = transport.get.bind(transport);
  const held = spyOn(transport, "get").mockImplementation(async (url, input) => {
    const result = await original(url, input);
    entered.resolve();
    await release.wait();
    return result;
  });
  try {
    const observed = entered.wait();
    const pending = fixture.runtime.routes.fetch(new Request(`http://quire.local${route}`,
      { headers: owner.headers, signal: controller.signal }));
    await observed;
    // When
    controller.abort();
    release.resolve();
    const response = await pending;
    // Then
    expect(response.status).toBe(502);
    expect(errorEnvelope.parse(await response.json()).error.code).toBe("EGRESS_TIMEOUT");
    expect(await fixture.runtime.db.all("SELECT * FROM reference_provenance")).toEqual([]);
  } finally { release.resolve(); held.mockRestore(); }
});

for (const change of ["configuration", "membership", "actor", "grant"] as const) {
  test(`rejects late lookup output when ${change} authority becomes stale`, async () => {
    // Given
    await using provider = referenceProvider();
    await using fixture = await referencesFixture(provider.origin);
    await fixture.configure(change === "grant" ? "mendeley" : "crossref");
    const owner = await fixture.login();
    const project = await fixture.create(owner);
    const reader = await fixture.login("operator@quire.local");
    await fixture.runtime.db.run(
      "INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'viewer',?)",
      [crypto.randomUUID(), project.id, reader.user.id, fixture.clock.now()]);
    const grant = change === "grant" ? await fixture.connect(reader, "mendeley") : undefined;
    provider.state.onRequest = async () => {
      switch (change) {
        case "configuration":
          await fixture.runtime.db.run("UPDATE adapter_provider_configs SET version=version+1 WHERE kind='crossref'");
          break;
        case "membership":
          await fixture.runtime.db.run("DELETE FROM project_members WHERE project_id=? AND user_id=?", [project.id, reader.user.id]);
          break;
        case "actor":
          await fixture.runtime.db.run("UPDATE users SET suspended=1 WHERE id=?", [reader.user.id]);
          break;
        case "grant":
          if (!grant) throw new TypeError("Mendeley grant required");
          await fixture.runtime.db.run("UPDATE provider_grants SET state='disabled',version=version+1 WHERE id=?", [grant.id]);
          break;
        default: { const unreachable: never = change; throw new TypeError(String(unreachable)); }
      }
    };
    // When
    const response = await fixture.request(
      `/api/references/search?projectId=${project.id}&provider=${grant ? "mendeley" : "crossref"}&query=lifecycle`,
      { headers: reader.headers });
    // Then
    expect(errorEnvelope.parse(await response.json()).error.code).toBe(
      { configuration: "PROVIDER_CHANGED", membership: "NOT_FOUND", actor: "UNAUTHENTICATED", grant: "GRANT_UNAVAILABLE" }[change]);
    expect(await fixture.runtime.db.all("SELECT * FROM reference_provenance")).toEqual([]);
  });
}

test("denies inaccessible projects before disclosure and preserves explicit search provenance", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("crossref");
  const owner = await fixture.login();
  const privateProject = await fixture.create(owner);
  const outsider = await fixture.login("operator@quire.local");
  // When
  const denied = await fixture.request(route.replace(fixtureIds.project, privateProject.id), { headers: outsider.headers });
  const response = await fixture.request(route, { headers: owner.headers });
  // Then
  expect(denied.status).toBe(404);
  expect(provider.state.requests).toHaveLength(1);
  const page = pageEnvelope.parse(await response.json()).data;
  expect(page.items).toHaveLength(1);
  const publication = page.items[0];
  if (!publication) throw new TypeError("Publication required");
  expect(await fixture.references.retrieval.provenance(owner.user.id, publication)).toHaveLength(1);
});
