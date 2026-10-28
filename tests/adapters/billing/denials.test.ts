import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import { billingFixture } from "./harness";
import { data } from "../../accounts/governance/harness";
import { fixtureIds } from "../../fixtures/foundation";

const quoteSchema = z.object({ quoteId: IdSchema });
const selection = { planId: "price_month", seats: 2, period: "month", expectedVersion: 0 } as const;
test("preserves the manual unbilled edition and names missing merchant credentials", async () => {
  // Given: no operator merchant configuration.
  await using app = await billingFixture(false);
  // When: catalog and preview are requested.
  const catalog = await data(await app.request("/api/billing/catalog"), z.object({ configured: z.boolean(), plans: z.array(z.unknown()) }));
  const response = await app.admin.write(`${app.path}/preview`, selection);
  // Then: no sample catalog or charge is invented and configuration failure is explicit.
  expect(catalog).toEqual({ configured: false, plans: [] });
  expect(response.status).toBe(503);
  const error = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json());
  expect(error.error.code).toBe("BILLING_UNCONFIGURED");
  expect((await app.account()).provider).toBe("manual");
  expect(app.provider.calls).toHaveLength(0);
});
test("denies anonymous, nonadmin, stale and cross-origin billing operations before provider dispatch", async () => {
  // Given: configured merchant billing with distinct organization membership.
  await using app = await billingFixture();
  const member = await app.login("sam@quire.local");
  // When: requests lack the current admin/fresh-session/CSRF authority.
  const anonymous = await app.request(`${app.path}/preview`, { method: "POST", headers: { "idempotency-key": "anonymous" }, body: JSON.stringify(selection) });
  const denied = await member.write(`${app.path}/preview`, selection);
  const crossOrigin = await app.request(`${app.path}/preview`, { method: "POST", headers: { ...app.admin.headers, origin: "https://attacker.example", "idempotency-key": "cross-origin" }, body: JSON.stringify(selection) });
  app.setTime("2026-10-27T12:15:00.001Z");
  const stale = await app.admin.write(`${app.path}/preview`, selection);
  // Then: each boundary denies the request without a merchant call.
  expect([anonymous.status, denied.status, crossOrigin.status, stale.status]).toEqual([401, 403, 403, 403]);
  expect(app.provider.calls).toHaveLength(0);
});
test("rejects underallocated seats and mismatched merchant price periods", async () => {
  // Given: the seeded organization has a licensed administrator.
  await using app = await billingFixture();
  // When: the requested capacity is below occupancy or the period does not match its price.
  const seats = await app.admin.write(`${app.path}/preview`, { ...selection, seats: 0 });
  const period = await app.admin.write(`${app.path}/preview`, { ...selection, period: "year" });
  // Then: both are denied rather than silently adjusting charges or licensing.
  expect(seats.status).toBe(400);
  expect(period.status).toBe(400);
  expect(app.provider.calls.filter((call) => call.path === "/v1/checkout/sessions")).toHaveLength(0);
});
test("rolls back webhook state and its receipt when provider capacity is below seats in use", async () => {
  // Given: a bound merchant customer and a licensed local seat.
  await using app = await billingFixture();
  await app.admin.write(`${app.path}/preview`, selection);
  app.provider.setSeats(0);
  // When: a correctly signed event reports an incompatible capacity.
  const response = await app.webhook(app.provider.event("evt_capacity"));
  // Then: no receipt or partially applied transition is persisted, so a corrected retry can reconcile.
  expect(response.status).toBe(409);
  expect((await app.account()).status).toBe("unbilled");
  expect(await app.runtime.db.get("SELECT id FROM webhook_receipts WHERE event='evt_capacity'")).toBeNull();
  app.provider.setSeats(2);
  expect((await app.webhook(app.provider.event("evt_capacity"))).status).toBe(200);
});
test("rejects forged, expired, modified and reused signed webhook payloads", async () => {
  // Given: a configured customer and one accepted signed event.
  await using app = await billingFixture();
  await app.admin.write(`${app.path}/preview`, selection);
  const bytes = app.provider.event("evt_verified");
  const signature = app.provider.sign(bytes, app.runtime.clock.now());
  expect((await app.webhook(bytes)).status).toBe(200);
  // When: signatures or event bytes are forged, expired, or reused with different content.
  const forged = await app.webhook(bytes, app.provider.sign(bytes, app.runtime.clock.now(), "whsec_wrong"));
  const changed = await app.webhook(`${bytes} `, signature);
  const reused = await app.webhook(`${bytes} `);
  app.setTime("2026-10-27T12:05:01.000Z");
  const expired = await app.webhook(bytes, signature);
  // Then: receipt idempotency does not bypass signature checks or permit event ID replacement.
  expect([forged.status, changed.status, reused.status, expired.status]).toEqual([400, 400, 409, 400]);
  expect((await app.runtime.db.all("SELECT * FROM webhook_receipts"))).toHaveLength(1);
});
test("rejects an expired quote and conflicting idempotency input", async () => {
  // Given: a real quote tied to an admin, organization, version and ten-minute expiry.
  await using app = await billingFixture();
  const quote = await data(await app.admin.write(`${app.path}/preview`, selection, "quote-stable"), quoteSchema);
  // When: its request key is reused with different seats and its checkout is attempted after expiry.
  const conflict = await app.admin.write(`${app.path}/preview`, { ...selection, seats: 3 }, "quote-stable");
  app.setTime("2026-10-27T12:10:00.001Z");
  const expired = await app.admin.write(`${app.path}/checkout`, { quoteId: quote.quoteId, expectedVersion: 0 });
  // Then: neither action can silently change the reviewed merchant request.
  expect(conflict.status).toBe(409);
  expect(expired.status).toBe(409);
  expect(app.provider.calls.filter((call) => call.path === "/v1/checkout/sessions")).toHaveLength(0);
});
test("retains uncertain dispatch and refuses automatic repeated purchase", async () => {
  // Given: a quote whose checkout encounters a provider error after durable intent.
  await using app = await billingFixture();
  const quote = await data(await app.admin.write(`${app.path}/preview`, selection), quoteSchema);
  app.provider.failCheckout();
  const input = { quoteId: quote.quoteId, expectedVersion: 0 };
  await app.admin.write(`${app.path}/checkout`, input, "uncertain");
  // When: the client retries the same operation and then tries a different purchase key.
  const replay = await data(await app.admin.write(`${app.path}/checkout`, input, "uncertain"), OperationSchema);
  const second = await app.admin.write(`${app.path}/checkout`, input, "another-purchase");
  // Then: unknown external completion stays running and is not automatically redispatched.
  expect(replay.status).toBe("running");
  expect(second.status).toBe(409);
  expect(app.provider.calls.filter((call) => call.path === "/v1/checkout/sessions")).toHaveLength(1);
});
test("denies invoice bytes belonging to another organization", async () => {
  // Given: a persisted provider invoice for the team.
  await using app = await billingFixture();
  await app.admin.write(`${app.path}/preview`, selection);
  await app.webhook(app.provider.event("evt_invoice_scope", "invoice.paid"));
  const invoice = z.object({ id: IdSchema }).parse(await app.runtime.db.get("SELECT id FROM invoices WHERE provider_id='in_fixture'"));
  const operator = await app.login("operator@quire.local");
  // When: even an operator requests it under a different billing organization.
  const response = await operator.get(`/api/organizations/${fixtureIds.institution}/billing/invoices/${invoice.id}/download`);
  // Then: provider document access is scoped by its billing account, not only invoice ID.
  expect(response.status).toBe(404);
});
test("rejects another administrator's quote even when the caller has operator authority", async () => {
  // Given: a quote belongs to the original administrator, not the operator.
  await using app = await billingFixture();
  const quote = await data(await app.admin.write(`${app.path}/preview`, selection), quoteSchema);
  const operator = await app.login("operator@quire.local");
  // When: a different authorized principal attempts to confirm that quote.
  const response = await operator.write(`${app.path}/checkout`, { quoteId: quote.quoteId, expectedVersion: 0 });
  // Then: quote review and confirmation remain actor-bound.
  expect(response.status).toBe(403);
  expect(app.provider.calls.filter((call) => call.path === "/v1/checkout/sessions")).toHaveLength(0);
});
test("rejects a quote after the merchant configuration version changes", async () => {
  // Given: a persisted quote at the previous merchant configuration version.
  await using app = await billingFixture();
  const quote = await data(await app.admin.write(`${app.path}/preview`, selection), quoteSchema);
  await app.runtime.db.run("UPDATE adapter_provider_configs SET version=version+1 WHERE kind='stripe-billing'");
  // When: checkout is requested after operator configuration changed.
  const response = await app.admin.write(`${app.path}/checkout`, { quoteId: quote.quoteId, expectedVersion: 0 });
  // Then: the reviewed configuration cannot silently change under confirmation.
  expect(response.status).toBe(409);
  expect(app.provider.calls.filter((call) => call.path === "/v1/checkout/sessions")).toHaveLength(0);
});
