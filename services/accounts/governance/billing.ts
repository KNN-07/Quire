import { z } from "zod";
import { BillingAccountSchema, endpoints, IdSchema, InvoiceSchema } from "@quire/contracts";
import type { BillingAccount, Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Principal } from "@quire/runtime";
import { authorize, audit, conflict, newId, page, route } from "./shared";
import { operator } from "./reports";

export function fresh(context: ModuleContext, principal: Principal): void {
  const row = z.object({ created_at: z.string() }).parse(context.db.query(
    "SELECT created_at FROM sessions WHERE id=?").get(principal.sessionId));
  if (Date.parse(context.clock.now()) - Date.parse(row.created_at) > 900_000)
    throw new ServiceError("FRESH_AUTH_REQUIRED", 403, "Sign in again for this operation");
}
export function billingAccount(context: ModuleContext, organizationId: Id): BillingAccount {
  const value = context.db.query("SELECT * FROM billing_accounts WHERE organization_id=?").get(organizationId);
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
export function ensureBillingAccount(context: ModuleContext, organizationId: Id, email: string): BillingAccount {
  context.db.query("INSERT OR IGNORE INTO billing_accounts(id,organization_id,provider,period,status,invoice_email,created_at) VALUES(?,?,'manual','month','unbilled',?,?)")
    .run(newId(), organizationId, email, context.clock.now());
  return billingAccount(context, organizationId);
}
export type BillingTransition = Pick<BillingAccount, "planId" | "period" | "seats" | "status" | "renewsAt"> & {
  readonly organizationId: Id; readonly expectedVersion: number; readonly provider?: BillingAccount["provider"];
};
// Trusted adapter seam: invoke inside the verified webhook's receipt transaction.
// Null actor denotes a verified provider event, never an invented operator session.
export function recordBillingTransition(context: ModuleContext, input: BillingTransition & {
  readonly actorId: Id | null;
}): BillingAccount {
  const current = billingAccount(context, input.organizationId);
  conflict(current.version, input.expectedVersion);
  const next = BillingAccountSchema.parse({ ...current, planId: input.planId, period: input.period,
    seats: input.seats, status: input.status, renewsAt: input.renewsAt,
    provider: input.provider ?? current.provider, version: current.version + 1 });
  const count = z.object({ total: z.number() }).parse(context.db.query(
    "SELECT count(*) AS total FROM members WHERE organization_id=? AND licensed=1").get(input.organizationId)).total;
  if (next.status !== "unbilled" && next.seats < count)
    throw new ServiceError("SEATS_IN_USE", 409, "Unassign seats before reducing capacity");
  context.db.query("UPDATE billing_accounts SET plan_id=?,period=?,seats=?,status=?,renews_at=?,provider=?,version=version+1 WHERE id=?")
    .run(next.planId, next.period, next.seats, next.status, next.renewsAt, next.provider, current.id);
  context.db.query("INSERT INTO audit_entries(id,at,actor_id,organization_id,event,target_id,details_json) VALUES(?,?,?,?,'billing.transitioned',?,?)")
    .run(newId(), context.clock.now(), input.actorId, input.organizationId, current.id,
      JSON.stringify({ status: next.status, seats: next.seats }));
  return next;
}
export function applyBillingTransition(context: ModuleContext, principal: Principal, input: BillingTransition): BillingAccount {
  operator(principal);
  return context.uow.local(() => {
    ensureBillingAccount(context, input.organizationId, principal.user.primaryEmail);
    return recordBillingTransition(context, { ...input, actorId: principal.user.id });
  });
}
export function registerBilling(context: ModuleContext): void {
  context.routes.register(endpoints.billingCatalog, () => ({ configured: false, plans: [] }));
  route(context, endpoints.billingGet, ({ params }, principal, request) => {
    authorize(context, principal, { organizationId: params.o, level: "admin" });
    fresh(context, principal);
    const account = context.uow.local(() => ensureBillingAccount(context, params.o, principal.user.primaryEmail));
    request.responseHeaders.set("etag", `"v${account.version}"`);
    return account;
  });
  route(context, endpoints.billingDetails, ({ params, body }, principal, request) => {
    authorize(context, principal, { organizationId: params.o, level: "admin" });
    fresh(context, principal);
    const current = ensureBillingAccount(context, params.o, principal.user.primaryEmail);
    conflict(current.version, body.expectedVersion);
    context.db.query("UPDATE billing_accounts SET invoice_email=?,tax_id=?,address=?,version=version+1 WHERE id=?")
      .run(body.invoiceEmail, body.taxId, body.address, current.id);
    audit(context, principal, { organizationId: params.o, event: "billing.details.updated", targetId: current.id });
    request.responseHeaders.set("etag", `"v${current.version + 1}"`);
    return billingAccount(context, params.o);
  });
  route(context, endpoints.billingInvoices, ({ params, query }, principal) => {
    authorize(context, principal, { organizationId: params.o, level: "admin" });
    fresh(context, principal);
    const rows = z.array(z.object({ id: IdSchema, billing_account_id: IdSchema, provider_id: z.string().nullable(),
      amount_minor: z.number(), currency: z.string(), status: z.string(), issued_at: z.string(), document_artifact_id: IdSchema.nullable() }))
      .parse(context.db.query("SELECT i.* FROM invoices i JOIN billing_accounts b ON b.id=i.billing_account_id WHERE b.organization_id=? AND i.id>? ORDER BY i.id LIMIT ?")
        .all(params.o, query.cursor ?? "", query.limit + 1));
    return page(rows.map((row) => InvoiceSchema.parse({ id: row.id, billingAccountId: row.billing_account_id,
      providerId: row.provider_id, amountMinor: row.amount_minor, currency: row.currency, status: row.status,
      issuedAt: row.issued_at, documentArtifactId: row.document_artifact_id })), query.limit);
  });
}
