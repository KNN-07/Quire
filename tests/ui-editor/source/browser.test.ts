import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { endpoints, resultSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticatedContext, nextApplicationEvent, projectDocument, startEditorApplication, startEditorBrowser } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import type * as Harness from "./browser-entry";
import { buildSourceFixture, sourceEntry as entry, sourceHtml as html, sourceReady as ready, sourceClose as close, sourceBrowserErrors } from "./browser-session";

describe("real-service source authoring", () => {
  const resources = new AsyncDisposableStack();
  let app: EditorApplication;
  let browser: EditorBrowser;
  beforeAll(async () => {
    try {
      await buildSourceFixture();
      app = resources.use(await startEditorApplication());
      console.info("SOURCE_RESOURCE_OWNED", { web: app.url.origin, api: app.apiUrl.origin, root: app.dataDir });
      browser = resources.use(await startEditorBrowser());
    } catch (error) {
      await resources.disposeAsync();
      throw error;
    }
  }, 120_000);
  afterAll(async () => {
    await resources.disposeAsync();
    console.info("SOURCE_RESOURCES_CLOSED", { web: app?.url.origin, api: app?.apiUrl.origin, root: app?.dataDir });
  }, 90_000);
  test.each([1440, 390])("persists real CodeMirror Unicode edits and preferences after reload at %i", async width => {
    // Given the actual application, an authenticated owner and the real source panel.
    await using actor = await authenticatedContext(browser, app, { viewport: { width, height: width === 390 ? 844 : 900 }, isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1 });
    const baseline = await actor.context.request.patch(endpoints.preferencesPatch.path, {
      headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken },
      data: { expectedVersion: actor.session.preferences.version, theme: "light", fontSize: 13, bindings: "default" },
    });
    editorValue(resultSchema(endpoints.preferencesPatch.output).parse(await baseline.json()));
    const page = await actor.context.newPage();
    const errors = sourceBrowserErrors(page);
    try {
      await page.goto(`${html}?project=${fixtureIds.project}`, { waitUntil: "domcontentloaded" });
      await ready(page);
      console.info("SOURCE_PHASE", { width, phase: "opened" });
      const original = await page.evaluate(async path => { const harness: typeof Harness = await import(path); return harness.text(); }, entry);
      const marker = `\r\n\\section{Unicode ${width}}\r\nTiếng Việt 中文 😀 𝛼\r\n\\unknownmacro{untouched}\r\n`;
      // When a real CodeMirror keystroke and source handle edit are durably acknowledged.
      await page.evaluate(async input => {
        const harness: typeof Harness = await import(input.entry);
        harness.select({ anchor: harness.text().length, head: harness.text().length });
        harness.insert(input.marker);
      }, { entry, marker });
      await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("End");
      await page.keyboard.insertText("% keyboard-proof");
      await page.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.flush(); }, entry);
      console.info("SOURCE_PHASE", { width, phase: "source-acknowledged" });
      const persisted = await projectDocument(actor.context, { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile });
      expect(persisted.text).toBe(original + marker + "% keyboard-proof");
      await close(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await ready(page);
      console.info("SOURCE_PHASE", { width, phase: "source-reloaded" });
      // Then authoritative source bytes survive reload and the panel has a real DOM/editor tree.
      const reloaded = await page.evaluate(async path => { const harness: typeof Harness = await import(path); return harness.text(); }, entry);
      expect(reloaded).toBe(persisted.text);
      expect(await page.locator(".cm-editor .cm-content").count()).toBe(1);
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        editor: document.querySelector(".cm-editor")?.getBoundingClientRect().toJSON(),
        scrollers: [...document.querySelectorAll("*")].filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight).map(node => node.className),
      }));
      expect(geometry.overflow).toBe(false);
      await page.screenshot({ path: fileURLToPath(new URL(`./evidence/source-${width}-light.png`, import.meta.url)) });
      await page.locator(".cm-scroller").evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.screenshot({ path: fileURLToPath(new URL(`./evidence/source-${width}-light-end.png`, import.meta.url)) });
      await page.getByRole("button", { name: "Outline", exact: true }).click();
      await page.getByRole("button", { name: `Unicode ${width}`, exact: true }).click();
      console.info("SOURCE_PHASE", { width, phase: "outline-navigated" });
      await page.screenshot({ path: fileURLToPath(new URL(`./evidence/outline-${width}-light.png`, import.meta.url)) });
      await page.getByRole("button", { name: "Preferences", exact: true }).click();
      await page.getByLabel("Font size (10-24 px)").fill("18");
      await page.getByLabel("Theme", { exact: true }).selectOption("dark");
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.preferencesPatch.path && response.request().method() === "PATCH", { timeout: 30_000 });
      await page.getByRole("button", { name: "Save preferences", exact: true }).click();
      const preferences = editorValue(resultSchema(endpoints.preferencesPatch.output).parse(await (await saved).json()));
      expect(preferences.fontSize).toBe(18);
      expect(preferences.theme).toBe("dark");
      await close(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await ready(page);
      expect(await page.locator(".q-source-panel").getAttribute("data-theme")).toBe("dark");
      const fontSize = await page.locator(".cm-scroller").evaluate(node => getComputedStyle(node).fontSize);
      expect(fontSize).toBe("18px");
      await page.screenshot({ path: fileURLToPath(new URL(`./evidence/source-${width}-dark.png`, import.meta.url)) });
      await page.locator(".cm-scroller").evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.screenshot({ path: fileURLToPath(new URL(`./evidence/source-${width}-dark-end.png`, import.meta.url)) });
      console.info("SOURCE_BROWSER_PERSISTENCE", { width, bytes: persisted.file.bytes, geometry, fontSize });
    } catch (error) {
      console.error("SOURCE_BROWSER_FAILURE_STATE", await page.evaluate(async path => {
        const harness: typeof Harness = await import(path);
        return harness.snapshot();
      }, entry));
      await page.screenshot({ path: fileURLToPath(new URL(`./evidence/failure-${width}.png`, import.meta.url)) });
      throw error;
    } finally {
      await close(page);
    }
    expect(errors).toEqual([]);
  }, 90_000);
  test("converges two actual source views and preserves a remote edit through local undo", async () => {
    // Given two independent authorized browsers on the same real Yjs document.
    await using owner = await authenticatedContext(browser, app);
    await using collaborator = await authenticatedContext(browser, app, { email: "mai@quire.local" });
    const left = await owner.context.newPage();
    const right = await collaborator.context.newPage();
    const leftErrors = sourceBrowserErrors(left);
    const rightErrors = sourceBrowserErrors(right);
    try {
      await Promise.all([left, right].map(async page => {
        await page.goto(`${html}?project=${fixtureIds.project}`, { waitUntil: "domcontentloaded" });
        await ready(page);
      }));
      const marker = `remote-${crypto.randomUUID()}-😀`;
      // When the observer is registered before a collaborator's actual edit.
      await left.evaluate(async input => {
        const harness: typeof Harness = await import(input.entry);
        harness.subscribeSource(input.marker);
      }, { entry, marker });
      await right.evaluate(async input => {
        const harness: typeof Harness = await import(input.entry);
        harness.select({ anchor: harness.text().length, head: harness.text().length });
        harness.insert(input.marker);
        await harness.flush();
      }, { entry, marker });
      await left.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.sourceObserved(); }, entry);
      await left.evaluate(async path => {
        const harness: typeof Harness = await import(path);
        harness.select({ anchor: 0, head: 0 }); harness.insert("LOCAL-");
      }, entry);
      await left.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("Control+z");
      await left.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.flush(); }, entry);
      // Then local undo does not delete the collaborator's durable Unicode edit.
      const persisted = await projectDocument(owner.context, { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile });
      expect(persisted.text.includes(marker)).toBe(true);
      expect(persisted.text.startsWith("LOCAL-")).toBe(false);
    } finally { await Promise.all([close(left), close(right)]); }
    expect([...leftErrors, ...rightErrors]).toEqual([]);
  }, 90_000);
  test("persists an ordinary incomplete main command through the source view and reload", async () => {
    // Given the actual current main document and its independently known source bytes.
    await using actor = await authenticatedContext(browser, app);
    const page = await actor.context.newPage();
    const errors = sourceBrowserErrors(page);
    try {
      await page.goto(`${html}?project=${fixtureIds.project}`, { waitUntil: "domcontentloaded" });
      await ready(page);
      const original = await page.evaluate(async path => { const harness: typeof Harness = await import(path); return harness.text(); }, entry);
      const offset = original.indexOf("\\documentclass") + "\\documentclass".length - 1;
      if (offset < "\\documentclass".length - 1) throw new TypeError("Expected initial documentclass command");
      // When a real Backspace leaves a temporarily incomplete command.
      await page.evaluate(async input => { const harness: typeof Harness = await import(input.entry); harness.select({ anchor: input.offset, head: input.offset + 1 }); }, { entry, offset });
      await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("Backspace");
      await page.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.flush(); }, entry);
      const expected = original.slice(0, offset) + original.slice(offset + 1);
      const persisted = await projectDocument(actor.context, { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile });
      // Then the server and a reopened source view preserve the incomplete draft exactly.
      expect(persisted.text).toBe(expected);
      await close(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await ready(page);
      expect(await page.evaluate(async path => { const harness: typeof Harness = await import(path); return harness.text(); }, entry)).toBe(expected);
    } finally { await close(page); }
    expect(errors).toEqual([]);
  }, 90_000);
  test("navigates a genuine compiler diagnostic independently of heuristic suppression", async () => {
    // Given invalid source durably written through the actual source document.
    await using actor = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
    const page = await actor.context.newPage();
    const errors = sourceBrowserErrors(page);
    const source = "\\documentclass{article}\n\\begin{document}\n\\quirenotacommand\n\\end{document}\n";
    try {
      await page.goto(`${html}?project=${fixtureIds.project}`, { waitUntil: "domcontentloaded" });
      await ready(page);
      await page.evaluate(async input => { const harness: typeof Harness = await import(input.entry); harness.replaceAllSource(input.source); await harness.flush(); }, { entry, source });
      const response = await actor.context.request.get(`/api/projects/${fixtureIds.project}/effective-access`, { params: { branch: "main" } });
      const access = editorValue(resultSchema(endpoints.projectAccess.output).parse(await response.json()));
      using failed = nextApplicationEvent(app, event => event.topic === "job.changed"
        && event.aggregateId === fixtureIds.project && event.payload.status === "failed", 60_000);
      // When the real sandboxed compiler processes the exact acknowledged draft.
      const [created, event] = await Promise.all([
        actor.context.request.post(`/api/projects/${fixtureIds.project}/compiles`, {
          headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
          data: { scope: { projectId: fixtureIds.project, branch: "main" }, expectedRevision: access.branchRevision, clean: false },
        }),
        failed.promise,
      ]);
      const queued = editorValue(resultSchema(endpoints.compileCreate.output).parse(await created.json()));
      const completed = await actor.context.request.get(`/api/compiles/${queued.id}`);
      const job = editorValue(resultSchema(endpoints.compileGet.output).parse(await completed.json()));
      const diagnostic = job.diagnostics.find(item => item.fileId === fixtureIds.mainFile && item.line === 3 && item.severity === "error");
      if (!diagnostic) throw new TypeError(`Actual compiler did not link the source error: ${JSON.stringify(job)}`);
      expect(event).toMatchObject({ topic: "job.changed", aggregateId: fixtureIds.project, payload: { resourceId: job.id, status: "failed" } });
      expect(job.status).toBe("failed");
      await page.evaluate(async input => { const harness: typeof Harness = await import(input.entry); harness.showDiagnostics(input.diagnostics); }, { entry, diagnostics: job.diagnostics });
      await page.getByRole("button", { name: "Code Check", exact: true }).click();
      await page.getByLabel("Check all files in this session", { exact: true }).uncheck();
      await page.locator(".q-source-tools").getByRole("button", { name: `error: ${diagnostic.message} (main.tex:3)`, exact: true }).click();
      // Then actual compiler navigation selects the real line despite disabled Code Check.
      const selection = await page.evaluate(async path => { const harness: typeof Harness = await import(path); return harness.selectedRange(); }, entry);
      expect(selection).toEqual({ anchor: source.indexOf("\\quirenotacommand"), head: source.indexOf("\\quirenotacommand") });
      await page.screenshot({ path: fileURLToPath(new URL("./evidence/source-diagnostic-1440.png", import.meta.url)) });
      console.info("SOURCE_REAL_DIAGNOSTIC", { jobId: job.id, fileId: diagnostic.fileId, line: diagnostic.line, selection });
    } finally { await close(page); }
    expect(errors).toEqual([]);
  }, 90_000);
});
