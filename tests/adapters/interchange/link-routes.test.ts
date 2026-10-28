import { test, expect } from "bun:test";
import { z } from "zod";
import { FileEntrySchema } from "@quire/contracts";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { interchangeFixture } from "./harness";

test("creates and manually refreshes actual remote bytes through core's single URL-link routes", async () => {
  // Given
  let bytes = new Uint8Array([0, 255, 1]);
  let downloads = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => {
    downloads++; return new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
  } });
  await using fixture = await interchangeFixture({ http: new SafeHttpClient({ fixtureOrigins: [server.url.origin] }) });
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const envelope = z.object({ data: FileEntrySchema });
  try {
    const created = await fixture.request(`/api/projects/${project.id}/links`, { method: "POST",
      headers: { ...owner.headers, "idempotency-key": "http-url-link" },
      body: JSON.stringify({ scope, path: "download.bin", kind: "url", url: server.url.href,
        expectedVersion: (await fixture.service.getBranch(scope)).revision }) });
    expect(created.status).toBe(200);
    const file = envelope.parse(await created.json()).data;
    bytes = new Uint8Array([0, 128, 99, 7]);
    const body = { expectedDigest: file.blob, expectedVersion: (await fixture.service.getBranch(scope)).revision };
    // When
    const refreshed = await fixture.request(`/api/projects/${project.id}/links/${file.id}/refresh`, { method: "POST",
      headers: { ...owner.headers, "idempotency-key": "http-url-refresh" }, body: JSON.stringify(body) });
    const retried = await fixture.request(`/api/projects/${project.id}/links/${file.id}/refresh`, { method: "POST",
      headers: { ...owner.headers, "idempotency-key": "http-url-refresh" }, body: JSON.stringify(body) });
    // Then
    expect(refreshed.status).toBe(200);
    const changed = envelope.parse(await refreshed.json()).data;
    expect(envelope.parse(await retried.json()).data.blob).toBe(changed.blob);
    expect(changed.editable).toBe(false);
    expect(downloads).toBe(2);
    const content = await fixture.request(`/api/projects/${project.id}/files/${file.id}/content?branch=main`, { headers: owner.headers });
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(bytes);
    expect((await fixture.service.getProject(project.id)).settings.mainFileId).not.toBe(file.id);
  } finally { await server.stop(true); }
});

test("denies unauthorized URL links before requesting external content", async () => {
  // Given
  let downloads = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { downloads++; return new Response("not requested"); } });
  await using fixture = await interchangeFixture({ http: new SafeHttpClient({ fixtureOrigins: [server.url.origin] }) });
  const owner = await fixture.login();
  const other = await fixture.login("mai@quire.local");
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  try {
    // When
    const response = await fixture.request(`/api/projects/${project.id}/links`, { method: "POST",
      headers: { ...other.headers, "idempotency-key": "denied-url-link" },
      body: JSON.stringify({ scope, path: "denied.txt", kind: "url", url: server.url.href,
        expectedVersion: (await fixture.service.getBranch(scope)).revision }) });
    // Then
    expect(response.status).toBe(404);
    expect(downloads).toBe(0);
  } finally { await server.stop(true); }
});
