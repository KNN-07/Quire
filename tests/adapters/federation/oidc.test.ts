import { expect, test } from "bun:test";
import { z } from "zod";
import { fixture } from "./harness";
import type { ProviderFault } from "./oidc-idp";

test("creates an ordinary session when discovery code PKCE and nonce verify", async () => {
  // Given
  await using app = await fixture();
  const authorization = await app.begin();
  // When
  const response = await app.request(authorization.path, { headers: { cookie: authorization.cookie } });
  // Then
  expect(response.status).toBe(303);
  const cookie = response.headers.getSetCookie().find((entry) => entry.startsWith("quire_session="))?.split(";")[0] ?? "";
  const me = await app.request("/api/me", { headers: { cookie } });
  expect(me.status).toBe(200);
  const user = z.object({ data: z.object({ user: z.object({ primaryEmail: z.string(), managedBy: z.string().nullable() }) }) }).parse(await me.json()).data.user;
  expect(user).toEqual({ primaryEmail: "external@example.test", managedBy: null });
  expect(new URL(authorization.location).searchParams.get("code_challenge_method")).toBe("S256");
});
const faults: readonly ProviderFault[] = ["issuer", "audience", "nonce", "expired", "signature", "unverified"];
for (const fault of faults) test(`rejects authentication when signed OIDC proof has ${fault} fault`, async () => {
  // Given
  await using app = await fixture();
  const authorization = await app.begin();
  app.provider.state.fault = fault;
  // When
  const response = await app.request(authorization.path, { headers: { cookie: authorization.cookie } });
  // Then
  expect(response.status).toBe(403);
  expect(await app.runtime.db.get("SELECT id FROM users WHERE primary_email='external@example.test'")).toBeNull();
});
test("rejects replay when an authorization state has already completed", async () => {
  // Given
  await using app = await fixture();
  const authorization = await app.begin();
  await app.request(authorization.path, { headers: { cookie: authorization.cookie } });
  // When
  const response = await app.request(authorization.path, { headers: { cookie: authorization.cookie } });
  // Then
  expect(response.status).toBe(400);
  expect(app.provider.observations).toEqual(["token"]);
});
test("rejects callback when initiating browser cookie is absent", async () => {
  // Given
  await using app = await fixture();
  const authorization = await app.begin();
  // When
  const response = await app.request(authorization.path);
  // Then
  expect(response.status).toBe(400);
  expect(app.provider.observations).toEqual([]);
});
test("rejects session admission when the provider is disabled during verification", async () => {
  // Given
  await using app = await fixture();
  const authorization = await app.begin();
  app.provider.state.beforeToken = async () => {
    const settings = await app.configurations.get();
    await app.runtime.uow.run((tx) => app.configurations.save(tx, { ...settings, config: { ...settings.config, enabled: false } }));
  };
  // When
  const response = await app.request(authorization.path, { headers: { cookie: authorization.cookie } });
  // Then
  expect(response.status).toBe(409);
  expect(await app.runtime.db.get("SELECT id FROM users WHERE primary_email='external@example.test'")).toBeNull();
});
test("rejects existing-email takeover when no explicit account linking occurred", async () => {
  // Given
  await using app = await fixture();
  app.provider.state.email = "kien@quire.local";
  const current = await app.configurations.get();
  await app.runtime.uow.run((tx) => app.configurations.save(tx, { ...current, config: { ...current.config, domains: ["quire.local"] } }));
  const authorization = await app.begin();
  // When
  const response = await app.request(authorization.path, { headers: { cookie: authorization.cookie } });
  // Then
  expect(response.status).toBe(409);
});
test("accepts a newly published signing key when the provider rotates JWKS", async () => {
  // Given
  await using app = await fixture();
  const authorization = await app.begin();
  app.provider.state.rotated = true;
  // When
  const response = await app.request(authorization.path, { headers: { cookie: authorization.cookie } });
  // Then
  expect(response.status).toBe(303);
});
