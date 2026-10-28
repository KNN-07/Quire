import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, access } from "node:fs/promises";
import type { Browser, Page } from "@playwright/test";
import { endpoints, ErrorResultSchema } from "@quire/contracts";
import { checkoutApplication } from "./fixture";
import { changed, responseData, waitForRenderedText } from "../../../ui-integrations/helpers";
import { startEditorBrowser } from "../../../ui-editor/shared/browser";

const evidence = "docs/evidence/p6-checkout-ui";
async function capture(page: Page, name: string) {
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
  const bounds = await page.evaluate(() => ({
    width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    main: document.querySelector("main")?.getBoundingClientRect().toJSON(),
  }));
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
  console.info("CHECKOUT_CAPTURE", { name, ...bounds });
}
async function preview(page: Page, path: string) {
  const response = await changed(page, `${path}/preview`, () => page.getByRole("button", { name: "Preview plan", exact: true }).click());
  expect(response.status()).toBe(200);
  const quote = await responseData(response, endpoints.billingPreview.output);
  await page.getByRole("button", { name: "Request checkout", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  console.info("CHECKOUT_PREVIEW", quote);
  return quote;
}
async function checkout(page: Page, path: string) {
  console.info("CHECKOUT_ACTION", { action: "Request checkout", page: page.url() });
  const response = await changed(page, `${path}/checkout`, () => page.getByRole("button", { name: "Request checkout", exact: true }).click());
  const body = await response.text();
  const json: unknown = JSON.parse(body);
  console.info("CHECKOUT_APPLICATION_HTTP", { status: response.status(), body });
  return { status: () => response.status(), request: () => response.request(), json: () => Promise.resolve(json) };
}

describe("configured checkout through real account HTTP and merchant protocol", () => {
  const resources = new AsyncDisposableStack();
  let app: Awaited<ReturnType<typeof checkoutApplication>>, browser: Browser;
  const pageErrors: string[] = [];
  beforeAll(async () => {
    try {
      app = resources.use(await checkoutApplication());
      browser = resources.use(await startEditorBrowser()).browser;
      browser.on("context", context => context.on("page", page => page.on("pageerror", error => pageErrors.push(error.message))));
    } catch (error) { await resources.disposeAsync(); throw error; }
  }, 120_000);
  afterAll(async () => {
    await resources.disposeAsync();
    expect(await access(app.app.dataDir).then(() => true, () => false)).toBe(false);
    console.info("CHECKOUT_BROWSER_CLOSED", { connected: browser.isConnected(), pageErrors });
    expect(browser.isConnected()).toBe(false);
    expect(pageErrors).toEqual([]);
  }, 30_000);

  test("follows the actual HTTPS destination and returns with an unchanged unconfirmed subscription", async () => {
    const context = await app.context(browser);
    try {
      const page = await context.newPage();
      await page.goto("/settings/billing");
      await page.getByLabel("Seats", { exact: true }).fill("2");
      const before = await app.account();
      expect(before.status).toBe("unbilled");
      const quote = await preview(page, app.path);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await capture(page, `quote-${width}`);
      }
      // Subscribe before the action; the destination is a real TLS fixture, not a routed browser response.
      const landed = page.waitForEvent("framenavigated", {
        predicate: frame => frame === page.mainFrame() && frame.url() === app.destination, timeout: 30_000,
      });
      const response = await checkout(page, app.path);
      expect(response.status()).toBe(202);
      const operation = await responseData(response, endpoints.billingCheckout.output);
      expect(operation.result).toMatchObject({ checkoutId: "cs_fixture", url: app.destination, reconciliation: "awaiting_webhook" });
      expect(response.request().postDataJSON()).toEqual({ quoteId: quote.quoteId, expectedVersion: before.version });
      await landed;
      await waitForRenderedText(page, "No payment has been made.");
      expect(page.url()).toBe(app.destination);
      expect(app.landings).toContain(app.destination);
      await capture(page, "hosted-landing-390");
      expect(await app.account()).toEqual(before);
      const returned = page.waitForEvent("framenavigated", {
        predicate: frame => frame === page.mainFrame() && frame.url() === `${app.app.url.origin}/settings/billing`, timeout: 30_000,
      });
      await page.getByRole("link", { name: "Return to billing without payment" }).click();
      await returned;
      await waitForRenderedText(page, "Unbilled");
      await capture(page, "returned-unconfirmed-390");
      expect(await app.account()).toEqual(before);
      console.info("CHECKOUT_UNCONFIRMED_RECORD", before);
    } finally { await context.close(); }
  }, 120_000);

  test("updates an existing subscription without a destination or optimistic activation", async () => {
    await app.webhook("evt_browser_existing");
    const before = await app.account();
    expect(before.status).toBe("active");
    const context = await app.context(browser);
    try {
      const page = await context.newPage();
      await page.goto("/settings/billing");
      await page.locator('select[name="plan"]').selectOption("price_year");
      await page.getByLabel("Seats", { exact: true }).fill("3");
      const quote = await preview(page, app.path);
      const landings = app.landings.length;
      const response = await checkout(page, app.path);
      expect(response.status()).toBe(202);
      const operation = await responseData(response, endpoints.billingCheckout.output);
      expect(operation.result).toEqual({ subscriptionId: "sub_fixture", reconciliation: "awaiting_webhook" });
      expect(response.request().postDataJSON()).toEqual({ quoteId: quote.quoteId, expectedVersion: before.version });
      await waitForRenderedText(page, "Awaiting provider webhook reconciliation.");
      expect(page.url()).toBe(`${app.app.url.origin}/settings/billing`);
      expect(app.landings).toHaveLength(landings);
      expect(await app.account()).toEqual(before);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await capture(page, `subscription-awaiting-webhook-${width}`);
      }
      const update = app.provider.calls.findLast(call => call.path === "/v1/subscriptions/sub_fixture" && call.fields["items[0][quantity]"]);
      const estimate = app.provider.calls.findLast(call => call.path === "/v1/invoices/create_preview");
      expect(update?.fields["proration_date"]).toBe(estimate?.fields["subscription_details[proration_date]"]);
      expect(update?.fields["payment_behavior"]).toBe("pending_if_incomplete");
      console.info("CHECKOUT_UPDATE_UNRECONCILED", { before, after: await app.account(), update });
    } finally { await context.close(); }
  }, 120_000);

  test("retains expired-quote and stale-version service denials without navigating", async () => {
    const context = await app.context(browser);
    try {
      const page = await context.newPage();
      for (const denial of ["expiry", "version"] as const) {
        await page.goto("/settings/billing");
        await page.getByLabel("Seats", { exact: true }).fill("2");
        const quote = await preview(page, app.path);
        if (denial === "expiry") {
          await app.app.application.runtime.db.run("UPDATE billing_merchant_quotes SET expires_at=? WHERE id=?", ["2000-01-01T00:00:00.000Z", quote.quoteId]);
        } else {
          const before = await app.account();
          const details = await context.request.patch(`${app.path}/details`, {
            headers: { origin: app.app.url.origin, "x-csrf-token": app.owner.account.csrfToken },
            data: { invoiceEmail: before.invoiceEmail, taxId: before.taxId, address: before.address, expectedVersion: before.version },
          });
          expect(details.status()).toBe(200);
        }
        const providerCalls = app.provider.calls.length;
        const response = await checkout(page, app.path);
        expect(response.status()).toBe(409);
        const error = ErrorResultSchema.parse(await response.json()).error;
        expect(error.code).toBe(denial === "expiry" ? "BILLING_QUOTE_EXPIRED" : "VERSION_CONFLICT");
        await waitForRenderedText(page, error.message);
        expect(page.url()).toBe(`${app.app.url.origin}/settings/billing`);
        expect(app.provider.calls.length).toBe(providerCalls);
        await capture(page, `denied-${denial}-1440`);
      }
    } finally { await context.close(); }
  }, 120_000);

  test("retains real session denial after a preview without navigating", async () => {
    const context = await app.context(browser);
    try {
      const page = await context.newPage();
      await page.goto("/settings/billing");
      await page.getByLabel("Seats", { exact: true }).fill("2");
      await preview(page, app.path);
      const logout = await context.request.post("/api/auth/logout", {
        headers: { origin: app.app.url.origin, "x-csrf-token": app.owner.account.csrfToken }, data: {},
      });
      expect(logout.ok()).toBe(true);
      const calls = app.provider.calls.length;
      const response = await checkout(page, app.path);
      expect(response.status()).toBe(401);
      const error = ErrorResultSchema.parse(await response.json()).error;
      await waitForRenderedText(page, error.message);
      expect(page.url()).toBe(`${app.app.url.origin}/settings/billing`);
      expect(app.provider.calls).toHaveLength(calls);
      await capture(page, "denied-session-1440");
    } finally { await context.close(); }
  }, 120_000);
});

