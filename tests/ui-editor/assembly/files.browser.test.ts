import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticateApi, nextApplicationEvent, projectDocument, startEditorApplication, startEditorBrowser } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { openSurface, surfaceSignal } from "./actual-browser";

const resources = new AsyncDisposableStack();
const evidence = resolve(`tests/ui-editor/assembly/evidence/files/${crypto.randomUUID()}`);
let app: EditorApplication;
let browser: EditorBrowser;
let identity: Awaited<ReturnType<typeof authenticateApi>>;
beforeAll(async () => {
  try {
    await mkdir(evidence, { recursive: true });
    app = resources.use(await startEditorApplication());
    browser = resources.use(await startEditorBrowser());
    identity = await authenticateApi(app);
    console.info("ASSEMBLY_FILES_OWNED", { root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin, evidence });
  } catch (cause) { await resources.disposeAsync(); throw cause; }
}, 90_000);
afterAll(async () => {
  await resources.disposeAsync();
  console.info("ASSEMBLY_FILES_CLOSED", { root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin });
}, 90_000);
for (const width of [1440, 390]) for (const theme of ["light", "dark"] as const) {
  test(`creates, opens and persists a real file through compact Files at ${width} in ${theme}`, async () => {
    // Given the actual compact Files disclosure, closed without removing any controls.
    const context = await browser.browser.newContext({ baseURL: app.url.origin,
      viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: theme,
      ...(width === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
    try {
      await context.addCookies([identity.cookie]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", cause => errors.push(cause.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await openSurface(page, { path: `/projects/${fixtureIds.project}/edit`, selector: '.qe-main .cm-content[contenteditable="true"]' });
      if (width === 390) {
        const drawer = await surfaceSignal(page, 'dialog[open] .editor-tools [role="tree"]');
        await page.locator(".qe-mobile-tabs").getByRole("button", { name: "Files", exact: true }).click();
        await drawer.observed;
      }
      const files = page.getByRole("region", { name: "Files", exact: true });
      expect(await files.locator("details").getAttribute("open")).toBeNull();
      expect(await files.getByRole("button", { name: "New file", exact: true }).isVisible()).toBe(false);
      expect(await files.getByRole("tree").isVisible()).toBe(true);
      const treeBox = await files.getByRole("tree").boundingBox();
      const toolsBox = await page.getByRole("complementary", { name: "Editor tools", exact: true }).boundingBox();
      if (!treeBox || !toolsBox) throw new TypeError("Compact file tree geometry is unavailable");
      expect(treeBox.y - toolsBox.y).toBeLessThan(64);
      expect(await files.getByRole("treeitem").first().evaluate(node => {
        const marker = node.firstElementChild;
        if (!marker) throw new TypeError("File row marker is missing");
        return marker.getBoundingClientRect().left - node.getBoundingClientRect().left;
      })).toBeLessThan(32);
      await page.screenshot({ path: `${evidence}/compact-files-${width}-${theme}.png` });
      const disclosure = files.locator("summary");
      await disclosure.focus(); await disclosure.press("Enter");
      expect(await files.getByLabel("Upload files", { exact: true }).isVisible()).toBe(true);
      expect(await files.getByLabel("Upload folder", { exact: true }).isVisible()).toBe(true);
      expect(await files.getByRole("button", { name: "Rename or move", exact: true }).isVisible()).toBe(true);
      expect(await files.getByRole("button", { name: "Download", exact: true }).isVisible()).toBe(true);
      await page.screenshot({ path: `${evidence}/compact-actions-${width}-${theme}.png` });
      await disclosure.press("Escape");
      expect(await files.locator("details").getAttribute("open")).toBeNull();
      expect(await disclosure.evaluate(node => node === document.activeElement)).toBe(true);
      await disclosure.press("Enter");
      // When real creation and tree navigation select a new document in the assembly session.
      const dialog = await surfaceSignal(page, 'dialog[open] input[placeholder="sections/method.tex"]');
      await files.getByRole("button", { name: "New file", exact: true }).click();
      await dialog.observed;
      const name = `assembly-${crypto.randomUUID()}.tex`;
      const text = `% created through compact Files ${width} ${theme}\n`;
      const form = page.getByRole("dialog", { name: "New file", exact: true });
      await form.getByLabel("Project path", { exact: true }).fill(name);
      await form.getByLabel("Initial source", { exact: true }).fill(text);
      const created = page.waitForResponse(response => response.request().method() === "POST"
        && new URL(response.url()).pathname === endpoints.fileCreate.path.replace(":p", fixtureIds.project));
      const listed = await surfaceSignal(page, `.editor-tools [role="treeitem"][title="${name}"]`);
      await form.getByRole("button", { name: "Create", exact: true }).click();
      const file = editorValue(resultSchema(endpoints.fileCreate.output).parse(await (await created).json()));
      await listed.observed;
      const opened = await surfaceSignal(page, `.qe-main .cm-content[aria-label="Source: ${name}"][contenteditable="true"]`);
      await files.getByRole("treeitem", { name, exact: true }).click();
      await opened.observed;
      if (width === 390) await page.getByRole("dialog", { name: "Project tools", exact: true }).getByRole("button", { name: "Close dialog", exact: true }).click();
      const marker = `% durable Unicode 😀 ${crypto.randomUUID()}\n`;
      using saved = nextApplicationEvent(app, event => event.topic === "document.saved"
        && event.aggregateId === fixtureIds.project && event.payload.resourceId === file.id);
      await page.getByRole("textbox", { name: `Source: ${name}`, exact: true }).press("ControlOrMeta+End");
      await Promise.all([saved.promise, page.keyboard.insertText(marker)]);
      // Then native persisted bytes identify this file rather than the previously selected main.
      expect((await projectDocument(context, { projectId: fixtureIds.project, fileId: file.id, branch: "main" })).text).toBe(text + marker);
      expect(errors).toEqual([]);
      await page.screenshot({ path: `${evidence}/opened-file-${width}-${theme}.png` });
    } finally { await context.close(); }
  }, 90_000);
}
