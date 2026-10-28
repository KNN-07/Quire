import { afterAll, beforeAll, expect, test } from "bun:test";
import { fixture } from "./harness";
import { certificate, authnRequestId, signedResponse } from "./signed-idp";
import type { SamlFault } from "./signed-idp";
import { FederationSaml } from "../../../services/adapters/federation";

let first: Awaited<ReturnType<typeof certificate>>;
let rotated: Awaited<ReturnType<typeof certificate>>;
beforeAll(async () => { first = await certificate(); rotated = await certificate(); });
afterAll(async () => { await first[Symbol.asyncDispose](); await rotated[Symbol.asyncDispose](); });
async function begin(app: Awaited<ReturnType<typeof fixture>>, certificates = [first.cert]) {
  const current = await app.configurations.get();
  const config = { ...current.config, protocol: "saml" as const,
    saml: { entityId: "https://idp.example.test", ssoUrl: `${app.provider.origin}/saml`, metadataXml: "", certificates } };
  await app.runtime.uow.run((tx) => app.configurations.save(tx, { ...current, config }));
  const response = await app.request("/api/auth/saml/start?returnTo=/projects");
  const location = response.headers.get("location");
  if (!location) throw new TypeError(await response.text());
  const cookie = response.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
  const protocol = new FederationSaml(app.context);
  return { cookie, state: new URL(location).searchParams.get("RelayState") ?? "",
    proof: { requestId: authnRequestId(location), issuer: config.saml.entityId, audience: protocol.spIssuer, destination: protocol.callbackUrl } };
}
test("issues a session when both SAML signatures and bound assertion verify", async () => {
  // Given
  await using app = await fixture();
  const state = await begin(app);
  const response = signedResponse({ ...state.proof, key: first.key, cert: first.cert });
  // When
  const result = await app.request("/api/auth/saml/acs", { method: "POST",
    headers: { cookie: state.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ RelayState: state.state, SAMLResponse: response }).toString() });
  // Then
  expect(result.status).toBe(303);
  expect(result.headers.getSetCookie().some((cookie) => cookie.startsWith("quire_session="))).toBe(true);
});
const faults: readonly SamlFault[] = ["signature", "unsigned-response", "unsigned-assertion", "issuer", "audience", "destination", "expired", "request", "recipient"];
for (const fault of faults) test(`rejects a SAML callback when it has ${fault}`, async () => {
  // Given
  await using app = await fixture();
  const state = await begin(app);
  const response = signedResponse({ ...state.proof, key: first.key, cert: first.cert, fault });
  // When
  const result = await app.request("/api/auth/saml/acs", { method: "POST",
    headers: { cookie: state.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ RelayState: state.state, SAMLResponse: response }).toString() });
  // Then
  expect(result.status).toBe(403);
  expect(await app.runtime.db.get("SELECT id FROM users WHERE primary_email='signed@example.test'")).toBeNull();
});
test("accepts an overlapping certificate when the IdP signs with its rotated key", async () => {
  // Given
  await using app = await fixture();
  const state = await begin(app, [first.cert, rotated.cert]);
  const response = signedResponse({ ...state.proof, key: rotated.key, cert: rotated.cert });
  // When
  const result = await app.request("/api/auth/saml/acs", { method: "POST",
    headers: { cookie: state.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ RelayState: state.state, SAMLResponse: response }).toString() });
  // Then
  expect(result.status).toBe(303);
});
test("rejects a retired signer when only the rotated certificate remains trusted", async () => {
  // Given
  await using app = await fixture();
  const state = await begin(app, [rotated.cert]);
  const response = signedResponse({ ...state.proof, key: first.key, cert: first.cert });
  // When
  const result = await app.request("/api/auth/saml/acs", { method: "POST",
    headers: { cookie: state.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ RelayState: state.state, SAMLResponse: response }).toString() });
  // Then
  expect(result.status).toBe(403);
});
test("rejects assertion replay even when a new request has a valid signature", async () => {
  // Given
  await using app = await fixture();
  const firstState = await begin(app);
  const assertionId = `_${crypto.randomUUID()}`;
  const firstProof = signedResponse({ ...firstState.proof, key: first.key, cert: first.cert, assertionId });
  const protocol = new FederationSaml(app.context);
  const settings = await app.configurations.get();
  const validated = await protocol.verify(settings.config, firstProof);
  await app.runtime.uow.run(validated.publish);
  const state = await begin(app);
  const response = signedResponse({ ...state.proof, key: first.key, cert: first.cert, assertionId });
  // When
  const result = await app.request("/api/auth/saml/acs", { method: "POST",
    headers: { cookie: state.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ RelayState: state.state, SAMLResponse: response }).toString() });
  // Then
  expect(result.status).toBe(403);
});
