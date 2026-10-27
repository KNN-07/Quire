import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { checkMarketing, assertReflow } from "./browser-checks.mjs";

const origin = process.env["MARKETING_ORIGIN"] ?? "http://127.0.0.1:43871";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  console.log("INTERACTIONS", JSON.stringify(await checkMarketing(page, origin)));

  // Given: operator prices differing across periods.
  await context.request.post(`${origin}/__fixture`, { data: "configured" });
  await page.goto(`${origin}/pricing`);
  await page.getByRole("heading", { name: "Operator annual", exact: true }).waitFor({ state: "visible" });
  // When: switching periods.
  await page.getByRole("button", { name: "Monthly", exact: true }).click();
  // Then: only the selected period's real catalog amount is rendered.
  await page.getByRole("heading", { name: "Operator monthly", exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.getByText("$12.34", { exact: true }).count(), 1);
  assert.equal(await page.getByRole("heading", { name: "Operator annual", exact: true }).count(), 0);

  // Given: the fixture support adapter accepts a validated inquiry.
  await context.request.post(`${origin}/__fixture`, { data: "accept" });
  await page.goto(`${origin}/self-hosting`);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("UI Test");
  await page.getByRole("textbox", { name: "Work email", exact: true }).fill("ui@example.test");
  await page.getByRole("textbox", { name: "Organization", exact: true }).fill("Test Lab");
  await page.getByRole("textbox", { name: "How can we help?", exact: true }).fill("Test inquiry");
  // When: submitting through the actual client.
  await page.getByRole("button", { name: "Send inquiry", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Receipt:" }).waitFor({ state: "visible" });
  // Then: one validated HTTP request includes the idempotency key.
  const fixture = await (await context.request.get(`${origin}/__fixture`)).json();
  assert.equal(fixture.inquiries.length, 1);
  assert.equal(fixture.inquiries[0].body.runtime, "native");
  assert.match(fixture.inquiries[0].headers["idempotency-key"], /^[\da-f-]{36}$/);
  await context.request.post(`${origin}/__fixture`, { data: "unconfigured" });

  // Given: an institution identifier not present on the server.
  await page.goto(`${origin}/institutions/missing`);
  // When: the server rejects the lookup.
  await page.getByRole("alert").waitFor({ state: "visible" });
  // Then: a real failure is rendered with a usable lookup control.
  assert.match(await page.getByRole("alert").textContent(), /NOT_FOUND/);
  assert.equal(await page.getByRole("textbox", { name: "Institution slug", exact: true }).inputValue(), "missing");
  await page.goto(`${origin}/institutions/test-lab`);
  await page.getByRole("button", { name: "Join institution", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Enrollment accepted" }).waitFor({ state: "visible" });
  console.log("HTTP_STATES", JSON.stringify({ configuredPeriod: true, acceptedReceipt: true, idempotencyHeader: true, institutionMissing: true }));

  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    const mobile = width === 390;
    const captureContext = await browser.newContext({
      viewport: { width, height: mobile ? 844 : 1000 }, colorScheme: theme,
      isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1,
    });
    const capture = await captureContext.newPage();
    for (const [name, path] of [["landing", "/"], ["pricing", "/pricing"], ["self-hosting", "/self-hosting"], ["institution", "/institutions"], ["institution-detail", "/institutions/test-lab"]]) {
      await capture.goto(origin + path);
      await capture.locator("h1").waitFor({ state: "visible" });
      await capture.evaluate(() => document.fonts.ready);
      if (name === "pricing") await capture.getByRole("heading", { name: "Hosted plans", exact: true }).waitFor({ state: "visible" });
      if (name === "institution-detail") await capture.getByRole("heading", { name: "Test institution", exact: true }).waitFor({ state: "visible" });
      console.log("REFLOW", name, width, theme, JSON.stringify(await assertReflow(capture)));
      const prefix = `docs/evidence/p1-ui-marketing/${name}-${width}-${theme}`;
      await capture.screenshot({ path: `${prefix}-top.png` });
      await capture.screenshot({ path: `${prefix}.png`, fullPage: true });
      await capture.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await capture.screenshot({ path: `${prefix}-end.png` });
      if (name === "self-hosting") {
        for (const [tab, state] of [["Docker Compose", "compose"], ["Kubernetes (Helm)", "helm"]]) {
          await capture.getByRole("tab", { name: tab, exact: true }).click();
          await capture.locator("#install").scrollIntoViewIfNeeded();
          await capture.screenshot({ path: `${prefix}-${state}.png` });
        }
      }
    }
    await captureContext.close();
  }
  assert.deepEqual(errors, []);
  console.log("PASS marketing browser assertions; 20 full-page, 20 top, 20 end and 8 deployment-tab captures; no page errors");
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error("FAILURE_PAGE", page.url(), await page.locator("body").innerText());
    await page.screenshot({ path: "docs/evidence/p1-ui-marketing/failure.png", fullPage: true });
  }
  throw error;
} finally { await browser.close(); }
