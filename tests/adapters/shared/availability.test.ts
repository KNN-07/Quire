import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import { CapabilitySchema } from "@quire/contracts";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { adapterFixture } from "./harness";
import { providerServer } from "./provider-server";
import { fixtureContribution } from "./contribution";
import { configure } from "./connection";
import { connectedFixture } from "./connected-fixture";

const availabilityEnvelope = z.object({ data: z.record(z.string(), CapabilitySchema) });
test("requires a session when connection availability is requested", async () => {
  // Given
  await using fixture = await adapterFixture({ contributions: [fixtureContribution()] });
  // When
  const response = await fixture.request("/api/connections/availability");
  // Then
  expect(response.status).toBe(401);
});
test("reports missing configuration through the authenticated availability route", async () => {
  // Given
  await using fixture = await adapterFixture({ contributions: [fixtureContribution()] });
  const owner = await fixture.login();
  // When
  const response = await fixture.request("/api/connections/availability", { headers: owner.headers });
  // Then
  const availability = availabilityEnvelope.parse(await response.json()).data;
  expect(Object.keys(availability)).toEqual(["fixture"]);
  expect(availability["fixture"]).toMatchObject({ enabled: false, state: "unconfigured" });
});
test("reads current configuration when an installed provider becomes configured", async () => {
  // Given
  await using provider = providerServer();
  await using fixture = await adapterFixture({ contributions: [fixtureContribution()],
    http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
  const owner = await fixture.login();
  await configure(fixture, provider.origin);
  // When
  const response = await fixture.request("/api/connections/availability", { headers: owner.headers });
  // Then
  expect(availabilityEnvelope.parse(await response.json()).data["fixture"]).toEqual({ enabled: true, state: "ready" });
});
test("enforces ownership through the published adapter test port", async () => {
  // Given
  await using setup = await connectedFixture();
  const outsider = await setup.fixture.login("outsider@quire.local");
  const adapter = setup.fixture.runtime.services.get("adapters").get("fixture");
  if (!adapter) throw new TypeError("Assembled adapter missing");
  const calls = setup.provider.observed.length;
  // When / Then
  await rejects(adapter.test(setup.grant.id, outsider.user.id), { code: "GRANT_NOT_FOUND" });
  expect(setup.provider.observed.length).toBe(calls);
});
test("executes a typed parameter request through the published adapter port", async () => {
  // Given
  await using setup = await connectedFixture();
  const adapter = setup.fixture.runtime.services.get("adapters").get("fixture");
  if (!adapter) throw new TypeError("Assembled adapter missing");
  // When
  const operation = await adapter.execute({
    actorId: setup.owner.user.id, grantId: setup.grant.id, action: "sync", parameters: { value: "typed port" },
    expectedVersion: setup.grant.version, expectedCursor: null, key: crypto.randomUUID(),
  });
  // Then
  expect(operation).toMatchObject({ status: "succeeded", result: { value: "typed port" } });
  expect(setup.provider.calls).toBe(1);
});
