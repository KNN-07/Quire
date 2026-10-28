import { expect, test } from "bun:test";
import { ScopeSchema } from "@quire/contracts";
import { RedisNotificationTransport } from "../../../../services/operations/storage/redis";
import { RedisFixture, signal, bounded, rejection, docker } from "./fixture";

test("real Redis readiness, cross-client events/leases, namespace isolation, outage/reconnect and disposal", async () => {
  const fixture = new RedisFixture();
  const transports: RedisNotificationTransport[] = [];
  try {
    await fixture.create();
    const namespace = `test:${crypto.randomUUID()}`;
    const a = new RedisNotificationTransport({ url: fixture.url, namespace });
    const b = new RedisNotificationTransport({ url: fixture.url, namespace });
    const isolated = new RedisNotificationTransport({ url: fixture.url, namespace: `${namespace}:isolated` });
    transports.push(a, b, isolated);
    const states: string[] = [];
    b.subscribeState(state => { states.push(state); });
    let isolatedEvents = 0;
    isolated.subscribeEvents(() => { isolatedEvents++; });
    expect(b.state).toBe("disconnected");
    expect((await rejection(b.publishEvents())).message).toBe("REDIS_TRANSPORT_NOT_READY");
    const admitted = a.connect();
    expect(a.connect()).toBe(admitted);
    await Promise.all([admitted, b.connect(), isolated.connect()]);
    expect(states).toEqual(["connecting", "ready"]);
    expect(a.state).toBe("ready");

    const first = signal<void>();
    let wakes = 0;
    const unsubscribe = b.subscribeEvents(() => { wakes++; first.resolve(); });
    await a.publishEvents();
    await first.promise;
    expect(wakes).toBe(1);
    const scope = ScopeSchema.parse({ projectId: crypto.randomUUID(), branch: "main" });
    const lease = signal<void>();
    const scopes: unknown[] = [];
    b.subscribeLeases(value => { scopes.push(value); lease.resolve(); });
    // A valid lease is a FIFO barrier after invalid/untrusted Redis inputs.
    await docker("exec", fixture.name, "redis-cli", "PUBLISH", `${namespace}:leases`, "not-json");
    await docker("exec", fixture.name, "redis-cli", "PUBLISH", `${namespace}:leases`, JSON.stringify({ ...scope, fence: 999 }));
    await docker("exec", fixture.name, "redis-cli", "PUBLISH", `${namespace}:leases`, JSON.stringify({ projectId: "invalid", branch: "main" }));
    await a.publishLease(scope);
    await lease.promise;
    expect(scopes).toEqual([scope]);
    expect(isolatedEvents).toBe(0);
    unsubscribe();
    await a.publishEvents();
    const barrier = signal<void>();
    const removeBarrier = b.subscribeLeases(() => { barrier.resolve(); });
    await a.publishLease(scope);
    await barrier.promise;
    removeBarrier();
    expect(wakes).toBe(1);

    const disconnected = signal<void>();
    const publisherDisconnected = signal<void>();
    b.subscribeState(state => { if (state === "disconnected") disconnected.resolve(); });
    a.subscribeState(state => { if (state === "disconnected") publisherDisconnected.resolve(); });
    const beforeUrl = fixture.url;
    await fixture.stop();
    await Promise.all([disconnected.promise, publisherDisconnected.promise]);
    expect(b.state).toBe("disconnected");
    expect((await rejection(b.publishLease(scope))).message).toBe("REDIS_TRANSPORT_NOT_READY");
    await fixture.start();
    expect(fixture.url).toBe(beforeUrl);
    const ready = signal<void>();
    b.subscribeState(state => { if (state === "ready") ready.resolve(); });
    await Promise.all([a.connect(), b.connect()]);
    await ready.promise;
    const reconnected = signal<void>();
    b.subscribeEvents(() => { reconnected.resolve(); });
    await a.publishEvents();
    await reconnected.promise;
    expect(states).toEqual(["connecting", "ready", "disconnected", "connecting", "ready"]);

    await Promise.all(transports.map(transport => transport.close()));
    expect(b.state).toBe("closed");
    await b.close();
    expect((await rejection(b.publishEvents())).message).toBe("REDIS_TRANSPORT_CLOSED");
    expect(() => b.connect()).toThrow("REDIS_TRANSPORT_CLOSED");
    expect(() => b.subscribeEvents(() => {})).toThrow("REDIS_TRANSPORT_CLOSED");
    const clients = await docker("exec", fixture.name, "redis-cli", "CLIENT", "LIST");
    expect(clients.trim().split("\n")).toHaveLength(1);
  } finally {
    await Promise.all(transports.map(transport => transport.close()));
    await fixture.close();
  }
}, 40_000);

test("real Redis AUTH rejection, authenticated database connection and close during admission", async () => {
  const fixture = new RedisFixture();
  const transports: RedisNotificationTransport[] = [];
  try {
    await fixture.create();
    const password = `${crypto.randomUUID()}:secret /`;
    await docker("exec", fixture.name, "redis-cli", "CONFIG", "SET", "requirepass", password);
    const broken = new RedisNotificationTransport({
      url: fixture.url, namespace: crypto.randomUUID(), connectionTimeoutMs: 1_000,
    });
    transports.push(broken);
    expect((await rejection(bounded(broken.connect(), "failed admission"))).message).toContain("NOAUTH");
    expect(broken.state).toBe("disconnected");
    const pending = broken.connect();
    const rejected = rejection(pending);
    await broken.close();
    await rejected;
    expect(broken.state).toBe("closed");
    const url = new URL(fixture.url);
    url.username = "default";
    url.password = password;
    url.pathname = "/3";
    const authenticated = new RedisNotificationTransport({ url: url.href, namespace: crypto.randomUUID() });
    transports.push(authenticated);
    const wake = signal<void>();
    authenticated.subscribeEvents(() => { wake.resolve(); });
    await authenticated.connect();
    await authenticated.publishEvents();
    await wake.promise;
    await authenticated.close();
    const clients = await docker("exec", fixture.name, "redis-cli", "--no-auth-warning", "-a", password, "CLIENT", "LIST");
    expect(clients.trim().split("\n")).toHaveLength(1);
  } finally {
    await Promise.all(transports.map(transport => transport.close()));
    await fixture.close();
  }
}, 30_000);
