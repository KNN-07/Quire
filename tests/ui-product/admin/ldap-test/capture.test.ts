import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser } from "../../../ui-editor/shared/browser";

test("LDAP test credential controls remain framed at desktop and mobile widths", async () => {
  const evidence = `docs/evidence/p27-admin-ldap/controls-${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  await using app = await connectionApplication();
  console.info("ADMIN_LDAP_CAPTURE_OWNED", { root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin, evidence });
  await using browser = await startEditorBrowser();
  await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
  const page = await operator.context.newPage();
  await page.goto("/admin/identity", { waitUntil: "domcontentloaded" });
  await page.getByRole("combobox", { name: /^Protocol/ }).selectOption("ldap");
  const username = page.getByLabel("Test username", { exact: true });
  const password = page.getByLabel("Test user password", { exact: true });
  await username.waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(() => document.fonts.ready);
      await username.evaluate(element => element.scrollIntoView({ block: "center" }));
      for (const field of [username, password]) {
        expect(await field.evaluate(element => {
          const box = element.getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth && box.top >= 56 && box.bottom <= innerHeight;
        })).toBe(true);
      }
      await page.screenshot({ path: `${evidence}/${width}-${colorScheme}.png` });
    }
  }
  await page.close();
}, 120_000);
