import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, InstantSchema, OperationSchema, InvoiceSchema } from "@quire/contracts";
import { data } from "../../accounts/governance/harness";
import { billingFixture } from "./harness";
import { invoiceBytes } from "./provider";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { policy } from "../../../services/accounts/identity/policy";
import { ownerBenefits } from "../../../services/accounts/identity/project-benefits";

const quoteSchema = z.object({ quoteId: IdSchema, amountMinor: z.number(), currency: z.string(), expiresAt: InstantSchema });
test("uses real configured prices and a provider preview before hosted checkout without activating a subscription", async () => {
  // Given: configured Stripe prices, a real administrator, and local unbilled governance.
  await using app = await billingFixture();
  const catalog = await data(await app.request("/api/billing/catalog"), z.object({ configured: z.boolean(), plans: z.array(z.object({ amountMinor: z.number() })) }));
  // When: the administrator previews two monthly seats and creates a hosted checkout.
  const quote = await data(await app.admin.write(`${app.path}/preview`, { planId: "price_month", seats: 2, period: "month", expectedVersion: 0 }), quoteSchema);
  const response = await app.admin.write(`${app.path}/checkout`, { quoteId: quote.quoteId, expectedVersion: 0 }, "checkout-first");
  const operation = await data(response, OperationSchema);
  // Then: provider amounts and a hosted URL are returned, but no payment or local activation is invented.
  expect(catalog.plans.map((plan) => plan.amountMinor)).toEqual([1500, 15000]);
  expect(quote.amountMinor).toBe(3000);
  expect(operation.result?.["url"]).toBe("https://checkout.stripe.com/c/pay/cs_fixture");
  expect((await app.account()).status).toBe("unbilled");
  expect(await data(await app.admin.write(`${app.path}/checkout`, { quoteId: quote.quoteId, expectedVersion: 0 }, "checkout-first"), OperationSchema)).toEqual(operation);
  expect(app.provider.calls.filter((call) => call.path === "/v1/checkout/sessions")).toHaveLength(1);
});
test("reconciles duplicate and reordered signed events from authoritative provider state", async () => {
  // Given: a hosted checkout completed at the provider.
  await using app = await billingFixture();
  const quote = await data(await app.admin.write(`${app.path}/preview`, { planId: "price_month", seats: 2, period: "month", expectedVersion: 0 }), quoteSchema);
  await app.admin.write(`${app.path}/checkout`, { quoteId: quote.quoteId, expectedVersion: 0 });
  const stale = app.provider.event("evt_old");
  app.provider.complete();
  await app.webhook(app.provider.event("evt_checkout", "checkout.session.completed"));
  app.provider.setSeats(4);
  const newest = app.provider.event("evt_new", "customer.subscription.updated", 1793102410);
  // When: a newer event, duplicate, and old snapshot arrive in that order.
  expect((await app.webhook(newest)).status).toBe(200);
  const version = (await app.account()).version;
  expect((await app.webhook(newest)).status).toBe(200);
  expect((await app.webhook(stale)).status).toBe(200);
  // Then: old event snapshots cannot roll capacity or billing version backwards.
  const account = await app.account();
  expect(account.seats).toBe(4);
  expect(account.version).toBe(version);
  expect((await app.runtime.db.all("SELECT * FROM webhook_receipts"))).toHaveLength(3);
});
test("changes seats and period with matched proration and defers cancellation to its verified webhook", async () => {
  // Given: an active configured subscription.
  await using app = await billingFixture();
  const first = await data(await app.admin.write(`${app.path}/preview`, { planId: "price_month", seats: 2, period: "month", expectedVersion: 0 }), quoteSchema);
  await app.admin.write(`${app.path}/checkout`, { quoteId: first.quoteId, expectedVersion: 0 });
  await app.webhook(app.provider.event("evt_active"));
  const account = await app.account();
  const quote = await data(await app.admin.write(`${app.path}/preview`, { planId: "price_year", seats: 3, period: "year", expectedVersion: account.version }), quoteSchema);
  // When: the admin confirms the annual quote, then requests cancellation at period end.
  expect((await app.admin.write(`${app.path}/checkout`, { quoteId: quote.quoteId, expectedVersion: account.version })).status).toBe(202);
  await app.webhook(app.provider.event("evt_changed"));
  const changed = await app.account();
  expect((await app.admin.write(`${app.path}/cancel`, { atPeriodEnd: true, expectedVersion: changed.version })).status).toBe(202);
  await app.webhook(app.provider.event("evt_cancel_scheduled"));
  // Then: authoritative state reports the new period/seats and scheduled nonrenewal, not immediate cancellation.
  const scheduled = await app.account();
  expect(scheduled.period).toBe("year");
  expect(scheduled.seats).toBe(3);
  expect(scheduled.status).toBe("active");
  expect(scheduled.renewsAt).toBeNull();
  const preview = app.provider.calls.findLast((call) => call.path === "/v1/invoices/create_preview");
  const update = app.provider.calls.find((call) => call.path === "/v1/subscriptions/sub_fixture" && call.fields["items[0][price]"]);
  expect(update?.fields["proration_date"]).toBe(preview?.fields["subscription_details[proration_date]"]);
});
test("downloads actual provider invoice bytes scoped to the billed organization", async () => {
  // Given: a real bound customer and a signed provider invoice event.
  await using app = await billingFixture();
  await app.admin.write(`${app.path}/preview`, { planId: "price_month", seats: 2, period: "month", expectedVersion: 0 });
  // When: invoice reconciliation downloads and stores the provider PDF.
  expect((await app.webhook(app.provider.event("evt_invoice", "invoice.paid"))).status).toBe(200);
  const invoices = await data(await app.admin.get(`${app.path}/invoices`), z.object({ items: z.array(InvoiceSchema) }));
  const invoice = invoices.items[0];
  if (!invoice) throw new TypeError("Provider invoice was not persisted");
  const response = await app.admin.get(`${app.path}/invoices/${invoice.id}/download`);
  // Then: HTTP returns the exact provider bytes and metadata, rather than a generated placeholder.
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(invoiceBytes);
  expect(invoice.providerId).toBe("in_fixture");
});
test("updates provider invoice email, address and tax display before committing local billing details", async () => {
  // Given: the configured merchant and a real administrator.
  await using app = await billingFixture();
  // When: invoice details are changed through the existing PATCH route.
  const response = await app.request(`${app.path}/details`, { method: "PATCH", headers: app.admin.headers,
    body: JSON.stringify({ invoiceEmail: "invoices@example.test", address: "One Billing Street", taxId: "VAT-EXAMPLE", expectedVersion: 0 }) });
  // Then: provider customer fields and the local optimistic billing counter agree.
  expect(response.status).toBe(200);
  const update = app.provider.calls.find((call) => call.path === "/v1/customers/cus_fixture");
  expect(update?.fields["email"]).toBe("invoices@example.test");
  expect(update?.fields["invoice_settings[custom_fields][0][value]"]).toBe("VAT-EXAMPLE");
  expect((await app.account()).version).toBe(1);
});

