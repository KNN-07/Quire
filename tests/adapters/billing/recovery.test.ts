import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import { billingFixture } from "./harness";
import { data } from "../../accounts/governance/harness";

const selection = { planId: "price_month", seats: 2, period: "month", expectedVersion: 0 } as const;
const quoteSchema = z.object({ quoteId: IdSchema });
test("retains encrypted merchant configuration, migration receipts and checkout replay across native reopen", async () => {
  // Given: a stored quote and completed hosted-session operation.
  await using app = await billingFixture();
  const quote = await data(await app.admin.write(`${app.path}/preview`, selection, "preview-restart"), quoteSchema);
  const input = { quoteId: quote.quoteId, expectedVersion: 0 };
  const original = await data(await app.admin.write(`${app.path}/checkout`, input, "checkout-restart"), OperationSchema);
  const ledger = await app.runtime.db.all("SELECT id,digest,applied_at FROM schema_migrations ORDER BY id");
  const secret = z.object({ encrypted_secret: z.instanceof(Uint8Array) }).parse(await app.runtime.db.get("SELECT encrypted_secret FROM adapter_provider_configs WHERE kind='stripe-billing'"));
  // When: the native runtime is closed and freshly constructed over the same durable data.
  await app.restart();
  const replay = await data(await app.admin.write(`${app.path}/checkout`, input, "checkout-restart"), OperationSchema);
  // Then: stored operations and migrations survive without another merchant write, and the key is not plaintext SQL.
  expect(replay).toEqual(original);
  expect(await app.runtime.db.all("SELECT id,digest,applied_at FROM schema_migrations ORDER BY id")).toEqual(ledger);
  expect(new TextDecoder().decode(secret.encrypted_secret).includes("sk_test_fixture")).toBe(false);
  expect(app.provider.calls.filter((call) => call.path === "/v1/checkout/sessions")).toHaveLength(1);
  expect(await data(await app.admin.write(`${app.path}/preview`, selection, "preview-restart"), quoteSchema)).toEqual(quote);
});
test("fences an expired reconciliation writer when a newer claim publishes first", async () => {
  // Given: provider response is held at an explicit event barrier after a stale snapshot is captured.
  await using app = await billingFixture();
  await app.admin.write(`${app.path}/preview`, selection);
  const gate = app.provider.holdSubscription();
  const stale = app.webhook(app.provider.event("evt_stale_writer"));
  try {
    await Promise.race([gate.arrived, new Promise<never>((_, reject) => {
      AbortSignal.timeout(5000).addEventListener("abort", () => reject(new TypeError("Provider barrier deadline exceeded")), { once: true });
    })]);
    app.setTime("2026-10-27T12:02:01.000Z");
    app.provider.setSeats(5);
    // When: claim expiry allows a new writer to reconcile before the first response resumes.
    expect((await app.webhook(app.provider.event("evt_takeover"))).status).toBe(200);
    gate.release();
    expect((await stale).status).toBe(409);
    // Then: stale publication and its receipt are rejected atomically.
    expect((await app.account()).seats).toBe(5);
    expect(await app.runtime.db.get("SELECT id FROM webhook_receipts WHERE event='evt_stale_writer'")).toBeNull();
  } finally { gate.release(); await stale; }
});
test("requires current administrator authority at publication after provider preparation", async () => {
  // Given: the merchant preview is held at its subscription-read barrier.
  await using app = await billingFixture();
  await app.admin.write(`${app.path}/preview`, selection);
  await app.webhook(app.provider.event("evt_initialize"));
  const account = await app.account();
  const gate = app.provider.holdSubscription();
  const pending = app.admin.write(`${app.path}/preview`, { ...selection, expectedVersion: account.version }, "revoked-preview");
  try {
    await Promise.race([gate.arrived, new Promise<never>((_, reject) => {
      AbortSignal.timeout(5000).addEventListener("abort", () => reject(new TypeError("Provider barrier deadline exceeded")), { once: true });
    })]);
    // When: another administrative mutation revokes the role while provider preparation is outside SQL.
    await app.runtime.db.run("UPDATE members SET role='member' WHERE organization_id=? AND user_id=(SELECT id FROM users WHERE primary_email='kien@quire.local')", [app.org]);
    gate.release();
    // Then: no quote is published using the previous role.
    expect((await pending).status).toBe(403);
    expect(await app.runtime.db.get("SELECT id FROM billing_merchant_quotes WHERE request_key='revoked-preview'")).toBeNull();
  } finally { gate.release(); await pending; }
});
test("supports payment-method portal and immediate cancellation without inventing local provider success", async () => {
  // Given: an active verified merchant subscription.
  await using app = await billingFixture();
  await app.admin.write(`${app.path}/preview`, selection);
  await app.webhook(app.provider.event("evt_before_cancel"));
  const account = await app.account();
  const portal = await data(await app.admin.write(`${app.path}/portal`, { expectedVersion: account.version }), z.object({ url: z.url() }));
  // When: the administrator requests immediate cancellation, followed by its signed provider event.
  const canceled = await app.admin.write(`${app.path}/cancel`, { atPeriodEnd: false, expectedVersion: account.version });
  const before = await app.account();
  await app.webhook(app.provider.event("evt_canceled", "customer.subscription.deleted"));
  // Then: payment changes use the actual hosted portal and local cancellation waits for reconciliation.
  expect(portal.url).toBe("https://billing.stripe.com/p/session/fixture");
  expect(canceled.status).toBe(202);
  expect(before.status).toBe("active");
  expect((await app.account()).status).toBe("canceled");
});
test("completes an uncertain checkout receipt from a verified completed-session webhook without redispatch", async () => {
  // Given: Stripe creates a hosted session, but the caller receives an uncertain transport result.
  await using app = await billingFixture();
  const quote = await data(await app.admin.write(`${app.path}/preview`, selection), quoteSchema);
  app.provider.failCheckout();
  const input = { quoteId: quote.quoteId, expectedVersion: 0 };
  expect((await app.admin.write(`${app.path}/checkout`, input, "lost-checkout")).status).toBe(502);
  app.provider.complete();
  // When: the customer's provider-completed checkout is delivered as a signed webhook.
  expect((await app.webhook(app.provider.event("evt_lost_checkout", "checkout.session.completed"))).status).toBe(200);
  // Then: the durable running receipt completes without creating a second purchase.
  const result = await data(await app.admin.write(`${app.path}/checkout`, input, "lost-checkout"), OperationSchema);
  expect(result.status).toBe("succeeded");
  expect(result.result?.["reconciliation"]).toBe("verified_webhook");
  expect(app.provider.calls.filter((call) => call.path === "/v1/checkout/sessions")).toHaveLength(1);
});
