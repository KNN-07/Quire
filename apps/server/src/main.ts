import { createApplication } from "./composition";
import type { RealtimeSocketData } from "@quire/runtime";

if (import.meta.main) {
  const app = await createApplication();
  const server = Bun.serve<RealtimeSocketData>({
    hostname: app.runtime.config.host, port: app.runtime.config.port,
    maxRequestBodySize: app.runtime.config.maxRequestBytes, fetch: app.handle, websocket: app.websocket,
  });
  console.info("server.listening", { url: server.url.toString() });
  const close = () => { void server.stop(true).then(() => { app.close(); process.exit(0); }); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
