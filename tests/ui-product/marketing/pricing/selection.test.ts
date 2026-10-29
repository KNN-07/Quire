import { expect, test } from "bun:test";
import { billingPlanPath, selectedBillingPlan } from "../../../../apps/web/src/features/marketing/pricing-selection";

test("validates an exact catalog identity and period without substitution", () => {
  const plan = { id: "operator/+year", name: "Annual", period: "year" as const, amountMinor: 9876, currency: "USD" };
  const catalog = { configured: true, plans: [plan] };
  expect(selectedBillingPlan(billingPlanPath(plan), catalog)).toEqual({ plan, error: "" });
  for (const path of ["/settings/billing?plan=missing&period=year", "/settings/billing?plan=operator%2F%2Byear&period=month", "/settings/billing?period=year", "/settings/billing?plan=operator%2F%2Byear"]) {
    const selection = selectedBillingPlan(path, catalog);
    expect(selection.plan).toBeNull();
    expect(selection.error.length).toBeGreaterThan(0);
  }
  expect(selectedBillingPlan(billingPlanPath(plan), { configured: false, plans: [] }).plan).toBeNull();
  expect(selectedBillingPlan("/settings/billing", catalog)).toEqual({ plan: null, error: "" });
});
