import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { StorageError } from "@quire/runtime";
import type { Transaction } from "@quire/contracts";
import { dispatchSiem, startSupport, stopSupport } from "../../../services/operations/support";
import { supportFixture } from "./fixture";

test("retries an ordered persistent SIEM cursor through outage and receiver restart without duplicate ingestion", async () => {
  // Given: real native storage and a real HTTP receiver with durable event-key deduplication.
  await using fixture = await supportFixture();
  using received = new Database(join(fixture.path, "owned-siem.sqlite"));
  received.run("CREATE TABLE received (key TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE)");
  const operator = await fixture.login();
  const token = "owned-receiver-secret-not-for-export";
  const accepted = Promise.withResolvers<void>();
  let acknowledge = false;
  let requests = 0;
  const fetchReceiver = async (request: Request) => {
    requests += 1;
    expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
    const event = z.object({ format: z.literal("quire-audit-v1"), id: z.uuid(), seq: z.number().int() })
      .parse(await request.json());
    expect(request.headers.get("idempotency-key")).toBe(`quire-audit-${event.id}`);
    received.query("INSERT INTO received(key,seq) VALUES(?,?) ON CONFLICT(key) DO NOTHING")
      .run(z.string().parse(request.headers.get("idempotency-key")), event.seq);
    accepted.resolve();
    return new Response(null, { status: acknowledge ? 204 : 503 });
  };
  let receiver = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: fetchReceiver });
  const port = Number(receiver.url.port);
  try {
    const response = await fixture.request("/api/admin/audit/siem", { method: "PUT",
      headers: { ...operator, "if-match": '"v0"' },
      body: JSON.stringify({ endpoint: new URL("/ingest", receiver.url).href, secret: token, enabled: true, expectedVersion: 0 }) });
    expect(response.status).toBe(200);
    // The accepted signal was subscribed before dispatch; no timing sleeps or polling.
    // When: a persisted event loses acknowledgement, the receiver stops, then restarts on its original port.
    expect(await dispatchSiem(fixture.context)).toBe("retry");
    await accepted.promise;
    const pending = z.object({ cursor: z.number(), attempts: z.number(), encrypted_secret: z.instanceof(Uint8Array) })
      .parse(await fixture.runtime.db.get("SELECT * FROM support_siem"));
    expect(pending.cursor).toBe(0);
    expect(pending.attempts).toBe(1);
    expect(new TextDecoder().decode(pending.encrypted_secret).includes(token)).toBe(false);
    expect(await dispatchSiem(fixture.context)).toBe("idle");
    await receiver.stop(true);
    fixture.advance(1001);
    expect(await dispatchSiem(fixture.context)).toBe("retry");
    acknowledge = true;
    receiver = Bun.serve({ hostname: "127.0.0.1", port, fetch: fetchReceiver });
    await fixture.reopen();
    fixture.advance(2001);
    const concurrent = await Promise.all([dispatchSiem(fixture.context), dispatchSiem(fixture.context)]);
    expect(concurrent.sort()).toEqual(["delivered", "idle"]);
    const afterFirst = z.object({ cursor: z.number(), attempts: z.number() })
      .parse(await fixture.runtime.db.get("SELECT * FROM support_siem"));
    await fixture.runtime.db.run("INSERT INTO audit_entries(id,at,event,target_id,details_json) VALUES(?,?,?,?,?)",
      [crypto.randomUUID(), fixture.runtime.clock.now(), "owned.second", "private-target", JSON.stringify({ token: "private-details" })]);
    expect(await dispatchSiem(fixture.context)).toBe("delivered");
    // Then: order and cursor persist, failed requests never advance, and the receiver ingests each event once.
    const values = z.array(z.object({ seq: z.number() })).parse(received.query("SELECT seq FROM received ORDER BY seq").all());
    expect(values).toHaveLength(2);
    expect(values[0]?.seq).toBe(afterFirst.cursor);
    expect(values[1]?.seq).toBeGreaterThan(afterFirst.cursor);
    expect(afterFirst.attempts).toBe(0);
    expect(requests).toBe(3);
    expect(await dispatchSiem(fixture.context)).toBe("idle");
    if (process.env["QUIRE_SUPPORT_EVIDENCE"]) {
      const dir = process.env["QUIRE_SUPPORT_EVIDENCE"];
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "siem-receipts.json"), JSON.stringify({
        receiverPort: port, requests, ingested: values, firstCursor: afterFirst.cursor, retryAttemptsReset: afterFirst.attempts,
        final: z.object({ cursor: z.number(), attempts: z.number(), last_error: z.string().nullable() })
          .parse(await fixture.runtime.db.get("SELECT cursor,attempts,last_error FROM support_siem")),
      }, null, 2));
    }
  } finally { await receiver.stop(true); }
}, 30000);

