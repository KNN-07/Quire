import { test, expect } from "bun:test";
import { z } from "zod";
import { WorkerController } from "../../../services/operations/workers";
import { fixture, fixtureIds, observe, spawnDetail, jobEvent, setupBudgetMs, processBudgetMs } from "./fixture";

test("only one durable controller can own the pool and expiry fences its predecessor", async () => {
  // Given one active authority with zero configured workers.
  await using app = await fixture();
  await app.controller.start();
  const successor = new WorkerController({ ...app.second, routes: app.second.routes.forLane("O") }, {
    coordinator: "http://127.0.0.1:1", bearer: app.bearer, environmentIds: [fixtureIds.environment],
  });
  const occupied = await successor.reconcile().then(() => null, (error: unknown) => error);
  expect(occupied).toMatchObject({ code: "WORKER_CONTROLLER_CONFLICT" });
  await app.runtime.db.run("UPDATE o_worker_controller SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=1");
  // When another controller takes the expired SQL authority.
  await successor.reconcile();
  // Then the original cannot renew over that authority and no idle workers were invented.
  const stale = await app.controller.reconcile().then(() => null, (error: unknown) => error);
  expect(stale).toMatchObject({ code: "WORKER_CONTROLLER_CONFLICT" });
  expect(z.object({ owner: z.string() }).parse(await app.runtime.db.get(
    "SELECT owner FROM o_worker_controller WHERE id=1")).owner).toBe(successor.owner);
  expect(await app.runtime.db.all("SELECT * FROM workers")).toEqual([]);
  const closed = await app.controller.close().then(() => null, (error: unknown) => error);
  if (closed !== null) expect(closed).toMatchObject({ code: "WORKER_CONTROLLER_CONFLICT" });
  await successor.close();
}, setupBudgetMs);

test("controller takeover fences a live worker heartbeat and replacement compiles through the other API", async () => {
  // Given an actual leased worker held at its immutable-source boundary.
  await using app = await fixture();
  await app.runtime.db.run("UPDATE o_worker_policy SET minimum=1,maximum=1 WHERE id=1");
  const registered = observe(app.events, "registered", () => undefined);
  await app.controller.start();
  await registered;
  const release = Promise.withResolvers<void>();
  app.gates.set("*", release.promise);
  const source = observe(app.events, "source", () => undefined);
  const job = await app.enqueue();
  await source;
  const lease = app.leases.find(item => item.jobId === job.id);
  if (!lease) throw new TypeError("Worker did not obtain an actual lease");
  const successor = new WorkerController({ ...app.second, routes: app.second.routes.forLane("O") }, {
    ...app.controller.config, coordinator: app.secondUrl,
  });
  app.trackController(successor);
  const spawned = observe(successor, "spawn", spawnDetail);
  try {
    await app.runtime.db.run("UPDATE o_worker_controller SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=1");
    // When the other API's controller takes authority over the expired lease.
    await successor.start();
    // Then the old live job cannot renew through its previously valid bearer/fence.
    const denied = await app.request(`/internal/jobs/${job.id}/heartbeat`, { method: "POST",
      headers: { authorization: `Bearer ${app.bearer}` },
      body: JSON.stringify({ attempt: lease.attempt, fencingToken: lease.fencingToken }) });
    expect(denied.status).toBe(409);
    release.resolve();
    const closed = await app.controller.close().then(() => null, (error: unknown) => error);
    if (closed !== null) expect(closed).toMatchObject({ code: "WORKER_CONTROLLER_CONFLICT" });
    const next = await spawned;
    const finished = jobEvent(app.second, true);
    const second = await app.enqueue();
    expect((await finished(second.id)).payload).toMatchObject({ resourceId: second.id, status: "succeeded" });
    expect((await app.runtime.services.get("compiler").get(fixtureIds.kien, second.id)).workerId).toBe(next.id);
  } finally {
    release.resolve();
    await successor.close();
  }
}, processBudgetMs);

test("a disabled managed pool refuses even an authenticated legacy worker claim", async () => {
  // Given an actual queued job and a durable disabled managed policy.
  await using app = await fixture();
  await app.runtime.db.run("UPDATE o_worker_policy SET minimum=0,maximum=0,managed=1 WHERE id=1");
  const job = await app.enqueue();
  // When a bearer-authenticated unmanaged role asks for work.
  const response = await app.request("/internal/workers/lease", { method: "POST",
    headers: { authorization: `Bearer ${app.bearer}` },
    body: JSON.stringify({ workerId: crypto.randomUUID(), environmentIds: [fixtureIds.environment] }) });
  // Then it cannot bypass the pool bounds; the immutable job remains queued.
  expect(response.status).toBe(200);
  expect(z.object({ data: z.object({ lease: z.null() }) }).parse(await response.json()).data.lease).toBeNull();
  expect((await app.runtime.services.get("compiler").get(fixtureIds.kien, job.id)).status).toBe("queued");
}, setupBudgetMs);
