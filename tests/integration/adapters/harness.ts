import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { loadConfig } from "@quire/runtime";
import { ProjectSchema, UserSchema } from "@quire/contracts";
import type { AdapterDeployment } from "../../../services/adapters";
import { createApplication } from "../../../apps/server/src/composition";
import { CoreProjects } from "../../../services/core/base";
import { seed } from "../../../scripts/seed";
import { controlledClock, fixtureOrigin, fixturePassword } from "../../adapters/shared/harness";
import { defaultPolicy } from "../../../services/accounts/identity/policy";

export async function data<T extends z.ZodType>(response: Response, schema: T): Promise<z.output<T>> {
  if (!response.ok) throw new TypeError(`HTTP ${response.status}: ${await response.text()}`);
  return schema.parse(z.object({ data: z.unknown() }).parse(await response.json()).data);
}

export async function integrationFixture(deployment: AdapterDeployment = {}) {
  const root = await mkdtemp(join(tmpdir(), "quire-p2x-integrate-"));
  const config = loadConfig({ QUIRE_DATA_DIR: root, QUIRE_PUBLIC_URL: fixtureOrigin });
  const clock = controlledClock();
  const initialize = () => createApplication({ config, clock, adapters: deployment });
  let app = await initialize().catch(async (error: unknown) => {
    await rm(root, { recursive: true, force: true }); throw error;
  });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: incoming => app.fetch(incoming) });
  async function request(path: string, input: RequestInit = {}) {
    const headers = new Headers(input.headers);
    headers.set("origin", fixtureOrigin);
    if (typeof input.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
    return fetch(new URL(path, server.url), { ...input, headers, signal: AbortSignal.timeout(20_000) });
  }
  async function login(email = "kien@quire.local") {
    const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: fixturePassword }) });
    const user = await data(response, UserSchema);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Session cookie required");
    const me = await data(await request("/api/me", { headers: { cookie } }), z.object({ csrfToken: z.string() }));
    return { user, headers: { cookie, "x-csrf-token": me.csrfToken } };
  }
  try {
    await seed(app.runtime, fixturePassword);
    return {
      root, clock, config, request, login,
      get runtime() { return app.runtime; },
      get adapters() {
        if (!app.adapters) throw new TypeError("Application adapters required");
        return app.adapters;
      },
      start: () => app.start(),
      get core() {
        const projects = app.runtime.services.get("projects");
        if (!(projects instanceof CoreProjects)) throw new TypeError("Persistent core required");
        return projects;
      },
      async configure(kind: string, settings: { readonly baseUrl: string; readonly model?: string; readonly secret?: string }) {
        const operator = await login("operator@quire.local");
        return data(await request(`/api/admin/providers/${kind}`, {
          method: "PUT", headers: { ...operator.headers, "if-match": '"0"' },
          body: JSON.stringify({ ...settings, policy: { ...defaultPolicy, ai: "agent" }, expectedVersion: 0 }),
        }), z.object({ kind: z.string(), secretPresent: z.boolean() }));
      },
      async project(session: Awaited<ReturnType<typeof login>>) {
        return data(await request("/api/projects", { method: "POST",
          headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ name: "Composed integration", origin: { kind: "blank" } }),
        }), ProjectSchema);
      },
      async restart() {
        await app.close();
        app = await initialize();
      },
      async [Symbol.asyncDispose]() {
        try { await server.stop(true); await app.close(); }
        finally { await rm(root, { recursive: true, force: true }); }
      },
    };
  } catch (error) {
    await server.stop(true); await app.close(); await rm(root, { recursive: true, force: true }); throw error;
  }
}
export type IntegrationFixture = Awaited<ReturnType<typeof integrationFixture>>;
export type Session = Awaited<ReturnType<IntegrationFixture["login"]>>;
