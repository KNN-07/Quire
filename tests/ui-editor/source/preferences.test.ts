import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { endpoints, resultSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { sourceCatalog } from "../../../apps/web/src/features/editor/source/locale";
import { authenticatedContext, startEditorApplication, startEditorBrowser } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { buildSourceFixture, sourceBrowserErrors, sourceClose, sourceEntry, sourceHtml, sourceReady } from "./browser-session";
import type * as Harness from "./browser-entry";

describe("persisted source preferences", () => {
  const resources = new AsyncDisposableStack();
  let app: EditorApplication;
  let browser: EditorBrowser;
  beforeAll(async () => {
    try {
      await buildSourceFixture();
      app = resources.use(await startEditorApplication());
      console.info("SOURCE_PREFERENCES_OWNED", { root: app.dataDir, web: app.url.origin });
      browser = resources.use(await startEditorBrowser());
    } catch (error) { await resources.disposeAsync(); throw error; }
  }, 120_000);
  afterAll(async () => {
    await resources.disposeAsync();
    console.info("SOURCE_PREFERENCES_CLOSED", { root: app?.dataDir, web: app?.url.origin, api: app?.apiUrl.origin });
  }, 90_000);
  test.each([1440, 390])("persists independent language dictionary and source typography controls at %i", async width => {
    // Given the real current account and a source view with no fabricated save state.
    await using actor = await authenticatedContext(browser, app, { viewport: { width, height: width === 390 ? 844 : 900 }, isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1 });
    const page = await actor.context.newPage();
    const errors = sourceBrowserErrors(page);
    try {
      await page.goto(`${sourceHtml}?project=${fixtureIds.project}`, { waitUntil: "domcontentloaded" });
      await sourceReady(page);
      await page.getByRole("button", { name: sourceCatalog[actor.session.user.interfaceLanguage].preferences, exact: true }).click();
      // When each language is changed through its actual control and acknowledged profile PATCH.
      for (const language of ["vi", "zh", "en"] as const) {
        const response = page.waitForResponse(entry => new URL(entry.url()).pathname === endpoints.profilePatch.path && entry.request().method() === "PATCH", { timeout: 30_000 });
        await page.locator('select[name="interfaceLanguage"]').selectOption(language);
        const user = editorValue(resultSchema(endpoints.profilePatch.output).parse(await (await response).json()));
        await page.getByRole("button", { name: sourceCatalog[language].preferences, exact: true }).focus();
        expect(user.interfaceLanguage).toBe(language);
        expect(await page.locator(".q-source-panel").getAttribute("lang")).toBe(language);
        await page.screenshot({ path: fileURLToPath(new URL(`./evidence/preferences-${width}-${language}.png`, import.meta.url)) });
      }
      await page.getByLabel("Font size (10-24 px)", { exact: true }).fill(width === 390 ? "24" : "18");
      await page.getByLabel("Font family", { exact: true }).selectOption("serif");
      await page.getByLabel("Line height", { exact: true }).selectOption("wide");
      await page.getByLabel("Dictionary", { exact: true }).selectOption("vi");
      await page.getByLabel("Custom dictionary words (one per line)", { exact: true }).fill("QuireWord\nViệtNam");
      await page.getByLabel("Theme", { exact: true }).selectOption("dark");
      const response = page.waitForResponse(entry => new URL(entry.url()).pathname === endpoints.preferencesPatch.path && entry.request().method() === "PATCH", { timeout: 30_000 });
      await page.getByRole("button", { name: sourceCatalog.en.save, exact: true }).click();
      const preferences = editorValue(resultSchema(endpoints.preferencesPatch.output).parse(await (await response).json()));
      expect(preferences.customWords).toEqual(["QuireWord", "ViệtNam"]);
      expect(preferences.dictionary).toBe("vi");
      expect(preferences.fontFamily).toBe("serif");
      expect(preferences.lineHeight).toBe("wide");
      await sourceClose(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await sourceReady(page);
      await page.getByRole("button", { name: sourceCatalog.en.preferences, exact: true }).click();
      await page.getByRole("link", { name: "Dictionary license", exact: true }).focus();
      expect(await page.locator(".q-source-panel").getAttribute("data-spelling-state")).toBe("ready");
      for (const choice of [
        { dictionary: "zh", state: "unavailable", alerts: 1, licenses: 0 },
        { dictionary: "vi", state: "ready", alerts: 0, licenses: 1 },
      ] as const) {
        await page.evaluate(async input => { const harness: typeof Harness = await import(input.entry); harness.subscribeSpelling(input.state); }, { entry: sourceEntry, state: choice.state });
        await page.getByLabel("Dictionary", { exact: true }).selectOption(choice.dictionary);
        const acknowledged = page.waitForResponse(result => new URL(result.url()).pathname === endpoints.preferencesPatch.path && result.request().method() === "PATCH", { timeout: 30_000 });
        await page.getByRole("button", { name: sourceCatalog.en.save, exact: true }).click();
        const changed = editorValue(resultSchema(endpoints.preferencesPatch.output).parse(await (await acknowledged).json()));
        expect(changed.dictionary).toBe(choice.dictionary);
        await page.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.spellingObserved(); }, sourceEntry);
        expect(await page.locator(".q-source-panel").getAttribute("data-spelling-state")).toBe(choice.state);
        expect(await page.getByRole("alert").count()).toBe(choice.alerts);
        expect(await page.getByRole("link", { name: "Dictionary license", exact: true }).count()).toBe(choice.licenses);
        await page.screenshot({ path: fileURLToPath(new URL(`./evidence/dictionary-${choice.dictionary}-${width}.png`, import.meta.url)) });
      }
      await page.getByRole("button", { name: sourceCatalog.en.close, exact: true }).click();
      // Then real persisted preferences drive the reopened editor independently of UI language.
      const geometry = await page.locator(".cm-scroller").evaluate(node => ({
        size: getComputedStyle(node).fontSize, line: getComputedStyle(node).lineHeight,
        family: getComputedStyle(node).fontFamily,
      }));
      expect(geometry.size).toBe(width === 390 ? "24px" : "18px");
      expect(geometry.line).toBe(width === 390 ? "48px" : "36px");
      expect(geometry.family.includes("Source Serif 4")).toBe(true);
      expect(await page.locator(".q-source-panel").getAttribute("data-theme")).toBe("dark");
      const layout = await page.evaluate(() => {
        const filename = document.querySelector(".q-source-filename");
        if (!filename) throw new TypeError("Current source filename is missing");
        return { filenameTop: filename.getBoundingClientRect().top, scrollY, viewport: { width: innerWidth, height: innerHeight },
          shifted: [...document.querySelectorAll("*")].filter(node => node.scrollTop !== 0).map(node => ({ node: node.id || node.className, top: node.scrollTop, height: node.clientHeight, content: node.scrollHeight })) };
      });
      console.info("SOURCE_PREFERENCES_RELOADED", { width, ...geometry, layout });
      expect(layout.filenameTop).toBeGreaterThanOrEqual(0);
      await page.screenshot({ path: fileURLToPath(new URL(`./evidence/preferences-${width}-dark-reload.png`, import.meta.url)) });
    } finally { await sourceClose(page); }
    expect(errors).toEqual([]);
  }, 90_000);
});
