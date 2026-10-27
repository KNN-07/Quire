import assert from "node:assert/strict";

export async function checkInvoicesAndPortal(page, origin, fixture) {
  let configured = false;
  const envelope = data => JSON.stringify({ data, requestId: fixture.requestId });
  // Given: an unavailable billing service has one explicit saved invoice fixture.
  await page.route("**/api/organizations/*/billing/invoices?*", route => route.fulfill({ status: 200, contentType: "application/json", body: envelope({
    items: [{ id: fixture.requestId, billingAccountId: fixture.billing.id, providerId: "fixture-invoice", amountMinor: 1200, currency: "USD", status: "open", issuedAt: "2026-10-26T00:00:00.000Z", documentArtifactId: fixture.requestId }], nextCursor: null,
  }) }));
  await page.route("**/api/organizations/*/billing/portal", route => {
    assert.equal(route.request().postDataJSON().expectedVersion, fixture.billing.version);
    assert.ok(route.request().headers()["idempotency-key"]);
    return route.fulfill({ status: configured ? 200 : 503, contentType: "application/json", body: configured ? envelope({ url: origin + "/test-provider-portal" }) : JSON.stringify({ error: { code: "BILLING_UNCONFIGURED", message: "Payment management is not configured." }, requestId: fixture.requestId }) });
  });
  await page.goto(origin + "/settings/billing", { waitUntil: "commit" });
  await page.getByRole("table", { name: "Billing invoices" }).waitFor({ state: "visible", timeout: 10000 });
  // Then: the saved invoice, not illustrative rows, is rendered with its real route.
  assert.equal(await page.getByRole("row").count(), 2);
  assert.equal(new URL(await page.getByRole("link", { name: "Download", exact: true }).getAttribute("href")).pathname, `/api/organizations/${fixture.organization.id}/billing/invoices/${fixture.requestId}/download`);
  // When: payment management is unconfigured.
  const unavailable = page.waitForResponse(response => response.url().endsWith("/billing/portal"));
  await page.getByRole("button", { name: "Manage payment method" }).click();
  assert.equal((await unavailable).status(), 503);
  // Then: the failure remains on the billing screen without collecting card fields.
  await page.getByRole("alert").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(new URL(page.url()).pathname, "/settings/billing");
  assert.equal(await page.locator('input[autocomplete="cc-number"]').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const image = await page.screenshot({ fullPage: true, type: "png" });

  // Given: the provider now returns a configured hosted-management URL.
  configured = true;
  await page.route(origin + "/test-provider-portal", route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><h1>Hosted portal boundary fixture</h1>" }));
  // When: the user opens management again.
  await page.getByRole("button", { name: "Manage payment method" }).click();
  // Then: navigation follows the returned URL; it is not a payment-success screen.
  await page.getByRole("heading", { name: "Hosted portal boundary fixture" }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(new URL(page.url()).pathname, "/test-provider-portal");
  return image;
}
