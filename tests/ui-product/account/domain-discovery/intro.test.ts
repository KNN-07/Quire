import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { connectionApplication } from "../../../ui-integrations/application";
import { startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";

test("sign-in intro retains visible styling across fresh and changed system themes", async () => {
  const evidence = `docs/evidence/p21-intro-rendering/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  await using app = await connectionApplication();
  await using browser = await startEditorBrowser();
  console.info("INTRO_OWNED", { root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin, evidence });
  for (const width of [1440, 390]) {
    const context = await browser.browser.newContext({
      baseURL: app.url.origin, colorScheme: "dark",
      viewport: { width, height: width === 390 ? 844 : 900 },
      isMobile: width === 390, hasTouch: width === 390,
    });
    try {
      const page = await context.newPage();
      await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "Continue with Google");
      for (const mode of ["fresh-dark", "light", "changed-dark"] as const) {
        if (mode !== "fresh-dark") await page.emulateMedia({ colorScheme: mode === "light" ? "light" : "dark" });
        await page.evaluate(() => document.fonts.ready);
        const style = await page.locator(".account-intro").evaluate(element => {
          const label = element.querySelector(".account-statement");
          if (!label) throw new Error("Missing intro heading");
          const computed = getComputedStyle(label);
          const box = label.getBoundingClientRect();
          return { color: computed.color, opacity: computed.opacity, visibility: computed.visibility,
            width: box.width, height: box.height, dark: matchMedia("(prefers-color-scheme: dark)").matches };
        });
        expect(style.color).toBe("rgb(255, 255, 255)");
        expect(style.opacity).toBe("1");
        expect(style.visibility).toBe("visible");
        expect(style.width).toBeGreaterThan(0);
        expect(style.height).toBeGreaterThan(0);
        console.info("INTRO_STYLE", { viewportWidth: width, mode, ...style });
        await page.screenshot({ path: `${evidence}/${width}-${mode}.png`, fullPage: true });
        await page.locator(".account-intro").screenshot({ path: `${evidence}/${width}-${mode}-element.png` });
      }
      await page.close();
    } finally { await context.close(); }
  }
}, 180_000);
