import { expect, test } from "bun:test";
import { referenceProvider, zoteroKey } from "./provider";
import { referencesFixture, grantEnvelope } from "./harness";

test("Zotero key admission requires session and CSRF and never returns the key", async () => {
  // Given: a configured actual HTTP provider with a known valid read key.
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("zotero");
  const owner = await fixture.login();
  const path = "/api/connections/zotero/credentials";
  const body = JSON.stringify({ accessToken: zoteroKey, label: "My bibliography" });
  // When: anonymous, missing-CSRF and authenticated users submit the same key.
  expect((await fixture.request(path, { method: "POST", body })).status).toBe(401);
  expect((await fixture.request(path, { method: "POST", headers: { cookie: owner.headers.cookie }, body })).status).toBe(403);
  const response = await fixture.request(path, { method: "POST", headers: owner.headers, body });
  expect(response.status).toBe(200);
  const json = await response.text();
  const grant = grantEnvelope.parse(JSON.parse(json)).data;
  // Then: only the owner's validated encrypted grant is published and survives restart.
  expect(grant).toMatchObject({ provider: "zotero", ownerId: owner.user.id, label: "My bibliography" });
  expect(json.includes(zoteroKey)).toBe(false);
  const row = await fixture.runtime.db.get<{ encrypted_secret: string }>(
    "SELECT encrypted_secret FROM provider_grants WHERE id=?", [grant.id]);
  expect(row?.encrypted_secret).toBeTruthy();
  expect(row?.encrypted_secret.includes(zoteroKey)).toBe(false);
  await fixture.restart();
  const list = await fixture.request("/api/connections", { headers: owner.headers });
  expect(await list.json()).toMatchObject({ data: { items: [grant] } });
});

test("Zotero key admission rejects upstream-invalid credentials without storing a grant", async () => {
  // Given: an authenticated user and a configured provider.
  await using provider = referenceProvider();
  await using fixture = await referencesFixture(provider.origin);
  await fixture.configure("zotero");
  const owner = await fixture.login();
  // When: the upstream rejects the submitted key.
  const response = await fixture.request("/api/connections/zotero/credentials", {
    method: "POST", headers: owner.headers, body: JSON.stringify({ accessToken: "invalid", label: "Rejected" }),
  });
  // Then: no usable grant is persisted.
  expect(response.ok).toBe(false);
  expect(await fixture.runtime.db.all("SELECT id FROM provider_grants WHERE owner_id=?", [owner.user.id])).toHaveLength(0);
});
