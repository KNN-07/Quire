import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@quire/runtime";
import type { RealtimeSocketData } from "@quire/runtime";
import { createApplication } from "../../../apps/server/src/composition";
import { seed } from "../../../scripts/seed";
import { startEditorWeb } from "./web-server";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export type EditorApplication = Awaited<ReturnType<typeof startEditorApplication>>;

/** Real native services and seed, unique storage, two OS-assigned loopback ports. */
export async function startEditorApplication() {
  const resources = new AsyncDisposableStack();
  try {
    const dataDir = await mkdtemp(join(tmpdir(), "quire-ui-editor-"));
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
    const web = await startEditorWeb(join(repository, "apps/web"), join(dataDir, "vite"), api.url.origin);
    resources.defer(() => web.close());
    const url = web.url;
    const application = await createApplication({
      config: loadConfig({ QUIRE_DATA_DIR: dataDir, QUIRE_PUBLIC_URL: url.origin }),
    });
    resources.defer(() => application.close());
    ready.resolve(application);
    const password = `editor-${crypto.randomUUID()}`;
    await seed(application.runtime, password);
    await application.start();
    const owned = resources.move();
    return { application, url, apiUrl: api.url, dataDir, password,
      async [Symbol.asyncDispose]() { await owned.disposeAsync(); } };
  } finally {
    await resources.disposeAsync();
  }
}
