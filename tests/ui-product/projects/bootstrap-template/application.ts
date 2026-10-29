import { join, resolve } from "node:path";
import { loadConfig } from "@quire/runtime";
import type { RealtimeSocketData } from "@quire/runtime";
import { createApplication } from "../../../../apps/server/src/composition";
import { cleanBootstrap } from "../../../core/catalog/bootstrap-template/fixture";
import { startEditorWeb } from "../../../ui-editor/shared/web-server";

/** Start native development services only after the real documented CLI bootstrap. */
export async function bootstrapApplication() {
  const resources = new AsyncDisposableStack();
  try {
    const bootstrap = resources.use(await cleanBootstrap());
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
    const web = await startEditorWeb(resolve("apps/web"), join(bootstrap.dataDir, "vite"), api.url.origin);
    resources.defer(() => web.close());
    const application = await createApplication({
      config: loadConfig({ QUIRE_DATA_DIR: bootstrap.dataDir, QUIRE_PUBLIC_URL: web.url.origin }),
    });
    resources.defer(() => application.close());
    ready.resolve(application);
    await application.start();
    const owned = resources.move();
    console.info("BOOTSTRAP_NATIVE_OWNED", { root: bootstrap.dataDir, web: web.url.origin, api: api.url.origin });
    return { application, url: web.url, apiUrl: api.url, dataDir: bootstrap.dataDir, password: bootstrap.password,
      async [Symbol.asyncDispose]() {
        await owned.disposeAsync();
        console.info("BOOTSTRAP_NATIVE_CLOSED", { web: web.url.origin, api: api.url.origin });
      } };
  } finally { await resources.disposeAsync(); }
}
