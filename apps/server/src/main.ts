import { assertUncontrolledEntrypoint } from "../../../services/operations/installation/launch";
import type { RealtimeSocketData } from "@quire/runtime";

if (import.meta.main) {
  await assertUncontrolledEntrypoint();
  const { createApplication } = await import("./composition");
  const app = await createApplication();
  await app.start();
  const server = Bun.serve<RealtimeSocketData>({
    hostname: app.runtime.config.host, port: app.runtime.config.port,
    maxRequestBodySize: app.runtime.config.maxRequestBytes, fetch: app.handle, websocket: app.websocket,
  });
  console.info("server.listening", { url: server.url.toString() });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    // Bun 1.3.14 can retain a stale pending-WebSocket count after policy close.
    // Dispose the listener synchronously; application close drains owned jobs.
    server[Symbol.dispose]();
    server.unref();
    void app.close().then(() => process.exit(0));
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
