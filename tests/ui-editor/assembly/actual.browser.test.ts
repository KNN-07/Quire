import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import type { BrowserContextOptions } from "@playwright/test";
import { z } from "zod";
import { CompileSettingsSchema, endpoints, resultSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticateApi, nextApplicationEvent, projectDocument, startEditorApplication, startEditorBrowser } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { openSurface, surfaceSignal } from "./actual-browser";

const sourceSelector = '.qe-main .cm-content[contenteditable="true"]';
const projectPath = `/projects/${fixtureIds.project}`;
const evidence = fileURLToPath(new URL(`./evidence/runs/${crypto.randomUUID()}/`, import.meta.url));
const routes = [
  { page: "edit", selector: sourceSelector },
  { page: "git", selector: ".qe-route .git-workspace" },
  { page: "agent", selector: ".qe-route .qa-assistant textarea" },
  { page: "history", selector: ".qe-route .quire-history:not(:has(.quire-review__loading))" },
  { page: "review", selector: ".qe-secondary .quire-review__review-grid:not(:has(.quire-review__loading))" },
  { page: "logs", selector: '.q-pdf-panel:has(.q-pdf-status[data-compile-status="succeeded"]) .q-tabs__panel:not([hidden]) .q-pdf-log' },
  { page: "pdf-diff", selector: '.q-pdf-panel select[aria-label="From revision"]:not(:disabled)' },
] as const;
describe("actual assembled editor routes", () => {
  const resources = new AsyncDisposableStack();
  let app: EditorApplication;
  let browser: EditorBrowser;
  let ownerIdentity: Awaited<ReturnType<typeof authenticateApi>>;
  const ownerContext = async (options: BrowserContextOptions = {}) => {
    const context = await browser.browser.newContext({ baseURL: app.url.origin, ...options });
    try {
      await context.addCookies([ownerIdentity.cookie]);
      return { context, session: ownerIdentity.session, async [Symbol.asyncDispose]() { await context.close(); } };
    } catch (cause) { await context.close(); throw cause; }
  };
  beforeAll(async () => {
    try {
      await mkdir(evidence, { recursive: true });
      console.info("ASSEMBLY_EVIDENCE_DIR", evidence);
      expect(Bun.version).toBe((await Bun.file(new URL("../../../.bun-version", import.meta.url)).text()).trim());
      console.info("ASSEMBLY_RUNTIME", { version: Bun.version, executable: process.execPath });
      for (const path of ["../../../apps/web/src/features/editor/index.tsx", "../../../apps/web/src/features/editor/workspace.tsx", "../../../apps/web/src/features/editor/workspace.css", "../../../apps/web/src/features/editor/chrome.tsx", "../../../apps/web/src/features/editor/session-controller.ts", "../../../apps/web/src/features/editor/source/SourcePanel.tsx", "../../../apps/web/src/features/editor/shared/contracts.ts", "../../../apps/web/src/features/editor/source/editor.ts", "../shared/web-server.mjs"]) {
        console.info("ASSEMBLY_INPUT", { path, sha256: new Bun.CryptoHasher("sha256").update(await Bun.file(new URL(path, import.meta.url)).arrayBuffer()).digest("hex") });
      }
      app = await startEditorApplication();
      resources.defer(async () => {
        console.info("ASSEMBLY_APP_CLOSE_START"); await app[Symbol.asyncDispose](); console.info("ASSEMBLY_APP_CLOSE_DONE");
      });
      browser = await startEditorBrowser();
      resources.defer(async () => {
        console.info("ASSEMBLY_BROWSER_CLOSE_START"); await browser[Symbol.asyncDispose](); console.info("ASSEMBLY_BROWSER_CLOSE_DONE");
      });
      console.info("ASSEMBLY_ACTUAL_OWNED", { web: app.url.origin, api: app.apiUrl.origin, root: app.dataDir });
      ownerIdentity = await authenticateApi(app);
      await using actor = await ownerContext();
      const projectResponse = await actor.context.request.get(`/api/projects/${fixtureIds.project}`, { params: { branch: "main" } });
      const project = editorValue(resultSchema(endpoints.projectGet.output).parse(await projectResponse.json()));
      const accessResponse = await actor.context.request.get(`/api/projects/${fixtureIds.project}/effective-access`, { params: { branch: "main" } });
      const access = editorValue(resultSchema(endpoints.projectAccess.output).parse(await accessResponse.json()));
      using compiled = nextApplicationEvent(app, event => event.topic === "job.changed"
        && event.aggregateId === fixtureIds.project && event.payload.status === "succeeded", 90_000);
      const [response] = await Promise.all([actor.context.request.post(endpoints.compileCreate.path.replace(":p", fixtureIds.project), {
        headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
        data: { scope: { projectId: fixtureIds.project, branch: "main" }, expectedRevision: access.branchRevision, settings: project.settings, clean: false },
      }), compiled.promise]);
      const job = editorValue(resultSchema(endpoints.compileCreate.output).parse(await response.json()));
      console.info("ASSEMBLY_REAL_FIXTURE_COMPILED", { job: job.id });
    } catch (cause) { await resources.disposeAsync(); throw cause; }
  }, 120_000);
  afterAll(async () => {
    await resources.disposeAsync();
    console.info("ASSEMBLY_ACTUAL_CLOSED", { web: app?.url.origin, api: app?.apiUrl.origin, root: app?.dataDir });
  }, 90_000);
  test("persists an actual mounted CodeMirror edit and receives it again on reload", async () => {
    // Given the actual authenticated router and independently read initial source.
    await using actor = await ownerContext();
    const page = await actor.context.newPage();
    const scope = { projectId: fixtureIds.project, fileId: fixtureIds.mainFile, branch: "main" };
    const before = await projectDocument(actor.context, scope);
    await openSurface(page, { path: projectPath + "/edit", selector: sourceSelector });
    const marker = `\n% assembled Unicode persistence 😀 ${crypto.randomUUID()}\n`;
    using saved = nextApplicationEvent(app, event => event.topic === "document.saved"
      && event.aggregateId === fixtureIds.project && event.payload.resourceId === fixtureIds.mainFile);
    await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+End");
    // When real keyboard input passes through the mounted shared transport.
    const [savedEvent] = await Promise.all([saved.promise, page.keyboard.insertText(marker)]);
    // Then the native byte endpoint and a fresh reload carry the exact committed input.
    const persisted = await projectDocument(actor.context, scope);
    expect(persisted.text).toBe(before.text + marker);
    if (savedEvent.topic !== "document.saved") throw new TypeError("Wrong source-save event");
    const acknowledged = await surfaceSignal(page, `.qe-status [data-save-revision="${savedEvent.payload.revision}"]`);
    await acknowledged.observed;
    const reloaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/files/${fixtureIds.mainFile}/document`), { timeout: 30_000 });
    await Promise.all([reloaded, page.reload({ waitUntil: "domcontentloaded" })]);
    const received = editorValue(resultSchema(endpoints.fileDocument.output).parse(await (await reloaded).json()));
    expect(received.text).toBe(before.text + marker);
    console.info("ASSEMBLY_ACTUAL_PERSISTED", { file: fixtureIds.mainFile, revision: persisted.file.version.revision, bytes: persisted.file.bytes });
  }, 90_000);
  for (const width of [1440, 390]) for (const theme of ["light", "dark"] as const) {
    test(`executes embedded Source tools from keyboard-accessible menus at ${width} in ${theme}`, async () => {
      // Given a real mounted source editor with a durably saved, unique comment.
      await using actor = await ownerContext({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: theme });
      const page = await actor.context.newPage();
      await openSurface(page, { path: projectPath + "/edit", selector: sourceSelector });
      const textbox = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
      const marker = `assembly-tools-${crypto.randomUUID()}`;
      using inserted = nextApplicationEvent(app, event => event.topic === "document.saved"
        && event.aggregateId === fixtureIds.project && event.payload.resourceId === fixtureIds.mainFile);
      await textbox.press("ControlOrMeta+End");
      await Promise.all([inserted.promise, page.keyboard.insertText(`\n% ${marker}\n`)]);
      const before = await projectDocument(actor.context, { projectId: fixtureIds.project, fileId: fixtureIds.mainFile, branch: "main" });
      // When the assembly menu opens each actual producer tool using keyboard activation.
      for (const [action, tool] of [["Find and replace", "Find"], ["Outline", "Outline"], ["Code Check", "Code Check"], ["Source preferences", "Preferences"], ["Keyboard shortcuts", "Shortcuts"]] as const) {
        const trigger = page.locator('.qe-source-header summary[aria-label="Source actions"]');
        await trigger.focus();
        await trigger.press("Enter");
        const opened = await surfaceSignal(page, `.q-source-tools[aria-label="${tool}"]`);
        const command = page.getByRole("button", { name: action, exact: true });
        await command.focus();
        await command.press("Enter");
        await opened.observed;
        const panel = page.locator(`.q-source-tools[aria-label="${tool}"]`);
        if (tool === "Find") {
          await panel.getByRole("textbox", { name: "Find in current file", exact: true }).fill(marker);
          await panel.getByRole("button", { name: "Next", exact: true }).click();
        }
        if (tool === "Shortcuts") await page.screenshot({ path: `${evidence}/source-tools-${width}-${theme}.png` });
        // Escape closes real tools and returns keyboard focus to the live editor.
        await panel.getByRole("button", { name: "Close", exact: true }).focus();
        await page.keyboard.press("Escape");
        expect(await page.locator(".q-source-tools").count()).toBe(0);
        expect(await textbox.evaluate(node => node === document.activeElement)).toBe(true);
      }
      // Then the actual formatting port applies to the selection produced by real Find.
      await page.locator('.qe-source-header summary[aria-label="Source actions"]').click();
      const menu = page.getByRole("navigation", { name: "Source actions", exact: true });
      expect(await menu.getByRole("button").count()).toBe(12);
      const lineTool = await surfaceSignal(page, ".cm-goto-line input");
      await menu.getByRole("button", { name: "Go to line", exact: true }).click();
      await lineTool.observed;
      expect(await page.locator(".cm-goto-line input").evaluate(node => node === document.activeElement)).toBe(true);
      await page.keyboard.press("Escape");
      await page.locator('.qe-source-header summary[aria-label="Source actions"]').click();
      using formatted = nextApplicationEvent(app, event => event.topic === "document.saved"
        && event.aggregateId === fixtureIds.project && event.payload.resourceId === fixtureIds.mainFile);
      await Promise.all([formatted.promise, menu.getByRole("button", { name: "Bold", exact: true }).click()]);
      const after = await projectDocument(actor.context, { projectId: fixtureIds.project, fileId: fixtureIds.mainFile, branch: "main" });
      expect(after.text).toBe(before.text.replace(marker, `\\textbf{${marker}}`));
      expect(await page.locator('.q-source-panel[data-presentation="embedded"] .q-source-toolbar').count()).toBe(0);
      await page.screenshot({ path: `${evidence}/source-embedded-${width}-${theme}.png` });
      console.info("ASSEMBLY_SOURCE_TOOLS", { width, theme, revision: after.file.version.revision });
    }, 90_000);
  }
  test("compiles from the actual header and renders genuine PDF.js output", async () => {
    // Given actual live PDF settings and a unique source edit, without a test-side flush.
    await using actor = await ownerContext({ viewport: { width: 1440, height: 900 } });
    const page = await actor.context.newPage();
    await openSurface(page, { path: projectPath + "/edit", selector: sourceSelector });
    await page.locator(".q-pdf-options > summary").click();
    await page.getByLabel("Draft (skip images)", { exact: true }).check();
    await page.getByLabel("Stop on first error", { exact: true }).check();
    await page.locator(".q-pdf-options > summary").press("Escape");
    expect(await page.locator(".q-pdf-options").getAttribute("open")).toBeNull();
    expect(await page.locator(".q-pdf-options > summary").evaluate(node => node === document.activeElement)).toBe(true);
    await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+End");
    await page.keyboard.insertText(`\n% fresh header compile ${crypto.randomUUID()}\n`);
    using completed = nextApplicationEvent(app, event => event.topic === "job.changed"
      && event.aggregateId === fixtureIds.project && event.payload.status === "succeeded", 90_000);
    const rendered = await surfaceSignal(page, 'canvas[data-rendered="true"]', 120_000);
    // When the mounted header starts the actual sandboxed compile.
    await page.getByRole("button", { name: "Recompile", exact: true }).click();
    await Promise.all([completed.promise, rendered.observed]);
    // Then discovery and artifact bytes match a successful job and rendered PDF.
    const response = await actor.context.request.get(`${projectPath.replace("/projects/", "/api/projects/")}/compile-preview`, { params: { branch: "main" } });
    const body = resultSchema(endpoints.compilePreview.output).parse(await response.json());
    const preview = editorValue(body);
    expect(preview.job?.status).toBe("succeeded");
    if (!preview.job || !preview.preview) throw new TypeError("Compiled preview was not published");
    const stored = z.object({ settings_json: z.string() }).parse(await app.application.runtime.db.get(
      "SELECT settings_json FROM compile_jobs WHERE id=?", [preview.job.id]));
    const settings = CompileSettingsSchema.parse(JSON.parse(stored.settings_json));
    expect(settings.draft).toBe(true);
    expect(settings.stopOnFirstError).toBe(true);
    const persisted = await projectDocument(actor.context, { projectId: fixtureIds.project, fileId: fixtureIds.mainFile, branch: "main" });
    expect(preview.preview?.snapshot.revision).toBe(persisted.file.version.revision);
    const artifact = await actor.context.request.get(`/api/artifacts/${preview.preview.artifact.id}/content`);
    const bytes = await artifact.body();
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    await Bun.write(`${evidence}/assembled-output-${preview.preview.artifact.id}.pdf`, bytes);
    await Bun.write(`${evidence}/preview-${preview.preview.artifact.id}.json`, JSON.stringify({ status: response.status(), body }, null, 2));
    await Bun.write(`${evidence}/header-settings-${preview.job.id}.json`, JSON.stringify({ jobId: preview.job.id, settings, revision: persisted.file.version.revision }, null, 2));
    const currentPaper = await surfaceSignal(page, `[data-artifact-id="${preview.preview.artifact.id}"] canvas[data-rendered="true"]`, 30_000);
    await currentPaper.observed;
    expect(await page.getByRole("group", { name: "PDF navigation", exact: true })
      .evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `${evidence}/assembled-compiled-1440-light.png` });
    console.info("ASSEMBLY_ACTUAL_PDF", { job: preview.job?.id, artifact: preview.preview.artifact.id, bytes: bytes.length });
  }, 150_000);
  test("restores a real history epoch and reopens an editable fresh transport", async () => {
    // Given a real loaded history version and an existing cached source document.
    await using actor = await ownerContext();
    const page = await actor.context.newPage();
    const scope = { projectId: fixtureIds.project, fileId: fixtureIds.mainFile, branch: "main" };
    const before = await projectDocument(actor.context, scope);
    await openSurface(page, { path: projectPath + "/history", selector: '.quire-history button[data-history-id][aria-pressed="true"]' });
    const dialog = await surfaceSignal(page, 'dialog[open]');
    await page.getByRole("button", { name: "Restore selected version", exact: true }).click();
    await dialog.observed;
    const restored = page.waitForResponse(response => response.request().method() === "POST" && /\/history\/[^/]+\/restore$/u.test(new URL(response.url()).pathname), { timeout: 30_000 });
    const reopened = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/files/${fixtureIds.mainFile}/document`), { timeout: 30_000 });
    // When the mounted history panel publishes a new epoch and refreshes the workspace.
    await page.getByRole("button", { name: "Restore version", exact: true }).click();
    await Promise.all([restored, reopened]);
    // Then the old transport cache is replaced and source authoring works on the new epoch.
    const received = editorValue(resultSchema(endpoints.fileDocument.output).parse(await (await reopened).json()));
    expect(received.file.version.epoch).toBeGreaterThan(before.file.version.epoch);
    const history = await surfaceSignal(page, '.quire-history button[data-history-id][aria-pressed="true"]');
    await history.observed;
    const editable = await surfaceSignal(page, sourceSelector);
    await page.getByRole("button", { name: "Back to editor", exact: true }).click();
    await editable.observed;
    expect(await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).getAttribute("contenteditable")).toBe("true");
    console.info("ASSEMBLY_ACTUAL_EPOCH", { before: before.file.version.epoch, after: received.file.version.epoch });
  }, 90_000);
  for (const width of [1440, 390]) for (const theme of ["light", "dark"] as const) {
    test(`uses every actual layout and persists user-owned split sizes at ${width} in ${theme}`, async () => {
      // Given one ordinary preview owner and the actual authoring document.
      await using actor = await ownerContext({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: theme,
        ...(width === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
      const page = await actor.context.newPage();
      await openSurface(page, { path: projectPath + "/edit", selector: sourceSelector });
      const modes = page.getByRole("group", { name: "Workspace layout", exact: true });
      for (const [layout, label] of [["source", "Source"], ["pdf", "PDF"], ["visual", "Visual"], ["stacked", "Vertical"], ["split", "Split"]] as const) {
        // When the real header changes the frame, it keeps the ordinary PDF controller mounted.
        const changed = await surfaceSignal(page, `.qe-panes[data-layout="${layout}"]`);
        await modes.getByRole("button", { name: label, exact: true }).click();
        await changed.observed;
        expect(await page.locator(".q-pdf-panel").count()).toBe(1);
        if (layout === "visual") {
          const visual = await surfaceSignal(page, ".qe-authoring .q-visual");
          await visual.observed;
        }
        if (layout === "pdf" || width === 1440 && layout !== "source") {
          const rendered = await surfaceSignal(page, '.qe-secondary:not([hidden]) canvas[data-rendered="true"]');
          await rendered.observed;
        }
        if (layout === "pdf" && width === 390) {
          expect(await page.getByRole("group", { name: "PDF navigation", exact: true })
            .evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
          const visiblePaper = await page.locator(".q-pdf-paper-region").evaluate(node => {
            const bounds = node.getBoundingClientRect();
            const pane = node.closest(".qe-secondary")?.getBoundingClientRect();
            return pane ? Math.min(bounds.bottom, pane.bottom) - Math.max(bounds.top, pane.top) : 0;
          });
          if (visiblePaper <= 120) await page.screenshot({ path: `${evidence}/layout-paper-failure-${width}-${theme}.png` });
          expect(visiblePaper).toBeGreaterThan(120);
        }
        const geometry = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
          source: document.querySelector(".qe-authoring")?.getBoundingClientRect().toJSON(),
          secondary: document.querySelector(".qe-secondary")?.getBoundingClientRect().toJSON(),
        }));
        expect(geometry.overflow).toBe(false);
        await page.screenshot({ path: `${evidence}/layout-${layout}-${width}-${theme}.png` });
        console.info("ASSEMBLY_LAYOUT", { width, theme, layout, geometry });
      }
      if (width === 1440) {
        const tree = page.getByRole("separator", { name: "Resize tree", exact: true });
        const split = page.getByRole("separator", { name: "Resize source and PDF", exact: true });
        const treeChanged = await surfaceSignal(page, '[role="separator"][aria-label="Resize tree"][aria-valuenow="238"]');
        await tree.press("ArrowRight"); await treeChanged.observed;
        const splitChanged = await surfaceSignal(page, '[role="separator"][aria-label="Resize source and PDF"][aria-valuenow="52"]');
        await split.press("ArrowRight"); await splitChanged.observed;
        const key = `quire.editor.sizes.${ownerIdentity.user.id}`;
        const saved = await page.evaluate(storageKey => localStorage.getItem(storageKey), key);
        if (!saved) throw new TypeError("Actual user split sizes were not persisted");
        expect(z.object({ tree: z.number(), split: z.number() }).parse(JSON.parse(saved))).toEqual({ tree: 238, split: 52 });
        // Then a real reload restores these sizes; another actual user gets a separate namespace.
        await openSurface(page, { path: projectPath + "/edit", selector: '[role="separator"][aria-label="Resize source and PDF"][aria-valuenow="52"]' });
        expect(await page.locator(".qe-tools").evaluate(node => node.getBoundingClientRect().width)).toBe(238);
        const collaborator = await authenticateApi(app, "mai@quire.local");
        await actor.context.addCookies([collaborator.cookie]);
        await openSurface(page, { path: projectPath + "/edit", selector: sourceSelector });
        expect(await page.locator(".qe-tools").evaluate(node => node.getBoundingClientRect().width)).toBe(236);
        const collaboratorChanged = await surfaceSignal(page, '[role="separator"][aria-label="Resize tree"][aria-valuenow="238"]');
        await page.getByRole("separator", { name: "Resize tree", exact: true }).press("ArrowRight");
        await collaboratorChanged.observed;
        expect(await page.evaluate(() => Object.keys(localStorage).filter(entry => entry.startsWith("quire.editor.sizes.")).sort((a, b) => a.localeCompare(b))))
          .toEqual([key, `quire.editor.sizes.${collaborator.user.id}`].sort((a, b) => a.localeCompare(b)));
        await page.setViewportSize({ width: 2560, height: 900 });
        await page.getByRole("separator", { name: "Resize source and PDF", exact: true }).press("ArrowRight");
        await page.getByRole("separator", { name: "Resize source and PDF", exact: true }).press("Home");
        const wideSaved = await page.evaluate(storageKey => localStorage.getItem(storageKey), `quire.editor.sizes.${collaborator.user.id}`);
        if (!wideSaved) throw new TypeError("Wide-viewport split preference missing");
        expect(z.object({ split: z.number().min(25).max(75) }).parse(JSON.parse(wideSaved)).split).toBe(25);
        await page.setViewportSize({ width: 1440, height: 900 });
        const clamped = await surfaceSignal(page, '[role="separator"][aria-label="Resize source and PDF"][aria-valuenow="41"]');
        await clamped.observed;
        expect(await page.locator(".qe-authoring").evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(339.5);
        const ready = await surfaceSignal(page, '.qe-pdf-owner canvas[data-rendered="true"]');
        await ready.observed;
        await page.screenshot({ path: `${evidence}/layout-restored-minimum-${width}-${theme}.png` });
      } else {
        const drawer = await surfaceSignal(page, 'dialog[open]');
        await page.locator(".qe-mobile-tabs").getByRole("button", { name: "Files", exact: true }).click();
        await drawer.observed;
        expect(await page.getByRole("dialog").evaluate(node => node.contains(document.activeElement))).toBe(true);
        await page.keyboard.press("Escape");
        expect(await page.locator("dialog[open]").count()).toBe(0);
        expect(await page.locator(".qe-mobile-tabs").getByRole("button", { name: "Files", exact: true }).evaluate(node => node === document.activeElement)).toBe(true);
      }
    }, 150_000);
  }
  for (const width of [1440, 390]) {
    for (const theme of ["light", "dark"] as const) {
      for (const route of routes) {
        test(`renders ${route.page} at ${width} in ${theme}`, async () => {
          // Given an independent actual user context with the requested viewport and theme.
          await using actor = await ownerContext({
            viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: theme,
            isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1,
          });
          const page = await actor.context.newPage();
          const errors: string[] = [];
          page.on("pageerror", cause => errors.push(cause.message));
          page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
          try {
            // When the actual router mounts the requested native producer.
            await openSurface(page, { path: projectPath + "/" + route.page, selector: route.selector });
            const synchronized = await surfaceSignal(page, '.qe-status [data-save-state="saved"]');
            await synchronized.observed;
            const environment = await surfaceSignal(page, '.qe-status [data-environment-state="ready"]');
            await environment.observed;
            if (route.page === "edit" && width === 1440) {
              const rendered = await surfaceSignal(page, '.qe-pdf-owner canvas[data-rendered="true"]');
              await rendered.observed;
            }
            // Then its principal surface is visible and the document does not overflow.
            const geometry = await page.evaluate(selector => {
              const principal = document.querySelector(selector)?.getBoundingClientRect();
              return { width: principal?.width ?? 0, height: principal?.height ?? 0,
                documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
                viewportWidth: innerWidth, viewportHeight: innerHeight,
                overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight };
            }, route.selector);
            await page.screenshot({ path: `${evidence}/actual-${route.page}-${width}-${theme}.png` });
            console.info("ASSEMBLY_ACTUAL_GEOMETRY", { page: route.page, width, theme, geometry });
            expect(geometry.width).toBeGreaterThan(0);
            expect(geometry.height).toBeGreaterThan(0);
            expect(geometry.overflow).toBe(false);
            expect(errors).toEqual([]);
            const scrollers = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("*")]
              .filter(node => node.getClientRects().length && /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight)
              .map(node => {
                const identity = node.id ? "#" + node.id : node.tagName.toLowerCase() + "." + node.className.trim().split(/\s+/).join(".");
                node.scrollTop = node.scrollHeight;
                return identity;
              }));
            console.info("ASSEMBLY_SCROLL_OWNERS", { page: route.page, width, theme, scrollers });
            await page.screenshot({ path: `${evidence}/actual-${route.page}-${width}-${theme}-end.png` });
            console.info("ASSEMBLY_ACTUAL_ROUTE", { page: route.page, width, theme, geometry });
          } catch (cause) {
            await page.screenshot({ path: `${evidence}/actual-failure-${route.page}-${width}-${theme}.png` });
            console.error("ASSEMBLY_ACTUAL_FAILURE", { page: route.page, width, theme, errors, text: await page.locator("body").innerText() });
            throw cause;
          }
        }, 90_000);
      }
    }
  }
});
