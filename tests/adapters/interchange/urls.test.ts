import { expect, test } from "bun:test";
import { DigestSchema, IdSchema } from "@quire/contracts";
import { z } from "zod";
import { OperationSchema } from "@quire/contracts";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { fetchSource, resolveSource, UrlLinks } from "../../../services/adapters/interchange";
import { interchangeFixture, rejectionCode } from "./harness";

test("blocks local, private and cloud metadata downloads when the public client resolves URLs", async () => {
  // Given
  const http = new SafeHttpClient();
  // When / Then
  for (const url of ["http://127.0.0.1/file", "http://169.254.169.254/latest/meta-data", "http://10.0.0.1/file", "http://[::1]/file"]) {
    expect(await rejectionCode(fetchSource(http, url))).toBe("EGRESS_ADDRESS_DENIED");
  }
});

test("rejects Drive login landing pages when a URL is not a direct download", async () => {
  // Given
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: () => new Response("<!doctype html><html>Sign in</html>", { headers: { "content-type": "text/html" } }),
  });
  const http = new SafeHttpClient({ fixtureOrigins: [server.url.origin] });
  try {
    // When / Then
    expect(await rejectionCode(fetchSource(http, `${server.url}drive`))).toBe("IMPORT_LANDING_PAGE");
  } finally { await server.stop(true); }
});

test("blocks a redirect into metadata addresses when a public download redirects", async () => {
  // Given
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: () => Response.redirect("http://169.254.169.254/latest/meta-data", 302),
  });
  const http = new SafeHttpClient({ fixtureOrigins: [server.url.origin] });
  try {
    // When / Then
    expect(await rejectionCode(fetchSource(http, server.url.href))).toBe("EGRESS_ADDRESS_DENIED");
  } finally { await server.stop(true); }
});

test("preserves binary linked bytes and detects conflicts when manually refreshing a URL", async () => {
  // Given
  let body = new Uint8Array([0, 255, 12]);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: () => new Response(body, { headers: { "content-type": "application/octet-stream" } }),
  });
  await using fixture = await interchangeFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const links = new UrlLinks(fixture.service, new SafeHttpClient({ fixtureOrigins: [server.url.origin] }));
  try {
    const first = await links.create({ actorId: owner.user.id, scope, path: "linked.bin", url: server.url.href,
      expectedVersion: (await fixture.service.getBranch(scope)).revision });
    if (!first.blob) throw new TypeError("Linked blob required");
    body = new Uint8Array([0, 128, 99, 7]);
    // When
    const refreshed = await links.refresh({ actorId: owner.user.id, scope, fileId: first.id,
      expectedDigest: first.blob, expectedVersion: (await fixture.service.getBranch(scope)).revision });
    // Then
    if (!refreshed.blob) throw new TypeError("Refreshed blob required");
    expect(await fixture.runtime.blobs.get(refreshed.blob)).toEqual(body);
    expect(refreshed.editable).toBe(false);
    expect(await rejectionCode(links.refresh({ actorId: owner.user.id, scope, fileId: first.id,
      expectedDigest: DigestSchema.parse("0".repeat(64)), expectedVersion: (await fixture.service.getBranch(scope)).revision }))).toBe("LINK_CONFLICT");
  } finally { await server.stop(true); }
});

test("requires an actor context when a staged upload ID is resolved outside the authenticated API", async () => {
  // Given
  const source = { kind: "upload", uploadId: IdSchema.parse(crypto.randomUUID()) } as const;
  // When / Then
  expect(await rejectionCode(resolveSource(new SafeHttpClient(), source))).toBe("UPLOAD_ACTOR_REQUIRED");
});

test("imports real fetched TeX when open-in carries a direct download URL", async () => {
  // Given
  const bytes = new TextEncoder().encode("\\documentclass{article}\n\\begin{document}URL fixture\\end{document}");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: () => new Response(bytes, { headers: { "content-type": "text/plain" } }),
  });
  await using fixture = await interchangeFixture({ http: new SafeHttpClient({ fixtureOrigins: [server.url.origin] }) });
  const owner = await fixture.login();
  try {
    // When
    const response = await fixture.request("/api/imports", { method: "POST",
      headers: { ...owner.headers, "idempotency-key": "url-import" },
      body: JSON.stringify({ kind: "open-in", name: "URL project", source: { kind: "url", url: server.url.href } }) });
    // Then
    expect(response.status).toBe(202);
    const operation = z.object({ data: OperationSchema }).parse(await response.json()).data;
    const [id] = z.object({ projectIds: z.array(IdSchema) }).parse(operation.result).projectIds;
    if (!id) throw new TypeError("Imported project required");
    const [main] = await fixture.service.listFiles({ projectId: id, branch: "main" });
    if (!main?.blob) throw new TypeError("Imported source blob required");
    expect(await fixture.runtime.blobs.get(main.blob)).toEqual(bytes);
  } finally { await server.stop(true); }
});

test("keeps linked bytes unchanged when the remote source becomes unavailable", async () => {
  // Given
  let available = true;
  const bytes = new Uint8Array([0, 128, 5]);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: () => available ? new Response(bytes) : new Response("removed", { status: 404 }),
  });
  await using fixture = await interchangeFixture();
  const owner = await fixture.login();
  const project = await fixture.create(owner.headers);
  const scope = { projectId: project.id, branch: "main" };
  const links = new UrlLinks(fixture.service, new SafeHttpClient({ fixtureOrigins: [server.url.origin] }));
  try {
    const file = await links.create({ actorId: owner.user.id, scope, path: "public.bin", url: server.url.href,
      expectedVersion: (await fixture.service.getBranch(scope)).revision });
    if (!file.blob) throw new TypeError("Linked blob required");
    available = false;
    // When
    const code = await rejectionCode(links.refresh({ actorId: owner.user.id, scope, fileId: file.id,
      expectedDigest: file.blob, expectedVersion: (await fixture.service.getBranch(scope)).revision }));
    // Then
    expect(code).toBe("IMPORT_HTTP_ERROR");
    expect((await fixture.service.getFile(scope, file.id)).blob).toBe(file.blob);
    expect(await fixture.runtime.blobs.get(file.blob)).toEqual(bytes);
  } finally { await server.stop(true); }
});
