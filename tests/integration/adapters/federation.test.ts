import { expect, test } from "bun:test";
import { IdentityConfigSchema, resourceVersionTag } from "@quire/contracts";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { emptyConfig } from "../../../services/adapters/federation";
import { providerFixture } from "../../adapters/federation/oidc-idp";
import { fixtureIds } from "../../fixtures/foundation";
import { data, integrationFixture } from "./harness";

test("admits signed institutional OIDC through the common identity dispatcher and rejects replay", async () => {
  // Given
  await using provider = await providerFixture();
  await using fixture = await integrationFixture({
    http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }),
    federation: { organizationId: fixtureIds.institution },
  });
  provider.state.now = Date.parse(fixture.clock.now());
  const operator = await fixture.login("operator@quire.local");
  const config = { ...emptyConfig, enabled: true, createOnLogin: true,
    breakGlassUserId: fixtureIds.operator, domains: ["example.test"], oidc: {
      issuer: provider.origin, clientId: "google-client", scopes: ["openid", "email", "profile"], secretPresent: true },
    oidcSecret: "fixture-client-secret", expectedVersion: 0 };
  const { version: _version, ...body } = config;
  await data(await fixture.request("/api/admin/identity", { method: "PUT",
    headers: { ...operator.headers, "if-match": resourceVersionTag(0) }, body: JSON.stringify(body) }), IdentityConfigSchema);
  const start = await fixture.request("/api/auth/oidc/start?returnTo=/projects", { redirect: "manual" });
  const location = start.headers.get("location");
  if (!location) throw new TypeError(await start.text());
  const authorize = await fetch(location, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  const callback = authorize.headers.get("location");
  if (!callback) throw new TypeError("OIDC callback missing");
  const url = new URL(callback);
  const headers = { cookie: start.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ") };
  const path = url.pathname + url.search;
  // When
  const admitted = await fixture.request(path, { headers, redirect: "manual" });
  // Then
  expect(admitted.status).toBe(303);
  const cookie = admitted.headers.getSetCookie().find(value => value.startsWith("quire_session="))?.split(";")[0];
  if (!cookie) throw new TypeError("Federated session missing");
  expect((await fixture.request("/api/me", { headers: { cookie } })).status).toBe(200);
  expect((await fixture.request(path, { headers, redirect: "manual" })).status).toBe(400);
  expect(provider.observations).toEqual(["token"]);
}, 90_000);
