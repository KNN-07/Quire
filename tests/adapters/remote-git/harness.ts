import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { AdapterGrantSchema, ProjectSchema, UserSchema } from "@quire/contracts";
import { createRuntime, loadConfig } from "@quire/runtime";
import type { Runtime } from "@quire/runtime";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import {
  register as core,
  migrations as coreMigrations,
  CoreProjects,
} from "../../../services/core/base";
import { register as git, migrations as gitMigrations } from "../../../services/core/git";
import { createAdapterModules, SafeHttpClient } from "../../../services/adapters/shared";
import { createRemoteGitIntegration } from "../../../services/adapters/remote-git";
import { createInterchangeModule } from "../../../services/adapters/interchange";
import { seed } from "../../../scripts/seed";

const password = "remote-git-fixture-password-2026";
const publicOrigin = "http://localhost:5173";

export async function remoteGitHarness(providerOrigin: string, options: {
  readonly standaloneImport?: boolean;
  readonly interchange?: boolean;
} = {}) {
  const path = await mkdtemp(join(tmpdir(), "quire-remote-git-test-"));
  const config = loadConfig({ QUIRE_DATA_DIR: path, QUIRE_PUBLIC_URL: publicOrigin });
  const createModules = () => {
    const remote = createRemoteGitIntegration({
      fixtureOrigins: [providerOrigin],
      registerImportRoute: options.standaloneImport ?? !options.interchange,
    });
    const shared = createAdapterModules({
      contributions: remote.contributions,
      http: new SafeHttpClient({ fixtureOrigins: [providerOrigin] }),
    });
    const interchange = options.interchange ? createInterchangeModule() : null;
    return { remote, shared, interchange };
  };
  let modules = createModules();
  const initialize = () => createRuntime(config, {
    modules: [
      {
        id: "010-a-identity",
        lane: "A",
        order: 10,
        register: identity,
        migrations: identityMigrations,
      },
      {
        id: "021-k-base",
        lane: "K",
        order: 21,
        register: core,
        migrations: coreMigrations,
      },
      {
        id: "022-k-git",
        lane: "K",
        order: 22,
        register: git,
        migrations: gitMigrations,
      },
      modules.shared.connections,
      modules.shared.providers,
      modules.remote.module,
      ...(modules.interchange ? [modules.interchange.module] : []),
    ],
  });
  let runtime: Runtime;
  try {
    runtime = await initialize();
    await seed(runtime, password);
  } catch (error) {
    await modules.interchange?.close();
    await modules.shared.close();
    await rm(path, { recursive: true, force: true });
    throw error;
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (incoming) => runtime.routes.fetch(incoming),
  });
  async function request(route: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("origin")) headers.set("origin", publicOrigin);
    if (typeof init.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(route, server.url), {
      ...init,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
  }
  async function login(email = "kien@quire.local") {
    const response = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const user = z.object({ data: UserSchema }).parse(await response.json()).data;
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Remote Git fixture login did not issue a cookie");
    const profile = await request("/api/me", { headers: { cookie } });
    const csrf = z.object({
      data: z.object({ csrfToken: z.string() }),
    }).parse(await profile.json()).data.csrfToken;
    return { user, headers: { cookie, "x-csrf-token": csrf } };
  }
  async function configure(provider: "github" | "gitlab" | "git" = "github") {
    const operator = await login("operator@quire.local");
    const response = await request(`/api/admin/providers/${provider}`, {
      method: "PUT",
      headers: { ...operator.headers, "if-match": '"0"' },
      body: JSON.stringify({
        baseUrl: providerOrigin,
        model: `remote-git-${provider}-client`,
        secret: `remote-git-${provider}-secret`,
        policy: defaultPolicy,
        expectedVersion: 0,
      }),
    });
    if (response.status !== 200) throw new TypeError(`${provider} fixture configuration failed: ${response.status}`);
    return operator;
  }
  async function connect(
    session: Awaited<ReturnType<typeof login>>,
    provider: "github" | "gitlab" = "github",
  ) {
    const started = await request(`/api/connections/${provider}/start`, {
      method: "POST",
      headers: session.headers,
      body: JSON.stringify({ returnTo: "/settings/integrations" }),
    });
    const url = z.object({ data: z.object({ url: z.url() }) }).parse(await started.json()).data.url;
    const authorization = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const location = authorization.headers.get("location");
    if (!location) throw new TypeError("GitHub fixture authorization did not redirect");
    const callback = new URL(location);
    const completed = await request(`${callback.pathname}${callback.search}`, {
      headers: session.headers,
    });
    if (completed.status !== 303) {
      throw new TypeError(`GitHub fixture callback failed: ${completed.status}`);
    }
    const listed = await request("/api/connections?limit=50", { headers: session.headers });
    const grants = z.object({
      data: z.object({ items: z.array(AdapterGrantSchema) }),
    }).parse(await listed.json()).data.items;
    const grant = grants.find((item) => item.provider === provider);
    if (!grant) throw new TypeError(`${provider} fixture grant was not saved`);
    return grant;
  }
  async function createProject(session: Awaited<ReturnType<typeof login>>, name: string) {
    const response = await request("/api/projects", {
      method: "POST",
      headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ name, origin: { kind: "blank" } }),
    });
    return z.object({ data: ProjectSchema }).parse(await response.json()).data;
  }
  return {
    path,
    request,
    login,
    configure,
    connect,
    createProject,
    get runtime() { return runtime; },
    get projects() {
      const service = runtime.services.get("projects");
      if (!(service instanceof CoreProjects)) throw new TypeError("Real core project service required");
      return service;
    },
    async restart() {
      await modules.interchange?.close();
      await modules.shared.close();
      await runtime.close();
      modules = createModules();
      runtime = await initialize();
    },
    async [Symbol.asyncDispose]() {
      await server.stop(true);
      await modules.interchange?.close();
      await modules.shared.close();
      await runtime.close();
      await rm(path, { recursive: true, force: true });
    },
  };
}
