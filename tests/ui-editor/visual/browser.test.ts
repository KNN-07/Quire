import { afterAll, beforeAll, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticatedContext, projectDocument, startEditorApplication, startEditorBrowser } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import type { VisualHarness } from "./browser-entry";

const resources = new AsyncDisposableStack();
let app: EditorApplication;
let browser: EditorBrowser;
beforeAll(async () => {
  try {
    const build = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./browser-entry.tsx", import.meta.url))],
      outdir: fileURLToPath(new URL("./evidence/build", import.meta.url)),
      target: "browser", minify: true, define: { "process.env.NODE_ENV": '"production"' },
    });
    if (!build.success) throw new AggregateError(build.logs, "Visual browser bundle failed");
    app = resources.use(await startEditorApplication());
    browser = resources.use(await startEditorBrowser());
  } catch (failure) { await resources.disposeAsync(); throw failure; }
}, 120_000);
afterAll(async () => {
  await resources.disposeAsync();
  console.info("VISUAL_OWNED_RESOURCES_CLOSED", { root: app?.dataDir, web: app?.url.origin, api: app?.apiUrl.origin });
}, 60_000);

async function fixturePage(page: Page, reset: boolean) {
  await page.addInitScript(() => {
    window.visualReady = new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new TypeError("Visual fixture did not mount")), 30_000);
      window.addEventListener("visual-ready", () => { clearTimeout(deadline); resolve(); }, { once: true });
    });
  });
  const html = fileURLToPath(new URL("./index.htm", import.meta.url));
  await page.goto(`/@fs${html}?reset=${reset}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.visualReady);
}
async function editAndSave<T>(page: Page, action: () => Promise<T>): Promise<T> {
  await page.evaluate(() => {
    const harness: VisualHarness = window.visualHarness;
    harness.armSave();
  });
  const receipt = page.evaluate(() => window.visualHarness.saved());
  const [value] = await Promise.all([action(), receipt]);
  return value;
}
test.each([1440, 390])("round trips visual, source, TSV and real PNG upload at %i", async width => {
  // Given: real HTTP/WS persistence and the production VisualPanel, no replacement client.
  await using actor = await authenticatedContext(browser, app, {
    viewport: { width, height: width === 390 ? 844 : 900 },
    isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: width === 390 ? 3 : 1,
  });
  // Chromium's loopback consent is scoped to this real, ephemeral fixture origin.
  await actor.context.grantPermissions(["local-network-access"], { origin: app.url.origin });
  const page = await actor.context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => {
    errors.push(error.message);
    console.info("VISUAL_PAGE_ERROR", error.message);
  });
  page.on("console", message => {
    if (message.type() === "error") console.info("VISUAL_CONSOLE_ERROR", message.text());
  });
  page.on("requestfailed", request => console.info("VISUAL_REQUEST_FAILED", request.url(), request.failure()?.errorText));
  try {
    await fixturePage(page, true);
    const snapshot = await page.evaluate(() => window.visualHarness.snapshot());
    console.info("VISUAL_INITIAL_SNAPSHOT", snapshot);
    if (snapshot.readOnly) {
      const accessResponse = await actor.context.request.get(`/api/projects/${fixtureIds.project}/effective-access`,
        { params: { branch: "main" } });
      const access = editorValue(resultSchema(endpoints.projectAccess.output).parse(await accessResponse.json()));
      console.info("VISUAL_ACCESS_AFTER_RECOVERY", { status: accessResponse.status(), role: access.role,
        actorId: access.actorId, edit: access.capabilities.edit, revision: access.branchRevision });
    }
    expect(snapshot.readOnly).toBe(false);
    const initial = await page.evaluate(() => window.visualHarness.text());
    const unknown = page.locator("details").filter({ hasText: "Source island · unrecognized" });
    await unknown.locator("summary").click();
    const island = unknown.getByRole("textbox", { name: "Preserved LaTeX source" });
    await editAndSave(page, async () =>
      island.fill((await island.inputValue()).replace("raw   {source}", "edited raw   {source}")));
    const heading = page.getByRole("group", { name: "section heading" }).getByRole("textbox");
    // When: supported visual text changes, then source mode modifies the same document.
    await editAndSave(page, () => heading.fill("Changed heading 😀"));
    await page.getByRole("button", { name: "Show source" }).click();
    const source = page.getByRole("textbox", { name: "Source fixture" });
    expect(await source.inputValue()).toBe(initial.replace("Round trip", "Changed heading 😀")
      .replace("raw   {source}", "edited raw   {source}"));
    await editAndSave(page, async () =>
      source.fill((await source.inputValue()).replace("Editable paragraph", "Source-updated paragraph")));
    await page.getByRole("button", { name: "Show visual" }).click();
    const paragraph = page.getByRole("textbox", { name: "Paragraph text", exact: true }).filter({ visible: true }).nth(1);
    await paragraph.focus();
    await paragraph.press("Control+End");
    await editAndSave(page, () => paragraph.evaluate(element => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "TSV A\tTSV B\nLeft\tRight");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    }));
    expect(await page.evaluate(() => window.visualHarness.text())).toContain("\\section{Changed heading 😀}");
    expect(await page.locator(".q-visual-table table").count()).toBe(2);
    const uploadResponse = page.waitForResponse(response => response.url().includes("/uploads") && response.request().method() === "POST");
    const clipboardBytes = await editAndSave(page, () => paragraph.evaluate(async element => {
      const canvas = document.createElement("canvas");
      canvas.width = 240; canvas.height = 120;
      const drawing = canvas.getContext("2d");
      if (!drawing) throw new TypeError("PNG fixture canvas unavailable");
      const tokens = getComputedStyle(document.documentElement);
      drawing.fillStyle = tokens.getPropertyValue("--q-selected");
      drawing.fillRect(0, 0, canvas.width, canvas.height);
      drawing.fillStyle = tokens.getPropertyValue("--q-ink");
      drawing.font = "18px sans-serif";
      drawing.fillText("Pasted PNG fixture", 20, 66);
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => {
        if (value) resolve(value); else reject(new TypeError("PNG fixture encoding failed"));
      }, "image/png"));
      const bytes = new Uint8Array(await png.arrayBuffer());
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File([bytes], "paste.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
      return Array.from(bytes);
    }));
    const response = await uploadResponse;
    expect(response.status()).toBe(200);
    const uploaded = editorValue(resultSchema(endpoints.filesUpload.output).parse(await response.json()))[0];
    if (!uploaded) throw new TypeError("PNG upload returned no file");
    console.info("VISUAL_UPLOADED_IMAGE", { path: uploaded.path, mime: uploaded.mime, bytes: uploaded.bytes });
    expect(uploaded.mime).toBe("image/png");
    const imageContent = await actor.context.request.get(`/api/projects/${fixtureIds.project}/files/${uploaded.id}/content`,
      { params: { branch: "main" } });
    expect(imageContent.status()).toBe(200);
    expect(new Uint8Array(await imageContent.body())).toEqual(new Uint8Array(clipboardBytes));
    const image = page.locator(".q-visual-figure img");
    await image.waitFor({ state: "visible" });
    await image.evaluate(element => new Promise<void>((resolve, reject) => {
      if (!(element instanceof HTMLImageElement)) { reject(new TypeError("Expected image")); return; }
      element.addEventListener("load", () => resolve(), { once: true });
      element.addEventListener("error", () => reject(new TypeError("Image decode failed")), { once: true });
      if (element.complete && element.naturalWidth > 0) resolve();
    }));
    await page.getByRole("textbox", { name: "Figure caption" }).fill("Pasted image caption");
    await page.getByRole("textbox", { name: "Figure label" }).fill("fig:pasted");
    const beforeInvalidFigure = await page.evaluate(() => window.visualHarness.text());
    expect(await page.getByRole("alert").count()).toBe(0);
    await page.getByRole("textbox", { name: "Figure width" }).fill("invalid");
    await page.getByRole("button", { name: "Apply figure" }).click();
    expect(await page.getByRole("alert").count()).toBe(1);
    expect(await page.evaluate(() => window.visualHarness.text())).toBe(beforeInvalidFigure);
    await page.getByRole("textbox", { name: "Figure width" }).fill("0.6\\linewidth");
    await editAndSave(page, () => page.getByRole("button", { name: "Apply figure" }).click());
    expect(await page.getByRole("alert").count()).toBe(0);
    // Then: real API bytes retain unsupported source, table edits and figure metadata.
    const stored = await projectDocument(actor.context, { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile });
    expect(stored.text).toContain("\\strange [z] { unknown  source }");
    expect(stored.text).toContain("%  exact comment   \\custom{not interpreted}");
    expect(stored.text).toContain("\\begin{unrecognized}  edited raw   {source}\n% keep this too\n\\end{unrecognized}");
    expect(stored.text).toContain("TSV A & TSV B");
    expect(stored.text).toContain("\\caption{Pasted image caption}");
    expect(stored.text).toContain("\\label{fig:pasted}");
    expect(stored.text).toContain("width=0.6\\linewidth");
    expect(stored.text.match(/\\usepackage\{graphicx\}/g)).toHaveLength(1);
    expect(errors).toEqual([]);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
      await page.locator(".q-visual-body").evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: fileURLToPath(new URL(`./evidence/visual-${width}-${theme}.png`, import.meta.url)) });
      await page.locator(".q-visual-figure").evaluate(element => { element.scrollIntoView({ block: "start" }); });
      await page.screenshot({ path: fileURLToPath(new URL(`./evidence/visual-${width}-${theme}-figure.png`, import.meta.url)) });
      await page.getByRole("button", { name: "Apply figure" }).evaluate(element => { element.scrollIntoView({ block: "end" }); });
      await page.screenshot({ path: fileURLToPath(new URL(`./evidence/visual-${width}-${theme}-figure-controls.png`, import.meta.url)) });
      await page.locator(".q-visual-body").evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.screenshot({ path: fileURLToPath(new URL(`./evidence/visual-${width}-${theme}-end.png`, import.meta.url)) });
    }
    const scroll = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      owners: [...document.querySelectorAll("*")].filter(element => /auto|scroll/.test(getComputedStyle(element).overflowY) &&
        element.scrollHeight > element.clientHeight).map(element => element.className),
    }));
    expect(scroll.overflow).toBe(false);
    console.info("VISUAL_BROWSER_EVIDENCE", { width, scroll, bytes: stored.file.bytes });
    await page.evaluate(() => window.visualHarness.dispose());
    await fixturePage(page, false);
    expect(await page.evaluate(() => window.visualHarness.text())).toBe(stored.text);
  } catch (failure) {
    console.info("VISUAL_FAILURE_SOURCE", await page.evaluate(() => window.visualHarness?.text()));
    console.info("VISUAL_FAILURE_FIGURES", await page.locator(".q-visual-body figure, .q-visual-body [role=alert]").allTextContents());
    throw failure;
  } finally {
    if (errors.length) console.info("VISUAL_BROWSER_ERRORS", errors);
    console.info("VISUAL_FINAL_SNAPSHOT", await page.evaluate(() => window.visualHarness?.snapshot()));
    await page.evaluate(() => window.visualHarness?.dispose());
    console.info("VISUAL_BROWSER_FIXTURE_CLOSING", { width, root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin });
  }
}, 120_000);
