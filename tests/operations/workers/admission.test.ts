import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntime, loadConfig } from "@quire/runtime";
import { IdSchema } from "@quire/contracts";
import { managedWorkerPool, migrations, WorkerController } from "../../../services/operations/workers";

test.each([
  { name: "additive schema absent", schema: false, managed: 0, expected: false },
  { name: "unmanaged durable policy", schema: true, managed: 0, expected: false },
  { name: "managed durable policy", schema: true, managed: 1, expected: true },
])("managed-mode discovery respects $name", async ({ schema, managed, expected }) => {
  // Given an actual native store with the selected schema/policy state.
  await using resources = new AsyncDisposableStack();
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-workers-discovery-"));
  resources.defer(() => rm(root, { recursive: true, force: true }));
  const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: root }), {
    modules: schema ? [{ id: "080-o-workers", lane: "O", order: 80, migrations, register: () => undefined }] : [],
  });
  resources.defer(() => runtime.close());
  if (schema) await runtime.db.run("UPDATE o_worker_policy SET managed=? WHERE id=1", [managed]);
  // When compiler lifecycle code discovers managed mode through the SQL port.
  const result = await managedWorkerPool(runtime.db);
  // Then absence and an explicitly unmanaged policy preserve the legacy mode.
  expect(result).toBe(expected);
});

test("background controller reconciliation outlives the request admission that schedules it", async () => {
  // Given an actual SQL controller constructed outside an admitted HTTP operation.
  await using resources = new AsyncDisposableStack();
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-workers-discovery-"));
  resources.defer(() => rm(root, { recursive: true, force: true }));
  const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: root }), {
    modules: [{ id: "080-o-workers", lane: "O", order: 80, migrations, register: () => undefined }],
  });
  resources.defer(() => runtime.close());
  await runtime.db.run("UPDATE o_worker_policy SET maximum=0 WHERE id=1");
  const dispatching = Promise.withResolvers<void>();
  const releaseDispatch = Promise.withResolvers<void>();
  resources.defer(() => { releaseDispatch.resolve(); });
  const controller = new WorkerController({ ...runtime, routes: runtime.routes.forLane("O"),
    events: {
      record: runtime.events.record.bind(runtime.events), read: runtime.events.read.bind(runtime.events),
      subscribe: runtime.events.subscribe.bind(runtime.events), close: runtime.events.close.bind(runtime.events),
      dispatch: async () => {
        dispatching.resolve();
        await releaseDispatch.promise;
        await runtime.events.dispatch();
      },
    },
  }, {
    coordinator: "http://127.0.0.1:1", bearer: "0".repeat(64),
    environmentIds: [IdSchema.parse("00000000-0000-4000-8000-000000000030")],
  });
  resources.defer(() => controller.close());
  const trigger = Promise.withResolvers<void>();
  const { pending } = await runtime.admission.writer(async () => ({
    pending: trigger.promise.then(() => controller.reconcile()),
  }));
  await runtime.uow.run(tx => runtime.events.record(tx, {
    topic: "operation.changed", aggregateId: IdSchema.parse(crypto.randomUUID()),
    payload: { resourceId: IdSchema.parse(crypto.randomUUID()), status: "queued" },
  }));
  // When a subscribed continuation runs after its original request has completed.
  trigger.resolve();
  await dispatching.promise;
  const maintenance = runtime.admission.exclusive(async () => {
    expect(await managedWorkerPool(runtime.db)).toBe(true);
  });
  releaseDispatch.resolve();
  await Promise.all([pending, maintenance]);
  // Then its actual outbox writes remain admitted while maintenance waits for the whole tick.
  expect(await managedWorkerPool(runtime.db)).toBe(true);
});
