import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { endpoints, OnboardingSchema } from "@quire/contracts";
import type { Page } from "@playwright/test";
import { accountReturnPath, billingReturnPath } from "../../../../apps/web/src/features/account/onboarding-return";
import { checkoutApplication } from "../checkout/fixture";
import { responseData } from "../../../ui-integrations/helpers";
import { startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";
import { readLocalMail } from "../../../../services/accounts/identity/mail";

const evidence = resolve(import.meta.dir, "../../../../docs/evidence/p34-onboarding");
const storageKey = "quire.onboarding.billing-return.v1";
test("billing continuation shares same-origin validation and persists only canonical plan/period data", () => {
  const origin = "https://quire.example.test";
  expect(accountReturnPath("/projects?filter=mine#recent", origin)).toBe("/projects?filter=mine#recent");
  for (const target of ["https://outside.invalid/settings/billing?plan=x&period=year", "//outside.invalid/a", "javascript:alert(1)"]) {
    expect(accountReturnPath(target, origin)).toBeNull();
    expect(billingReturnPath(target, origin)).toBeNull();
  }
  expect(billingReturnPath(`${origin}/settings/billing?plan=price_year&period=year&token=not-progress#not-progress`, origin))
    .toBe("/settings/billing?plan=price_year&period=year");
  expect(billingReturnPath("/settings/billing?plan=price_month&period=month", origin))
    .toBe("/settings/billing?plan=price_month&period=month");
  for (const target of ["/projects", "/settings/billing?plan=x", "/settings/billing?plan=x&period=week",
    "/settings/billing?plan=x&plan=y&period=year", "/settings/billing?plan=x&period=year&period=month"]) {
    expect(billingReturnPath(target, origin)).toBeNull();
  }
});
async function capture(page: Page, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise<void>(ready => requestAnimationFrame(() => ready())));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${width}-${colorScheme}.png`, fullPage: true, animations: "disabled" });
    }
  }
}

test("real pricing signup verifies in another tab and returns to the selected plan without a project, organization or payment", async () => {
  await mkdir(evidence, { recursive: true });
  await using merchant = await checkoutApplication();
  const { app } = merchant;
  await using browser = await startEditorBrowser();
  const context = await browser.browser.newContext({ baseURL: app.url.origin });
  const mutations: string[] = [];
  const errors: string[] = [];
  context.on("request", request => {
    if (!["GET", "HEAD"].includes(request.method())) mutations.push(new URL(request.url()).pathname);
  });
  context.on("page", page => { page.on("pageerror", error => errors.push(error.message)); });
  try {
    const page = await context.newPage();
    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Choose Annual fixture", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/sign-in");
    const target = new URL(page.url()).searchParams.get("returnTo");
    expect(target).toBe("/settings/billing?plan=price_year&period=year");
    if (!target) throw new Error("Pricing did not carry its selected plan");
    await page.getByRole("link", { name: "Create an account", exact: true }).click();
    await page.getByLabel("Full name", { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(target);
    await capture(page, "billing-signup");
    const email = `billing-onboarding-${crypto.randomUUID()}@example.test`;
    const password = `billing-onboarding-${crypto.randomUUID()}`;
    await page.getByLabel("Full name", { exact: true }).fill("Billing Onboarding Writer");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    const [registered] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === endpoints.authRegister.path),
      page.waitForURL(url => url.pathname === "/sign-up" && url.searchParams.get("step") === "verify"),
      page.getByRole("button", { name: "Create account", exact: true }).click(),
    ]);
    expect(registered.status()).toBe(200);
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(target);
    const denied = await context.request.post(endpoints.authLogin.path, {
      headers: { origin: app.url.origin }, data: { email, password },
    });
    expect(denied.status()).toBe(403);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByLabel("Verification token", { exact: true }).waitFor();
    const mail = readLocalMail(app.dataDir).find(entry => entry.recipient === email);
    if (!mail) throw new Error("Controlled mail fixture did not deliver verification");
    const verification = new URL(mail.body.split("\n")[0] ?? "");
    const token = verification.searchParams.get("token");
    if (!token) throw new Error("Controlled verification token missing");
    const storage = await page.evaluate(() => JSON.stringify({ local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)) }));
    expect(storage).not.toContain(password);
    expect(storage).not.toContain(email);
    expect(storage).not.toContain(token);
    const pending = z.object({ version: z.literal(1), path: z.string(), expiresAt: z.number() }).parse(
      JSON.parse(await page.evaluate(key => localStorage.getItem(key), storageKey) ?? "null"));
    expect(pending.path).toBe(target);

    const verifiedPage = await context.newPage();
    await verifiedPage.goto(verification.pathname + verification.search, { waitUntil: "domcontentloaded" });
    await verifiedPage.getByLabel("Verification token", { exact: true }).waitFor();
    expect(await verifiedPage.evaluate(() => sessionStorage.length)).toBe(0);
    const [verified] = await Promise.all([
      verifiedPage.waitForResponse(response => new URL(response.url()).pathname === endpoints.authVerifyEmail.path),
      verifiedPage.waitForURL(url => url.pathname === "/sign-in"),
      verifiedPage.getByRole("button", { name: "Verify email", exact: true }).click(),
    ]);
    expect(verified.status()).toBe(200);
    expect(new URL(verifiedPage.url()).searchParams.get("returnTo")).toBe(target);
    expect(new URL(verifiedPage.url()).searchParams.has("token")).toBe(false);
    await verifiedPage.reload({ waitUntil: "domcontentloaded" });
    await verifiedPage.getByLabel("Email", { exact: true }).fill(email);
    await verifiedPage.getByLabel("Password", { exact: true }).fill(password);
    const [signedIn] = await Promise.all([
      verifiedPage.waitForResponse(response => new URL(response.url()).pathname === endpoints.authLogin.path),
      verifiedPage.waitForURL(url => url.pathname + url.search === target),
      verifiedPage.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    expect(signedIn.status()).toBe(200);
    const user = await responseData(signedIn, endpoints.authLogin.output);
    expect(user.verifiedEmails).toContain(email);
    await verifiedPage.getByRole("heading", { name: "Billing", exact: true, level: 2 }).waitFor();
    await waitForRenderedText(verifiedPage, "Selected from pricing:");
    const organizations = await responseData(await context.request.get("/api/organizations?limit=200"), endpoints.organizationsList.output);
    expect(organizations.items).toHaveLength(0);
    expect(await verifiedPage.getByRole("button", { name: "Preview plan", exact: true }).count()).toBe(0);
    expect(await verifiedPage.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
    expect(await app.application.runtime.db.get("SELECT COUNT(*) AS count FROM projects WHERE owner_id=?", [user.id])).toEqual({ count: 0 });
    await capture(verifiedPage, "billing-returned");

    await verifiedPage.goto("/sign-up?step=start", { waitUntil: "domcontentloaded" });
    await waitForRenderedText(verifiedPage, "Choices saved to your account.");
    const [saved] = await Promise.all([
      verifiedPage.waitForResponse(response => new URL(response.url()).pathname === endpoints.onboardingSave.path && response.request().method() === "PATCH"),
      verifiedPage.getByRole("button", { name: "A thesis", exact: true }).click(),
    ]);
    expect(saved.status()).toBe(200);
    const progress = await responseData(await context.request.get(endpoints.onboardingGet.path), OnboardingSchema);
    await verifiedPage.goto(`/sign-up?step=start&${new URLSearchParams({ returnTo: target })}`, { waitUntil: "domcontentloaded" });
    await verifiedPage.getByRole("button", { name: "Continue to selected plan", exact: true }).waitFor();
    expect(await verifiedPage.getByRole("button", { name: "A thesis", exact: true }).getAttribute("aria-pressed")).toBe("true");
    await capture(verifiedPage, "billing-optional-start");
    await Promise.all([
      verifiedPage.waitForURL(url => url.pathname + url.search === target),
      verifiedPage.getByRole("button", { name: "Continue to selected plan", exact: true }).click(),
    ]);
    expect(await responseData(await context.request.get(endpoints.onboardingGet.path), OnboardingSchema)).toEqual(progress);
    expect(await app.application.runtime.db.get("SELECT COUNT(*) AS count FROM projects WHERE owner_id=?", [user.id])).toEqual({ count: 0 });
    expect(mutations.filter(path => path === "/api/projects" || path === "/api/organizations"
      || /\/billing\/(?:preview|checkout)$/u.test(path))).toEqual([]);
    expect(merchant.landings).toEqual([]);
    expect(errors).toEqual([]);
    console.info("ONBOARDING_BILLING_RETURN", { target, actorId: user.id, verification: 200, unverifiedLogin: 403,
      crossTabVerification: true, projectCount: 0, organizationCount: organizations.items.length,
      checkoutRequests: 0, resumedWritingKind: progress.choices.writingKind });
  } finally { await context.close(); }
}, 180_000);
