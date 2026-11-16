import { expect, test } from "bun:test";
import { AdapterGrantSchema, ProviderConfigSchema, PublisherContractSchema } from "@quire/contracts";
import type { PublisherContract } from "@quire/contracts";
import { publisherContribution } from "../../../services/adapters/publisher";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { adapterFixture } from "../shared/harness";
import { defaultPolicy } from "../../fixtures/foundation";
import { publisherProvider } from "./provider";
import { z } from "zod";

const contract: PublisherContract = {
  version: 1, mode: "manual", credentialTestPath: "api/me", authentication: "bearer",
  actions: { submit: false },
};
test("typed bearer configuration, fenced enrollment, action enforcement and local forgetting use real HTTP", async () => {
  await using provider = publisherProvider();
  await using app = await adapterFixture({ contributions: [publisherContribution],
    http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
  const operator = await app.login("operator@quire.local");
  const owner = await app.login();
  const outsider = await app.login("outsider@quire.local");
  const put = (body: Record<string, unknown>, version: number) => app.request("/api/admin/providers/publisher", {
    method: "PUT", headers: { ...operator.headers, "if-match": `"${version}"` },
    body: JSON.stringify({ baseUrl: provider.origin, policy: defaultPolicy, expectedVersion: version, ...body }),
  });
  let response = await put({ publisherContract: contract }, 0);
  expect(response.status).toBe(200);
  let settings = z.object({ data: ProviderConfigSchema }).parse(await response.json()).data;
  expect(settings.publisherContract).toEqual(contract);
  expect(settings.secretPresent).toBe(false);
  expect(settings.capabilities["submit"]?.enabled).toBe(false);
  expect(settings.capabilities["prepare"]?.enabled).toBe(true);
  expect(settings.capabilities["status"]?.enabled).toBe(true);
  response = await put({}, 1);
  expect(response.status).toBe(200);
  settings = z.object({ data: ProviderConfigSchema }).parse(await response.json()).data;
  expect(settings.publisherContract).toEqual(contract);
  expect((await put({ publisherContract: contract, model: "{}" }, 2)).status).toBe(422);
  expect((await put({ publisherContract: { ...contract, credentialTestPath: "https://foreign.invalid" } }, 2)).status).toBe(400);
  const current = await app.request("/api/admin/providers/publisher", { headers: operator.headers });
  expect(z.object({ data: ProviderConfigSchema }).parse(await current.json()).data.version).toBe(2);
  const token = provider.issueToken();
  const enroll = (headers: HeadersInit, accessToken = token) => app.request("/api/connections/publisher/credentials", {
    method: "POST", headers, body: JSON.stringify({ label: "Publisher key", accessToken }),
  });
  expect((await enroll({})).status).toBe(401);
  expect((await enroll({ cookie: owner.headers.cookie })).status).toBe(403);
  expect((await enroll(owner.headers, "invalid")).status).toBe(502);
  response = await enroll(owner.headers);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain(token);
  const grant = z.object({ data: AdapterGrantSchema }).parse(JSON.parse(text)).data;
  expect(grant.disconnect).toBe("local");
  expect((await app.request("/api/connections/publisher/start", { method: "POST", headers: owner.headers,
    body: JSON.stringify({ returnTo: "/settings/git" }) })).status).toBe(422);
  const adapter = app.runtime.services.get("adapters").get("publisher");
  if (!adapter) throw new TypeError("Publisher adapter missing");
  expect(adapter.capabilities()).toEqual(settings.capabilities);
  const project = await app.create(owner.headers);
  const before = provider.observed.length;
  response = await app.request(`/api/connections/${grant.id}/actions`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ action: "submit", projectId: project.id, parameters: {},
      expectedVersion: grant.version, expectedCursor: null }) });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: "ACTION_UNAVAILABLE" } });
  expect(provider.observed.length).toBe(before);
  response = await app.request(`/api/connections/${grant.id}/test`, { method: "POST", headers: outsider.headers,
    body: JSON.stringify({ expectedVersion: grant.version }) });
  expect(response.status).toBe(404);
  expect((await app.request("/api/connections", { headers: owner.headers }).then(r => r.text()))).not.toContain(token);
  const encrypted = await app.runtime.db.get<{ encrypted_secret: Uint8Array }>(
    "SELECT encrypted_secret FROM provider_grants WHERE id=?", [grant.id]);
  expect(new TextDecoder().decode(encrypted?.encrypted_secret)).not.toContain(token);
  response = await app.request(`/api/connections/${grant.id}`, { method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ expectedVersion: grant.version }) });
  expect(response.status).toBe(200);
  expect(provider.observed.some(path => path.includes("revoke"))).toBe(false);
  expect(await app.runtime.db.get("SELECT encrypted_secret,state FROM provider_grants WHERE id=?", [grant.id]))
    .toEqual({ encrypted_secret: null, state: "disabled" });
  const barrier = provider.pauseCredentialTest();
  const pending = enroll(owner.headers);
  try {
    await barrier.entered;
    expect((await put({ publisherContract: contract }, 2)).status).toBe(200);
  } finally { barrier.release(); }
  expect((await pending).status).toBe(409);
  expect(await app.runtime.db.all("SELECT id FROM provider_grants WHERE state='ready'")).toEqual([]);
  // A pre-existing model-only row survives restart without changing its version.
  const legacy = { version: 1, mode: "manual", credentialTestPath: "api/me", oauth: {
    authorizationPath: "oauth/authorize", tokenPath: "oauth/token", revokePath: "oauth/revoke",
    clientId: "publisher-fixture-client", scopes: ["submissions:read", "submissions:write"], tokenAuthentication: "body",
  } };
  response = await put({ model: JSON.stringify(legacy), secret: "publisher-fixture-secret" }, 3);
  expect(response.status).toBe(200);
  await app.restart();
  response = await app.request("/api/admin/providers/publisher", { headers: operator.headers });
  settings = z.object({ data: ProviderConfigSchema }).parse(await response.json()).data;
  expect(settings.model).toBe(JSON.stringify(legacy));
  expect(settings.publisherContract).toBeUndefined();
  expect(settings.version).toBe(4);
  expect(settings.secretPresent).toBe(true);
  expect((await enroll(owner.headers)).status).toBe(422);
  response = await app.request("/api/connections/publisher/start", { method: "POST", headers: owner.headers,
    body: JSON.stringify({ returnTo: "/settings/git" }) });
  expect(response.status).toBe(200);
  expect((await put({}, 4)).status).toBe(200);
  response = await app.request("/api/admin/providers/publisher", { headers: operator.headers });
  expect(z.object({ data: ProviderConfigSchema }).parse(await response.json()).data.model).toBe(JSON.stringify(legacy));
});

