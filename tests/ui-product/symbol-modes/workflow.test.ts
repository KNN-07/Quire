import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Page } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { symbols } from "../../../apps/web/src/features/editor/tools/symbols";
import { authenticatedContext, nextApplicationEvent, projectDocument, startEditorApplication, startEditorBrowser } from "../../ui-editor/shared";
import type { EditorApplication, EditorBrowser } from "../../ui-editor/shared";
import { openSurface, surfaceSignal } from "../../ui-editor/assembly/actual-browser";

const evidence = new URL("../../../docs/evidence/p56-symbols/final/", import.meta.url).pathname;
const sourceSelector = '.qe-main .cm-content[contenteditable="true"]';
const scope = { projectId: fixtureIds.project, fileId: fixtureIds.mainFile, branch: "main" };
const path = `/projects/${fixtureIds.project}/edit`;
const command = "\\triangleq";
const input = "\\documentclass{article}\n\\begin{document}\n$S$\n\\begin{tabular}{lc}\n$V$ & Value \\\\\n\\end{tabular}\n\\end{document}\n";
const afterSource = input.replace("\\begin{document}", "\\usepackage{amssymb}\n\\begin{document}").replace("$S$", `$${command}$`);
const afterVisual = afterSource.replace("$V$", `$${command}$`);
const inputs = [
  "apps/web/src/features/editor/tools/SymbolsPanel.tsx",
  "apps/web/src/features/editor/tools/symbols.ts",
  "apps/web/src/features/editor/tools/insertion.ts",
  "apps/web/src/features/editor/source/editor.ts",
  "apps/web/src/features/editor/visual/VisualPanel.tsx",
  "apps/web/src/features/editor/visual/Nodes.tsx",
  "apps/web/src/features/editor/index.tsx",
  "tests/ui-editor/shared/application.ts",
  "tests/ui-editor/shared/web-server.mjs",
];
const resources = new AsyncDisposableStack();
let app: EditorApplication;
let browser: EditorBrowser;

async function hashes(phase: string) {
  for (const file of inputs) console.info("P56_INPUT", { phase, file,
    sha256: new Bun.CryptoHasher("sha256").update(await Bun.file(file).arrayBuffer()).digest("hex") });
}
async function mode(page: Page, label: "Source" | "Visual") {
  const visible = await surfaceSignal(page, label === "Source" ? sourceSelector : ".q-visual");
  await page.getByRole("group", { name: "Workspace layout", exact: true }).getByRole("button", { name: label, exact: true }).click();
  await visible.observed;
}
async function closeDrawer(page: Page) {
  const drawer = page.getByRole("dialog", { name: "Project tools", exact: true });
  if (await drawer.count()) await drawer.getByRole("button", { name: "Close dialog", exact: true }).click();
}
async function search(page: Page, label: string) {
  if ((page.viewportSize()?.width ?? 1440) < 1024) {
    await page.locator(".qe-mobile-tabs").getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("combobox", { name: "Editor tool", exact: true }).selectOption("symbols");
  } else if (!await page.locator('.editor-tools[data-panel="symbols"]').count()) {
    await page.getByRole("navigation", { name: "Editor panels", exact: true }).getByRole("button", { name: "Symbols", exact: true }).click();
  } else if (!await page.getByRole("textbox", { name: "Search symbols", exact: true }).isVisible()) {
    await page.locator(".qe-mobile-tabs").getByRole("button", { name: "Files", exact: true }).click();
  }
  await page.getByRole("textbox", { name: "Search symbols", exact: true }).fill("triangleq");
  const insert = page.getByRole("button", { name: `Insert ${command} with amssymb`, exact: true });
  expect(await insert.count()).toBe(1);
  expect(await insert.isEnabled()).toBe(true);
  console.info("P56_SEARCH", { label, query: "triangleq", command, packageName: "amssymb", title: await insert.getAttribute("title") });
  await page.screenshot({ path: `${evidence}/${label}-search.png` });
  return insert;
}
async function reloadExact(page: Page, expected: string) {
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname.endsWith(`/files/${fixtureIds.mainFile}/document`), { timeout: 30_000 });
  await Promise.all([response, page.reload({ waitUntil: "domcontentloaded" })]);
  const document = editorValue(resultSchema(endpoints.fileDocument.output).parse(await (await response).json()));
  expect(document.text).toBe(expected);
  console.info("P56_RELOAD", { text: document.text, revision: document.file.version.revision });
}

beforeAll(async () => {
  try {
    await mkdir(evidence, { recursive: true });
    console.info("P56_START", { utc: new Date().toISOString(), cwd: process.cwd(), executable: process.execPath, runtime: Bun.version });
    await hashes("pre");
    expect(symbols.find(symbol => symbol.command === command)?.packageName).toBe("amssymb");
    app = await startEditorApplication();
    resources.defer(async () => {
      await app[Symbol.asyncDispose]();
      console.info("P56_APP_CLEANED", { root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin,
        rootExists: existsSync(app.dataDir) });
    });
    browser = await startEditorBrowser();
    resources.defer(async () => { await browser[Symbol.asyncDispose](); console.info("P56_BROWSER_CLEANED"); });
    console.info("P56_OWNED", { root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin });
  } catch (cause) { await resources.disposeAsync(); throw cause; }
}, 120_000);
afterAll(async () => {
  await resources.disposeAsync();
  await hashes("post");
  console.info("P56_END", { utc: new Date().toISOString() });
}, 90_000);

