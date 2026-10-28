import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, loadConfig } from "@quire/runtime";
import { createApplication } from "../../../apps/server/src/composition";
import { startSupport } from "../../../services/operations";
import { bounded } from "../portable/process";
import { operationsFixture } from "./harness";

test("preserves replacement module semantics without adding operational routes or another adapter aggregate", async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-integrate-custom-"));
  let registrations = 0;
  const app = await createApplication({ config: loadConfig({ QUIRE_DATA_DIR: root }),
    modules: [{ id: "085-o-support", lane: "O", order: 85, register() { registrations += 1; } }] });
  try {
    // When
    await app.start();
    const response = await app.fetch(new Request("http://fixture/api/admin/releases"));
    // Then
    expect(response.status).toBe(501);
    expect(app.adapters).toBeUndefined();
    expect(registrations).toBe(1);
    expect(await app.runtime.db.get("SELECT name FROM sqlite_master WHERE name='support_siem'")).toBeNull();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
    console.info("operations.custom.cleanup", { root, closed: true });
  }
}, 90_000);

test("starts a single support sender and awaits its acknowledgement before default adapter storage closes", async () => {
  // Given
  await using fixture = await operationsFixture();
  const operator = await fixture.login();
  const received = Promise.withResolvers<void>();
  const acknowledge = Promise.withResolvers<void>();
  let requests = 0;
  const receiver = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() {
    requests += 1;
    received.resolve();
    await acknowledge.promise;
    return new Response(null, { status: 204 });
  } });
  const receiverPort = Number(receiver.url.port);
  try {
    const configured = await fixture.request("/api/admin/audit/siem", { method: "PUT",
      headers: { ...operator, "if-match": '"v0"' }, body: JSON.stringify({
        endpoint: receiver.url.href, secret: "owned-local-siem-secret", enabled: true, expectedVersion: 0,
      }) });
    expect(configured.status).toBe(200);
    // When
    await fixture.app.start();
    await fixture.app.start();
    await bounded(received.promise, 10_000);
    const closing = fixture.app.close();
    acknowledge.resolve();
    await bounded(closing, 10_000);
    // Then: acknowledgement persistence is possible only if shutdown drained before closing storage.
    const reopened = await createRuntime(fixture.config);
    try {
      const state = await reopened.db.get<{ cursor: number; attempts: number }>("SELECT cursor,attempts FROM support_siem");
      expect(state?.cursor).toBeGreaterThan(0);
      expect(state?.attempts).toBe(0);
      expect(requests).toBe(1);
    } finally { await reopened.close(); }
    await fixture.app.close();
  } finally {
    acknowledge.resolve();
    await fixture.app.close();
    await receiver.stop(true);
    console.info("operations.receiver.cleanup", { port: receiverPort, closed: true });
  }
}, 90_000);

test("retains real writer admission throughout support network delivery so maintenance drains it", async () => {
  // Given
  await using fixture = await operationsFixture();
  const operator = await fixture.login();
  const received = Promise.withResolvers<void>();
  const acknowledge = Promise.withResolvers<void>();
  const receiver = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() {
    received.resolve();
    await acknowledge.promise;
    return new Response(null, { status: 204 });
  } });
  const receiverPort = Number(receiver.url.port);
  try {
    expect((await fixture.request("/api/admin/audit/siem", { method: "PUT",
      headers: { ...operator, "if-match": '"v0"' }, body: JSON.stringify({
        endpoint: receiver.url.href, secret: "owned-admission-secret", enabled: true, expectedVersion: 0,
      }) })).status).toBe(200);
    startSupport(fixture.app.runtime);
    await bounded(received.promise, 10_000);
    // When: probe the actual cross-process writer lock during the held network request.
    const probe = Bun.spawn(["flock", "--exclusive", "--nonblock",
      join(fixture.root, ".admission-writers.lock"), "true"], { stdout: "ignore", stderr: "ignore" });
    const code = await probe.exited;
    // Then: an exclusive maintenance owner cannot ignore this unfinished dispatch.
    expect(code).toBe(1);
  } finally {
    acknowledge.resolve();
    await fixture.app.close();
    await receiver.stop(true);
    console.info("operations.admission.receiver.cleanup", { port: receiverPort, closed: true });
  }
}, 90_000);