test("publisher path schema rejects foreign origins and encoded traversal", () => {
  for (const path of ["//foreign.invalid/api", "https://foreign.invalid", "api/%2e%2e/me", "api\\me", "../api", "api?q=x"]) {
    expect(PublisherContractSchema.safeParse({ ...contract, credentialTestPath: path }).success).toBe(false);
  }
});

test("OAuth grants are not silently forgotten after publisher switches to bearer enrollment", async () => {
  await using provider = publisherProvider();
  await using app = await adapterFixture({ contributions: [publisherContribution],
    http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
  const operator = await app.login("operator@quire.local");
  const owner = await app.login();
  const configure = (publisherContract: unknown, version: number) => app.request("/api/admin/providers/publisher", {
    method: "PUT", headers: { ...operator.headers, "if-match": `"${version}"` },
    body: JSON.stringify({ baseUrl: provider.origin, policy: defaultPolicy, expectedVersion: version,
      secret: "publisher-fixture-secret", publisherContract }),
  });
  expect((await configure({ version: 1, mode: "manual", credentialTestPath: "api/me", oauth: {
    authorizationPath: "oauth/authorize", tokenPath: "oauth/token", revokePath: "oauth/revoke",
    clientId: "publisher-fixture-client", scopes: ["submissions:read", "submissions:write"], tokenAuthentication: "body",
  } }, 0)).status).toBe(200);
  const start = await app.request("/api/connections/publisher/start", { method: "POST", headers: owner.headers,
    body: JSON.stringify({ returnTo: "/settings/git" }) });
  const url = z.object({ data: z.object({ url: z.string() }) }).parse(await start.json()).data.url;
  const authorization = await fetch(url, { redirect: "manual" });
  const location = authorization.headers.get("location");
  if (!location) throw new TypeError("OAuth callback required");
  const callback = new URL(location);
  expect((await app.request(callback.pathname + callback.search, { headers: owner.headers })).status).toBe(303);
  const listed = await app.request("/api/connections", { headers: owner.headers });
  const [grant] = z.object({ data: z.object({ items: z.array(AdapterGrantSchema) }) }).parse(await listed.json()).data.items;
  if (!grant) throw new TypeError("OAuth grant required");
  expect((await configure(contract, 1)).status).toBe(200);
  const removed = await app.request(`/api/connections/${grant.id}`, { method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ expectedVersion: grant.version }) });
  expect(removed.status).toBe(422);
  expect(await app.runtime.db.get("SELECT state,version FROM provider_grants WHERE id=?", [grant.id]))
    .toEqual({ state: "ready", version: 1 });
  expect(provider.observed.some(path => path.includes("revoke"))).toBe(false);
});
