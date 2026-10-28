import { expect, test } from "bun:test";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticatedContext, projectDocument, startEditorApplication, startEditorBrowser } from "../shared";
import type * as Harness from "./browser-entry";
import { buildSourceFixture, sourceEntry, sourceHtml, sourceReady, sourceClose, sourceBrowserErrors } from "./browser-session";

test("native multiline insertText preserves its leading newline at a trailing empty line", async () => {
  // Given: the real source editor and exact independently read persisted bytes.
  await buildSourceFixture();
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await using actor = await authenticatedContext(browser, app);
  const scope = { projectId: fixtureIds.project, fileId: fixtureIds.mainFile, branch: "main" };
  const before = await projectDocument(actor.context, scope);
  const page = await actor.context.newPage();
  const errors = sourceBrowserErrors(page);
  try {
    await page.goto(`${sourceHtml}?project=${fixtureIds.project}`, { waitUntil: "domcontentloaded" });
    await sourceReady(page);
    const loaded = await page.evaluate(async path => {
      const harness: typeof Harness = await import(path);
      return harness.text();
    }, sourceEntry);
    expect(loaded).toBe(before.text);
    await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+End");
    const selection = await page.evaluate(async path => {
      const harness: typeof Harness = await import(path);
      return harness.selectedRange();
    }, sourceEntry);
    expect(selection).toEqual({ anchor: before.text.length, head: before.text.length });
    const inputs = await page.evaluateHandle(() => {
      const captured: { data: string | null; type: string; composing: boolean }[] = [];
      document.addEventListener("beforeinput", event => {
        if (event instanceof InputEvent) captured.push({
          data: event.data, type: event.inputType, composing: event.isComposing,
        });
      }, { once: true });
      return captured;
    });
    const marker = "\n% exact multiline Unicode 😀\n";
    // When: the browser inserts the exact multiline value at the actual end selection.
    await page.keyboard.insertText(marker);
    const local = await page.evaluate(async path => {
      const harness: typeof Harness = await import(path);
      await harness.flush();
      return harness.text();
    }, sourceEntry);
    const persisted = await projectDocument(actor.context, scope);
    console.info("SOURCE_MULTILINE_BOUNDARY", {
      selection, input: await inputs.jsonValue(),
      expectedTail: (before.text + marker).slice(-100), localTail: local.slice(-100),
      persistedTail: persisted.text.slice(-100),
    });
    await inputs.dispose();
    // Then: neither DOM reconciliation nor persistence silently removes a newline.
    expect(local).toBe(before.text + marker);
    expect(persisted.text).toBe(before.text + marker);
    await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+z");
    const undone = await page.evaluate(async path => {
      const harness: typeof Harness = await import(path);
      await harness.flush();
      return harness.text();
    }, sourceEntry);
    expect(undone).toBe(before.text);
    const from = before.text.indexOf("article");
    if (from < 0) throw new TypeError("Expected source fixture document class");
    await page.evaluate(async input => {
      const harness: typeof Harness = await import(input.entry);
      harness.select({ anchor: input.from, head: input.from + "article".length });
    }, { entry: sourceEntry, from });
    const replacement = "report\n% selected multiline";
    await page.keyboard.insertText(replacement);
    await page.evaluate(async path => {
      const harness: typeof Harness = await import(path);
      await harness.flush();
    }, sourceEntry);
    expect((await projectDocument(actor.context, scope)).text)
      .toBe(before.text.slice(0, from) + replacement + before.text.slice(from + "article".length));
    expect(errors).toEqual([]);
  } finally { await sourceClose(page); }
}, 120000);
