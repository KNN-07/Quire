import { expect, test } from "bun:test";
import { OperationSchema } from "@quire/contracts";
import { checkoutDestination } from "../../../../apps/web/src/features/account/billing-navigation";

function operation(result: Readonly<Record<string, unknown>> | null, status = "succeeded", kind = "billing.checkout") {
  return OperationSchema.parse({ id: "11111111-1111-4111-8111-111111111111", kind, status, progress: 1, errorCode: null, result });
}
test("only a succeeded hosted checkout result supplies a navigation destination", () => {
  const result = { checkoutId: "cs_fixture", url: "https://merchant.example.test/checkout/session?token=opaque", reconciliation: "awaiting_webhook" };
  expect(checkoutDestination(operation(result))).toBe(result.url);
  expect(checkoutDestination(operation({ subscriptionId: "sub_fixture", reconciliation: "awaiting_webhook" }))).toBeNull();
  expect(checkoutDestination(operation(null, "running"))).toBeNull();
  expect(checkoutDestination(operation(null))).toBeNull();
  for (const status of ["queued", "running", "failed", "timeout", "canceled"]) {
    expect(checkoutDestination(operation(result, status))).toBeNull();
  }
  expect(checkoutDestination(operation(result, "succeeded", "billing.cancel"))).toBeNull();
});
test("unsupported checkout results and unsafe destinations cannot navigate", () => {
  for (const url of ["javascript:alert(1)", "http://merchant.example.test/pay", "/relative", "//merchant.example.test/pay", "not a url", "https://name:secret@merchant.example.test/pay"]) {
    expect(() => checkoutDestination(operation({ checkoutId: "cs_fixture", url, reconciliation: "awaiting_webhook" }))).toThrow();
  }
  for (const result of [{ checkoutId: "cs_fixture", reconciliation: "awaiting_webhook" }, { url: "https://merchant.example.test/pay" }, { checkoutId: "cs_fixture", url: "https://merchant.example.test/pay", reconciliation: "paid" }]) {
    expect(() => checkoutDestination(operation(result))).toThrow();
  }
});
