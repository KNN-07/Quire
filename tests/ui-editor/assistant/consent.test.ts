import { expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { assistantApplication } from "./application";
import { assistantBrowser } from "./browser";
import { waitForRenderedText } from "../shared/browser";

test("accepts server-required opaque terms using the actual user version", async () => {
  // Given legacy accepted terms and a user version distinct from preference version.
  const requiredTermsVersion = "fixture-terms-required-v9";
  await using app = await assistantApplication({ termsVersion: requiredTermsVersion });
  const initial = editorValue(resultSchema(endpoints.aiConsentGet.output).parse(
    await (await app.owner.http.get("api/me/ai/consent")).json()));
  await app.owner.http.post("api/me/ai-consent", { json: {
    termsVersion: "fixture-terms-legacy-v1", accepted: true, expectedVersion: initial.userVersion,
  } });
  await app.owner.http.patch("api/me", { json: {
    latexName: "Versioned consent fixture", expectedVersion: initial.userVersion + 1,
  } });
  await using browser = await assistantBrowser(app);
  await browser.open();
  await browser.page.getByText("AI preferences and consent", { exact: true }).click();
  expect(await browser.page.getByLabel("I consent to these provider terms").isChecked()).toBe(false);
  expect(await browser.page.locator(".qa-assistant__settings form").first().locator("input:not([type=checkbox])").count()).toBe(0);
  // When the user renews consent through the panel.
  const submitted = browser.page.waitForResponse(response => new URL(response.url()).pathname === endpoints.aiConsent.path
    && response.request().method() === "POST", { timeout: 30_000 });
  await browser.page.getByLabel("I consent to these provider terms").check();
  await browser.page.getByRole("button", { name: "Save consent decision", exact: true }).click();
  const result = editorValue(resultSchema(endpoints.aiConsent.output).parse(await (await submitted).json()));
  await waitForRenderedText(browser.page, "Consent accepted");
  // Then the real server metadata, not an editable date or preference version, was used.
  expect(result.version).toBe(initial.userVersion + 3);
  const stored = editorValue(resultSchema(endpoints.aiConsentGet.output).parse(
    await (await app.owner.http.get("api/me/ai/consent")).json()));
  expect(stored).toEqual({ requiredTermsVersion, acceptedTermsVersion: requiredTermsVersion,
    accepted: true, current: true, userVersion: initial.userVersion + 3 });
  await browser.page.reload({ waitUntil: "domcontentloaded" });
  await waitForRenderedText(browser.page, "usage ·");
  await browser.page.getByText("AI preferences and consent", { exact: true }).click();
  expect(await browser.page.getByLabel("I consent to these provider terms").isChecked()).toBe(true);
  expect(browser.errors).toEqual([]);
}, 120_000);

test("revokes current server consent with its returned user version", async () => {
  // Given current consent persisted through the actual account endpoint.
  const requiredTermsVersion = "fixture-terms-current-v4";
  await using app = await assistantApplication({ termsVersion: requiredTermsVersion });
  const initial = editorValue(resultSchema(endpoints.aiConsentGet.output).parse(
    await (await app.owner.http.get("api/me/ai/consent")).json()));
  await app.owner.http.post("api/me/ai-consent", { json: {
    termsVersion: requiredTermsVersion, accepted: true, expectedVersion: initial.userVersion,
  } });
  await using browser = await assistantBrowser(app);
  await browser.open();
  await browser.page.getByText("AI preferences and consent", { exact: true }).click();
  expect(await browser.page.getByLabel("I consent to these provider terms").isChecked()).toBe(true);
  // When the user revokes the current terms.
  const submitted = browser.page.waitForResponse(response => new URL(response.url()).pathname === endpoints.aiConsent.path
    && response.request().method() === "POST", { timeout: 30_000 });
  await browser.page.getByLabel("I consent to these provider terms").uncheck();
  await browser.page.getByRole("button", { name: "Save consent decision", exact: true }).click();
  const result = editorValue(resultSchema(endpoints.aiConsent.output).parse(await (await submitted).json()));
  await waitForRenderedText(browser.page, "Consent revoked");
  // Then revocation is persisted against the server-provided version.
  expect(result.version).toBe(initial.userVersion + 2);
  const stored = editorValue(resultSchema(endpoints.aiConsentGet.output).parse(
    await (await app.owner.http.get("api/me/ai/consent")).json()));
  expect(stored).toMatchObject({ acceptedTermsVersion: requiredTermsVersion, accepted: false,
    current: false, userVersion: initial.userVersion + 2 });
  expect(browser.errors).toEqual([]);
}, 120_000);
