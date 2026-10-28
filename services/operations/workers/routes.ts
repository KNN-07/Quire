import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { route, audit } from "./auth";
import { poolId, policy, workers, processRecord, conflict } from "./state";
import { createOperation, finishOperation } from "./operations";
import { poolEnvironments } from "./profiles";

export function register(context: ModuleContext): void {
  route(context, endpoints.workersList, async ({ input, context: bound, request }) => {
    const all = (await workers(bound.db, bound.clock.now())).filter(row => !input.query.cursor || row.id > input.query.cursor);
    const items = all.slice(0, input.query.limit);
    const versions = await bound.db.all<{ id: string; version: number }>("SELECT id,version FROM o_worker_processes");
    request.responseHeaders.set("x-worker-versions", JSON.stringify(Object.fromEntries(
      versions.filter(row => items.some(item => item.id === row.id)).map(row => [row.id, row.version]))));
    return { items, nextCursor: all.length > items.length ? items.at(-1)?.id ?? null : null };
  });
  route(context, endpoints.workerPolicyGet, async ({ context: bound, request }) => {
    const row = await policy(bound.db);
    request.responseHeaders.set("etag", `"v${row.version}"`);
    return { min: row.minimum, max: row.maximum, timeoutSeconds: row.timeout_seconds,
      sandbox: row.sandbox, version: row.version, pools: [{ id: poolId, name: "Managed compiler processes" }] };
  });
  route(context, endpoints.workerPolicy, async ({ input, principal, context: bound }) => {
    const { body } = input;
    const current = await policy(bound.db);
    conflict(current.version, body.expectedVersion);
    if (body.min > body.max || body.max > 32) throw new ServiceError("INVALID_WORKER_BOUNDS", 422, "Require 0 <= min <= max <= 32");
    if (body.max > 0) await poolEnvironments(bound, { backend: body.sandbox });
    await bound.db.run(`UPDATE o_worker_policy SET minimum=?,maximum=?,requested=?,timeout_seconds=?,sandbox=?,
      version=version+1,managed=1 WHERE id=1`, [body.min, body.max, Math.min(current.requested, body.max), body.timeoutSeconds, body.sandbox]);
    if (!body.max) await bound.db.run("UPDATE o_worker_processes SET desired='draining',version=version+1 WHERE desired='running'");
    await bound.db.run(`UPDATE o_worker_processes SET desired='draining',version=version+1
      WHERE desired='running' AND backend<>?`, [body.sandbox]);
    const superseded = await bound.db.all<{ operation_id: string }>(
      "SELECT operation_id FROM o_worker_requests WHERE target>?", [body.max]);
    for (const pending of superseded) {
      await finishOperation(bound, IdSchema.parse(pending.operation_id), "WORKER_POLICY_CHANGED");
      await bound.db.run("DELETE FROM o_worker_requests WHERE operation_id=?", [pending.operation_id]);
    }
    await audit(bound, principal.user.id, "workers.policy.updated");
    return { ok: true as const, version: current.version + 1 };
  });
  route(context, endpoints.workersCreate, async ({ input, principal, request, context: bound }) => {
    if (input.body.poolId !== poolId) throw new ServiceError("WORKER_POOL_NOT_FOUND", 404, "Pool is not configured");
    const authority = z.object({ expires_at: z.string() }).nullable().parse(
      await bound.db.get("SELECT expires_at FROM o_worker_controller WHERE id=1"));
    if (!authority || Date.parse(authority.expires_at) <= Date.parse(bound.clock.now())) {
      throw new ServiceError("WORKER_CONTROLLER_UNAVAILABLE", 503, "Start the configured worker controller");
    }
    const current = await policy(bound.db);
    const active = z.object({ count: z.number() }).parse(await bound.db.get(
      "SELECT count(*) AS count FROM o_worker_processes WHERE desired='running' AND exited_at IS NULL"));
    const target = Math.max(current.minimum, current.requested, active.count) + input.body.count;
    if (target > current.maximum) throw new ServiceError("WORKER_MAXIMUM", 409, "Creation exceeds worker maximum");
    await bound.db.run("UPDATE o_worker_policy SET requested=?,version=version+1 WHERE id=1", [target]);
    const operation = await createOperation(bound, { actor: principal.user.id, kind: "workers-create",
      key: z.string().parse(request.request.headers.get("idempotency-key")) });
    await bound.db.run("INSERT INTO o_worker_requests(operation_id,target) VALUES(?,?)", [operation.id, target]);
    await audit(bound, principal.user.id, "workers.created");
    return operation;
  });
  route(context, endpoints.workerDrain, async ({ input, principal, request, context: bound }) => {
    const row = await processRecord(bound.db, input.params.id);
    conflict(row.version, input.body.expectedVersion);
    if (row.desired !== "running") throw new ServiceError("WORKER_STATE_CONFLICT", 409, "Worker is not accepting work");
    const operation = await createOperation(bound, { actor: principal.user.id, kind: "worker-drain",
      key: z.string().parse(request.request.headers.get("idempotency-key")) });
    await bound.db.run("UPDATE o_worker_processes SET desired='draining',version=version+1,drain_operation=? WHERE id=?",
      [operation.id, row.id]);
    await bound.db.run("UPDATE workers SET state='draining' WHERE id=?", [row.id]);
    await bound.db.run("UPDATE o_worker_policy SET requested=CASE WHEN requested>0 THEN requested-1 ELSE 0 END WHERE id=1");
    await audit(bound, principal.user.id, "workers.drained");
    return operation;
  });
  route(context, endpoints.workerDelete, async ({ input, principal, context: bound }) => {
    const row = await processRecord(bound.db, input.params.id);
    conflict(row.version, input.body.expectedVersion);
    if (row.pid !== null || row.exited_at === null || await bound.db.get("SELECT job_id FROM worker_leases WHERE worker_id=?", [row.id])) {
      throw new ServiceError("WORKER_BUSY", 409, "Drain the worker and wait for its exact process exit before deletion");
    }
    await bound.db.run("UPDATE o_worker_processes SET desired='deleted',version=version+1 WHERE id=?", [row.id]);
    await bound.db.run("UPDATE workers SET state='offline',job_id=NULL WHERE id=?", [row.id]);
    await audit(bound, principal.user.id, "workers.deleted");
    return { ok: true as const, version: row.version + 1 };
  });
}
