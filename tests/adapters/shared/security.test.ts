import { expect, test } from "bun:test";
import { z } from "zod";
import { ProviderConfigSchema } from "@quire/contracts";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { SecretBox } from "../../../services/adapters/shared/secrets";
import { adapterFixture, errorEnvelope } from "./harness";
import { providerServer } from "./provider-server";
import { fixtureContribution } from "./contribution";
import { configure, connect } from "./connection";

test("reports exact missing configuration when a provider has no operator credentials", async () => {
  // Given
  await using fixture = await adapterFixture({ contributions: [fixtureContribution()] });
  const operator = await fixture.login("operator@quire.local");
  // When
  const response = await fixture.request("/api/admin/providers/fixture", { headers: operator.headers });
  // Then
  const config = z.object({ data: ProviderConfigSchema }).parse(await response.json()).data;
  expect(config.secretPresent).toBe(false);
  expect(config.capabilities["sync"]).toEqual({ enabled: false, state: "unconfigured",
    reason: "Missing: operator provider configuration; OAuth fixture client secret" });
  expect(response.headers.get("etag")).toBe('"0"');
});
test.each([
  ["csrf", { cookie: true, csrf: false, origin: "http://localhost:5173" }, "CSRF_DENIED"],
  ["origin", { cookie: true, csrf: true, origin: "https://attacker.invalid" }, "ORIGIN_DENIED"],
] as const)("rejects connection start when %s protection fails", async (_name, options, expected) => {
  // Given
  await using fixture = await adapterFixture({ contributions: [fixtureContribution()] });
  const owner = await fixture.login();
  // When
  const response = await fixture.request("/api/connections/fixture/start", {
    method: "POST", headers: { cookie: owner.headers.cookie, origin: options.origin,
      ...(options.csrf ? { "x-csrf-token": owner.headers["x-csrf-token"] } : {}) },
    body: JSON.stringify({ returnTo: "/settings" }),
  });
  // Then
  expect(errorEnvelope.parse(await response.json()).error.code).toBe(expected);
});
test.each(["https://attacker.invalid", "//attacker.invalid", "/\\attacker.invalid", "/api/auth/login"])(
  "rejects unsafe return target %s", async (returnTo) => {
    // Given
    await using fixture = await adapterFixture({ contributions: [fixtureContribution()] });
    const owner = await fixture.login();
    // When
    const response = await fixture.request("/api/connections/fixture/start", {
      method: "POST", headers: owner.headers, body: JSON.stringify({ returnTo }),
    });
    // Then
    expect(errorEnvelope.parse(await response.json()).error.code).toBe("OAUTH_RETURN_DENIED");
  });
test("denies another owner before provider I/O when testing a grant", async () => {
  // Given
  await using provider = providerServer();
  await using fixture = await adapterFixture({ contributions: [fixtureContribution()],
    http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
  await configure(fixture, provider.origin);
  const owner = await fixture.login();
  const other = await fixture.login("outsider@quire.local");
  const grant = await connect(fixture, owner);
  const before = provider.observed.length;
  // When
  const response = await fixture.request(`/api/connections/${grant.id}/test`, {
    method: "POST", headers: other.headers, body: JSON.stringify({ expectedVersion: 1 }),
  });
  // Then
  expect(response.status).toBe(404);
  expect(provider.observed.length).toBe(before);
});
test("denies provider configuration when the authenticated actor is not an operator", async () => {
  // Given
  await using fixture = await adapterFixture({ contributions: [fixtureContribution()] });
  const owner = await fixture.login();
  // When
  const response = await fixture.request("/api/admin/providers/fixture", { headers: owner.headers });
  // Then
  expect(response.status).toBe(403);
});
test("rejects copied or altered ciphertext when credential resource binding changes", () => {
  // Given
  const box = new SecretBox(crypto.getRandomValues(new Uint8Array(32)));
  const encrypted = box.seal("protected-access-token", "grant:one:alice:provider");
  // When / Then
  expect(() => box.open(encrypted, "grant:two:bob:provider")).toThrow("Credential key or authentication mismatch");
  const mutated = Uint8Array.from(encrypted);
  mutated[30] = (mutated[30] ?? 0) ^ 1;
  expect(() => box.open(mutated, "grant:one:alice:provider")).toThrow("Credential key or authentication mismatch");
});
