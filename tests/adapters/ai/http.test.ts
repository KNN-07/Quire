import { expect, test } from "bun:test";
import { endpoints } from "@quire/contracts";
import { z } from "zod";
import { aiFixture, errorSchema, runSchema } from "./harness";
import { providerServer } from "./provider";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==";

test("exposes governed images, conversation, usage and required run metadata over HTTP", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const root = `/api/projects/${project.id}/ai`;
  const uploaded = await fixture.request(`${root}/images`, { method: "POST", headers: session.headers,
    body: JSON.stringify({ mime: "image/png", dataBase64: png }) });
  const image = z.object({ data: endpoints.aiImageCreate.output }).parse(await uploaded.json()).data;
  const created = await fixture.request(`${root}/conversations`, { method: "POST", headers: session.headers, body: '{"shared":true}' });
  const conversation = z.object({ data: endpoints.aiConversationCreate.output }).parse(await created.json()).data;
  // When
  const run = await fixture.run(session, { scope: { projectId: project.id, branch: project.defaultBranch },
    mode: "ask", tool: "table-image", prompt: "Transcribe", fileIds: [], imageUploadIds: [image.id], conversationId: conversation.id });
  // Then
  const response = await fixture.request(`/api/ai/runs/${run.id}`, { headers: session.headers });
  const read = runSchema.parse(await response.json()).data;
  expect(read).toMatchObject({ tool: "table-image", status: "succeeded", version: 4, errorCode: null, conversationId: conversation.id });
  const shared = await fixture.request(`${root}/conversations/${conversation.id}`, { headers: session.headers });
  expect(z.object({ data: endpoints.aiConversationGet.output }).parse(await shared.json()).data.messages).toHaveLength(2);
  const usage = await fixture.request("/api/me/ai/usage?month=2026-10", { headers: session.headers });
  expect(z.object({ data: endpoints.aiUsageGet.output }).parse(await usage.json()).data).toEqual({
    month: "2026-10", used: 1, reserved: 0, refunded: 0,
  });
});

test("requires authentication and CSRF on every added mutation route", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const root = `/api/projects/${project.id}/ai`;
  const routes = [
    { path: `${root}/images`, method: "POST", body: { mime: "image/png", dataBase64: png } },
    { path: `${root}/conversations`, method: "POST", body: { shared: true } },
    { path: `${root}/security`, method: "PUT", body: { confidential: true, expectedVersion: 0 } },
    { path: `${root}/session`, method: "DELETE", body: { branch: project.defaultBranch } },
  ];
  // When
  const results = await Promise.all(routes.map(async route => {
    const anonymous = await fixture.request(route.path, { method: route.method, body: JSON.stringify(route.body) });
    const csrf = await fixture.request(route.path, { method: route.method, headers: { cookie: session.headers.cookie }, body: JSON.stringify(route.body) });
    return { anonymous: anonymous.status, csrf: csrf.status };
  }));
  const reads = await Promise.all([`${root}/security`, `${root}/conversations/${crypto.randomUUID()}`, "/api/me/ai/usage?month=2026-10"]
    .map(path => fixture.request(path)));
  // Then
  expect(results).toEqual(routes.map(() => ({ anonymous: 401, csrf: 403 })));
  expect(reads.map(response => response.status)).toEqual([401, 401, 401]);
  expect(provider.received).toHaveLength(0);
});

test("protects added reads and security writes from an unrelated authenticated user", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const owner = await fixture.login(); const outsider = await fixture.login("outsider@quire.local");
  await fixture.configure(); const project = await fixture.project(owner);
  const shared = await fixture.ai.conversations.create(owner.actor, project.id);
  const root = `/api/projects/${project.id}/ai`;
  // When
  const reads = await Promise.all([`${root}/conversations/${shared.id}`, `${root}/security`].map(path =>
    fixture.request(path, { headers: outsider.headers })));
  const write = await fixture.request(`${root}/security`, { method: "PUT", headers: outsider.headers,
    body: JSON.stringify({ confidential: true, expectedVersion: 0 }) });
  // Then
  expect(reads.map(response => response.status)).toEqual([404, 404]);
  expect(write.status).toBe(404);
  expect((await fixture.ai.store.security(owner.actor, project.id)).confidential).toBe(false);
});

test("publishes asynchronous provider failure code in the required run DTO", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  provider.status(503);
  const run = await fixture.run(session, { scope: { projectId: project.id, branch: project.defaultBranch },
    mode: "ask", tool: "chat", prompt: "Fail", fileIds: [] });
  // When
  const response = await fixture.request(`/api/ai/runs/${run.id}`, { headers: session.headers });
  // Then
  expect(runSchema.parse(await response.json()).data).toMatchObject({
    status: "failed", tool: "chat", version: 2, errorCode: "PROVIDER_HTTP_ERROR", conversationId: null,
  });
});

test("applies security and clears private history through authenticated routes", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const root = `/api/projects/${project.id}/ai`;
  // When
  const cleared = await fixture.request(`${root}/session`, { method: "DELETE", headers: session.headers,
    body: JSON.stringify({ branch: project.defaultBranch }) });
  const updated = await fixture.request(`${root}/security`, { method: "PUT", headers: session.headers,
    body: JSON.stringify({ confidential: true, expectedVersion: 0 }) });
  const denied = await fixture.request(`${root}/images`, { method: "POST", headers: session.headers,
    body: JSON.stringify({ mime: "image/png", dataBase64: png }) });
  // Then
  expect(z.object({ data: endpoints.aiSessionClear.output }).parse(await cleared.json()).data).toEqual({ ok: true, version: 0 });
  expect(z.object({ data: endpoints.aiSecurityPut.output }).parse(await updated.json()).data).toEqual({ confidential: true, version: 1 });
  expect(errorSchema.parse(await denied.json()).error.code).toBe("AI_CONFIDENTIAL");
});
