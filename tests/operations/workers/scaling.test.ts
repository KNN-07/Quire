import { test, expect } from "bun:test";
import { z } from "zod";
import { fixture, observe, spawnDetail, processBudgetMs } from "./fixture";

test("queue-driven scaling launches at most the durable maximum and scales idle processes to zero", async () => {
  // Given three durable queued jobs, no local pump, and a two-process upper bound.
  await using app = await fixture();
  await app.runtime.db.run("UPDATE o_worker_policy SET minimum=0,maximum=2 WHERE id=1");
  const jobs = await Promise.all([app.enqueue("scale-a"), app.enqueue("scale-b"), app.enqueue("scale-c")]);
  const events = new EventTarget();
  const spawned: string[] = [];
  let peak = 0;
  const onSpawn = (event: globalThis.Event) => {
    spawned.push(spawnDetail(event).id);
    peak = Math.max(peak, app.controller.processes.size);
  };
  app.controller.addEventListener("spawn", onSpawn);
  const complete = new Set<string>();
  const unsubscribe = app.runtime.events.subscribe(event => {
    if (event.topic !== "job.changed" || event.payload.status !== "succeeded") return;
    complete.add(event.payload.resourceId);
    if (complete.size === jobs.length) events.dispatchEvent(new Event("compiled"));
  });
  const compiled = observe(events, "compiled", () => undefined);
  const empty = observe(events, "empty", () => undefined);
  const onExit = () => {
    if (complete.size === jobs.length && app.controller.processes.size === 0) events.dispatchEvent(new Event("empty"));
  };
  app.controller.addEventListener("exit", onExit);
  try {
    // When the real controller consumes that queue.
    await app.controller.start();
    await compiled;
    await empty;
    // Then every job was claimed by a bounded real process and idle capacity is zero.
    const records = z.array(z.object({ worker_id: z.string(), status: z.string() })).parse(
      await app.runtime.db.all("SELECT worker_id,status FROM compile_jobs ORDER BY queue_order"));
    expect(peak).toBe(2);
    expect(spawned).toHaveLength(2);
    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(record.status).toBe("succeeded");
      expect(spawned).toContain(record.worker_id);
    }
    expect(app.controller.processes.size).toBe(0);
  } finally {
    unsubscribe();
    app.controller.removeEventListener("spawn", onSpawn);
    app.controller.removeEventListener("exit", onExit);
  }
}, processBudgetMs);
