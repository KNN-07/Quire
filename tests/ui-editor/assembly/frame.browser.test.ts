import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { authenticatedContext, startEditorApplication, startEditorBrowser } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import type * as Harness from "./frame-entry";

const entry = "/@fs" + fileURLToPath(new URL("./evidence/frame/frame-entry.js", import.meta.url));
const html = "/@fs" + fileURLToPath(new URL("./frame.html", import.meta.url));
const evidence = fileURLToPath(new URL(`./evidence/frame-runs/${crypto.randomUUID()}/`, import.meta.url));
describe("standalone verified-authoring frame geometry, not assembled-editor acceptance", () => {
  const resources = new AsyncDisposableStack();
  let app: EditorApplication;
  let browser: EditorBrowser;
  beforeAll(async () => {
    try {
      await mkdir(evidence, { recursive: true });
      const build = await Bun.build({
        entrypoints: [fileURLToPath(new URL("./frame-entry.tsx", import.meta.url))],
        outdir: fileURLToPath(new URL("./evidence/frame", import.meta.url)),
        target: "browser", minify: true, define: { "process.env.NODE_ENV": "\"production\"" },
        naming: { entry: "[name].[ext]", asset: "[name]-[hash].[ext]" },
      });
      if (!build.success) throw new AggregateError(build.logs, "Geometry fixture build failed");
      app = resources.use(await startEditorApplication());
      browser = resources.use(await startEditorBrowser());
      console.info("FRAME_RESOURCES_OWNED", { web: app.url.origin, api: app.apiUrl.origin, root: app.dataDir, evidence, runtime: Bun.version });
    } catch (cause) {
      await resources.disposeAsync();
      throw cause;
    }
  }, 120_000);
  afterAll(async () => {
    await resources.disposeAsync();
    console.info("FRAME_RESOURCES_CLOSED", { web: app?.url.origin, api: app?.apiUrl.origin, root: app?.dataDir });
  }, 90_000);
  for (const width of [1440, 390]) {
    for (const theme of ["light", "dark"] as const) {
      test(`holds actual authoring at ${width} in ${theme}`, async () => {
        // Given the actual seeded document, verified source/visual panels and the unmounted app frame.
        await using actor = await authenticatedContext(browser, app, {
          viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: theme,
          isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1,
        });
        const page = await actor.context.newPage();
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        try {
          await page.goto(html, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await page.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.ready; }, entry);
          const geometry = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
            header: document.querySelector(".qe-header")?.getBoundingClientRect().height,
            rail: document.querySelector(".qe-rail")?.getBoundingClientRect().width,
          }));
          expect(geometry.overflow).toBe(false);
          if (width === 1440) {
            expect(geometry.header).toBe(56);
            expect(geometry.rail).toBe(52);
          }
          await page.screenshot({ path: `${evidence}/frame-source-${width}-${theme}.png` });
          if (width === 1440) {
            // When the keyboard changes the real file splitter after its style subscription is armed.
            await page.evaluate(async path => { const harness: typeof Harness = await import(path); harness.armState("tree-width"); }, entry);
            await page.getByRole("separator", { name: "Resize tree", exact: true }).press("ArrowRight");
            await page.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.observed(); }, entry);
            // Then the new width is persisted under the actual user's key.
            expect(await page.locator(".qe-tools").evaluate(node => node.getBoundingClientRect().width)).toBe(238);
            const persisted = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("quire.editor.sizes.")));
            expect(persisted).toHaveLength(1);
          } else {
            await page.evaluate(async path => { const harness: typeof Harness = await import(path); harness.armState("drawer-open"); }, entry);
            await page.getByRole("navigation", { name: "Workspace panes" }).getByRole("button", { name: "Files", exact: true }).click();
            await page.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.observed(); }, entry);
            expect(await page.getByRole("dialog").evaluate(node => node.contains(document.activeElement))).toBe(true);
            await page.screenshot({ path: `${evidence}/frame-drawer-${width}-${theme}.png` });
            await page.evaluate(async path => { const harness: typeof Harness = await import(path); harness.armState("drawer-closed"); }, entry);
            await page.keyboard.press("Escape");
            await page.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.observed(); }, entry);
            expect(await page.getByRole("navigation", { name: "Workspace panes" }).getByRole("button", { name: "Files", exact: true }).evaluate(node => node === document.activeElement)).toBe(true);
          }
          await page.evaluate(async path => { const harness: typeof Harness = await import(path); harness.armState("visual"); }, entry);
          await page.getByRole("button", { name: "Visual", exact: true }).click();
          await page.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.observed(); }, entry);
          expect(await page.locator(".q-visual").count()).toBe(1);
          await page.screenshot({ path: `${evidence}/frame-visual-${width}-${theme}.png` });
          expect(errors).toEqual([]);
          console.info("FRAME_GEOMETRY", { width, theme, geometry });
        } catch (cause) {
          await page.screenshot({ path: `${evidence}/frame-failure-${width}-${theme}.png` });
          throw cause;
        } finally {
          await page.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.close(); }, entry);
        }
      }, 90_000);
    }
  }
});
