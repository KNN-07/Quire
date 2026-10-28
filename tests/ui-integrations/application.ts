import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "@quire/runtime";
import type { RealtimeSocketData } from "@quire/runtime";
import { createApplication, modules } from "../../apps/server/src/composition";
import { createApplicationAdapters } from "../../services/adapters";
import type { AdapterDeployment } from "../../services/adapters";
import { seed } from "../../scripts/seed";
import { startEditorWeb } from "../ui-editor/shared/web-server";
import { authenticateApi } from "../ui-editor/shared/api-session";

/** Canonical same-origin browser fixture with actual application and adapter modules. */
export async function connectionApplication(deployment: AdapterDeployment = {}) {
  const resources = new AsyncDisposableStack();
  try {
    const dataDir = await mkdtemp(join(tmpdir(), "quire-ui-integrations-"));
    resources.defer(() => rm(dataDir, { recursive: true, force: true }));
    const ready = Promise.withResolvers<Awaited<ReturnType<typeof createApplication>>>();
    const api = Bun.serve<RealtimeSocketData>({
      hostname: "127.0.0.1", port: 0,
      fetch: async (request, server) => {
        try {
          const response = await (await ready.promise).handle(request, server);
          if (response && response.status >= 500) console.error("CONNECTIONS_API_FAILURE", {
            path: new URL(request.url).pathname, status: response.status, body: await response.clone().text(),
          });
          return response;
        } catch (error) {
          if (error instanceof Error) console.error("CONNECTIONS_API_REJECTION", { path: new URL(request.url).pathname, error: error.stack });
          throw error;
        }
      },
      websocket: { async message(socket, message) { await (await ready.promise).websocket.message(socket, message); } },
    });
    resources.defer(async () => { await api.stop(true); });
    const web = await startEditorWeb(resolve(import.meta.dir, "../../apps/web"), join(dataDir, "vite"), api.url.origin);
    resources.defer(async () => { console.info("CONNECTIONS_WEB_CLOSE", dataDir); await web.close(); });
    const ticks = new EventTarget();
    const adapters = createApplicationAdapters({ ...deployment, schedulerTicks: deployment.schedulerTicks ?? {
      subscribe(listener) { ticks.addEventListener("tick", listener); return () => ticks.removeEventListener("tick", listener); },
    } });
    const application = await createApplication({
      config: loadConfig({ QUIRE_DATA_DIR: dataDir, QUIRE_PUBLIC_URL: web.url.origin }),
      modules: [...modules, ...adapters.modules],
    });
    console.info("CONNECTIONS_APPLICATION_CREATED", { dataDir, origin: web.url.origin });
    resources.defer(async () => { console.info("CONNECTIONS_RUNTIME_CLOSE", dataDir); await application.close(); });
    resources.defer(async () => { console.info("CONNECTIONS_ADAPTERS_CLOSE", dataDir); await adapters.close(); });
    ready.resolve(application);
    const password = `connections-${crypto.randomUUID()}`;
    await seed(application.runtime, password);
    adapters.start();
    console.info("CONNECTIONS_SEEDED", dataDir);
    const owned = resources.move();
    const base = { application, url: web.url, apiUrl: api.url, dataDir, password,
      async [Symbol.asyncDispose]() { await owned.disposeAsync(); console.info("CONNECTIONS_CLEANED", dataDir); } };
    return { ...base, async login(email = "kien@quire.local") {
      console.info("CONNECTIONS_LOGIN_START", { email, origin: web.url.origin });
      const actor = await authenticateApi(base, email);
      console.info("CONNECTIONS_LOGIN_READY", email);
      return { user: actor.user, account: actor.session,
        headers: { cookie: `${actor.cookie.name}=${actor.cookie.value}`, "x-csrf-token": actor.session.csrfToken } };
    } };
  } finally { await resources.disposeAsync(); }
}
