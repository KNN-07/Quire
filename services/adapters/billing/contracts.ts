import { z } from "zod";
import { IdSchema, InstantSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { ProviderConfigurations, SafeHttpClient } from "../shared";

export const merchantKind = "stripe-billing";
export const apiVersion = "2025-06-30.basil";
export const MerchantSecretSchema = z.strictObject({
  apiKey: z.string().startsWith("sk_"),
  webhookSecrets: z.array(z.string().startsWith("whsec_")).min(1).max(2),
  prices: z.array(z.strictObject({ id: z.string().regex(/^price_[A-Za-z0-9_]+$/), name: z.string().min(1) })).min(1),
  portalConfiguration: z.string().startsWith("bpc_"),
}).readonly();
export type MerchantSecret = z.infer<typeof MerchantSecretSchema>;
export const PriceSchema = z.object({
  id: z.string(), active: z.boolean(), type: z.literal("recurring"),
  billing_scheme: z.literal("per_unit"), unit_amount: z.number().int().nonnegative(),
  currency: z.string(), transform_quantity: z.null(),
  recurring: z.object({ interval: z.enum(["month", "year"]), interval_count: z.literal(1), usage_type: z.literal("licensed") }),
});
export const SubscriptionSchema = z.object({
  id: z.string(), customer: z.string(), metadata: z.object({ quire_organization: IdSchema }),
  status: z.enum(["active", "trialing", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"]),
  cancel_at_period_end: z.boolean(),
  items: z.object({ has_more: z.literal(false), data: z.array(z.object({
    id: z.string(), price: PriceSchema, quantity: z.number().int().nonnegative(),
    current_period_start: z.number().int(), current_period_end: z.number().int(),
  })).length(1) }),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;
export const BindingSchema = z.object({
  organization_id: IdSchema, customer_id: z.string(), subscription_id: z.string().nullable(),
  claim: z.string().nullable(), claim_until: z.string().nullable(), generation: z.number().int(),
  checkout_id: z.string().nullable(), checkout_until: z.string().nullable(),
});
export const QuoteSchema = z.object({
  id: IdSchema, organization_id: IdSchema, actor_id: IdSchema, version: z.number().int(),
  config_version: z.number().int(), price_id: z.string(), seats: z.number().int(),
  amount_minor: z.number().int().nonnegative(), currency: z.string(), expires_at: InstantSchema,
  proration_at: z.number().int(), item_id: z.string().nullable(), used: z.number().int(),
  request_key: z.string(), request_digest: z.string(),
});
export type Quote = z.infer<typeof QuoteSchema>;
export function seconds(value: number) { return InstantSchema.parse(new Date(value * 1000).toISOString()); }
export function digest(value: string | Uint8Array) { return new Bun.CryptoHasher("sha256").update(value).digest("hex"); }
export function fail(code: string, message: string, status = 409): never { throw new ServiceError(code, status, message); }
export class Merchant {
  readonly configuration: ProviderConfigurations;
  constructor(readonly context: ModuleContext, readonly http = new SafeHttpClient()) {
    this.configuration = new ProviderConfigurations(context, http);
  }
  async settings() {
    const value = await this.configuration.get(merchantKind);
    if (!value.enabled || !value.secret) fail("BILLING_UNCONFIGURED", "Missing: enabled stripe-billing provider; encrypted merchant JSON (apiKey, webhookSecrets, prices, portalConfiguration)", 503);
    let secret: unknown;
    try { secret = JSON.parse(value.secret); }
    catch (error) {
      if (error instanceof SyntaxError) fail("BILLING_UNCONFIGURED", "Missing: valid encrypted merchant JSON secret", 503);
      throw error;
    }
    const parsed = MerchantSecretSchema.safeParse(secret);
    if (!parsed.success) fail("BILLING_UNCONFIGURED", "Missing or invalid: apiKey; webhookSecrets; prices; portalConfiguration", 503);
    return { ...value, merchant: parsed.data };
  }
  async call<T extends z.ZodType>(path: string, schema: T, input: {
    readonly fields?: Readonly<Record<string, string>>; readonly key?: string; readonly method?: "POST" | "DELETE";
  } = {}) {
    const settings = await this.settings();
    return this.http.json(`${settings.baseUrl.replace(/\/$/, "")}/v1/${path}`, schema, {
      method: input.method ?? (input.fields ? "POST" : "GET"),
      headers: { authorization: `Bearer ${settings.merchant.apiKey}`, "stripe-version": apiVersion,
        ...(input.key ? { "idempotency-key": input.key } : {}),
        ...(input.fields ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      ...(input.fields ? { body: new URLSearchParams(input.fields).toString() } : {}),
    });
  }
  async catalog() {
    const raw = await this.configuration.get(merchantKind);
    if (!raw.enabled || !raw.secret) return { configured: false, plans: [] };
    const settings = await this.settings();
    const plans = [];
    for (const entry of settings.merchant.prices) {
      const price = await this.call(`prices/${entry.id}`, PriceSchema);
      if (!price.active) fail("BILLING_PRICE_INACTIVE", `Configured Stripe price ${entry.id} is inactive`, 503);
      plans.push({ id: price.id, name: entry.name, amountMinor: price.unit_amount,
        currency: price.currency, period: price.recurring.interval });
    }
    return { configured: true, plans };
  }
}
