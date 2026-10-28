import { test, expect } from "bun:test";
import { z } from "zod";
import { OperationSchema } from "@quire/contracts";
import { poolId } from "../../../services/operations/workers";
import { fixture, fixtureIds, observe, spawnDetail, operationEvent, setupBudgetMs, processBudgetMs } from "./fixture";

test("concurrent create receipts start one actual worker and do not bypass later operator revocation", async () => {
  // Given an authenticated operator and an active empty controller.
  await using app = await fixture();
  const auth = await app.login();
  await app.controller.start();
  const create = (count: number) => app.request("/api/admin/workers", {
    method: "POST", headers: { ...auth, "idempotency-key": "create-race" },
    body: JSON.stringify({ poolId, count }),
  });
  const spawned = observe(app.controller, "spawn", spawnDetail);
  const registered = observe(app.events, "registered", () => undefined);
  const completed = operationEvent(app.runtime);
  // When the same create is submitted concurrently.
  const responses = await Promise.all([create(1), create(1)]);
  // Then the durable receipt and requested capacity are shared, not doubled.
  const schema = z.object({ data: OperationSchema });
  expect(responses.map(response => response.status)).toEqual([202, 202]);
  const [first, replay] = await Promise.all(responses.map(async response => schema.parse(await response.json()).data));
  expect(first?.id).toBe(replay?.id);
  const worker = await spawned;
  await registered;
  expect((await completed).payload).toMatchObject({ resourceId: first?.id, status: "succeeded" });
  expect(app.controller.processes.size).toBe(1);
  expect(app.controller.processes.has(worker.id)).toBe(true);
  expect((await create(2)).status).toBe(409);
  await app.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [fixtureIds.operator]);
  expect((await create(1)).status).toBe(403);
}, processBudgetMs);

test("demotion after authentication but before the receipt transaction prevents policy mutation", async () => {
  // Given a real authenticated request paused after actual CSRF verification.
  await using app = await fixture();
  const auth = await app.login();
  const identity = app.runtime.services.get("identity");
  const verify = identity.verifyMutation.bind(identity);
  const events = new EventTarget();
  const authenticated = observe(events, "authenticated", () => undefined);
  const proceed = Promise.withResolvers<void>();
  identity.verifyMutation = async (request, principal) => {
    await verify(request, principal);
    events.dispatchEvent(new Event("authenticated"));
    await proceed.promise;
  };
  const response = app.request("/api/admin/workers/policy", { method: "PATCH", headers: auth,
    body: JSON.stringify({ min: 0, max: 1, timeoutSeconds: 30, sandbox: "bwrap", expectedVersion: 0 }) });
  await authenticated;
  // When authority is revoked before the locked mutation boundary.
  await app.second.db.run("UPDATE users SET operator=0 WHERE id=?", [fixtureIds.operator]);
  proceed.resolve();
  // Then the real request cannot mutate policy using its earlier principal.
  try {
    expect((await response).status).toBe(403);
    expect(z.object({ version: z.number() }).parse(await app.runtime.db.get(
      "SELECT version FROM o_worker_policy WHERE id=1")).version).toBe(0);
  } finally { identity.verifyMutation = verify; proceed.resolve(); }
}, setupBudgetMs);

test.each([
  { name: "expired fresh authentication", expected: 403, csrf: true, stale: true },
  { name: "missing CSRF", expected: 403, csrf: false, stale: false },
])("worker policy rejects $name", async ({ expected, csrf, stale }) => {
  // Given a genuine session with the selected boundary condition.
  await using app = await fixture();
  const auth = await app.login();
  if (stale) await app.runtime.db.run("UPDATE sessions SET created_at='2000-01-01T00:00:00.000Z' WHERE user_id=?", [fixtureIds.operator]);
  // When it attempts a privileged worker policy change.
  const response = await app.request("/api/admin/workers/policy", { method: "PATCH",
    headers: csrf ? auth : { cookie: auth.cookie },
    body: JSON.stringify({ min: 0, max: 1, timeoutSeconds: 30, sandbox: "bwrap", expectedVersion: 0 }) });
  // Then the boundary rejects the request.
  expect(response.status).toBe(expected);
}, setupBudgetMs);
