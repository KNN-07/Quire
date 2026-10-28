import { expect, test } from "bun:test";
import { IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { createExternalIdentityAdmission } from "../../../services/adapters/identity";
import { fixture } from "./harness";
import { errorSchema } from "./provider-fixture";

test("does not admit caller claims when the bound federation verifier rejects their proof", async () => {
  // Given: a verifier that rejects an unsigned assertion, not a raw-claims admission API.
  await using app = await fixture();
  const admit = createExternalIdentityAdmission(app.context, { kind: "federation",
    async verify(_unsigned: string) { throw new ServiceError("FEDERATION_SIGNATURE_REQUIRED", 403, "Unsigned assertion"); } });
  const request = { request: new Request("http://localhost/"), requestId: IdSchema.parse(crypto.randomUUID()), responseHeaders: new Headers() };
  // When: the caller supplies fabricated identity claims as their proof.
  const result = admit(JSON.stringify({ email: "forged@example.test", verified: true }), request);
  // Then: no account or session is created.
  expect(await result.catch((error: unknown) => {
    if (error instanceof ServiceError) return error;
    throw error;
  })).toMatchObject({ code: "FEDERATION_SIGNATURE_REQUIRED" });
  expect(await app.runtime.db.get("SELECT id FROM users WHERE primary_email='forged@example.test'")).toBeNull();
  expect(request.responseHeaders.has("set-cookie")).toBe(false);
});

test("fences configuration changes during a real provider exchange before publishing account or session", async () => {
  // Given: an exact exchange barrier subscribed before the callback starts.
  await using app = await fixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  app.provider.state.beforeToken = async () => { entered.resolve(); await release.promise; };
  const started = await app.begin();
  const callback = app.request(started.path, { headers: { cookie: started.cookie } });
  try {
    await Promise.race([entered.promise, callback.then(() => { throw new TypeError("Callback completed before exchange barrier"); })]);
    await app.runtime.db.run("UPDATE adapter_provider_configs SET version=version+1 WHERE kind='identity-google'");
  } finally { release.resolve(); }
  // When: the old-configuration token response completes.
  const response = await callback;
  // Then: verified claims cannot publish through a changed configuration fence.
  expect(response.status).toBe(409);
  expect(errorSchema.parse(await response.json()).error.code).toBe("PROVIDER_CHANGED");
  expect(await app.runtime.db.get("SELECT id FROM users WHERE primary_email='external@example.test'")).toBeNull();
});

test("rejects an expired OAuth state using the injected clock", async () => {
  // Given: the provider authorization occurred eleven minutes ago.
  await using app = await fixture();
  const started = await app.begin();
  app.provider.state.now += 11 * 60_000;
  // When: the old state is returned.
  const response = await app.request(started.path, { headers: { cookie: started.cookie } });
  // Then: expiry is checked before external I/O.
  expect(response.status).toBe(400);
  expect(app.provider.observations).toEqual([]);
});

test("rejects a callback routed to the wrong provider without consuming its code", async () => {
  // Given: a Google state and a browser cookie renamed to mimic GitHub.
  await using app = await fixture();
  const started = await app.begin();
  // When: it is submitted to the GitHub callback.
  const response = await app.request(started.path.replace("/google/", "/github/"),
    { headers: { cookie: started.cookie.replace("quire_identity_google", "quire_identity_github") } });
  // Then: the stored provider binding rejects the mix-up.
  expect(response.status).toBe(400);
  expect(app.provider.observations).toEqual([]);
});

for (const returnTo of ["https://attacker.example.test", "http://["]) test(`rejects unsafe post-login redirect ${returnTo} before persisting state`, async () => {
  // Given: an absolute attacker return URL.
  await using app = await fixture();
  // When: the login start endpoint receives it.
  const response = await app.request(`/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`);
  // Then: no open redirect or state is produced.
  expect(response.status).toBe(400);
  expect(await app.runtime.db.get("SELECT digest FROM identity_oauth_states")).toBeNull();
});

test("consumes denial state without exchanging a token", async () => {
  // Given: the provider redirects a user denial with a valid state.
  await using app = await fixture();
  const started = await app.begin();
  const denial = new URL(started.path, "http://localhost");
  denial.searchParams.delete("code");
  denial.searchParams.set("error", "access_denied");
  // When: the browser reports denial.
  const response = await app.request(denial.pathname + denial.search, { headers: { cookie: started.cookie } });
  // Then: no exchange occurs, and retrying the original code is rejected.
  expect(response.status).toBe(400);
  expect(errorSchema.parse(await response.json()).error.code).toBe("OAUTH_DENIED");
  expect((await app.request(started.path, { headers: { cookie: started.cookie } })).status).toBe(400);
  expect(app.provider.observations).toEqual([]);
});
