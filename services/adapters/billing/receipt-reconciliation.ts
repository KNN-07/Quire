import { z } from "zod";
import { OperationSchema } from "@quire/contracts";
import type { Transaction } from "@quire/contracts";
import type { Merchant, Subscription } from "./contracts";
import { QuoteSchema } from "./contracts";

export async function reconcileReceipts(merchant: Merchant, tx: Transaction, subscription: Subscription) {
  const rows = z.array(z.object({ actor_id: z.string(), key: z.string(), operation_json: z.string(), request_json: z.string() }))
    .parse(await tx.all("SELECT * FROM billing_merchant_receipts WHERE organization_id=?", [subscription.metadata.quire_organization]));
  const item = subscription.items.data[0];
  if (!item) return;
  for (const row of rows) {
    const operation = OperationSchema.parse(JSON.parse(row.operation_json));
    if (operation.status !== "running") continue;
    let confirmed = false;
    if (operation.kind === "billing.checkout") {
      const request = z.object({ quoteId: z.string() }).parse(JSON.parse(row.request_json));
      const quote = QuoteSchema.parse(await tx.get("SELECT * FROM billing_merchant_quotes WHERE id=?", [request.quoteId]));
      confirmed = subscription.status !== "incomplete" && subscription.status !== "incomplete_expired" &&
        quote.price_id === item.price.id && quote.seats === item.quantity;
      if (confirmed) await tx.run("UPDATE billing_merchant_quotes SET used=1 WHERE id=?", [quote.id]);
    } else if (operation.kind === "billing.cancel") {
      const request = z.object({ atPeriodEnd: z.boolean() }).parse(JSON.parse(row.request_json));
      confirmed = request.atPeriodEnd ? subscription.cancel_at_period_end : subscription.status === "canceled";
    }
    if (!confirmed) continue;
    const done = { ...operation, status: "succeeded", progress: 1,
      result: { subscriptionId: subscription.id, reconciliation: "verified_webhook" } };
    await tx.run("UPDATE billing_merchant_receipts SET operation_json=? WHERE actor_id=? AND key=?",
      [JSON.stringify(done), row.actor_id, row.key]);
    await tx.run("UPDATE operations SET status='succeeded',progress=1,result_json=?,version=version+1,updated_at=? WHERE id=?",
      [JSON.stringify({ organizationId: subscription.metadata.quire_organization, blob: null, projectIds: [] }),
        merchant.context.clock.now(), operation.id]);
    await merchant.context.events.record(tx, { topic: "operation.changed", aggregateId: operation.id,
      payload: { resourceId: operation.id, status: "succeeded" } });
  }
}
