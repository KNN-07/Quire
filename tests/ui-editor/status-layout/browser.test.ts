import { expect, test } from "bun:test";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { startAssemblyApplication } from "../assembly/application";
import { openSurface } from "../assembly/actual-browser";
import { authenticatedContext, startEditorBrowser } from "../shared";
import { fixtureIds } from "../../fixtures/foundation";

test("editor status items remain visible without an internally clipped mobile row", async () => {
  const evidence = `docs/evidence/p44-editor-status/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await startAssemblyApplication({});
    root = app.dataDir;
    console.info("EDITOR_STATUS_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app);
    const page = await owner.context.newPage();
    await openSurface(page, { path: `/projects/${fixtureIds.project}/edit`, selector: ".qe-status" });
    await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const [width, height] of [[1440, 900], [390, 844], [390, 900]] as const) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      for (const name of ["Assistant", "Project tools"]) {
        const drawer = page.getByRole("dialog", { name, exact: true });
        if (await drawer.count()) await drawer.getByRole("button", { name: "Close dialog", exact: true }).click();
      }
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        const geometry = await page.locator(".qe-status").evaluate(element => {
          const box = element.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight, viewport: { width: innerWidth, height: innerHeight },
            documentWidth: document.documentElement.scrollWidth,
            items: Array.from(element.children).map(child => {
              const rect = child.getBoundingClientRect();
              return { text: child.textContent, top: rect.top, bottom: rect.bottom, height: rect.height };
            }).filter(child => child.height > 0),
          };
        });
        const prefix = `${evidence}/${width}-${height}-${colorScheme}`;
        await writeFile(`${prefix}.json`, JSON.stringify(geometry, null, 2));
        await page.screenshot({ path: `${prefix}.png` });
        expect(geometry.documentWidth).toBeLessThanOrEqual(width);
        expect(geometry.bottom).toBeLessThanOrEqual(height + 1);
        expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight + 1);
        for (const item of geometry.items) expect(item.bottom).toBeLessThanOrEqual(geometry.bottom + 1);
      }
    }
    await page.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("EDITOR_STATUS_CLOSED", { root, evidence });
}, 180_000);