test("enforces current operator authority and optimistic configuration writes without exposing secrets", async () => {
  // Given: the real administration route and operator/non-operator sessions.
  await using fixture = await supportFixture();
  const operator = await fixture.login();
  const viewer = await fixture.login("alex@quire.local");
  let requests = 0;
  const receiver = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => {
    requests += 1; return new Response(null, { status: 204 });
  } });
  try {
    const body = { endpoint: new URL("/ingest", receiver.url).href, secret: "redacted-test-token", enabled: true, expectedVersion: 0 };
    const put = (headers = operator, change = body) => fixture.request("/api/admin/audit/siem", {
      method: "PUT", headers: { ...headers, "if-match": '"v0"' }, body: JSON.stringify(change),
    });
    // When: configuration is created, read, raced with stale writes, and its author loses operator authority.
    expect((await put(viewer)).status).toBe(403);
    expect((await put()).status).toBe(200);
    const read = await fixture.request("/api/admin/audit/siem", { headers: operator });
    const redacted = await read.text();
    expect(read.status).toBe(200);
    expect(read.headers.get("etag")).toBe('"v1"');
    expect(redacted.includes("redacted-test-token")).toBe(false);
    expect(JSON.parse(redacted)).toMatchObject({ data: { secretPresent: true, enabled: true, version: 1 } });
    expect((await put()).status).toBe(409);
    await fixture.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [operator.id]);
    // Then: future dispatch is fenced and no event is falsely marked delivered.
    expect(await dispatchSiem(fixture.context)).toBe("idle");
    expect(requests).toBe(0);
    expect(z.object({ cursor: z.number() }).parse(await fixture.runtime.db.get("SELECT cursor FROM support_siem")).cursor).toBe(0);
    expect((await fixture.request("/api/admin/audit/siem", { headers: operator })).status).toBe(403);
  } finally { await receiver.stop(true); }
});

test("starts real configured delivery and drains its acknowledgement before worker shutdown", async () => {
  // Given: a configured receiver and an exact receive subscription before the worker is started.
  await using fixture = await supportFixture();
  const operator = await fixture.login();
  const accepted = Promise.withResolvers<void>();
  const deadline = AbortSignal.timeout(10000);
  const expired = () => accepted.reject(deadline.reason);
  deadline.addEventListener("abort", expired, { once: true });
  let requests = 0;
  const receiver = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => {
    requests += 1; accepted.resolve(); return new Response(null, { status: 204 });
  } });
  try {
    const configured = await fixture.request("/api/admin/audit/siem", { method: "PUT",
      headers: { ...operator, "if-match": '"v0"' },
      body: JSON.stringify({ endpoint: receiver.url.href, secret: "owned-worker-secret", enabled: true, expectedVersion: 0 }) });
    expect(configured.status).toBe(200);
    // When: the production worker starts and receives shutdown while acknowledging its actual HTTP request.
    startSupport(fixture.runtime);
    startSupport(fixture.runtime);
    await accepted.promise;
    await stopSupport(fixture.runtime);
    // Then: shutdown has drained delivery and duplicate start has not created another sender.
    expect(requests).toBe(1);
    expect(z.object({ cursor: z.number() }).parse(await fixture.runtime.db.get("SELECT cursor FROM support_siem")).cursor).toBeGreaterThan(0);
  } finally {
    deadline.removeEventListener("abort", expired);
    await stopSupport(fixture.runtime);
    await receiver.stop(true);
  }
});

test("rejects missing delivery secrets and credential-bearing SIEM URLs", async () => {
  // Given: real operator authority and initially absent configuration.
  await using fixture = await supportFixture();
  const operator = await fixture.login();
  const put = (body: unknown) => fixture.request("/api/admin/audit/siem", { method: "PUT",
    headers: { ...operator, "if-match": '"v0"' }, body: JSON.stringify(body) });
  // When: invalid secret and endpoint boundaries are submitted.
  const missing = await put({ endpoint: "http://127.0.0.1:1", enabled: true, expectedVersion: 0 });
  const embedded = await put({ endpoint: "https://user:secret@example.invalid", enabled: false, expectedVersion: 0 });
  const query = await put({ endpoint: "https://example.invalid?token=private", enabled: false, expectedVersion: 0 });
  // Then: neither a leaking URL nor unauthenticated delivery is configured.
  expect(missing.status).toBe(400);
  expect(embedded.status).toBe(400);
  expect(query.status).toBe(400);
  expect(await fixture.runtime.db.get("SELECT 1 FROM support_siem")).toBeNull();
});

test("recovers a storage admission failure before delivering through the real configured receiver", async () => {
  // Given: real SQL plus a one-shot admission fault and a receive subscription before worker start.
  await using fixture = await supportFixture();
  const operator = await fixture.login();
  const accepted = Promise.withResolvers<void>();
  const deadline = AbortSignal.timeout(10000);
  const expired = () => accepted.reject(deadline.reason);
  deadline.addEventListener("abort", expired, { once: true });
  const receiver = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => {
    accepted.resolve(); return new Response(null, { status: 204 });
  } });
  let fault = true;
  const context = { ...fixture.runtime, uow: {
    async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
      if (fault) {
        fault = false;
        return fixture.runtime.uow.run(async () => { throw new StorageError("OWNED_ADMISSION_FAILURE", "owned"); });
      }
      return fixture.runtime.uow.run(work);
    },
  } };
  try {
    expect((await fixture.request("/api/admin/audit/siem", { method: "PUT",
      headers: { ...operator, "if-match": '"v0"' },
      body: JSON.stringify({ endpoint: receiver.url.href, secret: "owned-recovery-secret", enabled: true, expectedVersion: 0 }) })).status).toBe(200);
    // When: the worker encounters the admission failure and retries its durable work.
    startSupport(context);
    await accepted.promise;
    await stopSupport(context);
    // Then: storage recovery delivers the pending real event rather than silently stopping the worker.
    expect(z.object({ cursor: z.number() }).parse(await fixture.runtime.db.get("SELECT cursor FROM support_siem")).cursor).toBeGreaterThan(0);
  } finally {
    deadline.removeEventListener("abort", expired);
    await stopSupport(context);
    await receiver.stop(true);
  }
});
