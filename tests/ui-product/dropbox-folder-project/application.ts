import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "@quire/runtime";
import type { RealtimeSocketData } from "@quire/runtime";
import { createApplication } from "../../../apps/server/src/composition";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { seed } from "../../../scripts/seed";
import { startEditorWeb } from "../../ui-editor/shared/web-server";
import type { dropboxServer } from "../../adapters/dropbox/provider";

export async function folderApplication(provider: ReturnType<typeof dropboxServer>) {
  const resources = new AsyncDisposableStack();
  try {
    const dataDir = await mkdtemp(join(tmpdir(), "quire-p49-folder-"));
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
    provider.oauth.redirectTo(new URL("/api/connections/dropbox/callback", web.url).href);
    const application = await createApplication({
      config: loadConfig({ QUIRE_DATA_DIR: dataDir, QUIRE_PUBLIC_URL: web.url.origin }),
      adapters: {
        http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }),
        dropbox: { appKey: "quire-app", appFolder: "Apps/Quire", endpoints: {
          rpc: `${provider.origin}/2/`, content: `${provider.origin}/2/`,
          authorization: `${provider.origin}/authorize`, token: `${provider.origin}/token`,
        } },
        schedulerTicks: { subscribe: () => () => undefined },
      },
    });
    resources.defer(() => application.close());
    ready.resolve(application);
    const password = `folder-${crypto.randomUUID()}`;
    await seed(application.runtime, password);
    await application.start();
    const owned = resources.move();
    console.info("P49_OWNED", { root: dataDir, api: api.url.origin, web: web.url.origin, provider: provider.origin });
    return { application, dataDir, password, url: web.url, apiUrl: api.url,
      async [Symbol.asyncDispose]() {
        await owned.disposeAsync();
        console.info("P49_CLOSED", { root: dataDir, api: api.url.origin, web: web.url.origin });
      } };
  } finally { await resources.disposeAsync(); }
}
