import { z } from "zod";
import { IdSchema, assertNever } from "@quire/contracts";
import type { Id, Transaction, BillingAccount } from "@quire/contracts";
import { referenceBlob } from "@quire/runtime";
import { billingAccount, recordBillingTransition } from "../../accounts/governance/billing";
import { BindingSchema, fail, seconds, SubscriptionSchema } from "./contracts";
import type { Merchant, Subscription } from "./contracts";

function status(value: Subscription["status"]): BillingAccount["status"] {
  switch (value) {
    case "active": case "trialing": return "active";
    case "past_due": case "unpaid": case "paused": case "incomplete": return "past_due";
    case "canceled": case "incomplete_expired": return "canceled";
    default: return assertNever(value);
  }
}
export async function subscriptionState(merchant: Merchant, organizationId: Id, subscriptionId: string) {
  const subscription = await merchant.call(`subscriptions/${encodeURIComponent(subscriptionId)}`, SubscriptionSchema);
  const link = BindingSchema.parse(await merchant.context.db.get("SELECT * FROM billing_merchant_bindings WHERE organization_id=?", [organizationId]));
  if (subscription.metadata.quire_organization !== organizationId || subscription.customer !== link.customer_id ||
    (link.subscription_id !== null && link.subscription_id !== subscription.id))
    fail("BILLING_BINDING_MISMATCH", "Provider subscription does not match its organization");
  const settings = await merchant.settings();
  const item = subscription.items.data[0];
  if (!item || !settings.merchant.prices.some((price) => price.id === item.price.id))
    fail("BILLING_PRICE_UNCONFIGURED", "Subscription price is not in the merchant catalog");
  return subscription;
}
export async function publishSubscription(merchant: Merchant, tx: Transaction, subscription: Subscription) {
  const organizationId = subscription.metadata.quire_organization;
  const item = subscription.items.data[0];
  if (!item) fail("BILLING_ITEM_MISSING", "Expected one licensed recurring subscription item");
  const bound = { ...merchant.context, db: tx };
  const current = await billingAccount(bound, organizationId);
  const next = { organizationId, expectedVersion: current.version, actorId: null, provider: "configured" as const,
    planId: item.price.id, period: item.price.recurring.interval, seats: item.quantity,
    status: status(subscription.status), renewsAt: subscription.cancel_at_period_end || subscription.status === "canceled"
      ? null : seconds(item.current_period_end) };
  if (current.provider !== next.provider || current.planId !== next.planId || current.period !== next.period ||
      current.seats !== next.seats || current.status !== next.status || current.renewsAt !== next.renewsAt) {
    await recordBillingTransition(bound, next);
  }
  await tx.run("UPDATE billing_merchant_bindings SET subscription_id=? WHERE organization_id=?", [subscription.id, organizationId]);
  await tx.run(`INSERT INTO subscriptions(id,billing_account_id,provider_id,plan_id,status,seats,period_start,period_end)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(provider_id) DO UPDATE SET plan_id=excluded.plan_id,status=excluded.status,
    seats=excluded.seats,period_start=excluded.period_start,period_end=excluded.period_end,version=subscriptions.version+1`,
  [IdSchema.parse(crypto.randomUUID()), current.id, subscription.id, item.price.id, subscription.status,
    item.quantity, seconds(item.current_period_start), seconds(item.current_period_end)]);
}
export const ProviderInvoiceSchema = z.object({
  id: z.string(), customer: z.string(), amount_due: z.number().int().nonnegative(), currency: z.string(),
  status: z.enum(["draft", "open", "paid", "void", "uncollectible"]), created: z.number().int(),
  invoice_pdf: z.url().nullable(),
});
export async function invoiceState(merchant: Merchant, invoiceId: string) {
  const invoice = await merchant.call(`invoices/${encodeURIComponent(invoiceId)}`, ProviderInvoiceSchema);
  let hash = null;
  let bytes = 0;
  if (invoice.invoice_pdf) {
    const response = await merchant.http.request(invoice.invoice_pdf);
    if (response.status !== 200 || !new TextDecoder().decode(response.bytes.slice(0, 5)).startsWith("%PDF-"))
      fail("BILLING_DOCUMENT_INVALID", "Provider did not return invoice PDF bytes", 502);
    hash = await merchant.context.blobs.put(response.bytes);
    bytes = response.bytes.length;
  }
  return { invoice, hash, bytes };
}
export async function publishInvoice(merchant: Merchant, tx: Transaction, input: {
  readonly organizationId: Id; readonly state: Awaited<ReturnType<typeof invoiceState>>;
}) {
  const account = await billingAccount({ ...merchant.context, db: tx }, input.organizationId);
  const { invoice, hash, bytes } = input.state;
  const link = BindingSchema.parse(await tx.get("SELECT * FROM billing_merchant_bindings WHERE organization_id=?", [input.organizationId]));
  if (link.customer_id !== invoice.customer) fail("BILLING_BINDING_MISMATCH", "Invoice customer does not match organization");
  const existing = await tx.get("SELECT id FROM invoices WHERE billing_account_id=? AND provider_id=?", [account.id, invoice.id]);
  const id = existing ? z.object({ id: IdSchema }).parse(existing).id : IdSchema.parse(crypto.randomUUID());
  const invoiceStatus = invoice.status === "uncollectible" ? "open" : invoice.status;
  if (existing) await tx.run("UPDATE invoices SET amount_minor=?,currency=?,status=? WHERE id=?", [invoice.amount_due, invoice.currency, invoiceStatus, id]);
  else await tx.run("INSERT INTO invoices(id,billing_account_id,provider_id,amount_minor,currency,status,issued_at) VALUES(?,?,?,?,?,?,?)",
    [id, account.id, invoice.id, invoice.amount_due, invoice.currency, invoiceStatus, seconds(invoice.created)]);
  if (hash) {
    await referenceBlob(tx, { digest: hash, bytes }, merchant.context.clock);
    await tx.run("INSERT INTO billing_merchant_documents(invoice_id,sha256) VALUES(?,?) ON CONFLICT(invoice_id) DO UPDATE SET sha256=excluded.sha256", [id, hash]);
  }
}
