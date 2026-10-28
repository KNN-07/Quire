import { test, expect } from "bun:test";
import { rejects } from "node:assert/strict";
import { createRuntime } from "@quire/runtime";
import { runtimeFixture } from "../../fixtures/runtime";
import { fixtureIds } from "../../fixtures/foundation";
import { bounded } from "../portable/process";

test("admits durable event follow-up after the dispatching HTTP scope has finished", async () => {
  // Given a real event listener whose asynchronous refresh outlives its request.
  await using runtime = await runtimeFixture();
  await runtime.db.exec("CREATE TABLE admission_event_probe(value TEXT)");
  const resume = Promise.withResolvers<void>();
  const completed = Promise.withResolvers<void>();
  const unsubscribe = runtime.events.subscribe(() => {
    void (async () => {
      await resume.promise;
      await runtime.db.run("INSERT INTO admission_event_probe(value) VALUES('refreshed')");
      completed.resolve();
    })().catch((error: unknown) => completed.reject(error));
  });
  try {
    await runtime.admission.writer(async () => {
      await runtime.uow.run(tx => runtime.events.record(tx, {
        topic: "tree.changed", aggregateId: fixtureIds.project, payload: { resourceId: fixtureIds.project, version: 1 },
      }));
      await runtime.events.dispatch();
    });
    // When the refresh resumes only after the request admission has expired.
    resume.resolve();
    await bounded(completed.promise);
    // Then it owns fresh admission rather than receiving ADMISSION_EXPIRED.
    expect(await runtime.db.get<{ value: string }>("SELECT value FROM admission_event_probe")).toEqual({ value: "refreshed" });
  } finally { unsubscribe(); }
});

test("queues independent scheduled work behind backup and drains it on the next backup", async () => {
  // Given a scheduler callback captured from a request that has already completed.
  await using runtime = await runtimeFixture();
  await runtime.db.exec("CREATE TABLE admission_schedule_probe(value TEXT)");
  const schedule = Promise.withResolvers<() => Promise<void>>();
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  await runtime.admission.writer(async () => {
    schedule.resolve(() => runtime.admission.background(async () => {
      entered.resolve();
      await finish.promise;
      await runtime.db.run("INSERT INTO admission_schedule_probe(value) VALUES('worker exited')");
    }));
  });
  const backupEntered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const backup = runtime.admission.exclusive(async () => { backupEntered.resolve(); await release.promise; });
  await backupEntered.promise;
  // When a fresh controller callback arrives while maintenance holds exclusion.
  const scheduled = (await schedule.promise)();
  await rejects(runtime.db.run("INSERT INTO admission_schedule_probe(value) VALUES('forbidden')"), { code: "BACKUP_MAINTENANCE" });
  release.resolve();
  await backup;
  await entered.promise;
  const nextBackup = runtime.admission.exclusive(async () => {
    expect(await runtime.db.get<{ value: string }>("SELECT value FROM admission_schedule_probe")).toEqual({ value: "worker exited" });
  });
  // Then the independent operation is not lost, and its actual completion is drained.
  finish.resolve();
  await bounded(Promise.all([scheduled, nextBackup]));
});

test("drains admitted background source work before runtime shutdown closes storage", async () => {
  // Given an admitted worker paused before its durable write.
  await using runtime = await runtimeFixture();
  await runtime.db.exec("CREATE TABLE admission_shutdown_probe(value TEXT)");
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const writer = runtime.admission.background(async () => {
    entered.resolve();
    await finish.promise;
    await runtime.db.run("INSERT INTO admission_shutdown_probe(value) VALUES('completed')");
  });
  await entered.promise;
  // When shutdown closes new admission while the worker is still active.
  const closing = runtime.close();
  await rejects(runtime.admission.writer(async () => undefined), { code: "DATABASE_CLOSED" });
  finish.resolve();
  await bounded(Promise.all([writer, closing]));
  // Then reopening the actual SQLite source observes the completed write.
  const reopened = await createRuntime(runtime.config);
  try {
    expect(await reopened.db.get<{ value: string }>("SELECT value FROM admission_shutdown_probe")).toEqual({ value: "completed" });
  } finally { await reopened.close(); }
});
