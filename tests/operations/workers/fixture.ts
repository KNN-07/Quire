import { createHmac } from "node:crypto";
import { afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { IdSchema, WorkerLeaseSchema } from "@quire/contracts";
import type { Id, Event, WorkerLease } from "@quire/contracts";
import { createRuntime, loadConfig } from "@quire/runtime";
import type { Runtime, ServiceModule } from "@quire/runtime";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register as core, migrations as coreMigrations } from "../../../services/core/base";
import { register as compiler, migrations as compilerMigrations, stopWorker } from "../../../services/compiler";
import { register, migrations, WorkerController } from "../../../services/operations/workers";
import { register as environments, migrations as environmentMigrations } from "../../../services/operations/environments";
import { register as tasks } from "../../../services/operations/tasks";
import { seed } from "../../../scripts/seed";
import { fixtureIds } from "../../fixtures/foundation";
export { fixtureIds };
// The real native probe has a 180-second sandbox budget before fixture setup.
export const setupBudgetMs = 300000;
export const processBudgetMs = 900000;
const password = "owned-worker-operations-password-2026";
const observations = new Set<() => void>();
afterEach(() => {
  for (const cancel of observations) cancel();
  observations.clear();
});
const modules: readonly ServiceModule[] = [
  { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
  { id: "021-k-core", lane: "K", order: 21, register: core, migrations: coreMigrations },
  { id: "030-c-compiler", lane: "C", order: 30, register: compiler, migrations: compilerMigrations },
  { id: "042-o-tasks", lane: "O", order: 42, register: tasks },
  { id: "060-o-environments", lane: "O", order: 60, register: environments, migrations: environmentMigrations },
  { id: "080-o-workers", lane: "O", order: 80, register, migrations },
];
export function observe<T>(target: EventTarget, type: string, parse: (event: globalThis.Event) => T) {
  const result = Promise.withResolvers<T>();
  const cleanup = () => {
    clearTimeout(timeout); target.removeEventListener(type, listener); observations.delete(cleanup);
  };
  const listener = (event: globalThis.Event) => {
    cleanup();
    try { result.resolve(parse(event)); } catch (error) { result.reject(error); }
  };
  const timeout = setTimeout(() => {
    cleanup(); result.reject(new TypeError(`Timed out waiting for ${type}`));
  }, 300000);
  observations.add(cleanup);
  target.addEventListener(type, listener, { once: true });
  return result.promise;
}
export function jobEvent(runtime: Runtime, terminal: boolean) {
  const result = Promise.withResolvers<Event>();
  const seen = new Map<Id, Event>();
  let expected: Id | undefined;
  const cleanup = () => { clearTimeout(timeout); unsubscribe(); observations.delete(cleanup); };
  const timeout = setTimeout(() => { cleanup(); result.reject(new TypeError("Job event timed out")); }, 420000);
  const unsubscribe = runtime.events.subscribe(event => {
    if (event.topic !== "job.changed" || (terminal ? ["queued", "running"].includes(event.payload.status) : event.payload.status !== "running")) return;
    seen.set(event.payload.resourceId, event);
    if (event.payload.resourceId === expected) { cleanup(); result.resolve(event); }
  });
  observations.add(cleanup);
  return (id: Id) => {
    expected = id;
    const event = seen.get(id);
    if (event) { cleanup(); result.resolve(event); }
    return result.promise;
  };
}
export function operationEvent(runtime: Runtime) {
  const result = Promise.withResolvers<Event>();
  const cleanup = () => { clearTimeout(timeout); unsubscribe(); observations.delete(cleanup); };
  const timeout = setTimeout(() => { cleanup(); result.reject(new TypeError("Operation event timed out")); }, 300000);
  const unsubscribe = runtime.events.subscribe(event => {
    if (event.topic !== "operation.changed" || ["queued", "running"].includes(event.payload.status)) return;
    cleanup(); result.resolve(event);
  });
  observations.add(cleanup);
  return result.promise;
}
export async function fixture() {
  await using resources = new AsyncDisposableStack();
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-workers-"));
  resources.defer(() => rm(root, { recursive: true, force: true }));
  const config = loadConfig({ QUIRE_DATA_DIR: root });
  const runtime = await createRuntime(config, { modules });
  resources.defer(async () => { await stopWorker(runtime); await runtime.close(); });
  await seed(runtime, password);
  const events = new EventTarget();
  const gates = new Map<string, Promise<void>>();
  const leases: WorkerLease[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch: async request => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/source.zip")) {
        events.dispatchEvent(new CustomEvent("source", { detail: path }));
        await (gates.get(path) ?? gates.get("*"));
      } else await gates.get(path);
      const response = await runtime.routes.fetch(request);
      if (path === "/internal/workers/lease" && response.ok) {
        const result = z.object({ data: z.object({ lease: WorkerLeaseSchema.nullable() }) }).parse(await response.clone().json());
        if (result.data.lease) leases.push(result.data.lease);
        events.dispatchEvent(new Event("registered"));
      }
      return response;
    },
  });
  resources.defer(() => server.stop(true));
  const bearer = createHmac("sha256", runtime.secretKey).update("quire:compiler:worker:v1").digest("hex");
  const controller = new WorkerController({ ...runtime, routes: runtime.routes.forLane("O") }, {
    coordinator: String(server.url), bearer, environmentIds: [fixtureIds.environment],
  });
  const roles: { readonly id: string; readonly pid: number; readonly unit: string }[] = [];
  const exits: { readonly id: string; readonly code: number }[] = [];
  const trackController = (target: WorkerController) => {
    target.addEventListener("spawn", event => { roles.push(spawnDetail(event)); });
    target.addEventListener("exit", event => {
      if (!(event instanceof CustomEvent)) throw new TypeError("Expected owned worker exit event");
      exits.push(z.object({ id: IdSchema, code: z.number() }).parse(event.detail));
    });
  };
  trackController(controller);
  const listener = String(server.url);
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("origin", "http://localhost:5173");
    if (typeof init.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(path, server.url), { ...init, headers, signal: AbortSignal.timeout(90000) });
  };
  const login = async (email = "operator@quire.local") => {
    const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    const cookie = z.string().parse(response.headers.get("set-cookie")?.split(";")[0]);
    const me = await request("/api/me", { headers: { cookie } });
    const token = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json());
    return { cookie, "x-csrf-token": token.data.csrfToken };
  };
  const enqueue = (key: string = crypto.randomUUID()) => runtime.services.get("compiler").enqueue(fixtureIds.kien, {
    scope: { projectId: fixtureIds.project, branch: "main" }, expectedRevision: 0, clean: true,
  }, key);
  const second = await createRuntime(config, { modules });
  resources.defer(async () => { await stopWorker(second); await second.close(); });
  const secondServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: incoming => second.routes.fetch(incoming) });
  resources.defer(() => secondServer.stop(true));
  resources.defer(() => controller.close());
  const secondUrl = String(secondServer.url);
  const owned = resources.move();
  const close = async () => {
    await owned.disposeAsync();
    const first = roles[0];
    if (first) {
      await mkdir("docs/evidence/p2o-workers", { recursive: true });
      await writeFile(`docs/evidence/p2o-workers/roles-${first.id}.json`, JSON.stringify({
        runtime: Bun.version, root, listeners: [listener, secondUrl], roles, exits,
        cleanup: { controllerClosed: true, listenerClosed: true, adaptersClosed: true, rootRemoved: true },
      }, null, 2) + "\n");
    }
  };
  return { runtime, second, secondUrl, root, controller, trackController, request, login, enqueue, events, gates, bearer, leases,
    [Symbol.asyncDispose]: close };
}
export const spawnDetail = (event: globalThis.Event) => {
  if (!(event instanceof CustomEvent)) throw new TypeError("Expected worker process event");
  return z.object({ id: IdSchema, pid: z.number(), unit: z.string() }).parse(event.detail);
};
export const exitDetail = (event: globalThis.Event): Id => {
  if (!(event instanceof CustomEvent)) throw new TypeError("Expected worker process exit");
  return z.object({ id: IdSchema }).parse(event.detail).id;
};
