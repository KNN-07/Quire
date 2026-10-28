import { expect, test } from "bun:test";
import { z } from "zod";
import { fixtureIds } from "../../fixtures/foundation";
import { createDropboxIntegration } from "../../../services/adapters/dropbox";
import { adapterFixture } from "../shared/harness";
import { dropboxServer } from "./provider";
import { dropboxFixture, remotePath } from "./harness";
import { localText } from "./local";

test("reports unconfigured when operator Dropbox prerequisites are absent", async () => {
  // Given
  await using fixture = await adapterFixture({ contributions: [services => createDropboxIntegration().contribution(services)] });
  const owner = await fixture.login();
  // When
  const response = await fixture.request("/api/connections/availability", { headers: owner.headers });
  // Then
  const value = z.object({ data: z.object({ dropbox: z.object({ state: z.string(), reason: z.string() }) }) }).parse(await response.json()).data.dropbox;
  expect(value.state).toBe("unconfigured");
});

test("does not dispatch scheduled work before its controlled-clock due time", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.success("initialSync");
  const count = provider.observed.length;
  // When
  const failures = await harness.integration.scheduler.pump();
  // Then
  expect(failures).toEqual([]);
  expect(provider.observed.length).toBe(count);
});

test("publishes persisted local source when a subscribed scheduler tick becomes due", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.success("initialSync");
  provider.put(remotePath("scheduled.txt"), "scheduled inbound");
  const listeners = new Set<() => void>();
  harness.integration.scheduler.start({ subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } });
  harness.fixture.clock.advance(15 * 60_000); provider.oauth.advance(15 * 60_000);
  // When
  for (const listener of listeners) listener();
  const failures = await harness.integration.scheduler.pump();
  // Then
  expect(failures).toEqual([]);
  expect(await localText(harness, "scheduled.txt")).toBe("scheduled inbound");
  await harness.integration.scheduler.close();
  expect(listeners.size).toBe(0);
});

test("stops background synchronization when a project disconnects", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.success("initialSync");
  await harness.success("disconnect");
  harness.fixture.clock.advance(15 * 60_000); provider.oauth.advance(15 * 60_000);
  const count = provider.observed.length;
  // When
  await harness.integration.scheduler.pump();
  // Then
  expect(provider.observed.length).toBe(count);
  expect((await harness.action("sync")).status).toBe(409);
});

test("revokes the actual bearer token and stored encrypted grant on connection deletion", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  // When
  const response = await harness.fixture.request(`/api/connections/${harness.grant.id}`, { method: "DELETE",
    headers: harness.owner.headers, body: JSON.stringify({ expectedVersion: 1 }) });
  // Then
  expect(response.status).toBe(200);
  expect(provider.oauth.tokens.size).toBe(0);
  expect(await harness.fixture.runtime.db.get<{ state: string; encrypted_secret: Uint8Array | null }>(
    "SELECT state,encrypted_secret FROM provider_grants WHERE id=?", [harness.grant.id]))
    .toEqual({ state: "disabled", encrypted_secret: null });
});

test("rejects cross-owner grant use before sending project bytes", async () => {
  // Given
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  const outsider = await harness.fixture.login("outsider@quire.local");
  const count = provider.observed.length;
  // When
  const response = await harness.fixture.request(`/api/connections/${harness.grant.id}/actions`, { method: "POST",
    headers: { ...outsider.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ action: "initialSync", projectId: fixtureIds.project, parameters: {}, expectedVersion: 1, expectedCursor: null }) });
  // Then
  expect(response.status).toBe(404);
  expect(provider.observed.length).toBe(count);
});
