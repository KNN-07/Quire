import { expect, test } from "bun:test";
import { z } from "zod";
import { OperationSchema } from "@quire/contracts";
import { operationsFixture } from "./harness";

test("registers operational schemas once and denies an unconfigured update through the actual default host", async () => {
  // Given
  await using fixture = await operationsFixture();
  const operator = await fixture.login();
  const viewer = await fixture.login("alex@quire.local");
  const update = (headers: HeadersInit) => fixture.request("/api/admin/updates", { method: "POST",
    headers: { ...Object.fromEntries(new Headers(headers)), "idempotency-key": "unconfigured-update" },
    body: JSON.stringify({ releaseId: crypto.randomUUID(), at: fixture.app.runtime.clock.now(), autoSecurity: false }) });
  // When
  const releases = await fixture.request("/api/admin/releases", { headers: operator });
  const unavailable = await update(operator);
  await fixture.reopen();
  // Then
  expect(releases.status).toBe(200);
  expect(await releases.json()).toMatchObject({ data: { items: [], nextCursor: null } });
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toMatchObject({ error: { code: "UPDATES_UNCONFIGURED" } });
  expect((await update(viewer)).status).toBe(403);
  expect((await update({ cookie: operator.cookie })).status).toBe(403);
  expect((await fixture.request("/api/admin/releases")).status).toBe(401);
  const ledger = await fixture.app.runtime.db.all<{ id: string }>(
    "SELECT id FROM schema_migrations WHERE id IN ('070-o-updates','085-o-support') ORDER BY id");
  expect(ledger).toEqual([{ id: "070-o-updates" }, { id: "085-o-support" }]);
  expect(await fixture.app.runtime.db.all("SELECT * FROM update_jobs")).toHaveLength(0);
}, 90_000);

test("downloads actual redacted support bytes and rechecks current operator rights on the default host", async () => {
  // Given
  await using fixture = await operationsFixture();
  const operator = await fixture.login();
  const viewer = await fixture.login("alex@quire.local");
  const canary = "private-default-host-canary-10532";
  await fixture.app.runtime.db.run("UPDATE document_states SET text=?", [canary]);
  const create = (headers: HeadersInit) => fixture.request("/api/admin/diagnostics", { method: "POST",
    headers: { ...Object.fromEntries(new Headers(headers)), "idempotency-key": "default-diagnostic" }, body: "{}" });
  // When
  const created = await create(operator);
  const operation = z.object({ data: OperationSchema }).parse(await created.json()).data;
  const download = await fixture.request(`/api/operations/${operation.id}/download`, { headers: operator });
  const bytes = await download.text();
  // Then
  expect(created.status).toBe(202);
  expect(download.status).toBe(200);
  expect(download.headers.get("content-type")).toBe("application/json");
  expect(JSON.parse(bytes)).toMatchObject({ manifest: { format: "quire-support-v1", redacted: true },
    runtime: { database: { state: "ready" }, repository: { state: "ready" } },
    ports: { api: { state: "ready" } } });
  expect(bytes.includes(canary)).toBe(false);
  expect(bytes.includes(fixture.root)).toBe(false);
  expect((await create(viewer)).status).toBe(403);
  expect((await create({ cookie: operator.cookie })).status).toBe(403);
  await fixture.app.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [operator.id]);
  expect((await fixture.request(`/api/operations/${operation.id}/download`, { headers: operator })).status).toBe(403);
  console.info("operations.artifact", { operationId: operation.id, bytes: new TextEncoder().encode(bytes).length,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") });
  if (process.env["QUIRE_OPERATIONS_EVIDENCE"] === "1") console.info("operations.bundle", bytes);
}, 120_000);

test("saves support inquiries without pretending the missing adapter hook delivered mail", async () => {
  // Given
  await using fixture = await operationsFixture();
  const body = JSON.stringify({ name: "Owned fixture", email: "owned@example.invalid", organization: "Fixture",
    users: 1, runtime: "native", airGapped: true, message: "Do not send external mail." });
  const post = () => fixture.request("/api/support/inquiries", { method: "POST",
    headers: { "idempotency-key": "default-inquiry" }, body });
  // When
  const response = await post();
  await fixture.reopen();
  const replay = await post();
  // Then
  expect([response.status, replay.status]).toEqual([503, 503]);
  expect(await response.json()).toMatchObject({ error: { code: "SUPPORT_UNCONFIGURED" } });
  expect(await fixture.app.runtime.db.all("SELECT id FROM support_inquiries")).toHaveLength(1);
  expect(await fixture.app.runtime.db.all("SELECT id FROM mail_outbox")).toHaveLength(0);
}, 90_000);

test("queues one configured inquiry through the default aggregate outbox across concurrent HTTP retries and restart", async () => {
  // Given
  const recipient = "owned-default-support@example.invalid";
  await using fixture = await operationsFixture({ supportRecipient: recipient });
  const body = JSON.stringify({ name: "Owned fixture", email: "sender@example.invalid", organization: "Fixture",
    users: 2, runtime: "native", airGapped: true, message: "Local outbox proof, not an external email." });
  const post = () => fixture.request("/api/support/inquiries", { method: "POST",
    headers: { "idempotency-key": "configured-default-inquiry" }, body });
  // When
  const responses = await Promise.all([post(), post()]);
  await fixture.reopen();
  const replay = await post();
  // Then
  expect([...responses, replay].map(response => response.status)).toEqual([200, 200, 200]);
  const queued = await fixture.app.runtime.db.all<{ id: string; recipient: string; status: string; dedupe_key: string }>(
    `SELECT s.id,m.recipient,m.status,m.dedupe_key FROM support_inquiries s
      JOIN mail_outbox m ON m.dedupe_key='support:' || s.id WHERE s.status='queued'`);
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ recipient, status: "local", dedupe_key: `support:${queued[0]?.id}` });
  console.info("operations.inquiry", { id: queued[0]?.id, status: queued[0]?.status, messages: queued.length });
}, 90_000);
