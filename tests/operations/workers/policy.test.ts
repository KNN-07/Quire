import { test, expect } from "bun:test";
import { z } from "zod";
import { OperationSchema } from "@quire/contracts";
import { poolId } from "../../../services/operations/workers";
import { fixture, fixtureIds, operationEvent, setupBudgetMs } from "./fixture";

test("policy persists across API instances and rejects stale versions, invalid bounds and unprobed backends", async () => {
  // Given two real runtime instances sharing the durable native store.
  await using app = await fixture();
  const auth = await app.login();
  const patch = (body: unknown) => app.request("/api/admin/workers/policy", {
    method: "PATCH", headers: auth, body: JSON.stringify(body),
  });
  const body = { min: 0, max: 1, timeoutSeconds: 12, sandbox: "bwrap", expectedVersion: 0 };
  // When the operator sets a bounded policy.
  const response = await patch(body);
  const read = await app.second.routes.fetch(new Request("http://localhost/api/admin/workers/policy", { headers: auth }));
  // Then the other instance reads that committed policy and unsafe edits fail.
  expect(response.status).toBe(200);
  expect(z.object({ data: z.object({ min: z.number(), max: z.number(), timeoutSeconds: z.number(), version: z.number() }) })
    .parse(await read.json()).data).toEqual({ min: 0, max: 1, timeoutSeconds: 12, version: 1 });
  expect((await patch(body)).status).toBe(409);
  expect((await patch({ ...body, expectedVersion: 1, min: 2, max: 1 })).status).toBe(422);
  expect((await patch({ ...body, expectedVersion: 1, max: 33 })).status).toBe(422);
  expect((await patch({ ...body, expectedVersion: 1, sandbox: "docker" })).status).toBe(503);
  expect((await app.request("/api/admin/workers", { method: "POST", headers: { ...auth, "idempotency-key": "missing-controller" },
    body: JSON.stringify({ poolId, count: 1 }) })).status).toBe(503);
}, setupBudgetMs);

test("reducing maximum terminates an outstanding capacity operation instead of leaving it queued forever", async () => {
  // Given durable capacity requested before any worker can register.
  await using app = await fixture();
  const auth = await app.login();
  const release = Promise.withResolvers<void>();
  app.gates.set("/internal/workers/lease", release.promise);
  await app.controller.start();
  const created = await app.request("/api/admin/workers", { method: "POST",
    headers: { ...auth, "idempotency-key": "superseded-capacity" },
    body: JSON.stringify({ poolId, count: 1 }) });
  const operation = z.object({ data: OperationSchema }).parse(await created.json()).data;
  const finished = operationEvent(app.runtime);
  try {
    // When the operator explicitly disables that requested capacity.
    const disabled = await app.request("/api/admin/workers/policy", { method: "PATCH", headers: auth,
      body: JSON.stringify({ min: 0, max: 0, timeoutSeconds: 30, sandbox: "bwrap", expectedVersion: 1 }) });
    // Then the exact operation has a durable terminal failure, not phantom readiness.
    expect(disabled.status).toBe(200);
    expect((await finished).payload).toMatchObject({ resourceId: operation.id, status: "failed" });
    const read = await app.request(`/api/operations/${operation.id}`, { headers: auth });
    expect(z.object({ data: OperationSchema }).parse(await read.json()).data.errorCode).toBe("WORKER_POLICY_CHANGED");
  } finally { release.resolve(); }
}, setupBudgetMs);

test("operator authentication is current even for a recorded idempotency receipt", async () => {
  // Given a real operator session and an ordinary member session.
  await using app = await fixture();
  const operator = await app.login();
  const member = await app.login("kien@quire.local");
  const request = () => app.request("/api/admin/workers/policy", { headers: operator });
  // When current operator authority is removed.
  await app.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [fixtureIds.operator]);
  // Then cached principals, anonymous reads, and member writes cannot authorize.
  expect((await request()).status).toBe(403);
  expect((await app.request("/api/admin/workers")).status).toBe(401);
  expect((await app.request("/api/admin/workers/policy", { method: "PATCH", headers: member,
    body: JSON.stringify({ min: 0, max: 1, timeoutSeconds: 30, sandbox: "bwrap", expectedVersion: 0 }) })).status).toBe(403);
  expect((await app.request("/internal/workers/lease", { method: "POST",
    body: JSON.stringify({ workerId: crypto.randomUUID(), environmentIds: [fixtureIds.environment] }) })).status).toBe(401);
}, setupBudgetMs);

test("zero policy disables legacy claims even before a controller has started", async () => {
  // Given a genuine operator session and no active controller authority.
  await using app = await fixture();
  const auth = await app.login();
  const disabled = await app.request("/api/admin/workers/policy", { method: "PATCH", headers: auth,
    body: JSON.stringify({ min: 0, max: 0, timeoutSeconds: 30, sandbox: "bwrap", expectedVersion: 0 }) });
  expect(disabled.status).toBe(200);
  const job = await app.enqueue();
  // When a bearer-authenticated legacy role tries to bypass the explicit operator policy.
  const response = await app.request("/internal/workers/lease", { method: "POST",
    headers: { authorization: `Bearer ${app.bearer}` },
    body: JSON.stringify({ workerId: crypto.randomUUID(), environmentIds: [fixtureIds.environment] }) });
  // Then the durable managed policy, rather than an API-local default, governs admission.
  expect(response.status).toBe(200);
  expect(z.object({ data: z.object({ lease: z.null() }) }).parse(await response.json()).data.lease).toBeNull();
  expect((await app.runtime.services.get("compiler").get(fixtureIds.kien, job.id)).status).toBe("queued");
}, setupBudgetMs);
