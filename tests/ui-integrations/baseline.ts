import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { connectionApplication } from "./application";
import { startEditorBrowser, waitForRenderedText } from "../ui-editor/shared/browser";

await using app = await connectionApplication();
await using ownedBrowser = await startEditorBrowser();
const browser = ownedBrowser.browser;
{
  const session = await app.login();
  for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      colorScheme, isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1,
    });
    try {
      const [name, value] = session.headers.cookie.split("=");
      if (!name || !value) throw new TypeError("Cookie required");
      await context.addCookies([{ name, value, url: app.url.origin }]);
      const page = await context.newPage();
      await page.goto(new URL("/settings/git", app.url).href);
      await waitForRenderedText(page, "No provider connections.");
      const evidence = join(import.meta.dir, "evidence");
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: join(evidence, `connections-unconfigured-${width}-${colorScheme}-before.png`), fullPage: true });
    } finally { await context.close(); }
  }
}
