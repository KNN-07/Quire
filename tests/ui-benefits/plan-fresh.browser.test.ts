import { expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { authenticatedContext, startEditorApplication, startEditorBrowser, waitForRenderedText } from "../ui-editor/shared";

test("maps explicit plan values without price inference and requires real fresh operator authentication", async () => {
  // Given: an unmapped deliberately named manual plan on native services.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await using operator = await authenticatedContext(browser, app, {
    email: "operator@quire.local", viewport: { width: 390, height: 900 },
    colorScheme: "dark", isMobile: true, hasTouch: true, deviceScaleFactor: 3,
  });
  const page = await operator.context.newPage();
  await page.goto("/admin/benefits", { waitUntil: "domcontentloaded" });
  await waitForRenderedText(page, "Grant configured");
  await page.getByLabel("Grant scope").selectOption("plan");
  await page.getByLabel("Scope key").fill("manual:acceptance-plan");
  await page.getByRole("button", { name: "Load grant", exact: true }).click();
  await waitForRenderedText(page, "No grant contribution");
  expect(await page.getByLabel("Compile seconds", { exact: true }).inputValue()).toBe("");
  expect(await page.getByLabel("Writable collaborators", { exact: true }).inputValue()).toBe("");
  // When: the operator explicitly maps all four values.
  await page.getByLabel("Compile seconds", { exact: true }).fill("91");
  await page.getByLabel("Writable collaborators", { exact: true }).fill("3");
  await page.getByLabel("History days", { exact: true }).fill("0");
  await page.getByLabel("Allow tracked proposals").check();
  await page.getByRole("button", { name: "Review grant change" }).click();
  await page.getByLabel("I reviewed this scope, version and grant change.").check();
  await page.screenshot({ path: "docs/evidence/p4-benefits-controls/plan-confirmation-390-dark.png" });
  await page.getByRole("button", { name: "Confirm grant change" }).click();
  await waitForRenderedText(page, "Grant saved at version 1");
  // Then: exact manual mapping persists with zero history distinct from unlimited.
  const response = resultSchema(endpoints.adminProjectBenefitsGet.output).parse(await (
    await operator.context.request.get("/api/admin/project-benefits/plan/manual%3Aacceptance-plan")).json());
  if ("error" in response) throw new TypeError(response.error.message);
  expect(response.data).toEqual({
    version: 1, benefits: { compileSeconds: 91, writableMembers: 3, historyDays: 0, trackChanges: true },
  });
  // Given: this actual authenticated session crosses the server's freshness threshold.
  await app.application.runtime.db.run("UPDATE sessions SET created_at=? WHERE user_id=?", [
    "2000-01-01T00:00:00.000Z", operator.session.user.id,
  ]);
  // When: its already-loaded form attempts another reviewed write.
  await page.getByRole("button", { name: "Review grant change" }).click();
  await page.getByLabel("I reviewed this scope, version and grant change.").check();
  const refused = page.waitForResponse(entry => entry.request().method() === "PUT"
    && new URL(entry.url()).pathname.includes("/project-benefits/plan/"));
  await page.getByRole("button", { name: "Confirm grant change" }).click();
  expect((await refused).status()).toBe(403);
  // Then: controls expose real fresh-auth recovery and never retry the privileged write.
  await waitForRenderedText(page, "FRESH_AUTH_REQUIRED");
  expect(await page.getByRole("link", { name: "Sign in again", exact: true }).isVisible()).toBe(true);
  expect(await page.getByRole("button", { name: "Review grant change" }).isDisabled()).toBe(true);
  await page.screenshot({ path: "docs/evidence/p4-benefits-controls/fresh-auth-required-390-dark.png", fullPage: true });
}, 300_000);
