import type { endpoints, ResponseOf } from "@quire/contracts";

type Catalog = ResponseOf<typeof endpoints.billingCatalog>;

export function billingPlanPath(plan: Catalog["plans"][number]): string {
  return `/settings/billing?${new URLSearchParams({ plan: plan.id, period: plan.period })}`;
}

export function selectedBillingPlan(path: string, catalog: Catalog) {
  const query = new URL(path, "https://quire.invalid").searchParams;
  if (!query.has("plan") && !query.has("period")) return { plan: null, error: "" };
  const plan = catalog.configured ? catalog.plans.find(candidate => candidate.id === query.get("plan") && candidate.period === query.get("period")) : undefined;
  return plan ? { plan, error: "" } : { plan: null, error: "The selected plan or billing period is unavailable in the current catalog. Return to pricing to choose a published plan." };
}
