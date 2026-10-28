import { expect, test } from "bun:test";
import { aiFixture, failure } from "./harness";
import { providerServer } from "./provider";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==";

test("refuses unsupported image modality before making a reservation", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin, { visionModels: [] });
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const image = await fixture.ai.upload(session.actor, { projectId: project.id, mime: "image/png", dataBase64: png });
  // When
  const error = await failure(fixture.ai.create(session.actor, { key: crypto.randomUUID(), request: {
    scope: { projectId: project.id, branch: project.defaultBranch }, mode: "ask", tool: "equation-image",
    prompt: "Transcribe", fileIds: [], imageUploadIds: [image.id],
  } }));
  // Then
  expect(error.code).toBe("AI_MODALITY_UNSUPPORTED");
  expect(await fixture.ai.store.usage(session.actor, "2026-10")).toMatchObject({ used: 0, reserved: 0, refunded: 0 });
  expect(provider.received).toHaveLength(0);
});

test("rejects image bodies above ten MiB", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const bytes = Buffer.alloc(10 * 1024 * 1024 + 1);
  // When
  const error = await failure(fixture.ai.upload(session.actor, { projectId: project.id, mime: "image/png", dataBase64: bytes.toString("base64") }));
  // Then
  expect(error.code).toBe("AI_IMAGE_INVALID");
  expect(provider.received).toHaveLength(0);
});

test("keeps image uploads isolated to their session", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); const other = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const image = await fixture.ai.upload(session.actor, { projectId: project.id, mime: "image/png", dataBase64: png });
  // When
  const error = await failure(fixture.ai.create(other.actor, { key: crypto.randomUUID(), request: {
    scope: { projectId: project.id, branch: project.defaultBranch }, mode: "ask", tool: "table-image",
    prompt: "Transcribe", fileIds: [], imageUploadIds: [image.id],
  } }));
  // Then
  expect(error.code).toBe("AI_IMAGE_NOT_FOUND");
  expect(provider.received).toHaveLength(0);
});
