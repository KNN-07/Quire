import { z } from "zod";
import * as Y from "yjs";
import ky from "ky";

if (import.meta.main) {
  const state = z.object({ projectId: z.uuid(), fileId: z.uuid(), source: z.string(), cookie: z.string() })
    .parse(await Bun.file("/tmp/quire-p2o-deployment-compose/compose-proof.json").json());
  const base = "http://127.0.0.1:43182";
  const http = ky.create({ prefixUrl: base, retry: 0, timeout: 10_000, headers: { cookie: state.cookie } });
  const me = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await http.get("api/me").json());
  const mode = z.enum(["sse", "websocket", "all"]).parse(process.argv[2] ?? "all");
  const enabled = {
    sse: { sse: true, websocket: false }, websocket: { sse: false, websocket: true },
    all: { sse: true, websocket: true },
  }[mode];
  if (enabled.sse) {
  const controller = new AbortController();
  const stream = await http.get("api/events?after=0", { signal: controller.signal });
  if (!stream.headers.get("content-type")?.startsWith("text/event-stream")) throw new Error("Actual SSE response is missing");
  const reader = stream.body?.getReader();
  if (!reader) throw new Error("Actual SSE response has no stream");
  let replay = "";
  try {
    const signal = AbortSignal.timeout(10_000);
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    try {
      while (!replay.includes(": ready\n\n")) {
        const result = await reader.read();
        if (result.done) throw new Error(`SSE closed before durable replay completed: ${replay.slice(-1500)}`);
        replay += new TextDecoder().decode(result.value);
      }
    } finally { signal.removeEventListener("abort", abort); }
  } finally { await reader.cancel(); reader.releaseLock(); controller.abort(); }
  console.info(JSON.stringify({ durableSseReplay: true }));
  }
  if (enabled.websocket) {
  const received = Promise.withResolvers<void>();
  const doc = new Y.Doc();
  const socket = z.instanceof(WebSocket).parse(Reflect.construct(WebSocket, [
    `ws://127.0.0.1:43182/api/projects/${state.projectId}/realtime?branch=main`,
    { protocols: ["quire", `quire.csrf.${me.data.csrfToken}`], headers: { cookie: state.cookie, origin: base } } satisfies Bun.WebSocketOptions,
  ]));
  const timeout = setTimeout(() => received.reject(new Error("Real WebSocket synchronization timed out")), 10_000);
  socket.addEventListener("error", () => received.reject(new Error("Real WebSocket upgrade failed")), { once: true });
  socket.addEventListener("open", () => socket.send(JSON.stringify({
    type: "sync", fileId: state.fileId, epoch: 0,
    stateVectorBase64: Buffer.from(Y.encodeStateVector(doc)).toString("base64"),
  })), { once: true });
  socket.addEventListener("message", event => {
    const input: unknown = JSON.parse(String(event.data));
    const update = z.object({ type: z.literal("update"), fileId: z.uuid(), updateBase64: z.string() }).safeParse(input);
    if (update.success && update.data.fileId === state.fileId) {
      Y.applyUpdate(doc, Buffer.from(update.data.updateBase64, "base64"));
      if (doc.getText("source").toJSON() === state.source) received.resolve();
      else received.reject(new Error("Deployed WebSocket source differs from persisted source"));
    }
  });
  try {
    await received.promise;
    console.info(JSON.stringify({ websocketSyncBytes: Buffer.byteLength(state.source) }));
  } finally {
    clearTimeout(timeout);
    if (socket.readyState !== WebSocket.CLOSED) {
      const closed = Promise.withResolvers<void>();
      const deadline = setTimeout(() => closed.reject(new Error("Socket close timed out")), 10_000);
      socket.addEventListener("close", () => closed.resolve(), { once: true });
      socket.close();
      try { await closed.promise; } finally { clearTimeout(deadline); }
    }
    doc.destroy();
  }
  }
}
