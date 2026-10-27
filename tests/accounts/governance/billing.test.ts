import { expect, test } from "bun:test";
import { z } from "zod";
import { BillingAccountSchema, IdSchema, InvoiceSchema } from "@quire/contracts";
import { governanceFixture, data } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { applyBillingTransition, recordBillingTransition } from "../../../services/accounts/governance";

test("reports the local unbilled edition without inventing a paid plan", async () => {
  // Given: a real organization admin and no configured commercial catalog.
  await using app = await governanceFixture();
  const user = await app.login();
  // When: billing is read through its actual HTTP endpoint.
  const account = await data(await user.get(`/api/organizations/${ids.team}/billing`), BillingAccountSchema);
  // Then: the persisted account is explicitly unbilled and the public catalog is empty.
  expect(account.provider).toBe("manual");
  expect(account.status).toBe("unbilled");
  expect(account.planId).toBeNull();
  expect((await data(await app.request("/api/billing/catalog"), z.object({
    configured: z.boolean(), plans: z.array(z.unknown()),
  })))).toEqual({ configured: false, plans: [] });
});
test("keeps billing details under their own optimistic counter", async () => {
  // Given: an initialized unbilled account.
  await using app = await governanceFixture();
  const user = await app.login();
  await user.get(`/api/organizations/${ids.team}/billing`);
  // When: the admin updates invoice details at the current billing counter.
  const account = await data(await user.write(`/api/organizations/${ids.team}/billing/details`,
    { invoiceEmail: "invoices@example.test", taxId: "TAX", address: "One\nTwo", expectedVersion: 0 }, { method: "PATCH" }), BillingAccountSchema);
  // Then: details and counter persist without changing membership or organization counters.
  expect(account.version).toBe(1);
  expect(account.invoiceEmail).toBe("invoices@example.test");
  expect(z.object({ version: z.number() }).parse(app.runtime.db.query("SELECT version FROM organizations WHERE id=?").get(ids.team)).version).toBe(0);
  expect((await user.write(`/api/organizations/${ids.team}/billing/details`,
    { invoiceEmail: "stale@example.test", taxId: "", address: "", expectedVersion: 0 }, { method: "PATCH" })).status).toBe(409);
});
test("requires fresh authentication for billing after the controlled clock advances", async () => {
  // Given: a real session older than the 15-minute sensitive-operation window.
  await using app = await governanceFixture();
  const user = await app.login();
  app.setTime("2026-10-26T12:15:00.001Z");
  // When: billing is requested.
  const response = await user.get(`/api/organizations/${ids.team}/billing`);
  // Then: the still-valid session cannot perform the sensitive operation.
  expect(response.status).toBe(403);
});
test("returns only persisted organization invoices rather than placeholder billing history", async () => {
  // Given: invoices belonging to two different billing accounts.
  await using app = await governanceFixture();
  const user = await app.login();
  const operator = await app.login("operator@quire.local");
  const first = await data(await user.get(`/api/organizations/${ids.team}/billing`), BillingAccountSchema);
  const second = await data(await operator.get(`/api/organizations/${ids.institution}/billing`), BillingAccountSchema);
  const invoiceId = IdSchema.parse(crypto.randomUUID());
  for (const account of [first, second]) app.runtime.db.query(
    "INSERT INTO invoices(id,billing_account_id,amount_minor,currency,status,issued_at) VALUES(?,?,12500,'USD','open',?)")
    .run(account.id === first.id ? invoiceId : crypto.randomUUID(), account.id, app.runtime.clock.now());
  // When: the organization admin reads invoices.
  const page = await data(await user.get(`/api/organizations/${ids.team}/billing/invoices`),
    z.object({ items: z.array(InvoiceSchema) }));
  // Then: only that organization's actual invoice is returned.
  expect(page.items.map((invoice) => invoice.id)).toEqual([invoiceId]);
  expect((await user.get(`/api/organizations/${ids.institution}/billing/invoices`)).status).toBe(403);
});
test("rejects a local billing capacity reduction below allocated seats", async () => {
  // Given: a licensed administrator and an operator's valid local billing authority.
  await using app = await governanceFixture();
  const operator = await app.login("operator@quire.local");
  // When: the operator tries to reduce capacity below the occupied seat count.
  const transition = () => applyBillingTransition(app.context, operator.principal, {
    organizationId: ids.team, expectedVersion: 0, planId: "manual", period: "month",
    seats: 0, status: "active", renewsAt: null,
  });
  // Then: the transaction is rejected, with no partially initialized billing record.
  expect(transition).toThrow();
  expect(app.runtime.db.query("SELECT id FROM billing_accounts WHERE organization_id=?").get(ids.team)).toBeNull();
});
test("records a verified adapter transition without manufacturing a user session", async () => {
  // Given: an initialized billing account whose adapter boundary has verified a provider event.
  await using app = await governanceFixture();
  const admin = await app.login();
  await admin.get(`/api/organizations/${ids.team}/billing`);
  // When: the adapter records its trusted transition inside the caller's transaction.
  const result = app.runtime.uow.local(() => recordBillingTransition(app.context, {
    actorId: null, organizationId: ids.team, expectedVersion: 0, planId: "configured-plan",
    provider: "configured", period: "year", seats: 3, status: "active", renewsAt: null,
  }));
  // Then: real persisted billing changes and a provider-origin audit entry has no fake actor.
  expect(result.provider).toBe("configured");
  expect(result.version).toBe(1);
  expect(z.object({ actor_id: z.null() }).parse(app.runtime.db.query(
    "SELECT actor_id FROM audit_entries WHERE event='billing.transitioned'").get()).actor_id).toBeNull();
});
