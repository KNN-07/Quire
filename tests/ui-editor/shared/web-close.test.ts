import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startEditorWeb } from "./web-server";

async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new TypeError("Owned web shutdown deadline exceeded")), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

test("web fixture closes an upgraded proxy socket before waiting for listener shutdown", async () => {
  // Given: a real Node/Vite proxy and an open, bidirectional upgraded connection.
  const root = await mkdtemp(join(tmpdir(), "quire-web-close-"));
  const api = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request, server) { return server.upgrade(request) ? undefined : new Response("Upgrade required", { status: 426 }); },
    websocket: { message(socket, message) { socket.send(message); } },
  });
  const web = await startEditorWeb(resolve(import.meta.dir, "../../../apps/web"), join(root, "vite"), api.url.origin);
  const url = new URL("/api/owned-websocket", web.url);
  url.protocol = "ws:";
  const socket = new WebSocket(url);
  let closing: Promise<void> | undefined;
  try {
    await bounded(new Promise<void>((done, reject) => {
      socket.addEventListener("open", () => done(), { once: true });
      socket.addEventListener("error", () => reject(new TypeError("Proxy socket failed")), { once: true });
    }));
    const echo = new Promise<MessageEvent>(done => socket.addEventListener("message", done, { once: true }));
    socket.send("owned-proxy");
    expect((await bounded(echo)).data).toBe("owned-proxy");
    const closed = new Promise<void>(done => socket.addEventListener("close", () => done(), { once: true }));
    // When: web shutdown begins while the client and upstream remain open.
    closing = web.close();
    await bounded(Promise.all([closing, closed]));
    // Then: the owned upgraded socket is closed without requiring API shutdown first.
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  } finally {
    socket.close();
    await api.stop(true);
    await (closing ?? web.close());
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
