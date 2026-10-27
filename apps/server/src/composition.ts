import { createRuntime, loadConfig } from "@quire/runtime";
import type { RuntimeConfig, ServiceModule } from "@quire/runtime";
import type { RealtimeSocketData } from "@quire/runtime";
import type { Server, WebSocketHandler } from "bun";
import { endpoints } from "@quire/contracts";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register as governance, migrations as governanceMigrations } from "../../../services/accounts/governance";
import { register as base, migrations as baseMigrations } from "../../../services/core/base";
import { register as review, migrations as reviewMigrations, dispose as disposeReview } from "../../../services/core/review";
import { register as git, registerCredentials, migrations as gitMigrations } from "../../../services/core/git";
import { register as catalog, migrations as catalogMigrations } from "../../../services/core/catalog";
import { register as compiler, migrations as compilerMigrations, startWorker, stopWorker } from "../../../services/compiler";
import { register as overview } from "../../../services/operations/overview";

// F owns this ordered module list. Feature lanes export register(context), never edit this file.
export const modules: readonly ServiceModule[] = [
  { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
  { id: "011-a-governance", lane: "A", order: 11, register: governance, migrations: governanceMigrations },
  { id: "021-k-base", lane: "K", order: 21, register: base, migrations: baseMigrations },
  { id: "023-k-review", lane: "K", order: 23, register: review, migrations: reviewMigrations },
  { id: "024-k-catalog", lane: "K", order: 24, register: catalog, migrations: catalogMigrations },
  { id: "024-k-git", lane: "K", order: 24, register: git, migrations: gitMigrations },
  { id: "025-a-git-credentials", lane: "A", order: 25, register: registerCredentials },
  { id: "030-c-compiler", lane: "C", order: 30, register: compiler, migrations: compilerMigrations },
  { id: "040-o-overview", lane: "O", order: 40, register: overview },
];
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
    start: async () => {
      if (runtime.services.has("compiler")) await startWorker(runtime);
    },
    handle: (request: Request, server: Server<RealtimeSocketData>) => {
      if (request.headers.get("upgrade")?.toLowerCase() === "websocket" && runtime.services.has("realtime")) {
        return runtime.services.get("realtime").upgrade(request, server);
      }
      if (new URL(request.url).pathname === endpoints.events.path) server.timeout(request, 0);
      return runtime.routes.fetch(request);
    },
    close: async () => {
      if (runtime.services.has("compiler")) await stopWorker(runtime);
      disposeReview(runtime);
      runtime.close();
    },
  };
}
