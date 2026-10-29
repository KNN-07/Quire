import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createRuntime, loadConfig, ServiceError } from "@quire/runtime";
import { AiRunSchema, ProjectSchema, UserSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register as core, migrations as coreMigrations, CoreProjects } from "../../../services/core/base";
import { register as git, migrations as gitMigrations } from "../../../services/core/git";
import { register as catalog, migrations as catalogMigrations } from "../../../services/core/catalog";
import { createAdapterModules, SafeHttpClient } from "../../../services/adapters/shared";
import { createAiModules } from "../../../services/adapters/ai";
import { createReferencesModules } from "../../../services/adapters/references";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { seed } from "../../../scripts/seed";
import { fixturePassword, fixtureOrigin, controlledClock } from "../shared/harness";
import type { CreateRun } from "../../../services/adapters/ai/model";
import { register as review, migrations as reviewMigrations, dispose as disposeReview } from "../../../services/core/review";
import { register as compiler, migrations as compilerMigrations, startWorker, stopWorker } from "../../../services/compiler";

export async function aiFixture(origin: string, options: {
  readonly visionModels?: readonly string[]; readonly termsVersion?: string; readonly review?: boolean;
  readonly compiler?: boolean;
} = {}) {
  const path = await mkdtemp(join(tmpdir(), "quire-p2x-ai-"));
  const clock = controlledClock();
  const config = loadConfig({ QUIRE_DATA_DIR: path, QUIRE_PUBLIC_URL: fixtureOrigin });
  const http = new SafeHttpClient({ fixtureOrigins: [origin], maxBytes: 16 * 1024 * 1024, timeoutMs: 60_000 });
  const factories = () => {
    const references = createReferencesModules();
    const ai = createAiModules({ http, visionModels: options.visionModels ?? ["fixture-model"], retrieval: () => references.retrieval,
      ...(options.termsVersion ? { termsVersion: options.termsVersion } : {}) });
    const shared = createAdapterModules({ http, contributions: [...references.contributions, ...ai.contributions] });
    return { references, ai, shared };
  };
  let modules = factories();
  const initialize = (assembly = modules) => createRuntime(config, { clock, modules: [
    { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
    { id: "021-k-base", lane: "K", order: 21, register: core, migrations: coreMigrations },
    { id: "023-k-git", lane: "K", order: 23, register: git, migrations: gitMigrations },
    { id: "024-k-catalog", lane: "K", order: 24, register: catalog, migrations: catalogMigrations },
    ...(options.review ? [{ id: "025-k-review", lane: "K" as const, order: 25, register: review, migrations: reviewMigrations }] : []),
    ...(options.compiler ? [{ id: "030-c-compiler", lane: "C" as const, order: 30, register: compiler, migrations: compilerMigrations }] : []),
    assembly.shared.connections, assembly.shared.providers, assembly.references.module, assembly.ai.module,
  ] });
  let runtime = await initialize();
  await seed(runtime, fixturePassword);
  if (options.compiler) await startWorker(runtime);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: incoming => runtime.routes.fetch(incoming) });
  async function request(route: string, input: RequestInit = {}) {
    const headers = new Headers(input.headers);
    headers.set("origin", fixtureOrigin);
    if (typeof input.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(route, server.url), { ...input, headers, signal: AbortSignal.timeout(10_000) });
  }
  async function login(email = "kien@quire.local") {
    const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: fixturePassword }) });
    const user = z.object({ data: UserSchema }).parse(await response.json()).data;
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Missing fixture cookie");
    const me = await request("/api/me", { headers: { cookie } });
    const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
    const principal = await runtime.services.get("identity").require(new Request("http://fixture/api/me", { headers: { cookie } }));
    return { user, actor: { id: user.id, sessionId: principal.sessionId }, headers: { cookie, "x-csrf-token": csrf } };
  }
  async function configure(limit = 50) {
    const operator = await login("operator@quire.local");
    const response = await request("/api/admin/providers/ai", { method: "PUT", headers: { ...operator.headers, "if-match": '"0"' },
      body: JSON.stringify({ baseUrl: `${origin}/v1`, model: "fixture-model", secret: "fixture-ai-key",
        policy: { ...defaultPolicy, ai: "agent", aiDailyUses: limit }, expectedVersion: 0 }) });
    if (response.status !== 200) throw new TypeError(await response.text());
  }
  async function createProject(session: Awaited<ReturnType<typeof login>>) {
    const response = await request("/api/projects", { method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ name: "AI test", origin: { kind: "blank" } }) });
    const project = z.object({ data: ProjectSchema }).parse(await response.json()).data;
    await runtime.db.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'project',?,?,?)",
      [crypto.randomUUID(), project.id, JSON.stringify({ ...defaultPolicy, ai: "agent" }), clock.now()]);
    await runtime.db.run("UPDATE organizations SET policy_json=? WHERE id IN (SELECT organization_id FROM members WHERE user_id=?)",
      [JSON.stringify({ ...defaultPolicy, ai: "agent" }), session.user.id]);
    await runtime.db.run("INSERT INTO identity_ai_consent(user_id,terms_version,accepted,updated_at) VALUES(?,'2026-10-27',1,?) ON CONFLICT(user_id) DO UPDATE SET accepted=1",
      [session.user.id, clock.now()]);
    return project;
  }
  function settled() {
    const pending = Promise.withResolvers<Id>();
    const signal = AbortSignal.timeout(10_000);
    const abort = () => { unsubscribe(); pending.reject(new TypeError("AI terminal event timeout")); };
    const unsubscribe = runtime.events.subscribe(event => {
      if (event.topic !== "operation.changed" || !["succeeded", "failed", "canceled"].includes(event.payload.status)) return;
      unsubscribe(); signal.removeEventListener("abort", abort); pending.resolve(event.aggregateId);
    });
    signal.addEventListener("abort", abort, { once: true });
    return pending.promise;
  }
  return { path, clock, request, login, configure, project: createProject, settled,
    get runtime() { return runtime; }, get ai() { return modules.ai.service; },
    get core() { const service = runtime.services.get("projects"); if (!(service instanceof CoreProjects)) throw new TypeError("Core required"); return service; },
    async run(session: Awaited<ReturnType<typeof login>>, input: CreateRun) {
      const finished = settled();
      const response = await request(`/api/projects/${input.scope.projectId}/ai/runs`, {
        method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(input) });
      if (response.status !== 202) throw new TypeError(`${response.status}: ${await response.text()}`);
      const created = z.object({ data: AiRunSchema }).parse(await response.json()).data;
      await finished;
      return (await modules.ai.service.get(session.actor, created.id)).run;
    },
    async restart() {
      if (options.compiler) await stopWorker(runtime);
      await disposeReview(runtime);
      await modules.ai.close(); await modules.references.close(); await modules.shared.close(); await runtime.close();
      modules = factories(); runtime = await initialize();
      if (options.compiler) await startWorker(runtime);
    },
    async fork() {
      const assembly = factories();
      const other = await initialize(assembly);
      return { service: assembly.ai.service, async [Symbol.asyncDispose]() {
        await disposeReview(other);
        await assembly.ai.close(); await assembly.references.close(); await assembly.shared.close(); await other.close();
      } };
    },
    async [Symbol.asyncDispose]() {
      if (options.compiler) await stopWorker(runtime);
      await disposeReview(runtime);
      await server.stop(true); await modules.ai.close(); await modules.references.close(); await modules.shared.close();
      await runtime.close(); await rm(path, { recursive: true, force: true });
    },
  };
}
export const errorSchema = z.object({ error: z.object({ code: z.string() }) });
export const runSchema = z.object({ data: AiRunSchema });
export async function failure(action: Promise<unknown>): Promise<ServiceError> {
  try { await action; }
  catch (error) { if (error instanceof ServiceError) return error; throw error; }
  throw new TypeError("Expected an actual service failure");
}
