import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createRuntime, loadConfig } from "@quire/runtime";
import type { Runtime } from "@quire/runtime";
import { InstantSchema, UserSchema, ProjectSchema } from "@quire/contracts";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register as core, migrations as coreMigrations, CoreProjects } from "../../../services/core/base";
import { seed } from "../../../scripts/seed";
import { createAdapterModules } from "../../../services/adapters/shared";
import type { AdapterContribution, SafeHttpClient } from "../../../services/adapters/shared";

export const fixturePassword = "adapter-fixture-password-2026";
export const fixtureOrigin = "http://localhost:5173";
export const errorEnvelope = z.object({ error: z.object({ code: z.string() }) });
export function controlledClock() {
  let now = Date.parse("2026-10-27T12:00:00.000Z");
  return { now: () => InstantSchema.parse(new Date(now).toISOString()), advance: (milliseconds: number) => { now += milliseconds; } };
}
export async function adapterFixture(options: {
  readonly contributions: readonly AdapterContribution[]; readonly http?: SafeHttpClient;
}) {
  const path = await mkdtemp(join(tmpdir(), "quire-p2x-base-"));
  const clock = controlledClock();
  const config = loadConfig({ QUIRE_DATA_DIR: path, QUIRE_PUBLIC_URL: fixtureOrigin });
  const createModules = () => createAdapterModules(options);
  let adapters = createModules();
  const initialize = () => createRuntime(config, { clock, modules: [
    { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
    { id: "021-k-base", lane: "K", order: 21, register: core, migrations: coreMigrations },
    adapters.connections, adapters.providers,
  ] });
  let runtime: Runtime;
  try { runtime = await initialize(); }
  catch (error) { await adapters.close(); await rm(path, { recursive: true, force: true }); throw error; }
  try { await seed(runtime, fixturePassword); }
  catch (error) { await adapters.close(); await runtime.close(); await rm(path, { recursive: true, force: true }); throw error; }
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (incoming) => runtime.routes.fetch(incoming) });
  async function request(route: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("origin")) headers.set("origin", fixtureOrigin);
    if (typeof init.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(route, server.url), { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(10_000) });
  }
  async function login(email = "kien@quire.local") {
    const result = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: fixturePassword }) });
    const user = z.object({ data: UserSchema }).parse(await result.json()).data;
    const cookie = result.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Fixture login did not issue a session cookie");
    const profile = await request("/api/me", { headers: { cookie } });
    const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await profile.json()).data.csrfToken;
    return { user, headers: { cookie, "x-csrf-token": csrf } };
  }
  async function create(headers: HeadersInit, name = "Adapter fixture project") {
    const response = await request("/api/projects", { method: "POST",
      headers: { ...Object.fromEntries(new Headers(headers)), "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ name, origin: { kind: "blank" } }),
    });
    return z.object({ data: ProjectSchema }).parse(await response.json()).data;
  }
  return {
    path, origin: server.url.origin, clock, request, login, create, get runtime() { return runtime; },
    get service() {
      const service = runtime.services.get("projects");
      if (!(service instanceof CoreProjects)) throw new TypeError("Real core project service required");
      return service;
    },
    async restart() { await adapters.close(); await runtime.close(); adapters = createModules(); runtime = await initialize(); },
    async [Symbol.asyncDispose]() {
      await server.stop(true);
      await adapters.close();
      await runtime.close();
      await rm(path, { recursive: true, force: true });
    },
  };
}
export type AdapterFixture = Awaited<ReturnType<typeof adapterFixture>>;
export type FixtureSession = Awaited<ReturnType<AdapterFixture["login"]>>;
