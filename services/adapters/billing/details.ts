import { z } from "zod";
import { BillingAccountSchema } from "@quire/contracts";
import { installBillingDetails, updateBillingDetails } from "../../accounts/governance/billing";
import { binding, operation } from "./store";
import { digest, merchantKind, fail } from "./contracts";
import type { Merchant } from "./contracts";

export function registerDetails(merchant: Merchant) {
  const context = merchant.context;
  installBillingDetails(context, async (input, request, principal) => {
    const settings = await merchant.configuration.get(merchantKind);
    if (!settings.enabled || !settings.secret) return context.uow.run(async (tx) =>
      updateBillingDetails({ ...context, db: tx }, input, principal));
    // The existing contract carries an untyped tax identifier, not a Stripe tax-id type.
    // Preserve it as invoice display information; legal tax registration stays in the hosted portal.
    if (input.taxId.length > 140 || input.address.length > 200)
      fail("BILLING_DETAILS_TOO_LONG", "Stripe invoice tax display allows 140 characters and address line allows 200", 400);
    const headers = new Headers(request.request.headers);
    headers.set("idempotency-key", `billing-details:${input.organizationId}:${input.expectedVersion}:${digest(JSON.stringify(input))}`);
    const action = { organizationId: input.organizationId, expectedVersion: input.expectedVersion,
      principal, request: new Request(request.request.url, { headers }) };
    const result = await operation(merchant, action, {
      kind: "billing.details", parameters: input,
      prepare: async (key) => {
        const link = await binding(merchant, action);
        await merchant.call(`customers/${encodeURIComponent(link.customer_id)}`, z.object({ id: z.string() }), {
          key, fields: { email: input.invoiceEmail, "address[line1]": input.address,
            ...(input.taxId ? { "invoice_settings[custom_fields][0][name]": "Tax ID",
              "invoice_settings[custom_fields][0][value]": input.taxId } : { "invoice_settings[custom_fields]": "" }) },
        });
        return { customerId: link.customer_id };
      },
      complete: async (tx, prepared) => ({
        ...prepared, billingAccount: await updateBillingDetails({ ...context, db: tx }, input, principal),
      }),
    });
    if (!result.result) fail("BILLING_OPERATION_UNCERTAIN", "Customer update is awaiting reconciliation");
    return BillingAccountSchema.parse(result.result["billingAccount"]);
  });
}
