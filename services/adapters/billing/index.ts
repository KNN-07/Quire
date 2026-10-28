import { z } from "zod";
import { endpoints, DigestSchema } from "@quire/contracts";
import type { ServiceModule, ModuleContext } from "@quire/runtime";
import { installBillingCatalog, fresh } from "../../accounts/governance/billing";
import { authorize } from "../../accounts/governance/shared";
import { Merchant, MerchantSecretSchema, merchantKind, fail } from "./contracts";
import { preview, checkout } from "./quotes";
import { authority, binding, operation } from "./store";
import { receive, readWebhook } from "./webhooks";
import { migrations } from "./migrations";
import { SubscriptionSchema } from "./contracts";
import type { AdapterContribution, SafeHttpClient } from "../shared";
import { registerDetails } from "./details";

export const stripeBillingContribution: AdapterContribution = ({ http }) => ({
  kind: merchantKind, label: "Stripe merchant billing",
  configuration: (settings) => {
    if (!settings.secret) return ["Stripe secret API key", "webhook signing secrets", "merchant price IDs", "portal configuration ID"];
    let value: unknown;
    try { value = JSON.parse(settings.secret); }
    catch (error) { if (error instanceof SyntaxError) return ["valid merchant JSON secret"]; throw error; }
    const parsed = MerchantSecretSchema.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map((issue) => `merchant secret ${issue.path.join(".")}`);
  },
  actions: {},
  test: async ({ configuration }) => {
    const secret = MerchantSecretSchema.parse(JSON.parse(configuration.secret ?? "{}"));
    await http.json(`${configuration.baseUrl.replace(/\/$/, "")}/v1/account`, z.object({ id: z.string() }), {
      headers: { authorization: `Bearer ${secret.apiKey}` },
    });
    return { ok: true };
  },
  probe: async (configuration) => {
    const secret = MerchantSecretSchema.parse(JSON.parse(configuration.secret ?? "{}"));
    await http.json(`${configuration.baseUrl.replace(/\/$/, "")}/v1/account`, z.object({ id: z.string() }), {
      headers: { authorization: `Bearer ${secret.apiKey}` },
    });
    return { ok: true };
  },
});
function registerMerchant(context: ModuleContext, http?: SafeHttpClient) {
  const merchant = new Merchant(context, http);
  installBillingCatalog(context, () => merchant.catalog());
  registerDetails(merchant);
  context.routes.register(endpoints.billingPreview, async ({ params, body }, request) => {
    const principal = await context.services.get("identity").require(request.request);
    await context.services.get("identity").verifyMutation(request.request, principal);
    return preview(merchant, { organizationId: params.o, expectedVersion: body.expectedVersion,
      principal, request: request.request }, body);
  });
  context.routes.register(endpoints.billingCheckout, async ({ params, body }, request) => {
    const principal = await context.services.get("identity").require(request.request);
    await context.services.get("identity").verifyMutation(request.request, principal);
    return checkout(merchant, { organizationId: params.o, expectedVersion: body.expectedVersion,
      principal, request: request.request }, body.quoteId);
  });
  context.routes.register(endpoints.billingCancel, async ({ params, body }, request) => {
    const principal = await context.services.get("identity").require(request.request);
    await context.services.get("identity").verifyMutation(request.request, principal);
    const input = { organizationId: params.o, expectedVersion: body.expectedVersion, principal, request: request.request };
    return operation(merchant, input, { kind: "billing.cancel", parameters: body, prepare: async (key) => {
      const link = await binding(merchant, input);
      if (!link.subscription_id) fail("BILLING_SUBSCRIPTION_MISSING", "No merchant subscription to cancel");
      const path = `subscriptions/${encodeURIComponent(link.subscription_id)}`;
      const result = await merchant.call(path, SubscriptionSchema, body.atPeriodEnd
        ? { key, fields: { cancel_at_period_end: "true" } } : { key, method: "DELETE" });
      return { subscriptionId: result.id, atPeriodEnd: body.atPeriodEnd, reconciliation: "awaiting_webhook" };
    } });
  });
  context.routes.register(endpoints.invoiceDownload, async ({ params }, request) => {
    const principal = await context.services.get("identity").require(request.request);
    await authorize(context, principal, { organizationId: params.o, level: "admin" });
    await fresh(context, principal);
    const row = await context.db.get(`SELECT d.sha256 FROM billing_merchant_documents d JOIN invoices i ON i.id=d.invoice_id
      JOIN billing_accounts b ON b.id=i.billing_account_id WHERE i.id=? AND b.organization_id=?`, [params.id, params.o]);
    if (!row) fail("BILLING_DOCUMENT_MISSING", "No provider invoice document is available", 404);
    const hash = z.object({ sha256: DigestSchema }).parse(row).sha256;
    request.responseHeaders.set("content-type", "application/pdf");
    request.responseHeaders.set("content-disposition", `attachment; filename="invoice-${params.id}.pdf"`);
    return new Uint8Array(await context.blobs.get(hash));
  });
  context.routes.registerTransport(endpoints.billingWebhook, async (request) => {
    if (new URL(request.request.url).pathname !== "/api/webhooks/billing/stripe")
      fail("BILLING_PROVIDER_UNKNOWN", "Configured webhook provider is stripe", 404);
    await receive(merchant, { bytes: await readWebhook(request.request),
      signature: request.request.headers.get("stripe-signature") ?? "" });
    return Response.json({ data: { ok: true, version: 0 }, requestId: request.requestId });
  });
}
export function createBillingModules(options: { readonly http?: SafeHttpClient } = {}): {
  readonly merchant: ServiceModule; readonly portal: ServiceModule;
} {
  return {
    merchant: { id: "067-x-billing", lane: "A", order: 67, migrations, register: (context) => registerMerchant(context, options.http) },
    portal: { id: "068-x-billing-portal", lane: "X", order: 68, register(context) {
      const merchant = new Merchant(context, options.http);
      context.routes.register(endpoints.billingPortal, async ({ params, body }, request) => {
        const principal = await context.services.get("identity").require(request.request);
        await context.services.get("identity").verifyMutation(request.request, principal);
        const input = { organizationId: params.o, expectedVersion: body.expectedVersion, principal, request: request.request };
        await authority(context, input);
        const result = await operation(merchant, input, { kind: "billing.portal", parameters: body, prepare: async (key) => {
          const settings = await merchant.settings();
          const link = await binding(merchant, input);
          return merchant.call("billing_portal/sessions", z.object({ url: z.url() }), { key,
            fields: { customer: link.customer_id, configuration: settings.merchant.portalConfiguration,
              return_url: `${context.config.publicUrl}/settings/billing` } });
        } });
        if (!result.result) fail("BILLING_OPERATION_UNCERTAIN", "Portal creation is awaiting reconciliation");
        return z.object({ url: z.url() }).parse(result.result);
      });
    } },
  };
}
export { migrations };
