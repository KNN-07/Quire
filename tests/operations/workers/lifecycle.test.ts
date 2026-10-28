import { test, expect } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { WorkerSchema } from "@quire/contracts";
import { fixture, fixtureIds, observe, spawnDetail, exitDetail, jobEvent, processBudgetMs } from "./fixture";

test("drain waits for active compilation, exits, replaces the process, and zero policy rejects new claims", async () => {
  // Given a real compiler process, with its first immutable source download held.
  await using app = await fixture();
  const auth = await app.login();
  const policy = (body: unknown) => app.request("/api/admin/workers/policy", {
    method: "PATCH", headers: auth, body: JSON.stringify(body),
  });
  expect((await policy({ min: 1, max: 1, timeoutSeconds: 60, sandbox: "bwrap", expectedVersion: 0 })).status).toBe(200);
  const spawned = observe(app.controller, "spawn", spawnDetail);
  const registered = observe(app.events, "registered", () => undefined);
  await app.controller.start();
  const original = await spawned;
  await registered;
  const release = Promise.withResolvers<void>();
  app.gates.set("*", release.promise);
  const source = observe(app.events, "source", () => undefined);
  const job = await app.enqueue();
  await source;
  const running = await app.runtime.services.get("compiler").get(fixtureIds.kien, job.id);
  expect(running.workerId).toBe(original.id);
  expect(app.leases.find(lease => lease.jobId === job.id)?.limits.wallSeconds).toBe(60);
  const exits = observe(app.controller, "exit", exitDetail);
  const replacement = observe(app.controller, "spawn", spawnDetail);
  const terminal = jobEvent(app.runtime, true);
  try {
    // When the operator drains while that worker owns active work.
    const drained = await app.request(`/api/admin/workers/${original.id}/drain`, { method: "POST",
      headers: { ...auth, "idempotency-key": "drain-active" }, body: JSON.stringify({ expectedVersion: 0 }) });
    expect(drained.status).toBe(202);
    await app.controller.reconcile();
    // Then no process is stopped early; the exact active job finishes before replacement.
    expect(app.controller.processes.has(original.id)).toBe(true);
    const list = await app.request("/api/admin/workers", { headers: auth });
    const listed = z.object({ data: z.object({ items: z.array(WorkerSchema) }) }).parse(await list.json());
    expect(listed.data.items.find(row => row.id === original.id)?.state).toBe("draining");
    expect((await app.request(`/api/admin/workers/${original.id}`, { method: "DELETE", headers: auth,
      body: JSON.stringify({ expectedVersion: 1 }) })).status).toBe(409);
    release.resolve();
    expect((await terminal(job.id)).payload).toMatchObject({ resourceId: job.id, status: "succeeded" });
    expect(await exits).toBe(original.id);
    const next = await replacement;
    expect(next.id).not.toBe(original.id);
    const secondTerminal = jobEvent(app.runtime, true);
    const second = await app.enqueue();
    expect((await secondTerminal(second.id)).payload).toMatchObject({ resourceId: second.id, status: "succeeded" });
    const result = await app.runtime.services.get("compiler").get(fixtureIds.kien, second.id);
    expect(result.workerId).toBe(next.id);
    const artifact = result.artifacts.find(item => item.name === "output.pdf");
    if (!artifact) throw new TypeError("Actual worker produced no PDF");
    const author = await app.login("kien@quire.local");
    const download = await app.request(`/api/artifacts/${artifact.id}/content`, { headers: author });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    await mkdir("docs/evidence/p2o-workers", { recursive: true });
    await writeFile("docs/evidence/p2o-workers/final.pdf", bytes);
    const exit = observe(app.controller, "exit", exitDetail);
    expect((await policy({ min: 0, max: 0, timeoutSeconds: 60, sandbox: "bwrap", expectedVersion: 1 })).status).toBe(200);
    await app.controller.reconcile();
    await exit;
    const queued = await app.enqueue();
    const denied = await app.request("/internal/workers/lease", { method: "POST",
      headers: { authorization: `Bearer ${app.bearer}` },
      body: JSON.stringify({ workerId: original.id, environmentIds: [fixtureIds.environment] }) });
    expect(z.object({ data: z.object({ lease: z.null() }) }).parse(await denied.json()).data.lease).toBeNull();
    expect((await app.runtime.services.get("compiler").get(fixtureIds.kien, queued.id)).status).toBe("queued");
    expect((await app.request(`/api/admin/workers/${original.id}`, { method: "DELETE", headers: auth,
      body: JSON.stringify({ expectedVersion: 2 }) })).status).toBe(200);
  } finally { release.resolve(); }
}, processBudgetMs);

test("a killed real worker is replaced without API-local compilation", async () => {
  // Given one real worker whose job has reached a subscribed source barrier.
  await using app = await fixture();
  await app.runtime.db.run("UPDATE o_worker_policy SET minimum=1,maximum=1 WHERE id=1");
  const spawned = observe(app.controller, "spawn", spawnDetail);
  const registered = observe(app.events, "registered", () => undefined);
  await app.controller.start();
  const first = await spawned;
  await registered;
  const release = Promise.withResolvers<void>();
  app.gates.set("*", release.promise);
  const source = observe(app.events, "source", () => undefined);
  const job = await app.enqueue();
  await source;
  const exit = observe(app.controller, "exit", exitDetail);
  const replacement = observe(app.controller, "spawn", spawnDetail);
  try {
    // When that exact owned process is killed.
    const kill = Bun.spawn(["/usr/bin/systemctl", "--user", "kill", "--kill-whom=main", "--signal=SIGKILL", first.unit],
      { stdout: "pipe", stderr: "pipe" });
    expect(await kill.exited).toBe(0);
    // Then its durable lease is fenced and a different real process compiles the next job.
    expect(await exit).toBe(first.id);
    release.resolve();
    const next = await replacement;
    const finished = jobEvent(app.runtime, true);
    const second = await app.enqueue();
    expect((await finished(second.id)).payload).toMatchObject({ resourceId: second.id, status: "succeeded" });
    expect((await app.runtime.services.get("compiler").get(fixtureIds.kien, job.id)).failureCode).toBe("WORKER_PROCESS_EXITED");
    expect((await app.runtime.services.get("compiler").get(fixtureIds.kien, second.id)).workerId).toBe(next.id);
  } finally { release.resolve(); }
}, processBudgetMs);
