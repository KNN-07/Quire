import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "@quire/runtime";
import type { RealtimeSocketData } from "@quire/runtime";
import type { AdapterDeployment } from "../../../services/adapters";
import { createApplication } from "../../../apps/server/src/composition";
import { seed } from "../../../scripts/seed";
import { startEditorWeb } from "../shared/web-server";

/** Full application composition; only the external provider uses an owned loopback origin. */
export async function startAssemblyApplication(adapters: AdapterDeployment) {
  const resources = new AsyncDisposableStack();
  try {
    const dataDir = await mkdtemp(join(tmpdir(), "quire-assembly-"));
    resources.defer(() => rm(dataDir, { recursive: true, force: true }));
    const ready = Promise.withResolvers<Awaited<ReturnType<typeof createApplication>>>();
    const api = Bun.serve<RealtimeSocketData>({
      hostname: "127.0.0.1", port: 0,
      fetch: async (request, server) => (await ready.promise).handle(request, server),
      websocket: {
        async open(socket) { await (await ready.promise).websocket.open?.(socket); },
        async message(socket, message) { await (await ready.promise).websocket.message(socket, message); },
        async close(socket, code, reason) { await (await ready.promise).websocket.close?.(socket, code, reason); },
        async drain(socket) { await (await ready.promise).websocket.drain?.(socket); },
      },
    });
    resources.defer(async () => { await api.stop(true); });
    const web = await startEditorWeb(resolve("apps/web"), join(dataDir, "vite"), api.url.origin);
    resources.defer(() => web.close());
    const application = await createApplication({
      config: loadConfig({ QUIRE_DATA_DIR: dataDir, QUIRE_PUBLIC_URL: web.url.origin }), adapters,
    });
    resources.defer(() => application.close());
    ready.resolve(application);
    const password = `assembly-${crypto.randomUUID()}`;
    await seed(application.runtime, password);
    await application.start();
    console.info("ASSEMBLY_INTEGRATION_OWNED", { root: dataDir, web: web.url.origin, api: api.url.origin });
    const owned = resources.move();
    return { application, url: web.url, apiUrl: api.url, dataDir, password,
      async [Symbol.asyncDispose]() {
        await owned.disposeAsync();
        console.info("ASSEMBLY_INTEGRATION_CLOSED", { root: dataDir, web: web.url.origin, api: api.url.origin });
      },
    };
  } finally { await resources.disposeAsync(); }
}
