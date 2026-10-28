import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, loadConfig, ServiceError } from "@quire/runtime";
import { createApplication, modules } from "../../../apps/server/src/composition";
import { createApplicationAdapters } from "../../../services/adapters";
import { PandocConverter } from "../../../services/adapters/interchange";
import { superviseEnvironmentWork } from "../../../services/operations/environments/lifecycle";
import { bounded } from "../portable/process";
import { fixtureIds } from "../../fixtures/foundation";
import { integrationFixture } from "./harness";

test("preserves an explicitly replaced module catalog without installing external routes", async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), "quire-p2x-integrate-custom-"));
  const app = await createApplication({ config: loadConfig({ QUIRE_DATA_DIR: root }), modules: [] });
  try {
    // When
    const response = await app.fetch(new Request("http://fixture/api/connections/availability"));
    // Then
    expect(response.status).toBe(501);
    expect(app.adapters).toBeUndefined();
    expect((await app.fetch(new Request("http://fixture/api/health"))).status).toBe(200);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 90_000);

test("leaves explicitly assembled adapter start and close with the custom caller", async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), "quire-p2x-integrate-assembled-"));
  const listeners = new Set<() => void>();
  const adapters = createApplicationAdapters({ schedulerTicks: { subscribe(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  } } });
  try {
    const app = await createApplication({
      config: loadConfig({ QUIRE_DATA_DIR: root }), modules: [...modules, ...adapters.modules],
    });
    try {
      // When: host startup must not create or start another aggregate.
      await app.start();
      expect(app.adapters).toBeUndefined();
      expect(listeners.size).toBe(0);
      adapters.start();
      expect(listeners.size).toBe(3);
      // Then: custom caller retains ownership through host shutdown.
      await app.close();
      expect(listeners.size).toBe(3);
      await adapters.close();
      expect(listeners.size).toBe(0);
    } finally { await adapters.close(); await app.close(); }
  } finally { await adapters.close(); await rm(root, { recursive: true, force: true }); }
}, 90_000);

test("drains real supervised work before storage closes when module registration fails", async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), "quire-p2x-integrate-startup-"));
  const config = loadConfig({ QUIRE_DATA_DIR: root });
  const converter = new PandocConverter();
  let work: Promise<void> | undefined;
  try {
    const construction = createApplication({ config, adapters: { converter },
      modules: [...modules, {
        id: "099-f-integration-failure", lane: "F", order: 99,
        async register(context) {
          await context.db.exec("CREATE TABLE integration_startup_cleanup(value TEXT)");
          const entered = Promise.withResolvers<void>();
          work = superviseEnvironmentWork(context, signal => context.admission.background(async () => {
            const aborted = new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
            entered.resolve();
            await aborted;
            await context.db.run("INSERT INTO integration_startup_cleanup(value) VALUES('drained')");
          }));
          await entered.promise;
          throw new ServiceError("INTEGRATION_REGISTRATION_FAILURE", 500, "Injected registration failure");
        },
      }],
    });
    // When
    const failure = await bounded(construction.then(async app => { await app.close(); return null; }, error => {
      if (!(error instanceof ServiceError)) throw error;
      return error;
    }), 60_000);
    await work;
    // Then: cleanup published while its actual SQL executor was still open.
    expect(failure?.code).toBe("INTEGRATION_REGISTRATION_FAILURE");
    const reopened = await createRuntime(config);
    try {
      expect(await reopened.db.get<{ value: string }>("SELECT value FROM integration_startup_cleanup")).toEqual({ value: "drained" });
    } finally { await reopened.close(); }
    const closed = await converter.convert({ entries: [], main: "main.tex", from: "markdown", to: "latex" })
      .then(() => null, error => {
        if (!(error instanceof ServiceError)) throw error;
        return error;
      });
    expect(closed?.code).toBe("CONVERSION_CLOSED");
  } finally { await converter.close(); await rm(root, { recursive: true, force: true }); }
}, 90_000);

test("closes partial scheduler subscriptions and persistent runtime resources when application start fails", async () => {
  // Given
  const listeners = new Set<() => void>();
  let subscriptions = 0;
  await using fixture = await integrationFixture({ schedulerTicks: { subscribe(listener) {
    if (++subscriptions === 2) throw new ServiceError("INTEGRATION_START_FAILURE", 500, "Injected ticker failure");
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  } } });
  // When
  const failure = await fixture.start().then(() => null, error => {
    if (!(error instanceof ServiceError)) throw error;
    return error;
  });
  // Then
  expect(failure?.code).toBe("INTEGRATION_START_FAILURE");
  expect(listeners.size).toBe(0);
  const reopened = await createRuntime(fixture.config);
  try {
    expect(await reopened.db.get<{ id: string }>("SELECT id FROM users WHERE id=?", [fixtureIds.kien])).toEqual({ id: fixtureIds.kien });
  } finally { await reopened.close(); }
}, 90_000);

test("starts the credential-free default application with actual adapters and closes idempotently", async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), "quire-p2x-integrate-default-"));
  const app = await createApplication({ config: loadConfig({ QUIRE_DATA_DIR: root }) });
  try {
    // When
    await app.start();
    await app.close();
    await app.close();
    // Then
    expect(app.adapters).toBeDefined();
    const failure = await app.start().then(() => null, error => {
      if (!(error instanceof Error)) throw error;
      return error;
    });
    expect(failure).toMatchObject({ code: "APPLICATION_CLOSED" });
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 90_000);
