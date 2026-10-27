import { endpoints, resourceVersionTag, WorkerSchema } from "@quire/contracts";
import type { Worker } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";

/** Mutable protocol fixture so wrong collection/policy versions fail the UI run. */
export function workersFixture() {
  let version = 9;
  let policy = endpoints.workerPolicyGet.output.parse({
    min: 1, max: 4, timeoutSeconds: 180, sandbox: "bwrap", version: 4,
    pools: [{ id: fixtureIds.team, name: "Local compile pool" }],
  });
  let workers: readonly Worker[] = [WorkerSchema.parse({
    id: "00000000-0000-4000-8000-000000000401", poolId: fixtureIds.team,
    state: "idle", environmentIds: [fixtureIds.environment], jobId: null,
    lastHeartbeat: "2026-10-26T12:00:00Z", buildsToday: 12,
  })];
  const reply = (data: unknown, counter = version) => Response.json(
    { data, requestId: fixtureIds.operator }, { headers: { etag: resourceVersionTag(counter) } },
  );
  const failure = (message: string, status: number) => Response.json({
    error: { code: status === 409 ? "STALE_VERSION" : "INVALID_REQUEST", message },
    requestId: fixtureIds.operator,
  }, { status });
  const operation = (kind: string) => ({ id: crypto.randomUUID(), kind, status: "queued", progress: 0, result: null, errorCode: null });
  return (request: Request, url: URL, body: unknown): Response | null => {
    if (!url.pathname.startsWith("/api/admin/workers")) return null;
    if (request.method !== "GET" && request.headers.get("x-csrf-token") !== "fixture-csrf") return failure("Missing CSRF", 403);
    if (url.pathname === "/api/admin/workers/policy") {
      if (request.method === "GET") return reply(policy, policy.version);
      const input = endpoints.workerPolicy.input.parse({ params: {}, query: {}, body });
      if (input.body.expectedVersion !== policy.version) return failure("Policy changed", 409);
      if (input.body.max < input.body.min) return failure("Maximum must cover minimum", 400);
      policy = { ...policy, min: input.body.min, max: input.body.max,
        timeoutSeconds: input.body.timeoutSeconds, sandbox: input.body.sandbox, version: policy.version + 1 };
      return reply({ ok: true, version: policy.version }, policy.version);
    }
    if (url.pathname === "/api/admin/workers") {
      if (request.method === "GET") return reply({ items: workers, nextCursor: null });
      const input = endpoints.workersCreate.input.parse({ params: {}, query: {}, body });
      if (!request.headers.get("idempotency-key") || !policy.pools.some(pool => pool.id === input.body.poolId)) return failure("Invalid worker pool or missing key", 400);
      return reply(operation("workers.create"));
    }
    const workerId = url.pathname.split("/")[4];
    const worker = workers.find(item => item.id === workerId);
    if (!worker) return failure("Worker not found", 404);
    if (url.pathname.endsWith("/drain")) {
      const input = endpoints.workerDrain.input.parse({ params: { id: worker.id }, query: {}, body });
      if (input.body.expectedVersion !== version) return failure("Workers changed", 409);
      if (!request.headers.get("idempotency-key")) return failure("Missing key", 400);
      workers = workers.map(item => item.id === worker.id ? { ...item, state: "draining" as const } : item);
      version += 1;
      return reply(operation("workers.drain"));
    }
    if (request.method === "DELETE") {
      const input = endpoints.workerDelete.input.parse({ params: { id: worker.id }, query: {}, body });
      if (input.body.expectedVersion !== version) return failure("Workers changed", 409);
      workers = workers.filter(item => item.id !== worker.id);
      version += 1;
      return reply({ ok: true, version });
    }
    return failure("Unsupported worker request", 400);
  };
}
