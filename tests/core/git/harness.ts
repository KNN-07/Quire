import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntime, loadConfig } from "@quire/runtime";
import { GitStatusSchema, OperationSchema, ProjectSchema, UserSchema } from "@quire/contracts";
import type { Id, Clock } from "@quire/contracts";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register as base, migrations as baseMigrations, CoreProjects } from "../../../services/core/base";
import { register, registerCredentials, migrations } from "../../../services/core/git";
import { seed } from "../../../scripts/seed";
import { register as compiler, migrations as compilerMigrations, startWorker, stopWorker } from "../../../services/compiler";
import { clock, origin, password } from "../base/harness";

export const statusEnvelope = z.object({ data: GitStatusSchema });
export const operationEnvelope = z.object({ data: OperationSchema });
export async function gitFixture(options: { readonly compiler?: boolean; readonly clock?: Clock } = {}) {
  const path = await mkdtemp(join(tmpdir(), "quire-git-test-"));
  const config = loadConfig({ QUIRE_DATA_DIR: path });
  const modules = [
    { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
    { id: "021-k-base", lane: "K", order: 21, register: base, migrations: baseMigrations },
    { id: "024-k-git", lane: "K", order: 24, register, migrations },
    { id: "025-a-git-credentials", lane: "A", order: 25, register: registerCredentials },
    ...(options.compiler ? [{ id: "030-c-compiler", lane: "C" as const, order: 30, register: compiler, migrations: compilerMigrations }] : []),
  ] as const;
  let runtime = await createRuntime(config, { modules, clock: options.clock ?? clock });
  await seed(runtime, password);
  if (options.compiler) await startWorker(runtime);
  const failures: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async incoming => {
    const response = await runtime.routes.fetch(incoming);
    if (!response.ok) failures.push(`${incoming.method} ${new URL(incoming.url).pathname}: ${response.status} ${await response.clone().text()}`);
    return response;
  } });
  async function request(route: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("origin", origin);
    if (typeof init.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(route, server.url), { ...init, headers, signal: AbortSignal.timeout(15000) });
  }
  async function login(email = "kien@quire.local") {
    const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    const user = z.object({ data: UserSchema }).parse(await response.json()).data;
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Expected login cookie");
    const me = await request("/api/me", { headers: { cookie } });
    const csrfToken = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
    return { user, headers: { cookie, "x-csrf-token": csrfToken, "idempotency-key": crypto.randomUUID() } };
  }
  function service() {
    const value = runtime.services.get("projects");
    if (!(value instanceof CoreProjects)) throw new TypeError("Expected durable projects");
    return value;
  }
  async function create(headers: HeadersInit) {
    const response = await request("/api/projects", { method: "POST", headers,
      body: JSON.stringify({ name: "Git project", origin: { kind: "blank" } }) });
    return z.object({ data: ProjectSchema }).parse(await response.json()).data;
  }
  async function status(headers: HeadersInit, projectId: Id, branch = "main") {
    const response = await request(`/api/projects/${projectId}/git/status?branch=${encodeURIComponent(branch)}`, { headers });
    const data: unknown = await response.json();
    const result = statusEnvelope.safeParse(data);
    if (!result.success) throw new TypeError(`Status ${response.status}: ${JSON.stringify(data)}`);
    return { ...result.data.data, revision: Number(response.headers.get("etag")?.replace(/\D/g, "")) };
  }
  async function token(headers: HeadersInit) {
    const response = await request("/api/me/git-tokens", { method: "POST", headers,
      body: JSON.stringify({ name: "CLI", expiresAt: "2027-01-01T00:00:00.000Z" }) });
    return z.object({ data: z.object({ id: z.string(), secretOnce: z.string() }) }).parse(await response.json()).data;
  }
  return { path, request, login, create, status, token, service, server, failures,
    get runtime() { return runtime; },
    async restart() {
      if (options.compiler) await stopWorker(runtime);
      await runtime.close(); runtime = await createRuntime(config, { modules, clock: options.clock ?? clock });
      if (options.compiler) await startWorker(runtime);
    },
    [Symbol.asyncDispose]: async () => {
      await server.stop(true);
      if (options.compiler) await stopWorker(runtime);
      await runtime.close(); await rm(path, { recursive: true, force: true });
    },
  };
}
