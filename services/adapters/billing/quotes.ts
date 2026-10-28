import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { billingAccount } from "../../accounts/governance/billing";
import { conflict } from "../../accounts/governance/shared";
import { authority, binding, claim, fence, operation, release, publicationAuthority } from "./store";
import type { BillingRequest } from "./store";
import { digest, fail, QuoteSchema, seconds, SubscriptionSchema, merchantKind } from "./contracts";
import type { Merchant } from "./contracts";

export async function preview(merchant: Merchant, input: BillingRequest, selection: {
  readonly planId: string; readonly period: "month" | "year"; readonly seats: number;
}) {
  await authority(merchant.context, input);
  const requestKey = input.request.headers.get("idempotency-key");
  if (!requestKey) fail("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required", 400);
  const requestDigest = digest(JSON.stringify({ organizationId: input.organizationId, ...selection }));
  const prior = await merchant.context.db.get("SELECT * FROM billing_merchant_quotes WHERE actor_id=? AND request_key=?", [input.principal.user.id, requestKey]);
  if (prior) {
    const quote = QuoteSchema.parse(prior);
    if (quote.request_digest !== requestDigest) fail("IDEMPOTENCY_CONFLICT", "Preview key belongs to different input");
    return { quoteId: quote.id, amountMinor: quote.amount_minor, currency: quote.currency, expiresAt: quote.expires_at };
  }
  const settings = await merchant.settings();
  const catalog = await merchant.catalog();
  const plan = catalog.plans.find((item) => item.id === selection.planId && item.period === selection.period);
  if (!plan) fail("BILLING_PLAN_UNKNOWN", "Select a configured price and matching period", 400);
  if (selection.seats < 1) fail("BILLING_SEATS_INVALID", "A subscription needs at least one seat", 400);
  const count = z.object({ total: z.number() }).parse(await merchant.context.db.get(
    "SELECT count(*) AS total FROM members WHERE organization_id=? AND licensed=1", [input.organizationId])).total;
  if (selection.seats < count) fail("SEATS_IN_USE", "Unassign seats before reducing capacity");
  const link = await binding(merchant, input);
  const lease = await claim(merchant.context, input.organizationId);
  try {
    const subscription = link.subscription_id ? await merchant.call(`subscriptions/${encodeURIComponent(link.subscription_id)}`, SubscriptionSchema) : null;
    const item = subscription?.items.data[0];
    const prorationAt = Math.floor(Date.parse(merchant.context.clock.now()) / 1000);
    const fields: Record<string, string> = {
      customer: link.customer_id, "subscription_details[items][0][price]": plan.id,
      "subscription_details[items][0][quantity]": String(selection.seats),
      "subscription_details[proration_behavior]": "always_invoice",
    };
    if (subscription && item) {
      fields["subscription"] = subscription.id;
      fields["subscription_details[items][0][id]"] = item.id;
      fields["subscription_details[proration_date]"] = String(prorationAt);
    }
    const estimate = await merchant.call("invoices/create_preview",
      z.object({ amount_due: z.number().int().nonnegative(), currency: z.string() }), { fields });
    const quote = { id: IdSchema.parse(crypto.randomUUID()), organization_id: input.organizationId,
      actor_id: input.principal.user.id, version: input.expectedVersion, config_version: settings.version,
      price_id: plan.id, seats: selection.seats, amount_minor: estimate.amount_due, currency: estimate.currency,
      expires_at: seconds(prorationAt + 600), proration_at: prorationAt, item_id: item?.id ?? null, used: 0,
      request_key: requestKey, request_digest: requestDigest };
    await authority(merchant.context, input);
    await merchant.context.uow.run(async (tx) => {
      await fence(tx, lease, merchant.context.clock.now());
      await publicationAuthority(merchant.context, tx, input);
      const latest = await merchant.configuration.get(merchantKind, tx);
      if (!latest.enabled || latest.version !== settings.version) fail("VERSION_CONFLICT", "Merchant configuration changed during preview");
      await tx.run(`INSERT INTO billing_merchant_quotes(id,organization_id,actor_id,version,config_version,price_id,seats,amount_minor,currency,expires_at,proration_at,item_id,used,request_key,request_digest)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, Object.values(quote));
    });
    return { quoteId: quote.id, amountMinor: quote.amount_minor, currency: quote.currency, expiresAt: quote.expires_at };
  } finally { await release(merchant.context, lease); }
}
export async function checkout(merchant: Merchant, input: BillingRequest, quoteId: string) {
  return operation(merchant, input, { kind: "billing.checkout", parameters: { quoteId, expectedVersion: input.expectedVersion },
    prepare: async (key, publish) => {
      const settings = await merchant.settings();
      const stored = await merchant.context.db.get("SELECT * FROM billing_merchant_quotes WHERE id=?", [quoteId]);
      if (!stored) fail("BILLING_QUOTE_MISSING", "Preview a configured plan before checkout", 404);
      const quote = QuoteSchema.parse(stored);
      if (quote.organization_id !== input.organizationId || quote.actor_id !== input.principal.user.id)
        fail("FORBIDDEN", "Quote belongs to another organization or administrator", 403);
      conflict(quote.version, input.expectedVersion);
      conflict(settings.version, quote.config_version);
      if (quote.used || quote.expires_at <= merchant.context.clock.now()) fail("BILLING_QUOTE_EXPIRED", "Preview again before checkout");
      const link = await binding(merchant, input);
      const account = await billingAccount(merchant.context, input.organizationId);
      const count = z.object({ total: z.number() }).parse(await merchant.context.db.get(
        "SELECT count(*) AS total FROM members WHERE organization_id=? AND licensed=1", [input.organizationId])).total;
      if (quote.seats < count) fail("SEATS_IN_USE", "Unassign seats before reducing capacity");
      let result: Readonly<Record<string, unknown>>;
      if (link.subscription_id) {
        if (!quote.item_id) fail("BILLING_QUOTE_STALE", "Subscription changed; preview again");
        const updated = await merchant.call(`subscriptions/${encodeURIComponent(link.subscription_id)}`, SubscriptionSchema, {
          key, fields: { "items[0][id]": quote.item_id, "items[0][price]": quote.price_id,
            "items[0][quantity]": String(quote.seats), proration_behavior: "always_invoice",
            proration_date: String(quote.proration_at), payment_behavior: "pending_if_incomplete" },
        });
        result = { subscriptionId: updated.id, reconciliation: "awaiting_webhook" };
      } else {
        if (link.checkout_id && (!link.checkout_until || link.checkout_until > merchant.context.clock.now()))
          fail("BILLING_CHECKOUT_PENDING", "A checkout is already open or uncertain; reconcile it before another purchase");
        // Reserve before dispatch. Unknown external completion is not safe to retry under another key.
        await publish(async (tx) => {
          await tx.run("UPDATE billing_merchant_bindings SET checkout_id=?,checkout_until=NULL WHERE organization_id=?",
            [`pending:${key}`, input.organizationId]);
        });
        const expiresAt = Math.floor(Date.parse(merchant.context.clock.now()) / 1000) + 1800;
        const session = await merchant.call("checkout/sessions", z.object({ id: z.string(), url: z.url(), expires_at: z.number().int() }), {
          key, fields: { mode: "subscription", customer: link.customer_id,
            "line_items[0][price]": quote.price_id, "line_items[0][quantity]": String(quote.seats),
            client_reference_id: input.organizationId, "subscription_data[metadata][quire_organization]": input.organizationId,
            success_url: `${merchant.context.config.publicUrl}/settings/billing`,
            cancel_url: `${merchant.context.config.publicUrl}/settings/billing`, expires_at: String(expiresAt) },
        });
        await publish(async (tx) => {
          await tx.run("UPDATE billing_merchant_bindings SET checkout_id=?,checkout_until=? WHERE organization_id=?",
            [session.id, seconds(session.expires_at), input.organizationId]);
        });
        result = { checkoutId: session.id, url: session.url, reconciliation: "awaiting_webhook", billingAccountId: account.id };
      }
      await publish(async (tx) => { await tx.run("UPDATE billing_merchant_quotes SET used=1 WHERE id=?", [quote.id]); });
      return result;
    } });
}
