import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { loadConfig } from "@quire/runtime";
import { createApplication } from "../../../apps/server/src/composition";
import type { AdapterDeployment } from "../../../services/adapters";
import { seed } from "../../../scripts/seed";

export async function operationsFixture(adapters?: AdapterDeployment) {
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-integrate-"));
  let app: Awaited<ReturnType<typeof createApplication>>;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => app.fetch(request) });
  const port = Number(server.url.port);
  const config = loadConfig({ QUIRE_DATA_DIR: root, QUIRE_PORT: String(port),
    QUIRE_PUBLIC_URL: server.url.origin });
  const password = "owned-operational-integration-password";
  try {
    app = await createApplication({ config, ...(adapters ? { adapters } : {}) });
  } catch (error) {
    await server.stop(true);
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("origin", config.publicUrl);
    if (init.body) headers.set("content-type", "application/json");
    return fetch(new URL(path, server.url), { ...init, headers, signal: AbortSignal.timeout(90_000) });
  };
  try {
    await seed(app.runtime, password);
  } catch (error) {
    await server.stop(true);
    await app.close();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return {
    root, config, request,
    get app() { return app; },
    async login(email = "operator@quire.local") {
      const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      const cookie = z.string().parse(response.headers.get("set-cookie")?.split(";")[0]);
      const me = z.object({ data: z.object({ csrfToken: z.string(), user: z.object({ id: z.string() }) }) })
        .parse(await (await request("/api/me", { headers: { cookie } })).json()).data;
      return { id: me.user.id, cookie, "x-csrf-token": me.csrfToken };
    },
    async reopen() { await app.close(); app = await createApplication({ config, ...(adapters ? { adapters } : {}) }); },
    async [Symbol.asyncDispose]() {
      try { await server.stop(true); await app.close(); }
      finally {
        await rm(root, { recursive: true, force: true });
        console.info("operations.cleanup", { root, port, closed: true });
      }
    },
  };
}
