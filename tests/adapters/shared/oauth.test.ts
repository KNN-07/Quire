import { describe, expect, test } from "bun:test";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { adapterFixture, errorEnvelope } from "./harness";
import { providerServer } from "./provider-server";
import { fixtureContribution } from "./contribution";
import { authorization, configure, connect, grantsEnvelope } from "./connection";

describe("encrypted OAuth connection lifecycle", () => {
  test("persists encrypted credentials and survives restart when authorization succeeds", async () => {
    // Given
    await using provider = providerServer();
    await using fixture = await adapterFixture({ contributions: [fixtureContribution()],
      http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
    await configure(fixture, provider.origin);
    const owner = await fixture.login();
    // When
    const grant = await connect(fixture, owner);
    await fixture.restart();
    // Then
    const list = await fixture.request("/api/connections", { headers: owner.headers });
    expect(grantsEnvelope.parse(await list.json()).data.items).toEqual([grant]);
    const persisted = await fixture.runtime.db.get<{ encrypted_secret: Uint8Array }>(
      "SELECT encrypted_secret FROM provider_grants WHERE id=?", [grant.id]);
    expect(persisted?.encrypted_secret).toBeInstanceOf(Uint8Array);
    const disk = await Bun.file(`${fixture.path}/quire.sqlite`).bytes();
    const wal = await Bun.file(`${fixture.path}/quire.sqlite-wal`).bytes();
    for (const token of provider.activeTokens) {
      expect(Buffer.from(persisted?.encrypted_secret ?? []).includes(token)).toBe(false);
      expect(Buffer.from(disk).includes(token)).toBe(false);
      expect(Buffer.from(wal).includes(token)).toBe(false);
    }
    expect(provider.tokenCalls).toBe(1);
    const tested = await fixture.request(`/api/connections/${grant.id}/test`, {
      method: "POST", headers: owner.headers, body: JSON.stringify({ expectedVersion: grant.version }),
    });
    expect(await tested.json()).toMatchObject({ data: { ok: true } });
  });
  test("rejects replay when a completed callback is reused", async () => {
    // Given
    await using provider = providerServer();
    await using fixture = await adapterFixture({ contributions: [fixtureContribution()],
      http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
    await configure(fixture, provider.origin);
    const owner = await fixture.login();
    const started = await authorization(fixture, owner);
    expect((await fixture.request(started.callback, { headers: owner.headers })).status).toBe(303);
    // When
    const replay = await fixture.request(started.callback, { headers: owner.headers });
    // Then
    expect(errorEnvelope.parse(await replay.json()).error.code).toBe("OAUTH_STATE_INVALID");
    expect(provider.tokenCalls).toBe(1);
  });
  test("rejects a different session when the account identity is the same", async () => {
    // Given
    await using provider = providerServer();
    await using fixture = await adapterFixture({ contributions: [fixtureContribution()],
      http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
    await configure(fixture, provider.origin);
    const first = await fixture.login();
    const started = await authorization(fixture, first);
    const second = await fixture.login();
    // When
    const response = await fixture.request(started.callback, { headers: second.headers });
    // Then
    expect(errorEnvelope.parse(await response.json()).error.code).toBe("OAUTH_STATE_INVALID");
    expect(provider.tokenCalls).toBe(0);
  });
  test("rejects expired state before token exchange when the injected clock advances", async () => {
    // Given
    await using provider = providerServer();
    await using fixture = await adapterFixture({ contributions: [fixtureContribution()],
      http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
    await configure(fixture, provider.origin);
    const owner = await fixture.login();
    const started = await authorization(fixture, owner);
    fixture.clock.advance(600_001);
    // When
    const response = await fixture.request(started.callback, { headers: owner.headers });
    // Then
    expect(errorEnvelope.parse(await response.json()).error.code).toBe("OAUTH_STATE_INVALID");
    expect(provider.tokenCalls).toBe(0);
  });
  test("rotates refresh tokens when an expired connection is tested", async () => {
    // Given
    await using provider = providerServer();
    await using fixture = await adapterFixture({ contributions: [fixtureContribution()],
      http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
    await configure(fixture, provider.origin);
    const owner = await fixture.login();
    const grant = await connect(fixture, owner);
    const previousTokens = provider.activeTokens;
    fixture.clock.advance(61_000);
    provider.advance(61_000);
    // When
    const response = await fixture.request(`/api/connections/${grant.id}/test`, {
      method: "POST", headers: owner.headers, body: JSON.stringify({ expectedVersion: 1 }),
    });
    // Then
    expect(await response.json()).toMatchObject({ data: { ok: true } });
    expect(provider.activeTokens).not.toEqual(previousTokens);
    const list = await fixture.request("/api/connections", { headers: owner.headers });
    expect(grantsEnvelope.parse(await list.json()).data.items[0]?.version).toBe(2);
  });
  test("revokes upstream and clears encrypted credentials when the owner disconnects", async () => {
    // Given
    await using provider = providerServer();
    await using fixture = await adapterFixture({ contributions: [fixtureContribution()],
      http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
    await configure(fixture, provider.origin);
    const owner = await fixture.login();
    const grant = await connect(fixture, owner);
    // When
    const response = await fixture.request(`/api/connections/${grant.id}`, {
      method: "DELETE", headers: owner.headers, body: JSON.stringify({ expectedVersion: 1 }),
    });
    // Then
    expect(await response.json()).toMatchObject({ data: { ok: true, version: 2 } });
    expect(provider.revocations).toBe(1);
    expect(provider.activeTokens).toHaveLength(0);
    expect(await fixture.runtime.db.get<{ state: string; encrypted_secret: Uint8Array | null }>(
      "SELECT state,encrypted_secret FROM provider_grants WHERE id=?", [grant.id]))
      .toEqual({ state: "disabled", encrypted_secret: null });
  });
});
