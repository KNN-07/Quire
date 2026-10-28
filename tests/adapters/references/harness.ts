import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createRuntime, loadConfig } from "@quire/runtime";
import type { Runtime } from "@quire/runtime";
import { UserSchema, ProjectSchema, AdapterGrantSchema } from "@quire/contracts";
import type { AdapterGrant } from "@quire/contracts";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register as core, migrations as coreMigrations, CoreProjects } from "../../../services/core/base";
import { register as catalog, migrations as catalogMigrations } from "../../../services/core/catalog";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { seed } from "../../../scripts/seed";
import { createAdapterModules, SafeHttpClient, GrantStore } from "../../../services/adapters/shared";
import { createReferencesModules } from "../../../services/adapters/references";
import { createInterchangeModule } from "../../../services/adapters/interchange";
import { controlledClock, fixturePassword, fixtureOrigin } from "../shared/harness";
import { mendeleyToken, zoteroKey } from "./provider";

export async function referencesFixture(providerOrigin: string, options: { readonly links?: boolean } = {}) {
  const path = await mkdtemp(join(tmpdir(), "quire-p2x-references-"));
  const clock = controlledClock();
  const config = loadConfig({ QUIRE_DATA_DIR: path, QUIRE_PUBLIC_URL: fixtureOrigin });
  let references = createReferencesModules();
  const createShared = () => createAdapterModules({ contributions: references.contributions,
    http: new SafeHttpClient({ fixtureOrigins: [providerOrigin] }) });
  let shared = createShared();
  const createInterchange = () => options.links ? createInterchangeModule({
    bibliographyLinks: references.links, http: new SafeHttpClient({ fixtureOrigins: [providerOrigin] }),
  }) : undefined;
  let interchange = createInterchange();
  const initialize = () => createRuntime(config, { clock, modules: [
    { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
    { id: "021-k-base", lane: "K", order: 21, register: core, migrations: coreMigrations },
    { id: "024-k-catalog", lane: "K", order: 24, register: catalog, migrations: catalogMigrations },
    shared.connections, shared.providers, references.module, ...(interchange ? [interchange.module] : []),
  ] });
  let runtime: Runtime;
  try { runtime = await initialize(); }
  catch (error) { await interchange?.close(); await references.close(); await shared.close(); await rm(path, { recursive: true, force: true }); throw error; }
  try { await seed(runtime, fixturePassword); }
  catch (error) { await interchange?.close(); await references.close(); await shared.close(); await runtime.close(); await rm(path, { recursive: true, force: true }); throw error; }
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: incoming => runtime.routes.fetch(incoming) });
  async function request(route: string, input: RequestInit = {}) {
    const headers = new Headers(input.headers);
    headers.set("origin", fixtureOrigin);
    if (typeof input.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(route, server.url), { ...input, headers, signal: AbortSignal.timeout(15_000) });
  }
  async function login(email = "kien@quire.local") {
    const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: fixturePassword }) });
    const user = z.object({ data: UserSchema }).parse(await response.json()).data;
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Session cookie required");
    const me = await request("/api/me", { headers: { cookie } });
    const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
    return { user, headers: { cookie, "x-csrf-token": csrf } };
  }
  async function configure(kind: string) {
    const operator = await login("operator@quire.local");
    const response = await request(`/api/admin/providers/${kind}`, { method: "PUT", headers: { ...operator.headers, "if-match": '"0"' },
      body: JSON.stringify({ baseUrl: providerOrigin, policy: defaultPolicy, expectedVersion: 0,
        ...(kind === "mendeley" ? { model: "registered-client", secret: "registered-client-secret" } : {}) }) });
    if (response.status !== 200) throw new TypeError(`Provider configuration failed: ${response.status} ${await response.text()}`);
  }
  return {
    path, clock, request, login, configure,
    get runtime() { return runtime; }, get references() { return references; },
    get service() {
      const service = runtime.services.get("projects");
      if (!(service instanceof CoreProjects)) throw new TypeError("Real core required");
      return service;
    },
    async connect(session: Awaited<ReturnType<typeof login>>, provider = "zotero"): Promise<AdapterGrant> {
      if (provider === "zotero") return references.connectZotero(session.user.id, { apiKey: zoteroKey, label: "Fixture account" });
      return runtime.uow.run(tx => new GrantStore({ ...runtime, routes: runtime.routes.forLane("X") }).create({
        actorId: session.user.id, provider, label: "Fixture Mendeley account", tokens: {
          accessToken: mendeleyToken, refreshToken: "fixture-refresh", tokenType: "Bearer", expiresAt: null, scopes: ["all"],
        },
      }, tx));
    },
    async action(session: Awaited<ReturnType<typeof login>>, grant: AdapterGrant,
      input: { readonly action: string; readonly projectId?: string; readonly parameters: Readonly<Record<string, unknown>>;
        readonly expectedCursor?: string | null; readonly key?: string }) {
      return request(`/api/connections/${grant.id}/actions`, { method: "POST",
        headers: { ...session.headers, "idempotency-key": input.key ?? crypto.randomUUID() },
        body: JSON.stringify({ action: input.action, parameters: input.parameters, expectedVersion: grant.version,
          expectedCursor: input.expectedCursor ?? null, ...(input.projectId ? { projectId: input.projectId } : {}) }) });
    },
    async create(session: Awaited<ReturnType<typeof login>>) {
      const response = await request("/api/projects", { method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ name: "References fixture", origin: { kind: "blank" } }) });
      return z.object({ data: ProjectSchema }).parse(await response.json()).data;
    },
    async restart() {
      await interchange?.close(); await references.close(); await shared.close(); await runtime.close();
      references = createReferencesModules(); shared = createShared(); interchange = createInterchange(); runtime = await initialize();
    },
    async [Symbol.asyncDispose]() {
      await server.stop(true); await interchange?.close(); await references.close(); await shared.close(); await runtime.close();
      await rm(path, { recursive: true, force: true });
    },
  };
}
export type ReferencesFixture = Awaited<ReturnType<typeof referencesFixture>>;
export type ReferenceSession = Awaited<ReturnType<ReferencesFixture["login"]>>;
export const grantEnvelope = z.object({ data: AdapterGrantSchema });
