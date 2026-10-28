import type { TransactionContext } from "./shared";
import { z } from "zod";
import { BillingAccountSchema, endpoints, IdSchema, InvoiceSchema } from "@quire/contracts";
import type { BillingAccount, Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Principal, RequestContext } from "@quire/runtime";
import { authorize, audit, conflict, newId, page, route, publishPolicyChange } from "./shared";
import { operator } from "./reports";

export type BillingCatalogHook = () => Promise<{
  readonly configured: boolean;
  readonly plans: readonly { readonly id: string; readonly name: string; readonly amountMinor: number;
    readonly currency: string; readonly period: "month" | "year" }[];
}>;
const catalogHooks = new WeakMap<ModuleContext["services"], BillingCatalogHook>();
export type BillingDetailsInput = {
  readonly organizationId: Id; readonly expectedVersion: number; readonly invoiceEmail: string;
  readonly taxId: string; readonly address: string;
};
export type BillingDetailsHook = (input: BillingDetailsInput, request: RequestContext, principal: Principal) => Promise<BillingAccount>;
const detailsHooks = new WeakMap<ModuleContext["services"], BillingDetailsHook>();
export function installBillingDetails(context: ModuleContext, hook: BillingDetailsHook): void {
  if (detailsHooks.has(context.services)) throw new ServiceError("DUPLICATE_BILLING", 500, "Merchant details already installed");
  detailsHooks.set(context.services, hook);
}
export async function updateBillingDetails(context: TransactionContext, input: BillingDetailsInput, principal: Principal) {
  await authorize(context, principal, { organizationId: input.organizationId, level: "admin" });
  await fresh(context, principal);
  const current = await ensureBillingAccount(context, input.organizationId, principal.user.primaryEmail);
  conflict(current.version, input.expectedVersion);
  await context.db.run("UPDATE billing_accounts SET invoice_email=?,tax_id=?,address=?,version=version+1 WHERE id=?",
    [input.invoiceEmail, input.taxId, input.address, current.id]);
  await audit(context, principal, { organizationId: input.organizationId, event: "billing.details.updated", targetId: current.id });
  return billingAccount(context, input.organizationId);
}
export function installBillingCatalog(context: ModuleContext, catalog: BillingCatalogHook): void {
  if (catalogHooks.has(context.services)) throw new ServiceError("DUPLICATE_BILLING", 500, "Merchant already installed");
  catalogHooks.set(context.services, catalog);
}
export async function fresh(context: ModuleContext, principal: Principal): Promise<void> {
  const row = z.object({ created_at: z.string() }).parse((await context.db.get("SELECT created_at FROM sessions WHERE id=?", [principal.sessionId])));
  if (Date.parse(context.clock.now()) - Date.parse(row.created_at) > 900_000)
    throw new ServiceError("FRESH_AUTH_REQUIRED", 403, "Sign in again for this operation");
}
export async function billingAccount(context: ModuleContext, organizationId: Id): Promise<BillingAccount> {
  const value = (await context.db.get("SELECT * FROM billing_accounts WHERE organization_id=?", [organizationId]));
  if (!value) throw new ServiceError("BILLING_NOT_FOUND", 404, "Billing account not initialized");
  const row = z.object({
    id: IdSchema, organization_id: IdSchema.nullable(), user_id: IdSchema.nullable(), provider: z.string(),
    plan_id: z.string().nullable(), period: z.string(), seats: z.number(), status: z.string(), renews_at: z.string().nullable(),
    invoice_email: z.string(), tax_id: z.string(), address: z.string(), version: z.number(),
  }).parse(value);
  return BillingAccountSchema.parse({ id: row.id, organizationId: row.organization_id, userId: row.user_id,
    provider: row.provider, planId: row.plan_id, period: row.period, seats: row.seats, status: row.status,
    renewsAt: row.renews_at, invoiceEmail: row.invoice_email, taxId: row.tax_id, address: row.address, version: row.version });
}
export async function ensureBillingAccount(context: TransactionContext, organizationId: Id, email: string): Promise<BillingAccount> {
  await context.db.lock("quire:accounts");
  await context.db.run("INSERT INTO billing_accounts(id,organization_id,provider,period,status,invoice_email,created_at) VALUES(?,?,'manual','month','unbilled',?,?) ON CONFLICT DO NOTHING", [newId(), organizationId, email, context.clock.now()]);
  return (await billingAccount(context, organizationId));
}
export type BillingTransition = Pick<BillingAccount, "planId" | "period" | "seats" | "status" | "renewsAt"> & {
  readonly organizationId: Id; readonly expectedVersion: number; readonly provider?: BillingAccount["provider"];
};
// Trusted adapter seam: invoke inside the verified webhook's receipt transaction.
// Null actor denotes a verified provider event, never an invented operator session.
export async function recordBillingTransition(context: TransactionContext, input: BillingTransition & {
  readonly actorId: Id | null;
}): Promise<BillingAccount> {
  await context.db.lock("quire:accounts");
  const current = (await billingAccount(context, input.organizationId));
  conflict(current.version, input.expectedVersion);
  const next = BillingAccountSchema.parse({ ...current, planId: input.planId, period: input.period,
    seats: input.seats, status: input.status, renewsAt: input.renewsAt,
    provider: input.provider ?? current.provider, version: current.version + 1 });
  const count = z.object({ total: z.number() }).parse((await context.db.get("SELECT count(*) AS total FROM members WHERE organization_id=? AND licensed=1", [input.organizationId]))).total;
  if (next.status !== "unbilled" && next.seats < count)
    throw new ServiceError("SEATS_IN_USE", 409, "Unassign seats before reducing capacity");
  await context.db.run("UPDATE billing_accounts SET plan_id=?,period=?,seats=?,status=?,renews_at=?,provider=?,version=version+1 WHERE id=?", [next.planId, next.period, next.seats, next.status, next.renewsAt, next.provider, current.id]);
  await context.db.run("INSERT INTO audit_entries(id,at,actor_id,organization_id,event,target_id,details_json) VALUES(?,?,?,?,'billing.transitioned',?,?)", [newId(), context.clock.now(), input.actorId, input.organizationId, current.id, JSON.stringify({ status: next.status, seats: next.seats })]);
  await publishPolicyChange(context, { organizationId: input.organizationId, version: next.version });
  return next;
}
export async function applyBillingTransition(context: ModuleContext, principal: Principal, input: BillingTransition): Promise<BillingAccount> {
  operator(principal);
  const result = await context.uow.run(async (tx) => {
    await tx.lock("quire:accounts");
    const bound = { ...context, db: tx };

    await ensureBillingAccount(bound, input.organizationId, principal.user.primaryEmail);
    return (await recordBillingTransition(bound, { ...input, actorId: principal.user.id }));
  });
  await context.events.dispatch();
  return result;
}
export function registerBilling(context: ModuleContext): void {
  context.routes.register(endpoints.billingCatalog, async () => {
    const catalog = await catalogHooks.get(context.services)?.() ?? { configured: false, plans: [] };
    return { configured: catalog.configured, plans: [...catalog.plans] };
  });
  route(context, endpoints.billingGet, async ({ params }, principal, request, bound) => {
    await authorize(bound, principal, { organizationId: params.o, level: "admin" });
    await fresh(bound, principal);
    const account = await ensureBillingAccount(bound, params.o, principal.user.primaryEmail);
    request.responseHeaders.set("etag", `"v${account.version}"`);
    return account;
  });
  context.routes.register(endpoints.billingDetails, async ({ params, body }, request) => {
    const identity = context.services.get("identity");
    const principal = await identity.require(request.request);
    await identity.verifyMutation(request.request, principal);
    const input = { ...body, organizationId: params.o };
    const hook = detailsHooks.get(context.services);
    const account = hook ? await hook(input, request, principal) : await context.uow.run(async (tx) =>
      updateBillingDetails({ ...context, db: tx }, input, principal));
    await context.events.dispatch();
    request.responseHeaders.set("etag", `"v${account.version}"`);
    return account;
  });
  route(context, endpoints.billingInvoices, async ({ params, query }, principal, _request, bound) => {
    await authorize(bound, principal, { organizationId: params.o, level: "admin" });
    await fresh(bound, principal);
    const rows = z.array(z.object({ id: IdSchema, billing_account_id: IdSchema, provider_id: z.string().nullable(),
      amount_minor: z.number(), currency: z.string(), status: z.string(), issued_at: z.string(), document_artifact_id: IdSchema.nullable() }))
      .parse((await bound.db.all("SELECT i.* FROM invoices i JOIN billing_accounts b ON b.id=i.billing_account_id WHERE b.organization_id=? AND i.id>? ORDER BY i.id LIMIT ?", [params.o, query.cursor ?? "", query.limit + 1])));
    return page(rows.map((row) => InvoiceSchema.parse({ id: row.id, billingAccountId: row.billing_account_id,
      providerId: row.provider_id, amountMinor: row.amount_minor, currency: row.currency, status: row.status,
      issuedAt: row.issued_at, documentArtifactId: row.document_artifact_id })), query.limit);
  });
}
