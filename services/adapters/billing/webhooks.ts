import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { BindingSchema, digest, fail, merchantKind } from "./contracts";
import type { Merchant } from "./contracts";
import { claim, fence, release } from "./store";
import { invoiceState, publishInvoice, publishSubscription, subscriptionState } from "./reconcile";
import { reconcileReceipts } from "./receipt-reconciliation";

const EventSchema = z.object({
  id: z.string().startsWith("evt_"), type: z.string(), created: z.number().int(),
  data: z.object({ object: z.object({ id: z.string() }).passthrough() }),
});
export function verifySignature(input: {
  readonly bytes: Uint8Array; readonly signature: string; readonly secrets: readonly string[]; readonly now: number;
}) {
  const fields = input.signature.split(",").map((part) => part.split("="));
  const timestamp = fields.find(([key]) => key === "t")?.[1];
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(input.now - Number(timestamp)) > 300)
    fail("BILLING_SIGNATURE_INVALID", "Webhook timestamp is missing or outside the five-minute window", 400);
  const signatures = fields.filter(([key]) => key === "v1").map(([, value]) => value ?? "");
  const matched = input.secrets.some((secret) => {
    const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(input.bytes).digest();
    return signatures.some((signature) => /^[a-f0-9]{64}$/i.test(signature) && timingSafeEqual(expected, Buffer.from(signature, "hex")));
  });
  if (!matched) fail("BILLING_SIGNATURE_INVALID", "Webhook signature does not match configured signing secrets", 400);
}
export async function receive(merchant: Merchant, input: { readonly bytes: Uint8Array; readonly signature: string }) {
  const settings = await merchant.settings();
  verifySignature({ ...input, secrets: settings.merchant.webhookSecrets,
    now: Math.floor(Date.parse(merchant.context.clock.now()) / 1000) });
  const event = EventSchema.parse(JSON.parse(new TextDecoder().decode(input.bytes)));
  const hash = digest(input.bytes);
  const context = merchant.context;
  const replay = async () => {
    const prior = await context.db.get("SELECT digest FROM webhook_receipts WHERE provider=? AND event=?", [merchantKind, event.id]);
    if (!prior) return false;
    if (z.object({ digest: z.string() }).parse(prior).digest !== hash) fail("BILLING_EVENT_CONFLICT", "Event ID reused with different bytes");
    return true;
  };
  if (await replay()) return;
  let organizationId: Id | null = null;
  let subscriptionId: string | null = null;
  let invoiceId: string | null = null;
  const object = event.data.object;
  if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    organizationId = z.object({ metadata: z.object({ quire_organization: IdSchema }) }).parse(object).metadata.quire_organization;
    subscriptionId = object.id;
  } else if (event.type === "checkout.session.completed") {
    const session = await merchant.call(`checkout/sessions/${encodeURIComponent(object.id)}`,
      z.object({ customer: z.string(), subscription: z.string(), client_reference_id: IdSchema, status: z.literal("complete") }));
    organizationId = session.client_reference_id;
    subscriptionId = session.subscription;
    const link = BindingSchema.parse(await context.db.get("SELECT * FROM billing_merchant_bindings WHERE organization_id=?", [organizationId]));
    if (link.customer_id !== session.customer) fail("BILLING_BINDING_MISMATCH", "Checkout customer does not match organization");
  } else if (["invoice.finalized", "invoice.paid", "invoice.payment_failed", "invoice.voided", "invoice.marked_uncollectible"].includes(event.type)) {
    const customer = z.object({ customer: z.string() }).parse(object).customer;
    const row = await context.db.get("SELECT * FROM billing_merchant_bindings WHERE customer_id=?", [customer]);
    if (!row) fail("BILLING_BINDING_MISSING", "Invoice customer is not bound to Quire");
    const link = BindingSchema.parse(row);
    organizationId = link.organization_id;
    subscriptionId = link.subscription_id;
    invoiceId = object.id;
  }
  const lease = organizationId ? await claim(context, organizationId) : null;
  try {
    // Event snapshots are unordered. Retrieve authoritative state only after serialized admission.
    const subscription = organizationId && subscriptionId ? await subscriptionState(merchant, organizationId, subscriptionId) : null;
    const invoice = invoiceId ? await invoiceState(merchant, invoiceId) : null;
    await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      if (lease) await fence(tx, lease, context.clock.now());
      const prior = await tx.get("SELECT digest FROM webhook_receipts WHERE provider=? AND event=?", [merchantKind, event.id]);
      if (prior) {
        if (z.object({ digest: z.string() }).parse(prior).digest !== hash) fail("BILLING_EVENT_CONFLICT", "Event ID reused with different bytes");
        return;
      }
      const latest = await merchant.configuration.get(merchantKind, tx);
      if (!latest.enabled || latest.version !== settings.version) fail("VERSION_CONFLICT", "Merchant configuration changed during reconciliation");
      if (subscription) {
        await publishSubscription(merchant, tx, subscription);
        await reconcileReceipts(merchant, tx, subscription);
      }
      if (invoice && organizationId) await publishInvoice(merchant, tx, { organizationId, state: invoice });
      await tx.run("INSERT INTO webhook_receipts(id,provider,event,received_at,digest) VALUES(?,?,?,?,?)",
        [crypto.randomUUID(), merchantKind, event.id, context.clock.now(), hash]);
    });
    await context.events.dispatch();
  } finally { if (lease) await release(context, lease); }
}
export async function readWebhook(request: Request) {
  if (!request.body) fail("BILLING_BODY_REQUIRED", "Webhook body required", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) return Buffer.concat(chunks);
      size += result.value.length;
      if (size > 1024 * 1024) fail("BILLING_BODY_TOO_LARGE", "Webhook exceeds one MiB", 413);
      chunks.push(result.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
}
