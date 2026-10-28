import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { supportFixture } from "./fixture";

const inquiry = { name: "Local test", email: "support-fixture@example.invalid", organization: "Fixture only",
  users: 5, runtime: "native", airGapped: true, message: "Owned support inquiry; never send externally." } as const;

test("persists an unconfigured inquiry durably without claiming outbound delivery", async () => {
  // Given: no recipient or outbound hook.
  await using fixture = await supportFixture();
  const post = () => fixture.request("/api/support/inquiries", { method: "POST",
    headers: { "idempotency-key": "unconfigured" }, body: JSON.stringify(inquiry) });
  // When: the public form is submitted and retried.
  const response = await post();
  await fixture.reopen();
  const replay = await post();
  // Then: one durable private request remains and neither response claims delivery.
  expect(response.status).toBe(503);
  expect(replay.status).toBe(503);
  const rows = z.array(z.object({ request_json: z.string(), status: z.literal("unconfigured") }))
    .parse(await fixture.runtime.db.all("SELECT request_json,status FROM support_inquiries"));
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0]?.request_json ?? "{}")).toEqual(inquiry);
  expect(await fixture.runtime.db.get("SELECT 1 FROM mail_outbox")).toBeNull();
});

test("queues configured inquiry atomically through the injected outbox and deduplicates public retries", async () => {
  // Given: the real durable mail table, injected as the narrow configured outbound seam.
  await using fixture = await supportFixture({ outbox: {
    recipient: () => "owned-local@example.invalid",
    enqueue: async (tx, value) => {
      await tx.run(`INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,status,created_at)
        VALUES(?,?,?,?,?,'local',?)`, [crypto.randomUUID(), "owned-local@example.invalid", "Owned support inquiry",
        JSON.stringify(value), `support:${value.id}`, "2026-10-27T12:00:00.000Z"]);
    },
  } });
  const post = (body: typeof inquiry | { readonly message: string } = inquiry) => fixture.request("/api/support/inquiries",
    { method: "POST", headers: { "idempotency-key": "configured" }, body: JSON.stringify(body) });
  // When: duplicate public requests race through actual HTTP.
  const responses = await Promise.all([post(), post()]);
  // Then: both accept one persisted inquiry and exactly one durable local mail; conflicting reuse fails.
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  expect(await fixture.runtime.db.all("SELECT id FROM support_inquiries")).toHaveLength(1);
  expect(await fixture.runtime.db.all("SELECT id FROM mail_outbox WHERE status='local'")).toHaveLength(1);
  expect((await post({ ...inquiry, message: "different" })).status).toBe(409);
  if (process.env["QUIRE_SUPPORT_EVIDENCE"]) {
    const dir = process.env["QUIRE_SUPPORT_EVIDENCE"];
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "inquiry-receipts.json"), JSON.stringify({
      inquiries: await fixture.runtime.db.all("SELECT id,status FROM support_inquiries"),
      mail: await fixture.runtime.db.all("SELECT id,status,dedupe_key FROM mail_outbox"),
    }, null, 2));
  }
});

test("rejects oversized inquiry input before private request persistence", async () => {
  // Given: the actual public route with bounded inquiry parsing.
  await using fixture = await supportFixture();
  // When: a body crosses the support-specific retention boundary.
  const response = await fixture.request("/api/support/inquiries", { method: "POST",
    headers: { "idempotency-key": "oversized" }, body: JSON.stringify({ ...inquiry, message: "x".repeat(20001) }) });
  // Then: no oversized PII is stored.
  expect(response.status).toBe(400);
  expect(await fixture.runtime.db.get("SELECT 1 FROM support_inquiries")).toBeNull();
});
