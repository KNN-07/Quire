import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, foundationMigrations, PreparedLifecycle, StorageError } from "@quire/runtime";
import type { Runtime, ServiceModule } from "@quire/runtime";
import { fixture, fingerprint, inspect } from "./fixture";
import { bounded } from "../portable/process";
import { fixtureIds } from "../../fixtures/foundation";

test("native preparation is read-only, defers registration-time dispatch, and disposes without activating", async () => {
  let registrations = 0;
  let deliveries = 0;
  const module: ServiceModule = {
    id: "098-f-prepared-events", lane: "F", order: 98,
    async register(context) {
      registrations++;
      context.events.subscribe(() => { deliveries++; });
      await context.events.dispatch();
    },
  };
  await using data = await fixture({ modules: [module], adapters: false });
  const source = await createRuntime(data.config, { modules: [module] });
  try {
    await source.uow.run(tx => source.events.record(tx, { topic: "policy.changed", aggregateId: fixtureIds.project,
      payload: { resourceId: fixtureIds.project, version: 1 } }));
  } finally { await source.close(); }
  registrations = 0;
  deliveries = 0;
  const before = await fingerprint(data.root);
  const prepared = await createRuntime(data.config, { startup: "prepared", modules: [module] });
  expect(prepared.state).toBe("prepared");
  expect((await prepared.check()).database).toBe("sqlite");
  expect(Reflect.has(prepared, "db")).toBe(false);
  expect(Reflect.has(prepared, "services")).toBe(false);
  expect(registrations).toBe(0);
  expect(deliveries).toBe(0);
  expect(await fingerprint(data.root)).toEqual(before);
  await Promise.all([prepared.dispose(), prepared.dispose()]);
  expect(prepared.state).toBe("disposed");
  await rejects(prepared.activate(), { code: "RUNTIME_DISPOSED" });
  expect(registrations).toBe(0);
  expect(await fingerprint(data.root)).toEqual(before);
  const activated = await createRuntime(data.config, { startup: "prepared", modules: [module] });
  const first = activated.activate();
  expect(activated.activate()).toBe(first);
  try {
    const runtime = await first;
    expect(await activated.activate()).toBe(runtime);
    expect(registrations).toBe(1);
    expect(deliveries).toBe(1);
    expect(await runtime.db.get("SELECT attempts FROM outbox")).toEqual({ attempts: 1 });
  } finally { await activated.dispose(); }
});

test("missing and changed migrations fail without migration writes or module registration", async () => {
  await using data = await fixture({ modules: [], adapters: false });
  const before = await fingerprint(data.root);
  const missing: ServiceModule = {
    id: "099-f-required", lane: "F", order: 99,
    migrations: [{ id: "099-f-required", sql: "CREATE TABLE must_not_exist(id TEXT)" }],
    register() { throw new Error("registration must not run"); },
  };
  await rejects(createRuntime(data.config, { startup: "prepared", modules: [missing] }), { code: "MIGRATION_REQUIRED" });
  const foundation = await foundationMigrations();
  await rejects(createRuntime(data.config, { startup: "prepared",
    foundation: foundation.map((migration, index) => index ? migration : { ...migration, sql: migration.sql + "\n-- changed" }),
  }), { code: "MIGRATION_CHANGED" });
  using db = inspect(data.root);
  expect(db.query("SELECT name FROM sqlite_master WHERE name='must_not_exist'").get()).toBeNull();
  expect(await fingerprint(data.root)).toEqual(before);
});

test("prepared custom factories fail closed instead of invoking eager storage", async () => {
  await using data = await fixture({ modules: [], adapters: false });
  let invoked = false;
  await rejects(createRuntime(data.config, { startup: "prepared", createAdapters: async () => {
    invoked = true;
    throw new Error("eager adapter factory must not execute");
  } }), { code: "PREPARED_ADAPTERS_REQUIRED" });
  expect(invoked).toBe(false);
});

test("prepared native activation rejects a replaced database identity", async () => {
  await using data = await fixture({ modules: [], adapters: false });
  const prepared = await createRuntime(data.config, { startup: "prepared" });
  await rename(join(data.root, "quire.sqlite"), join(data.root, "retained.sqlite"));
  await writeFile(join(data.root, "quire.sqlite"), "");
  await rejects(prepared.activate(), { code: "RUNTIME_BINDING_CHANGED" });
  expect(prepared.state).toBe("failed");
  await prepared.dispose();
});

test("dispose during actual registration waits, rejects activation, and releases owned resources once", async () => {
  await using data = await fixture({ modules: [], adapters: false });
  const entered = Promise.withResolvers<void>();
  const continueRegistration = Promise.withResolvers<void>();
  let closed = 0;
  let captured: Pick<Runtime, "db"> | undefined;
  const module: ServiceModule = {
    id: "098-f-concurrent", lane: "F", order: 98,
    async register(context) {
      captured = context;
      entered.resolve();
      await continueRegistration.promise;
    },
    async dispose(context) {
      await context.db.run("INSERT INTO operator_settings(key,value_json,updated_at) VALUES('disposed','true',?)", [context.clock.now()]);
      closed++;
    },
  };
  const prepared = await createRuntime(data.config, { startup: "prepared", modules: [module] });
  const activation = prepared.activate();
  const rejected = rejects(activation, { code: "RUNTIME_DISPOSED" });
  await bounded(entered.promise);
  const disposal = prepared.dispose();
  expect(prepared.state).toBe("disposing");
  expect(closed).toBe(0);
  continueRegistration.resolve();
  await Promise.all([rejected, disposal]);
  expect(closed).toBe(1);
  expect(prepared.state).toBe("disposed");
  if (!captured) throw new Error("Registration did not capture the real executor");
  await rejects(captured.db.get("SELECT 1"), { code: "DATABASE_CLOSED" });
  using db = inspect(data.root);
  expect(db.query("SELECT value_json FROM operator_settings WHERE key='disposed'").get()).toEqual({ value_json: "true" });
});

test("activation and cleanup errors both survive and failed lifecycle cannot restart", async () => {
  let starts = 0;
  let releases = 0;
  const lifecycle = new PreparedLifecycle(async () => {
    starts++;
    throw new StorageError("START_FAILED", "owned start");
  }, async () => {
    releases++;
    throw new StorageError("CLOSE_FAILED", "owned cleanup");
  });
  const first = lifecycle.activate();
  await rejects(first, error => error instanceof AggregateError && error.errors.length === 2);
  expect(lifecycle.activate()).toBe(first);
  await rejects(lifecycle.dispose(), { code: "CLOSE_FAILED" });
  expect(starts).toBe(1);
  expect(releases).toBe(1);
});
