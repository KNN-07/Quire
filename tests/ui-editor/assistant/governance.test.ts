import { expect, test } from "bun:test";
import { assistantApplication } from "./application";
import { assistantBrowser, capture, consent } from "./browser";
import { waitForRenderedText } from "../shared/browser";

test("shows the real missing provider configuration and consent denial", async () => {
  // Given a real server with no provider configured and no AI consent.
  await using app = await assistantApplication();
  await using browser = await assistantBrowser(app);
  await browser.open();
  await capture(browser.page, "unconfigured");
  // When an unauthorised generation is requested through the UI.
  await browser.page.getByLabel("Message the assistant").fill("Explain the document");
  await browser.page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(browser.page, "AI_CONSENT_REQUIRED");
  // Then the exact backend denial is visible without a fabricated answer.
  expect(await browser.page.getByRole("alert").textContent()).toContain("AI_CONSENT_REQUIRED");
  expect(app.provider.received).toHaveLength(0);
  // Browser HTTP error messages are retained separately, not mistaken for page exceptions.
  expect(browser.errors.filter(error => error.startsWith("pageerror:"))).toEqual([]);
}, 120_000);

test("shows the real exhausted shared usage denial", async () => {
  // Given an operator-configured zero allowance and explicit user consent.
  await using app = await assistantApplication();
  await app.configure(0);
  await using browser = await assistantBrowser(app);
  await browser.open(); await consent(browser.page);
  // When the user sends a prompt.
  await browser.page.getByLabel("Message the assistant").fill("Explain the document");
  await browser.page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(browser.page, "AI_DAILY_LIMIT");
  // Then the quota denial and actual usage remain visible.
  expect(await browser.page.getByRole("alert").textContent()).toContain("AI_DAILY_LIMIT");
  expect(app.provider.received).toHaveLength(0);
  await capture(browser.page, "usage-denied");
  expect(browser.errors.filter(error => error.startsWith("pageerror:"))).toEqual([]);
}, 120_000);
