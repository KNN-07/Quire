import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { isPublicAddress } from "../../../services/adapters/shared/network-policy";
import { abortable } from "../../../services/adapters/shared/cancellation";

test.each([
  JSON.stringify({ access_token: "token-\u00e9-\ud83d\ude00" }),
  new Uint8Array([0, 255, 37, 81]),
])("preserves complete DELETE request bytes at the provider boundary", async body => {
  // Given: a real receiver, including UTF-8 text and binary request bodies.
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    return Response.json({
      method: request.method, length: request.headers.get("content-length"),
      bytes: [...new Uint8Array(await request.arrayBuffer())],
    });
  } });
  try {
    const client = new SafeHttpClient({ fixtureOrigins: [server.url.origin] });
    // When: a provider revocation sends its payload with DELETE.
    const response = await client.request(server.url.href, { method: "DELETE", body });
    // Then: framing uses encoded bytes, not JavaScript string length.
    expect(JSON.parse(new TextDecoder().decode(response.bytes))).toEqual({
      method: "DELETE", length: String(Buffer.byteLength(body)), bytes: [...Buffer.from(body)],
    });
  } finally { await server.stop(true); }
});

test.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "172.16.0.1",
  "192.168.0.1", "0.0.0.0", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1", "2002:7f00:1::"])(
  "rejects prohibited literal destination %s", async (address) => {
    // Given
    const url = `http://${address.includes(":") ? `[${address}]` : address}/secret`;
    // When / Then
    expect(isPublicAddress(address)).toBe(false);
    await rejects(new SafeHttpClient().request(url), { code: "EGRESS_ADDRESS_DENIED" });
  });
test("rejects a mixed public and private DNS answer before opening a socket", async () => {
  // Given
  const client = new SafeHttpClient({ resolve: async () => [
    { address: "1.1.1.1", family: 4 }, { address: "127.0.0.1", family: 4 },
  ] });
  // When / Then
  await rejects(client.request("https://rebind.invalid/"), { code: "EGRESS_ADDRESS_DENIED" });
});
test("permits only the exact injected loopback fixture origin", async () => {
  // Given
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => Response.json({ host: request.headers.get("host") }) });
  try {
    const client = new SafeHttpClient({ fixtureOrigins: [server.url.origin] });
    // When
    const response = await client.request(server.url.href);
    // Then
    expect(JSON.parse(new TextDecoder().decode(response.bytes))).toEqual({ host: server.url.host });
    await rejects(new SafeHttpClient().request(server.url.href), { code: "EGRESS_ADDRESS_DENIED" });
  } finally { await server.stop(true); }
});
test("checks redirected IPs when a fixture redirects to cloud metadata", async () => {
  // Given
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: () => Response.redirect("http://169.254.169.254/latest/meta-data/", 302) });
  try {
    // When / Then
    await rejects(new SafeHttpClient({ fixtureOrigins: [server.url.origin] }).request(server.url.href),
      { code: "EGRESS_ADDRESS_DENIED" });
  } finally { await server.stop(true); }
});
test("stops reading when a streamed response exceeds the byte bound", async () => {
  // Given
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("x".repeat(1024)) });
  try {
    // When / Then
    await rejects(new SafeHttpClient({ fixtureOrigins: [server.url.origin], maxBytes: 32 }).request(server.url.href),
      { code: "EGRESS_TOO_LARGE" });
  } finally { await server.stop(true); }
});
test("cancels an actual request after its server observes dispatch", async () => {
  // Given
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() {
    entered.resolve(); await release.promise; return new Response("late");
  } });
  const abort = new AbortController();
  const client = new SafeHttpClient({ fixtureOrigins: [server.url.origin] });
  const pending = client.request(server.url.href, { signal: abort.signal });
  const rejected = rejects(pending, { code: "EGRESS_TIMEOUT" });
  try {
    await abortable(() => entered.promise, AbortSignal.timeout(5_000));
    // When
    abort.abort();
    // Then
    await rejected;
  } finally { release.resolve(); await server.stop(true); }
});
test("denies credential transmission when a public destination lacks HTTPS", async () => {
  // Given
  const client = new SafeHttpClient();
  // When / Then
  await rejects(client.request("http://1.1.1.1/token", {
    method: "POST", body: "client_secret=protected",
  }), { code: "EGRESS_TLS_REQUIRED" });
});
test("does not forward authorization when a redirect changes fixture origins", async () => {
  // Given
  let received = false;
  const destination = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { received = true; return new Response("unexpected"); } });
  const source = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.redirect(destination.url, 302) });
  try {
    const client = new SafeHttpClient({ fixtureOrigins: [source.url.origin, destination.url.origin] });
    // When / Then
    await rejects(client.request(source.url.href, { headers: { authorization: "Bearer protected" } }),
      { code: "EGRESS_REDIRECT_DENIED" });
    expect(received).toBe(false);
  } finally { await source.stop(true); await destination.stop(true); }
});
