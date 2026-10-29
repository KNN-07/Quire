import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";

test("identity provider details remain readable beside desktop actions and above mobile actions", async () => {
  const evidence = `docs/evidence/p20-identity-layout/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("IDENTITY_LAYOUT_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    for (const width of [1440, 390]) {
      await using actor = await authenticatedContext(browser, app, {
        viewport: { width, height: width === 390 ? 844 : 900 },
        isMobile: width === 390, hasTouch: width === 390,
      });
      const page = await actor.context.newPage();
      await page.goto("/settings/security", { waitUntil: "domcontentloaded" });
      await waitForRenderedText(page, "Link Google");
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `${evidence}/${width}-${colorScheme}.png`, fullPage: true });
        const rows = await page.getByRole("button", { name: /^Link / }).evaluateAll(buttons => buttons.map(button => {
          const row = button.parentElement;
          const detail = row?.querySelector("span");
          const reason = detail?.querySelector("small");
          if (!row || !detail || !reason) throw new Error("Provider details missing");
          const text = document.createRange();
          text.selectNodeContents(detail);
          text.setEndBefore(reason);
          const labelBox = text.getBoundingClientRect();
          const detailBox = detail.getBoundingClientRect();
          const reasonBox = reason.getBoundingClientRect();
          const buttonBox = button.getBoundingClientRect();
          return {
            separateLines: reasonBox.top >= labelBox.bottom,
            fullMobileWidth: detailBox.width >= row.clientWidth - 1,
            actionBelow: buttonBox.top >= detailBox.bottom,
            actionBeside: buttonBox.left >= detailBox.right,
            disabled: button instanceof HTMLButtonElement && button.disabled,
          };
        }));
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.separateLines).toBe(true);
          expect(row.disabled).toBe(true);
          if (width === 390) {
            expect(row.fullMobileWidth).toBe(true);
            expect(row.actionBelow).toBe(true);
          } else expect(row.actionBeside).toBe(true);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await page.close();
    }
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("IDENTITY_LAYOUT_CLOSED", { root, evidence });
}, 180_000);
