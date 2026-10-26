import { createRuntime, loadConfig } from "@quire/runtime";
import type { RuntimeConfig, ServiceModule } from "@quire/runtime";
import type { RealtimeSocketData } from "@quire/runtime";
import type { Server, WebSocketHandler } from "bun";
import { endpoints } from "@quire/contracts";

// F owns this ordered module list. Feature lanes export register(context), never edit this file.
export const modules: readonly ServiceModule[] = [];
export async function createApplication(options: {
  readonly config?: RuntimeConfig; readonly modules?: readonly ServiceModule[];
} = {}) {
  const runtime = await createRuntime(options.config ?? loadConfig(), { modules: options.modules ?? modules });
  runtime.routes.forLane("F").register(endpoints.health, () => {
    runtime.db.query("SELECT 1").get();
    return { status: "ok", runtime: `bun-${Bun.version}`, database: "sqlite", at: runtime.clock.now() } as const;
  });
  const websocket: WebSocketHandler<RealtimeSocketData> = {
    message: (socket, message) => runtime.services.get("realtime").handlers.message(socket, message),
    open: (socket) => runtime.services.get("realtime").handlers.open?.(socket),
    close: (socket, code, reason) => runtime.services.get("realtime").handlers.close?.(socket, code, reason),
    drain: (socket) => runtime.services.get("realtime").handlers.drain?.(socket),
    maxPayloadLength: 4 * 1024 * 1024,
  };
  return {
    runtime, websocket, fetch: (request: Request) => runtime.routes.fetch(request),
    handle: (request: Request, server: Server<RealtimeSocketData>) => {
      if (request.headers.get("upgrade")?.toLowerCase() === "websocket" && runtime.services.has("realtime")) {
        return runtime.services.get("realtime").upgrade(request, server);
      }
      return runtime.routes.fetch(request);
    },
    close: runtime.close,
  };
}
