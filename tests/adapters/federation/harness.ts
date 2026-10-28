import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntime, loadConfig } from "@quire/runtime";
import { InstantSchema, UserSchema } from "@quire/contracts";
import type { IdentityConfig } from "@quire/contracts";
import { createIdentityModule } from "../../../services/adapters/identity";
import { createAdapterModules, SafeHttpClient } from "../../../services/adapters/shared";
import { createFederationModules, FederationConfigurations, emptyConfig } from "../../../services/adapters/federation";
import type { FederationDeployment } from "../../../services/adapters/federation";
import { register, migrations } from "../../../services/accounts/identity";
import { register as governance, migrations as governanceMigrations } from "../../../services/accounts/governance";
import { register as operations } from "../../../services/operations/tasks";
import { seed } from "../../../scripts/seed";
import { fixtureIds } from "../../fixtures/foundation";
import { providerFixture } from "./oidc-idp";

export const password = "federation-fixture-password-2026";
export async function fixture(options: FederationDeployment = {}) {
  const provider = await providerFixture();
  provider.state.now = Date.now();
  const root = await mkdtemp(join(tmpdir(), "quire-p2x-federation-"));
  const sandbox = { path: root, config: loadConfig({ QUIRE_DATA_DIR: root }),
    [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) };
  const http = new SafeHttpClient({ fixtureOrigins: [provider.origin], timeoutMs: 3000 });
  const deployment = { organizationId: fixtureIds.institution, ...options };
  const shared = createAdapterModules({ http, contributions: [] });
  const federation = createFederationModules({ ...deployment, http });
  const runtime = await createRuntime(sandbox.config, {
    clock: { now: () => InstantSchema.parse(new Date(provider.state.now).toISOString()) },
    modules: [{ id: "010-a-identity", lane: "A", order: 10, register, migrations },
      { id: "011-a-governance", lane: "A", order: 11, register: governance, migrations: governanceMigrations },
      shared.connections, shared.providers, createIdentityModule({ http, profiles: [] }),
      federation.callbacks, federation.administration,
      { id: "operation-reads", lane: "O", order: 90, register: operations }],
  });
  try { await seed(runtime, password); }
  catch (error) {
    await shared.close();
    await runtime.close();
    await provider[Symbol.asyncDispose]();
    await sandbox[Symbol.asyncDispose]();
    throw error;
  }
  const context = { ...runtime, routes: runtime.routes.forLane("A") };
  const configurations = new FederationConfigurations(context, deployment);
  const config: IdentityConfig = { ...emptyConfig, enabled: true, createOnLogin: true,
    breakGlassUserId: fixtureIds.operator, domains: ["example.test"], oidc: {
      issuer: provider.origin, clientId: "google-client", scopes: ["openid", "email", "profile"], secretPresent: true } };
  await runtime.uow.run((tx) => configurations.save(tx, { config, oidcSecret: "fixture-client-secret", ldapSecret: null }));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (incoming) => runtime.routes.fetch(incoming) });
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("origin", new URL(runtime.config.publicUrl).origin);
    if (typeof init.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
    return fetch(new URL(path, server.url), { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(10_000) });
  }
  async function login(email = "operator@quire.local") {
    const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (!response.ok) throw new TypeError(await response.text());
    const cookie = response.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
    const me = await request("/api/me", { headers: { cookie } });
    const data = z.object({ data: z.object({ user: UserSchema, csrfToken: z.string() }) }).parse(await me.json()).data;
    return { user: data.user, cookie, headers: { cookie, "x-csrf-token": data.csrfToken } };
  }
  async function begin() {
    const response = await request("/api/auth/oidc/start?returnTo=/projects");
    const location = response.headers.get("location");
    if (!location) throw new TypeError(await response.text());
    const authorization = await fetch(location, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    const callback = authorization.headers.get("location");
    if (!callback) throw new TypeError(await authorization.text());
    const url = new URL(callback);
    return { path: url.pathname + url.search,
      cookie: response.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; "), location };
  }
  async function token() {
    const operator = await login();
    const response = await request("/api/admin/scim/token", { method: "POST",
      headers: { ...operator.headers, "idempotency-key": crypto.randomUUID() }, body: "{}" });
    const result = z.object({ data: z.object({ secretOnce: z.string() }) }).parse(await response.json());
    return { authorization: `Bearer ${result.data.secretOnce}` };
  }
  return { runtime, context, configurations, provider, request, login, begin, token, deployment, http,
    [Symbol.asyncDispose]: async () => {
      await server.stop(true);
      await shared.close();
      await runtime.close();
      await provider[Symbol.asyncDispose]();
      await sandbox[Symbol.asyncDispose]();
    },
  };
}