for (const width of [1440, 390]) for (const theme of ["light", "dark"] as const) {
  test(`native Source math and Visual table symbol persistence at ${width} ${theme}`, async () => {
    await using actor = await authenticatedContext(browser, app, {
      viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: theme,
    });
    const page = await actor.context.newPage();
    const label = `${width}-${theme}`;
    page.on("request", request => {
      if (new URL(request.url()).pathname.startsWith("/api/")) console.info("P56_REQUEST", { label, method: request.method(), url: request.url() });
    });
    page.on("response", response => {
      if (new URL(response.url()).pathname.startsWith("/api/")) console.info("P56_RESPONSE", { label, status: response.status(), url: response.url() });
    });
    try {
      await openSurface(page, { path, selector: sourceSelector });
      await closeDrawer(page);
      await mode(page, "Source");
      const before = await projectDocument(actor.context, scope);
      console.info("P56_ORIGINAL_OWNED_INPUT", { label, text: before.text });
      const textbox = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
      using initialized = nextApplicationEvent(app, event => event.topic === "document.saved" && event.payload.resourceId === fixtureIds.mainFile);
      await textbox.press("ControlOrMeta+a");
      await Promise.all([initialized.promise, page.keyboard.insertText(input)]);
      expect((await projectDocument(actor.context, scope)).text).toBe(input);
      await textbox.press("ControlOrMeta+Home");
      await textbox.press("ArrowDown");
      await textbox.press("ArrowDown");
      await textbox.press("Home");
      await textbox.press("ArrowRight");
      await textbox.press("Shift+ArrowRight");
      console.info("P56_ACTION", { label, mode: "Source", selection: "S", boundary: "$S$", expected: afterSource });
      const sourceInsert = await search(page, `${label}-source`);
      using sourceSaved = nextApplicationEvent(app, event => event.topic === "document.saved" && event.payload.resourceId === fixtureIds.mainFile);
      await Promise.all([sourceSaved.promise, sourceInsert.click()]);
      await closeDrawer(page);
      const sourceAcknowledged = await surfaceSignal(page, '.qe-status [data-save-state="saved"]');
      await sourceAcknowledged.observed;
      const source = await projectDocument(actor.context, scope);
      console.info("P56_SOURCE_RESULT", { label, text: source.text, revision: source.file.version.revision });
      expect(source.text).toBe(afterSource);
      await page.screenshot({ path: `${evidence}/${label}-source-inserted.png` });
      await reloadExact(page, afterSource);
      await closeDrawer(page);
      await mode(page, "Visual");
      const cell = page.getByRole("textbox", { name: "Row 1 column 1", exact: true });
      expect(await cell.inputValue()).toBe("$V$");
      await cell.click();
      await cell.press("Home");
      await cell.press("ArrowRight");
      await cell.press("Shift+ArrowRight");
      expect(await cell.evaluate(node => {
        if (!(node instanceof HTMLTextAreaElement)) throw new TypeError("Expected native textarea");
        return { from: node.selectionStart, to: node.selectionEnd, selected: node.value.slice(node.selectionStart, node.selectionEnd) };
      })).toEqual({ from: 1, to: 2, selected: "V" });
      console.info("P56_ACTION", { label, mode: "Visual", selection: "V", boundary: "tabular Row 1 column 1 $V$", expected: afterVisual });
      const visualInsert = await search(page, `${label}-visual`);
      using visualSaved = nextApplicationEvent(app, event => event.topic === "document.saved" && event.payload.resourceId === fixtureIds.mainFile);
      await Promise.all([visualSaved.promise, visualInsert.click()]);
      await closeDrawer(page);
      const visualAcknowledged = await surfaceSignal(page, '.qe-status [data-save-state="saved"]');
      await visualAcknowledged.observed;
      const visual = await projectDocument(actor.context, scope);
      console.info("P56_VISUAL_RESULT", { label, text: visual.text, revision: visual.file.version.revision });
      expect(visual.text).toBe(afterVisual);
      expect(visual.text.split("\\usepackage{amssymb}").length - 1).toBe(1);
      expect(visual.text.split(command).length - 1).toBe(2);
      expect(await cell.inputValue()).toBe(`$${command}$`);
      await page.screenshot({ path: `${evidence}/${label}-visual-inserted.png` });
      await reloadExact(page, afterVisual);
      await closeDrawer(page);
      await mode(page, "Source");
      await page.screenshot({ path: `${evidence}/${label}-persisted-source.png` });
    } catch (cause) {
      console.error("P56_FAILURE", { label, source: (await projectDocument(actor.context, scope)).text, body: await page.locator("body").innerText() });
      await page.screenshot({ path: `${evidence}/${label}-failure.png` });
      throw cause;
    }
  }, 120_000);
}