test("rejects an actual unsafe provider destination while preserving the unconfirmed record", async () => {
  await using app = await checkoutApplication({ unsafeDestination: true });
  await using browser = await startEditorBrowser();
  const context = await app.context(browser.browser);
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/settings/billing");
    await page.getByLabel("Seats", { exact: true }).fill("2");
    const before = await app.account();
    await preview(page, app.path);
    const response = await checkout(page, app.path);
    expect(response.status()).toBe(202);
    const operation = await responseData(response, endpoints.billingCheckout.output);
    expect(operation.result?.["url"]).toBe(app.destination.replace("https:", "http:"));
    await waitForRenderedText(page, "Payment is not confirmed.");
    expect(await page.getByRole("alert").count()).toBe(1);
    expect(page.url()).toBe(`${app.app.url.origin}/settings/billing`);
    expect(app.landings).toHaveLength(0);
    expect(await app.account()).toEqual(before);
    expect(errors).toEqual([]);
    await capture(page, "unsafe-destination-1440");
  } finally { await context.close(); }
}, 120_000);

test("shows the real missing configuration without offering checkout", async () => {
  await using app = await checkoutApplication({ configured: false });
  await using browser = await startEditorBrowser();
  const context = await app.context(browser.browser, 390);
  try {
    const page = await context.newPage();
    await page.goto("/settings/billing");
    await waitForRenderedText(page, "Billing is not configured.");
    expect(await page.getByRole("button", { name: "Preview plan", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Request checkout", exact: true }).count()).toBe(0);
    expect(app.provider.calls).toHaveLength(0);
    expect((await app.account()).status).toBe("unbilled");
    await capture(page, "unconfigured-390");
  } finally { await context.close(); }
}, 120_000);
