import { z } from "zod";
import { createRuntime, loadConfig } from "@quire/runtime";
import type { Runtime, RuntimeOptions } from "@quire/runtime";
import { ProjectSchema, UserSchema, InstantSchema } from "@quire/contracts";
import type { Policy } from "@quire/contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { register, migrations, CoreProjects } from "../../../services/core/base";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register as governance, migrations as governanceMigrations } from "../../../services/accounts/governance";
import { seed } from "../../../scripts/seed";
import { defaultPolicy } from "../../fixtures/foundation";

export const password = "core-base-test-password-2026";
export const origin = "http://localhost:5173";
export const clock = { now: () => InstantSchema.parse("2026-10-26T12:00:00.000Z") };
export const projectEnvelope = z.object({ data: ProjectSchema });
export const errorEnvelope = z.object({ error: z.object({ code: z.string() }) });
export const okEnvelope = z.object({ data: z.object({ ok: z.literal(true), version: z.number() }) });
export async function baseFixture(options: Pick<RuntimeOptions, "createAdapters"> = {}) {
  const path = await mkdtemp(join(tmpdir(), "quire-p1s-core-base-"));
  const config = loadConfig({ QUIRE_DATA_DIR: path });
  const modules = [
    { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
    { id: "011-a-governance", lane: "A", order: 11, register: governance, migrations: governanceMigrations },
    { id: "021-k-base", lane: "K", order: 21, register, migrations },
  ] as const;
  const initialize = async () => {
    const instance = await createRuntime(config, { ...options, modules, clock });
    try { await seed(instance, password); return instance; }
    catch (error) { await instance.close(); throw error; }
  };
  let runtime: Runtime;
  try { runtime = await initialize(); }
  catch (error) { await rm(path, { recursive: true, force: true }); throw error; }
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => runtime.routes.fetch(request) });
  const request = async (route: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("origin", origin);
    if (typeof init.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(route, server.url), { ...init, headers, signal: AbortSignal.timeout(10000) });
  };
  async function login(email = "kien@quire.local") {
    const result = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    const user = z.object({ data: UserSchema }).parse(await result.json()).data;
    const cookie = result.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Expected session cookie");
    const profile = await request("/api/me", { headers: { cookie } });
    const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await profile.json()).data.csrfToken;
    return { user, headers: { cookie, "x-csrf-token": csrf } };
  }
  async function create(headers: HeadersInit, name = "Core project") {
    const response = await request("/api/projects", {
      method: "POST",
      headers: { ...Object.fromEntries(new Headers(headers)), "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ name, origin: { kind: "blank" } })
    });
    return projectEnvelope.parse(await response.json()).data;
  }
  return {
    path, request, login, create,
    get runtime() { return runtime; },
    get service() {
      const port = runtime.services.get("projects");
      if (!(port instanceof CoreProjects)) throw new TypeError("Expected concrete base project service");
      return port;
    },
    async restart() { (await runtime.close()); runtime = await createRuntime(config, { ...options, modules, clock }); },
    async replica() {
      const other = await createRuntime(config, { ...options, modules, clock });
      return {
        runtime: other,
        get service() {
          const port = other.services.get("projects");
          if (!(port instanceof CoreProjects)) throw new TypeError("Expected concrete replica project service");
          return port;
        },
        async request(route: string, init: RequestInit = {}) {
          const headers = new Headers(init.headers);
          headers.set("origin", origin);
          if (typeof init.body === "string") headers.set("content-type", "application/json");
          return other.routes.fetch(new Request(new URL(route, server.url), { ...init, headers }));
        },
        async [Symbol.asyncDispose]() { await other.close(); },
      };
    },
    async setPolicy(projectId: string, patch: Partial<Policy>) {
      (await runtime.db.run("UPDATE organizations SET policy_json=?", [JSON.stringify({ ...defaultPolicy, ...patch })]));
      (await runtime.db.run(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
        VALUES(?,'project',?,?,?) ON CONFLICT(scope_kind,scope_id) DO UPDATE SET policy_json=excluded.policy_json`, [crypto.randomUUID(), projectId, JSON.stringify({ ...defaultPolicy, ...patch }), clock.now()]));
    },
    [Symbol.asyncDispose]: async () => { await server.stop(true); (await runtime.close()); await rm(path, { recursive: true, force: true }); },
  };
}
