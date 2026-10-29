import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { endpoints } from "@quire/contracts";
import { checkoutApplication } from "../../account/checkout/fixture";
import { changed, responseData, waitForRenderedText } from "../../../ui-integrations/helpers";
import { startEditorBrowser } from "../../../ui-editor/shared/browser";
import { fixtureIds } from "../../../fixtures/foundation";

const evidence = "docs/evidence/p34-pricing";
async function capture(page: Page, name: string) {
  await mkdir(evidence, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
  const bounds = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
  console.info("PRICING_CAPTURE", { name, ...bounds });
}

test("native catalog selection reaches authorized preview and owned checkout only on explicit request", async () => {
  await using app = await checkoutApplication();
  await using browser = await startEditorBrowser();
  const context = await app.context(browser.browser);
  const errors: string[] = [];
  try {
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const before = await app.account();
    await page.goto("/pricing");
    await page.getByRole("link", { name: "Choose Annual fixture", exact: true }).waitFor({ state: "visible" });
    expect(await page.locator(".qm-comparison-group").count()).toBe(6);
    expect(await page.locator(".qm-comparison-group tbody tr").count()).toBe(23);
    for (const width of [1440, 390]) for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await capture(page, `configured-${width}-${theme}`);
    }
    await page.getByRole("button", { name: "Monthly", exact: true }).click();
    await page.getByRole("link", { name: "Choose Monthly fixture", exact: true }).waitFor({ state: "visible" });
    expect(await page.getByRole("heading", { name: "Annual fixture", exact: true }).count()).toBe(0);
    await page.getByRole("link", { name: "Choose Monthly fixture", exact: true }).click();
    await page.getByLabel("Seats", { exact: true }).waitFor({ state: "visible" });
    expect(await page.locator('select[name="plan"]').inputValue()).toBe("price_month");
    expect(new URL(page.url()).searchParams.get("period")).toBe("month");
    await page.goto("/pricing");
    await page.getByRole("link", { name: "Choose Annual fixture", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("link", { name: "Choose Annual fixture", exact: true }).click();
    await page.getByLabel("Seats", { exact: true }).fill("2");
    expect(new URL(page.url()).searchParams.get("plan")).toBe("price_year");
    expect(new URL(page.url()).searchParams.get("period")).toBe("year");
    expect(await page.locator('select[name="plan"]').inputValue()).toBe("price_year");
    expect(app.landings).toHaveLength(0);
    expect(app.provider.calls.filter(call => call.path === "/v1/checkout/sessions")).toHaveLength(0);
    const response = await changed(page, `${app.path}/preview`, () => page.getByRole("button", { name: "Preview plan", exact: true }).click());
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ planId: "price_year", period: "year", seats: 2 });
    const quote = await responseData(response, endpoints.billingPreview.output);
    await page.getByRole("button", { name: "Request checkout", exact: true }).waitFor({ state: "visible" });
    expect(app.landings).toHaveLength(0);
    expect(app.provider.calls.filter(call => call.path === "/v1/checkout/sessions")).toHaveLength(0);
    for (const width of [1440, 390]) for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await capture(page, `selected-billing-${width}-${theme}`);
    }
    const landed = page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame() && frame.url() === app.destination, timeout: 30_000 });
    const checkoutResponse = page.waitForResponse(entry => new URL(entry.url()).pathname === `${app.path}/checkout` && entry.request().method() === "POST");
    await page.getByRole("button", { name: "Request checkout", exact: true }).click();
    const checked = await checkoutResponse;
    expect(checked.status()).toBe(202);
    expect(checked.request().postDataJSON()).toEqual({ quoteId: quote.quoteId, expectedVersion: before.version });
    await landed;
    await waitForRenderedText(page, "No payment has been made.");
    expect(await app.account()).toEqual(before);
    expect(app.landings).toContain(app.destination);
    console.info("PRICING_CONNECTED_CHECKOUT", { quote, checkoutStatus: checked.status(), before, destination: page.url() });

    for (const query of ["plan=missing&period=year", "plan=price_year&period=month"]) {
      await page.goto(`/settings/billing?${query}`);
      await page.getByLabel("Seats", { exact: true }).waitFor({ state: "visible" });
      await waitForRenderedText(page, "The selected plan or billing period is unavailable");
      expect(await page.locator('select[name="plan"]').inputValue()).toBe("");
      expect(await page.getByRole("button", { name: "Request checkout", exact: true }).count()).toBe(0);
    }
    await capture(page, "unavailable-selection-390-dark");
    const denied = await context.request.post(`/api/organizations/${fixtureIds.institution}/billing/preview`, {
      headers: { origin: app.app.url.origin, "x-csrf-token": app.owner.account.csrfToken, "idempotency-key": crypto.randomUUID() },
      data: { planId: "price_year", period: "year", seats: 2, expectedVersion: 0 },
    });
    expect(denied.status()).toBe(403);
    console.info("PRICING_UNAUTHORIZED_ORGANIZATION", { status: denied.status(), body: await denied.text() });

    // Existing permitted password return preserves the exact same-origin selection.
    await context.clearCookies();
    await page.goto("/pricing");
    await page.getByRole("link", { name: "Choose Annual fixture", exact: true }).click();
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("kien@quire.local");
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/settings/billing?plan=price_year&period=year");
    await page.getByLabel("Password", { exact: true }).fill(app.app.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Seats", { exact: true }).waitFor({ state: "visible" });
    expect(await page.locator('select[name="plan"]').inputValue()).toBe("price_year");
    console.info("PRICING_AUTH_RETURN", page.url());
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}, 120_000);

test("native unconfigured catalog retains all groups and never offers paid continuation", async () => {
  await using app = await checkoutApplication({ configured: false });
  await using browser = await startEditorBrowser();
  const context = await app.context(browser.browser);
  try {
    const page = await context.newPage();
    for (const width of [1440, 390]) for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/pricing");
      await page.getByRole("heading", { name: "Hosted plans", exact: true }).waitFor({ state: "visible" });
      expect(await page.locator(".qm-comparison-group").count()).toBe(6);
      expect(await page.getByRole("link", { name: /^Choose / }).count()).toBe(0);
      await capture(page, `unconfigured-${width}-${theme}`);
    }
    await page.goto("/settings/billing?plan=price_year&period=year");
    await waitForRenderedText(page, "Billing is not configured.");
    await waitForRenderedText(page, "The selected plan or billing period is unavailable");
    expect(await page.getByRole("button", { name: "Preview plan", exact: true }).count()).toBe(0);
    expect(app.provider.calls).toHaveLength(0);
    await capture(page, "unconfigured-billing-390-dark");
  } finally { await context.close(); }
}, 120_000);