test("projects signed mapped sponsorships to existing external projects and withdraws only that contribution", async () => {
  // Given: a real configured price mapping, independent user grant, and an unlicensed administrator.
  await using app = await billingFixture();
  const operator = await app.login("operator@quire.local");
  const context = { ...app.runtime, routes: app.runtime.routes.forLane("A") };
  const basic = { compileSeconds: 12, writableMembers: 1, historyDays: 1, trackChanges: false };
  const paid = { compileSeconds: 90, writableMembers: 3, historyDays: null, trackChanges: true };
  for (const [scope, benefits] of [
    ["deployment/local", basic], [`user/${ids.kien}`, { ...basic, compileSeconds: 30 }],
    ["plan/configured:price_month", paid],
  ] as const) expect((await app.request(`/api/admin/project-benefits/${scope}`, { method: "PUT", headers: operator.headers,
    body: JSON.stringify({ expectedVersion: 0, benefits }) })).status).toBe(200);
  const external = IdSchema.parse(crypto.randomUUID());
  await app.runtime.db.run(`INSERT INTO projects(id,name,owner_id,workspace_id,settings_json,created_at,updated_at)
    SELECT ?,'External owned project',owner_id,NULL,settings_json,created_at,updated_at FROM projects WHERE id=?`, [external, ids.project]);
  await app.runtime.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'admin',0,?)",
    [crypto.randomUUID(), app.org, ids.mai, app.runtime.clock.now()]);
  const quote = await data(await app.admin.write(`${app.path}/preview`,
    { planId: "price_month", seats: 2, period: "month", expectedVersion: 0 }), quoteSchema);
  expect((await app.admin.write(`${app.path}/checkout`, { quoteId: quote.quoteId, expectedVersion: 0 })).status).toBe(202);
  for (const projectId of [ids.project, external]) expect((await policy(context).forProject(ids.mai, projectId)).compileSeconds).toBe(30);
  const cursor = Math.max(0, ...(await app.runtime.events.read(0, { limit: 1000 })).map(event => event.seq));
  // When: signed provider state activates, lapses, recovers, schedules cancellation, and finally cancels.
  expect((await app.webhook(app.provider.event("evt_benefits_active"))).status).toBe(200);
  const account = await app.account();
  for (const projectId of [ids.project, external]) {
    expect((await policy(context).forProject(ids.mai, projectId)).compileSeconds).toBe(90);
    const events = (await app.runtime.events.read(cursor, { aggregateId: projectId })).filter(event => event.topic === "policy.changed");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.resourceId).toBe(projectId);
  }
  expect((await app.runtime.events.read(cursor, { aggregateId: account.id })).filter(event => event.topic === "policy.changed")).toHaveLength(0);
  expect(await ownerBenefits(context, ids.mai)).toEqual(basic);
  app.provider.setStatus("past_due");
  expect((await app.webhook(app.provider.event("evt_benefits_due"))).status).toBe(200);
  expect((await ownerBenefits(context, ids.kien)).compileSeconds).toBe(30);
  app.provider.setStatus("active");
  expect((await app.webhook(app.provider.event("evt_benefits_recovered"))).status).toBe(200);
  const active = await app.account();
  expect((await app.admin.write(`${app.path}/cancel`, { atPeriodEnd: true, expectedVersion: active.version })).status).toBe(202);
  expect((await app.webhook(app.provider.event("evt_benefits_nonrenewing"))).status).toBe(200);
  expect(await ownerBenefits(context, ids.kien)).toEqual(paid);
  const scheduled = await app.account();
  expect((await app.admin.write(`${app.path}/cancel`, { atPeriodEnd: false, expectedVersion: scheduled.version })).status).toBe(202);
  expect((await app.webhook(app.provider.event("evt_benefits_canceled", "customer.subscription.deleted"))).status).toBe(200);
  // Then: cancellation removes its sponsorship without canceling the independent user grant.
  expect((await ownerBenefits(context, ids.kien)).compileSeconds).toBe(30);
  const rows = await app.runtime.db.all("SELECT id,role,licensed FROM members WHERE organization_id=?", [app.org]);
  expect(rows).toHaveLength(2);
});

test("rolls back signed billing receipts and project events when seats are still allocated", async () => {
  // Given: an already allocated organization seat and initialized provider binding.
  await using app = await billingFixture();
  await app.admin.write(`${app.path}/preview`, { planId: "price_month", seats: 2, period: "month", expectedVersion: 0 });
  const before = await app.account();
  const cursor = Math.max(0, ...(await app.runtime.events.read(0, { limit: 1000 })).map(event => event.seq));
  app.provider.setSeats(0);
  // When: the signed authoritative provider state would undercut allocated seats.
  const response = await app.webhook(app.provider.event("evt_benefits_underallocated"));
  // Then: existing rejection preserves account state and leaves neither receipt nor invalidation.
  expect(response.status).toBe(409);
  expect(await app.account()).toEqual(before);
  expect(await app.runtime.db.get("SELECT id FROM webhook_receipts WHERE event='evt_benefits_underallocated'")).toBeNull();
  expect((await app.runtime.events.read(cursor, { aggregateId: ids.project })).filter(event => event.topic === "policy.changed")).toHaveLength(0);
});
