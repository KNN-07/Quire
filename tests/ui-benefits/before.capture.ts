import { test } from "bun:test";
import { authenticatedContext, startEditorApplication, startEditorBrowser, waitForRenderedText } from "../ui-editor/shared";
import { openPanel } from "../ui-editor/review/browser-harness";

test("captures pre-change administration and owner sharing", async () => {
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  for (const width of [390, 1440, 1920]) {
    for (const theme of ["light", "dark"] as const) {
      await using owner = await authenticatedContext(browser, app, {
        viewport: { width, height: 900 }, colorScheme: theme,
        isMobile: width === 390, hasTouch: width === 390,
        deviceScaleFactor: width === 390 ? 3 : 1,
      });
      const page = await owner.context.newPage();
      await openPanel(page, { view: "share", theme });
      await page.screenshot({ path: `docs/evidence/p4-benefits-controls/share-${width}-${theme}-before.png` });
      await using operator = await authenticatedContext(browser, app, {
        email: "operator@quire.local", viewport: { width, height: 900 }, colorScheme: theme,
        isMobile: width === 390, hasTouch: width === 390,
        deviceScaleFactor: width === 390 ? 3 : 1,
      });
      const admin = await operator.context.newPage();
      await admin.goto("/admin", { waitUntil: "domcontentloaded" });
      await waitForRenderedText(admin, "Server overview");
      await admin.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
      await admin.screenshot({ path: `docs/evidence/p4-benefits-controls/admin-${width}-${theme}-before.png` });
    }
  }
}, 300_000);
