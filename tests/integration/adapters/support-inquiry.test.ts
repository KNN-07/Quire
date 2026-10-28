import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { IdSchema } from "@quire/contracts";
import { createApplicationAdapters, loadAdapterDeployment } from "../../../services/adapters";
import { integrationFixture } from "./harness";

test("validates the configured support recipient without inventing a default destination", () => {
  // Given / When: deployment configuration is absent or explicitly provided.
  expect(createApplicationAdapters({}).inquiries.recipient()).toBeNull();
  expect(loadAdapterDeployment({ QUIRE_SUPPORT_RECIPIENT: "support@example.test" }).supportRecipient)
    .toBe("support@example.test");
  // Then: invalid destinations fail at the configuration boundary.
  expect(() => loadAdapterDeployment({ QUIRE_SUPPORT_RECIPIENT: "invalid" })).toThrow();
  expect(() => createApplicationAdapters({ supportRecipient: "invalid" })).toThrow();
});

test("enqueues support mail through the supplied transaction with durable deduplication", async () => {
  // Given: the actual aggregate and its existing persisted mail outbox.
  await using fixture = await integrationFixture({ supportRecipient: "support@example.test" });
  const inquiry = { id: IdSchema.parse(crypto.randomUUID()), name: "Reader", email: "reader@example.test",
    organization: "Lab", users: 2, runtime: "native", airGapped: false, message: "A support request" };
  // When: the same inquiry is enqueued twice and the application reopens.
  await fixture.runtime.uow.run(async tx => {
    await fixture.adapters.inquiries.enqueue(tx, inquiry);
    await fixture.adapters.inquiries.enqueue(tx, inquiry);
  });
  await fixture.restart();
  // Then: one real local message remains available to the existing delivery worker.
  const rows = await fixture.runtime.db.all<{ recipient: string; body: string; status: string }>(
    "SELECT recipient,body,status FROM mail_outbox WHERE dedupe_key=?", [`support:${inquiry.id}`]);
  expect(rows).toEqual([{ recipient: "support@example.test", body: JSON.stringify(inquiry), status: "local" }]);
  expect((await fixture.adapters.delivery.drain()).state).toBe("unconfigured");
}, 30_000);

test("rolls back support mail together with its caller transaction", async () => {
  // Given: a real configured aggregate and an inquiry in an uncommitted transaction.
  await using fixture = await integrationFixture({ supportRecipient: "support@example.test" });
  const inquiry = { id: IdSchema.parse(crypto.randomUUID()), name: "Reader", email: "reader@example.test",
    organization: "", users: 1, runtime: "native", airGapped: false, message: "Rollback request" };
  const failure = new TypeError("Caller transaction failed");
  // When: the caller fails after enqueue.
  await rejects(fixture.runtime.uow.run(async tx => {
    await fixture.adapters.inquiries.enqueue(tx, inquiry);
    throw failure;
  }), failure);
  // Then: no independently committed mail escapes the transaction.
  expect(await fixture.runtime.db.get("SELECT id FROM mail_outbox WHERE dedupe_key=?", [`support:${inquiry.id}`]))
    .toBeNull();
}, 30_000);
