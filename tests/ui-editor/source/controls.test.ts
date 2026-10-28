import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticatedContext, projectDocument, startEditorApplication, startEditorBrowser } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { buildSourceFixture, sourceBrowserErrors, sourceClose, sourceEntry, sourceHtml, sourceReady } from "./browser-session";
import type * as Harness from "./browser-entry";
describe("real source controls", () => {
  const resources = new AsyncDisposableStack();
  let app: EditorApplication;
  let browser: EditorBrowser;
  beforeAll(async () => {
    try {
      await buildSourceFixture();
      app = resources.use(await startEditorApplication());
      console.info("SOURCE_CONTROLS_OWNED", { root: app.dataDir, web: app.url.origin });
      browser = resources.use(await startEditorBrowser());
    } catch (error) { await resources.disposeAsync(); throw error; }
  }, 120_000);
  afterAll(async () => {
    await resources.disposeAsync();
    console.info("SOURCE_CONTROLS_CLOSED", { root: app?.dataDir, web: app?.url.origin, api: app?.apiUrl.origin });
  }, 90_000);

test("uses actual current-file find replacement math and scoped Code Check controls", async () => {
  // Given actual native services and a real source view with deterministic source bytes.
  await using actor = await authenticatedContext(browser, app);
  const page = await actor.context.newPage();
  const errors = sourceBrowserErrors(page);
  try {
    await page.goto(`${sourceHtml}?project=${fixtureIds.project}`, { waitUntil: "domcontentloaded" });
    await sourceReady(page);
    await page.evaluate(async path => {
      const harness: typeof Harness = await import(path);
      harness.replaceAllSource("\\documentclass{article}\n\\begin{document}\ncat Cat scatter 😀\n\\end{document}\n");
      await harness.flush();
    }, sourceEntry);
    // When whole-word case-insensitive replacement is invoked through the real controls.
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await page.getByLabel("Find in current file", { exact: true }).fill("cat");
    await page.getByLabel("Replace with", { exact: true }).fill("dog");
    await page.getByLabel("Whole word", { exact: true }).check();
    await page.getByRole("button", { name: "Replace all", exact: true }).click();
    await page.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.flush(); }, sourceEntry);
    // Then the server persists only matching whole words and source commands preserve the emoji.
    const replaced = await projectDocument(actor.context, { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile });
    expect(replaced.text.includes("dog dog scatter 😀")).toBe(true);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(async path => { const harness: typeof Harness = await import(path); const from = harness.text().indexOf("😀"); harness.select({ anchor: from, head: from + 2 }); }, sourceEntry);
    await page.getByRole("button", { name: "Inline math", exact: true }).click();
    await page.getByRole("button", { name: "Code Check", exact: true }).click();
    await page.getByRole("button", { name: "Suppress this file", exact: true }).click();
    await page.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.flush(); }, sourceEntry);
    const math = await projectDocument(actor.context, { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile });
    expect(math.text.includes("\\(😀\\)")).toBe(true);
    expect(math.text.startsWith("% quire-check disable-file all\n")).toBe(true);
    expect(await page.getByRole("heading", { name: "Compiler diagnostics", exact: true }).count()).toBe(1);
  } finally { await sourceClose(page); }
  expect(errors).toEqual([]);
}, 90_000);

test.each(["vim", "emacs"] as const)("applies %s keys only to the source view and uses collaborative undo", async binding => {
  // Given a real source view and the persisted user's chosen maintained emulation.
  await using actor = await authenticatedContext(browser, app);
  const response = await actor.context.request.patch(endpoints.preferencesPatch.path, {
    headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken },
    data: { expectedVersion: actor.session.preferences.version, bindings: binding },
  });
  const preferences = editorValue(resultSchema(endpoints.preferencesPatch.output).parse(await response.json()));
  const page = await actor.context.newPage();
  const errors = sourceBrowserErrors(page);
  try {
    await page.goto(`${sourceHtml}?project=${fixtureIds.project}`, { waitUntil: "domcontentloaded" });
    await sourceReady(page);
    const original = await page.evaluate(async path => { const harness: typeof Harness = await import(path); return harness.text(); }, sourceEntry);
    const textbox = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
    // When actual modal/Emacs key events insert text and invoke their undo commands.
    await textbox.click();
    if (binding === "vim") await textbox.press("i");
    await page.keyboard.insertText("KEYMAP-PROOF");
    if (binding === "vim") { await textbox.press("Escape"); await textbox.press("u"); }
    else { await textbox.press("Control+x"); await textbox.press("u"); }
    await page.evaluate(async path => { const harness: typeof Harness = await import(path); await harness.flush(); }, sourceEntry);
    // Then undo returns the authoritative document to its original bytes.
    const persisted = await projectDocument(actor.context, { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile });
    expect(persisted.text).toBe(original);
    expect(preferences.bindings).toBe(binding);
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await page.getByLabel("Find in current file", { exact: true }).fill("plain input");
    expect(await page.getByLabel("Find in current file", { exact: true }).inputValue()).toBe("plain input");
  } finally { await sourceClose(page); }
  expect(errors).toEqual([]);
}, 90_000);
test("checks real prose and persists a personal dictionary word through the source controls", async () => {
  // Given an actual account with an English dictionary and an independent personal word.
  await using actor = await authenticatedContext(browser, app);
  const configured = await actor.context.request.patch(endpoints.preferencesPatch.path, {
    headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken },
    data: { expectedVersion: actor.session.preferences.version, dictionary: "en-US", spellCheck: true, customWords: ["QuireWord"], bindings: "default" },
  });
  editorValue(resultSchema(endpoints.preferencesPatch.output).parse(await configured.json()));
  const page = await actor.context.newPage();
  const errors = sourceBrowserErrors(page);
  try {
    await page.goto(`${sourceHtml}?project=${fixtureIds.project}`, { waitUntil: "domcontentloaded" });
    await sourceReady(page);
    await page.evaluate(async path => {
      const harness: typeof Harness = await import(path);
      harness.replaceAllSource("\\documentclass{article}\n\\begin{document}\nHello zzqxword QuireWord\n\\end{document}");
      await harness.flush();
    }, sourceEntry);
    // When the actual checker flags prose and the user adds that token to their dictionary.
    await page.getByRole("button", { name: "Code Check", exact: true }).click();
    await page.getByRole("button", { name: "Spelling: zzqxword", exact: true }).click();
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.preferencesPatch.path && response.request().method() === "PATCH", { timeout: 30_000 });
    await page.getByRole("button", { name: "Add zzqxword to dictionary", exact: true }).click();
    const preferences = editorValue(resultSchema(endpoints.preferencesPatch.output).parse(await (await saved).json()));
    expect(preferences.customWords).toEqual(["QuireWord", "zzqxword"]);
    await sourceClose(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await sourceReady(page);
    // Then the reopened checker uses that durable personal dictionary, not a browser word list.
    await page.getByRole("button", { name: "Code Check", exact: true }).click();
    await page.getByRole("link", { name: "Dictionary license", exact: true }).focus();
    expect(await page.getByRole("button", { name: "Spelling: zzqxword", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Spelling: QuireWord", exact: true }).count()).toBe(0);
  } finally { await sourceClose(page); }
  expect(errors).toEqual([]);
}, 90_000);
});
