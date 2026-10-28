import { expect, test } from "bun:test";
import { z } from "zod";
import { AuthOptionsSchema, UserSchema } from "@quire/contracts";
import { fixture } from "./harness";
import { errorSchema } from "./provider-fixture";
import type { ProviderFault } from "./provider-fixture";

test("reports exact missing application credentials when providers are unconfigured", async () => {
  // Given: an assembled runtime without OAuth credentials.
  await using app = await fixture({ configured: false });
  // When: a client discovers and attempts an unavailable provider.
  const response = await app.request("/api/auth/options");
  const options = z.object({ data: AuthOptionsSchema }).parse(await response.json()).data;
  // Then: capabilities are real, and local startup still works.
  expect(options.providers).toHaveLength(3);
  expect(options.providers.every((entry) => !entry.capability.enabled && entry.capability.state === "unconfigured")).toBe(true);
  expect(options.providers[0]?.capability.reason).toContain("clientId and clientSecret");
  expect((await app.request("/api/auth/google/start?returnTo=/projects")).status).toBe(503);
  expect((await app.login()).user.primaryEmail).toBe("kien@quire.local");
});

for (const id of ["google", "github"]) test(`admits verified ${id} users through the actual HTTP authorization flow`, async () => {
  // Given: a real code-grant fixture with PKCE and verified email.
  await using app = await fixture();
  const started = await app.begin(id);
  // When: the authorization callback is submitted by the initiating browser.
  const response = await app.request(started.path, { headers: { cookie: started.cookie } });
  // Then: the real session authenticates and contains the verified, not public-profile, email.
  expect(response.status, await response.clone().text()).toBe(303);
  const cookie = response.headers.getSetCookie().find((entry) => entry.startsWith("quire_session="))?.split(";")[0] ?? "";
  const me = await app.request("/api/me", { headers: { cookie } });
  const user = z.object({ data: z.object({ user: UserSchema }) }).parse(await me.json()).data.user;
  expect(user.primaryEmail).toBe("external@example.test");
  expect(user.verifiedEmails).toEqual(["external@example.test"]);
  expect(await app.runtime.db.get("SELECT id FROM provider_grants WHERE owner_id=?", [user.id])).toBeNull();
});

const faults: readonly ProviderFault[] = ["issuer", "audience", "nonce", "expired", "signature", "unverified"];
for (const fault of faults) test(`rejects admission when the signed provider response has ${fault}`, async () => {
  // Given: a valid browser-bound authorization with one invalid identity condition.
  await using app = await fixture();
  const started = await app.begin();
  app.provider.state.fault = fault;
  // When: the callback exchanges its actual code.
  const response = await app.request(started.path, { headers: { cookie: started.cookie } });
  // Then: no external account or session is admitted.
  expect(response.status).toBe(403);
  expect(await app.runtime.db.get("SELECT id FROM users WHERE primary_email='external@example.test'")).toBeNull();
  expect(response.headers.getSetCookie().some((entry) => entry.startsWith("quire_session="))).toBe(false);
});

test("rejects discovery when its issuer differs from the configured authority", async () => {
  // Given: a provider advertising a different issuer.
  await using app = await fixture();
  app.provider.state.fault = "discovery";
  // When: the user starts sign-in.
  const response = await app.request("/api/auth/google/start?returnTo=/projects");
  // Then: no authorization redirect is issued.
  expect(response.status).toBe(503);
  expect(errorSchema.parse(await response.json()).error.code).toBe("OIDC_DISCOVERY_INVALID");
});

test("rejects missing browser binding before exchanging a valid state", async () => {
  // Given: a code belonging to another browser.
  await using app = await fixture();
  const started = await app.begin();
  // When: a caller submits the callback without the browser cookie.
  const response = await app.request(started.path);
  // Then: the provider is never called.
  expect(response.status).toBe(400);
  expect(app.provider.observations).toEqual([]);
});

test("rejects replay before making a second token request", async () => {
  // Given: a consumed authorization state.
  await using app = await fixture();
  const started = await app.begin();
  expect((await app.request(started.path, { headers: { cookie: started.cookie } })).status).toBe(303);
  // When: the callback is replayed.
  const response = await app.request(started.path, { headers: { cookie: started.cookie } });
  // Then: replay cannot issue another session or exchange another code.
  expect(response.status).toBe(400);
  expect(app.provider.observations).toEqual(["token"]);
});

test("requires explicit linking when a verified provider email collides with a local account", async () => {
  // Given: the provider authenticates a different subject with a local user's email.
  await using app = await fixture();
  app.provider.state.email = "kien@quire.local";
  const started = await app.begin();
  // When: the caller attempts implicit account merging.
  const response = await app.request(started.path, { headers: { cookie: started.cookie } });
  // Then: no identity is attached to the local account.
  expect(response.status).toBe(409);
  expect(errorSchema.parse(await response.json()).error.code).toBe("IDENTITY_EMAIL_COLLISION");
  expect(await app.runtime.db.get("SELECT id FROM identities")).toBeNull();
});

test("requires a verified local account before first ORCID linking", async () => {
  // Given: ORCID's actual openid-only claims contain no email.
  await using app = await fixture();
  const started = await app.begin("orcid");
  // When: a first-time user attempts ORCID-only registration.
  const response = await app.request(started.path, { headers: { cookie: started.cookie } });
  // Then: a fake email or user is never invented.
  expect(response.status).toBe(403);
  expect(errorSchema.parse(await response.json()).error.code).toBe("VERIFIED_EMAIL_REQUIRED");
});
