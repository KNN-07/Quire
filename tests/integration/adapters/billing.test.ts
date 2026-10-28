import { expect, test } from "bun:test";
import { z } from "zod";
import { BillingAccountSchema, IdSchema, OperationSchema } from "@quire/contracts";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { stripeFixture } from "../../adapters/billing/provider";
import { fixtureIds } from "../../fixtures/foundation";
import { data, integrationFixture } from "./harness";

test("reconciles a signed merchant event once through composed governance and persists native billing state", async () => {
  // Given
  await using provider = stripeFixture();
  await using fixture = await integrationFixture({ http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
  const session = await fixture.login();
  await fixture.configure("stripe-billing", { baseUrl: provider.origin, secret: JSON.stringify({
    apiKey: "sk_test_fixture", webhookSecrets: ["whsec_fixture"], portalConfiguration: "bpc_fixture",
    prices: [{ id: "price_month", name: "Monthly fixture" }, { id: "price_year", name: "Annual fixture" }],
  }) });
  const path = `/api/organizations/${fixtureIds.team}/billing`;
  const post = (route: string, body: unknown) => fixture.request(route, { method: "POST",
    headers: { ...session.headers, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
  const quote = await data(await post(`${path}/preview`,
    { planId: "price_month", seats: 2, period: "month", expectedVersion: 0 }), z.object({ quoteId: IdSchema }));
  const checkout = await data(await post(`${path}/checkout`, { quoteId: quote.quoteId, expectedVersion: 0 }), OperationSchema);
  expect(checkout.status).toBe("succeeded");
  expect((await data(await fixture.request(path, { headers: session.headers }), BillingAccountSchema)).status).toBe("unbilled");
  provider.complete();
  const bytes = provider.event("evt_composed_checkout", "checkout.session.completed");
  const webhook = (signature: string) => fixture.request("/api/webhooks/billing/stripe", {
    method: "POST", body: bytes, headers: { "content-type": "application/json", "stripe-signature": signature },
  });
  // When
  expect((await webhook(provider.sign(bytes, fixture.clock.now()))).status).toBe(200);
  expect((await webhook(provider.sign(bytes, fixture.clock.now()))).status).toBe(200);
  await fixture.restart();
  // Then
  const account = await data(await fixture.request(path, { headers: session.headers }), BillingAccountSchema);
  expect(account.status).toBe("active");
  expect(account.seats).toBe(2);
  expect(await fixture.runtime.db.all("SELECT event FROM webhook_receipts")).toHaveLength(1);
  expect((await webhook("t=0,v1=forged")).status).toBe(400);
}, 90_000);
