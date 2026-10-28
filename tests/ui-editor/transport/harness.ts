import { z } from "zod";
import { createClient, RealtimeServerMessageSchema } from "@quire/contracts";
import type { EditorDocument } from "../../../apps/web/src/features/editor/shared";
import { loadEditorWorkspace } from "../../../apps/web/src/features/editor/shared";
import { createEditorTransport } from "../../../apps/web/src/features/editor/transport";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { origin, reviewFixture } from "../../core/review/harness";

export function changed(document: EditorDocument, predicate: () => boolean): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const signal = AbortSignal.timeout(10_000);
    const abort = () => { unsubscribe(); reject(signal.reason); };
    const check = () => {
      if (!predicate()) return;
      unsubscribe(); signal.removeEventListener("abort", abort); resolve();
    };
    const unsubscribe = document.subscribe(check);
    signal.addEventListener("abort", abort, { once: true });
    check();
  });
}
export async function transportFixture() {
  const fixture = await reviewFixture();
  const sessions = new Map<string, Record<string, string>>();
  const controls: ReturnType<typeof createEditorTransport>[] = [];
  const ownedSockets = new Set<WebSocket>();
  const proxy = Bun.serve({
    hostname: "127.0.0.1", port: 0, idleTimeout: 0,
    fetch(request) {
      const url = new URL(request.url);
      const parts = url.pathname.split("/");
      const key = parts[1] ?? "";
      const headers = new Headers(request.headers);
      for (const [name, value] of Object.entries(sessions.get(key) ?? {})) headers.set(name, value);
      headers.set("origin", origin);
      const path = "/" + parts.slice(2).join("/") + url.search;
      return fixture.request(path, { method: request.method, headers, signal: request.signal });
    },
  });
  async function open(headers: Record<string, string>, shareToken?: string) {
      const key = crypto.randomUUID();
      sessions.set(key, headers);
      const client = createClient(`${proxy.url.origin}/${key}`, { csrfToken: () => headers["x-csrf-token"] ?? null });
      const workspace = await loadEditorWorkspace(client, {
        projectId: ids.project, branch: "main", page: "edit", shareToken: shareToken ?? null,
      });
      const sockets: WebSocket[] = [];
      let dropAck = false;
      const transport = createEditorTransport({ client, workspace,
        openSocket(url, protocols) {
          const target = new URL(url.pathname.split("/").slice(2).join("/") + url.search, fixture.url);
          target.protocol = "ws:";
          const socket = z.instanceof(WebSocket).parse(Reflect.construct(WebSocket, [target, {
            protocols: [...protocols], headers: { cookie: headers["cookie"] ?? "", origin },
          } satisfies Bun.WebSocketOptions]));
          socket.addEventListener("message", event => {
            const message = RealtimeServerMessageSchema.parse(JSON.parse(String(event.data)));
            if (message.type === "ack" && dropAck) {
              dropAck = false;
              event.stopImmediatePropagation();
              socket.close(1000, "Lost acknowledgement");
            }
          });
          sockets.push(socket);
          ownedSockets.add(socket);
          return socket;
        },
      });
      controls.push(transport);
      const file = workspace.files.find(entry => entry.id === ids.mainFile);
      if (!file) throw new TypeError("Missing main file");
      const document = await transport.open(file);
      await changed(document, () => document.getSnapshot().persistence.kind === "saved");
      return { transport, document, workspace, sockets, client,
        dropNextAck() { dropAck = true; } };
  }
  return {
    fixture,
    async user(email = "kien@quire.local", shareToken?: string) {
      const login = await fixture.login(email);
      return { ...await open(login.headers, shareToken), login };
    },
    anonymous: (shareToken: string) => open({}, shareToken),
    async [Symbol.asyncDispose]() {
      await Promise.all(controls.map(control => control.dispose()));
      const closed = [...ownedSockets].every(socket => socket.readyState === WebSocket.CLOSED);
      proxy[Symbol.dispose](); proxy.unref();
      await fixture[Symbol.asyncDispose]();
      if (!closed) throw new TypeError("Transport teardown left an owned socket open");
      console.info("P2U_TRANSPORT_SOCKETS_CLOSED", ownedSockets.size);
    },
  };
}
