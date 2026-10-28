import { z } from "zod";
import type { Operation } from "@quire/contracts";

const checkoutResult = z.union([
  z.object({ checkoutId: z.string().min(1), url: z.string(), reconciliation: z.literal("awaiting_webhook") }),
  z.object({ subscriptionId: z.string().min(1), reconciliation: z.literal("awaiting_webhook") }),
]);

export function checkoutDestination(operation: Operation): string | null {
  if (operation.kind !== "billing.checkout" || operation.status !== "succeeded" || !operation.result) return null;
  const parsed = checkoutResult.safeParse(operation.result);
  if (!parsed.success) throw new Error("Checkout returned no supported destination or subscription update. Payment is not confirmed.");
  if (!("checkoutId" in parsed.data)) return null;
  const destination = parsed.data.url;
  if (!URL.canParse(destination)) throw new Error("Checkout returned an invalid hosted destination. Payment is not confirmed.");
  const url = new URL(destination);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Checkout requires a hosted HTTPS destination without credentials. Payment is not confirmed.");
  return url.href;
}
