import { expect, test } from "bun:test";
import { endpoints, createClient, ErrorResultSchema, resourceVersionTag } from "@quire/contracts";
import { createApplication } from "../../apps/server/src/composition";
import { ServiceError } from "@quire/runtime";
import { isolatedData } from "../fixtures/runtime";
import { fixtureIds as ids } from "../fixtures/foundation";

test("serves checked health when the typed client uses a real HTTP server", async () => {
  // Given: an isolated API listening on an ephemeral port.
  await using sandbox = await isolatedData();
  const app = await createApplication({ config: sandbox.config, modules: [] });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  const client = createClient(server.url.origin);
  try {
    // When: the registry-generated client requests health.
    const result = await client.call(endpoints.health, { params: {}, query: {}, body: undefined });
    // Then: real database-backed health passes the checked response contract.
    expect("data" in result && result.data.status).toBe("ok");
  } finally { await server.stop(true); await app.close(); }
});
test("returns 501 when authentication and realtime are unimplemented", async () => {
  // Given: a foundation application with no account or core modules.
  await using sandbox = await isolatedData();
  const app = await createApplication({ config: sandbox.config, modules: [] });
  try {
    // When: unsupported feature surfaces are invoked.
    const responses = await Promise.all([
      app.fetch(new Request("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "kien@quire.local", password: "irrelevant" }) })),
      app.fetch(new Request("http://localhost/api/projects/00000000-0000-4000-8000-000000000020/realtime?branch=main")),
    ]);
    // Then: neither credentials nor collaboration are falsely acknowledged.
    for (const response of responses) {
      expect(response.status).toBe(501);
      expect(ErrorResultSchema.parse(await response.json()).error.code).toBe("NOT_IMPLEMENTED");
    }
  } finally { await app.close(); }
});
test("injects lane registration when a real module supplies a handler", async () => {
  // Given: an F-owned health route reserved by composition.
  await using sandbox = await isolatedData();
  // When: an A module tries to register F's endpoint.
  const boot = createApplication({ config: sandbox.config, modules: [{
    id: "010-a-invalid", lane: "A", order: 10,
    register(context) { context.routes.register(endpoints.health, () => ({ status: "ok", runtime: "test", database: "sqlite", at: context.clock.now() } as const)); },
  }] });
  // Then: ownership fails at startup.
  const failure = await boot.then(() => null, (error: unknown) => error);
  expect(failure).toBeInstanceOf(ServiceError);
});
test("preserves bytes and artifact metadata when the typed client downloads content", async () => {
  // Given: a test-owned byte transport registered through the K module boundary.
  await using sandbox = await isolatedData();
  const bytes = new Uint8Array([0, 255, 128, 10]);
  const app = await createApplication({ config: sandbox.config, modules: [{
    id: "020-k-binary-fixture", lane: "K", order: 20,
    register(context) {
      context.routes.register(endpoints.fileContent, (_input, request) => {
        request.responseHeaders.set("content-type", "application/octet-stream");
        request.responseHeaders.set("x-artifact-partial", "true");
        return bytes;
      });
    },
  }] });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  try {
    // When: the same registry drives a byte download.
    const response = await createClient(server.url.origin).callWithMetadata(endpoints.fileContent, {
      params: { p: ids.project, f: ids.mainFile }, query: { branch: "main" }, body: undefined,
    });
    // Then: binary bytes are not coerced through JSON or text.
    expect("data" in response.result ? response.result.data : null).toEqual(bytes);
    expect(response.metadata.headers["x-artifact-partial"]).toBe("true");
    expect(response.metadata.headers["content-type"]).toBe("application/octet-stream");
  } finally { await server.stop(true); await app.close(); }
});
test("preserves multipart wire data when the typed client sends an upload", async () => {
  // Given: a test-owned handler that observes parsed upload input, without storing feature data.
  await using sandbox = await isolatedData();
  const seen: { readonly version: number; readonly paths: readonly string[]; readonly bytes: readonly number[] }[] = [];
  const app = await createApplication({ config: sandbox.config, modules: [{
    id: "020-k-upload-fixture", lane: "K", order: 20,
    register(context) {
      context.routes.register(endpoints.filesUpload, async (input) => {
        const bytes = await Promise.all(input.body.files.map(async (file) => [...new Uint8Array(await file.arrayBuffer())]));
        seen.push({ version: input.body.expectedVersion, paths: input.body.paths, bytes: bytes.flat() });
        return [];
      });
    },
  }] });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  try {
    const form = new FormData();
    form.set("scope", JSON.stringify({ projectId: ids.project, branch: "main" }));
    form.set("paths", JSON.stringify(["asset.bin"]));
    form.set("expectedVersion", "4");
    form.append("files", new File([new Uint8Array([0, 255])], "asset.bin"));
    // When: the typed client sends the real multipart body.
    await createClient(server.url.origin).call(endpoints.filesUpload, {
      params: { p: ids.project }, query: {}, body: form, headers: { "idempotency-key": "upload-test" },
    });
    // Then: validation normalizes metadata without turning the File into a JSON object.
    expect(seen).toEqual([{ version: 4, paths: ["asset.bin"], bytes: [0, 255] }]);
  } finally { await server.stop(true); await app.close(); }
});
test("preserves conflict details and version metadata when a service rejects stale state", async () => {
  // Given: a typed service boundary returning a structured, versioned conflict.
  await using sandbox = await isolatedData();
  const app = await createApplication({ config: sandbox.config, modules: [{
    id: "020-k-conflict-fixture", lane: "K", order: 20,
    register(context) {
      context.routes.register(endpoints.projectGet, (_input, request) => {
        request.responseHeaders.set("etag", resourceVersionTag(2));
        request.responseHeaders.set("x-last-successful-artifact-id", ids.mainFile);
        request.responseHeaders.set("x-preview-stale", "true");
        throw new ServiceError("STALE_VERSION", 409, {
          message: "The resource changed", details: { currentVersion: 2 },
        });
      });
    },
  }] });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  try {
    // When: the client requests both the checked envelope and HTTP metadata.
    const response = await createClient(server.url.origin).callWithMetadata(endpoints.projectGet, {
      params: { p: ids.project }, query: { branch: "main" }, body: undefined,
    });
    // Then: the caller can recover without inventing a DTO field or a version.
    expect(response.metadata).toMatchObject({ etag: '"v2"', expectedVersion: 2 });
    expect(response.metadata.headers["x-last-successful-artifact-id"]).toBe(ids.mainFile);
    expect(response.metadata.headers["x-preview-stale"]).toBe("true");
    expect("error" in response.result ? response.result.error : null)
      .toMatchObject({ code: "STALE_VERSION", details: { currentVersion: 2 } });
  } finally { await server.stop(true); await app.close(); }
});

test("preserves an explicit project token only on its typed HTTP request", async () => {
  await using sandbox = await isolatedData();
  const seen: { raw: string | null; parsed: string | undefined }[] = [];
  const app = await createApplication({ config: sandbox.config, modules: [{
    id: "020-k-token-fixture", lane: "K", order: 20,
    register(context) {
      context.routes.register(endpoints.filesList, (input, request) => {
        seen.push({ raw: request.request.headers.get("x-project-token"), parsed: input.headers["x-project-token"] });
        return [];
      });
    },
  }] });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  try {
    const client = createClient(server.url.origin);
    const input = { params: { p: ids.project }, query: { branch: "main" }, body: undefined };
    const result = await client.call(endpoints.filesList, { ...input, headers: { "x-project-token": "fixture-share-credential" } });
    expect("data" in result && result.data).toEqual([]);
    await client.call(endpoints.filesList, input);
    expect(seen).toEqual([
      { raw: "fixture-share-credential", parsed: "fixture-share-credential" },
      { raw: null, parsed: undefined },
    ]);
  } finally { await server.stop(true); await app.close(); }
});
