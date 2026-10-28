import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { nextApplicationEvent, startEditorApplication, startEditorBrowser } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { armCanvasRender, armDom, captureMatrix, edit, evidence, pdfBrowser, rendered, validSource } from "./browser-helpers";
import { pdfScenario } from "./scenario";

const resources = new AsyncDisposableStack();
let app: EditorApplication;
let browser: EditorBrowser;
beforeAll(async () => {
  try {
    await mkdir(evidence, { recursive: true });
    app = resources.use(await startEditorApplication());
    console.info("PDF_NAVIGATION_FIXTURE_OPENED", { web: app.url.origin, api: app.apiUrl.origin, root: app.dataDir });
    browser = resources.use(await startEditorBrowser());
  } catch (error) { await resources.disposeAsync(); throw error; }
}, 120_000);
afterAll(async () => {
  await resources.disposeAsync();
  console.info("PDF_NAVIGATION_FIXTURE_CLOSED", { web: app.url.origin, api: app.apiUrl.origin, root: app.dataDir });
}, 30_000);

test.each([1440, 390] as const)("renders actual pages with zoom presentation and bidirectional SyncTeX at %s", async width => pdfScenario(async () => {
  // Given saved source and an actual sandboxed two-page PDF.
  await using fixture = await pdfBrowser(app, browser, { width });
  const { page, project } = fixture;
  await edit(page, validSource);
  using complete = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === project.id && event.payload.status === "succeeded", 90_000);
  await armDom(page, 'canvas[data-rendered="true"]');
  await Promise.all([complete.promise, page.getByRole("button", { name: "Recompile", exact: true }).click()]);
  await rendered(page);
  const preview = await page.evaluate(() => window.pdfFixture.controller.getSnapshot().preview);
  if (!preview) throw new TypeError("Successful preview was not discovered");
  const syncPath = `/api/compiles/${preview.artifact.jobId}/synctex`;
  const initialWidth = await page.locator("canvas").evaluate(node => node.getBoundingClientRect().width);
  // When PDF.js navigation, viewport transforms and both real SyncTeX endpoints are used.
  await armCanvasRender(page);
  await page.getByLabel("Zoom", { exact: true }).selectOption("2");
  await rendered(page);
  const zoomedWidth = await page.locator("canvas").evaluate(node => node.getBoundingClientRect().width);
  expect(zoomedWidth).toBeGreaterThan(initialWidth);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  expect(await page.getByLabel("Page", { exact: true }).inputValue()).toBe("2");
  await armDom(page, 'canvas[aria-label="PDF page 1"][data-rendered="true"]');
  const forwardResponse = page.waitForResponse(response => new URL(response.url()).pathname === syncPath
    && response.request().method() === endpoints.synctex.method, { timeout: 30_000 });
  const [forward] = await Promise.all([forwardResponse, page.getByRole("button", { name: "Source to PDF", exact: true }).click()]);
  await rendered(page);
  const forwardLocations = editorValue(resultSchema(endpoints.synctex.output).parse(await forward.json()));
  expect(forwardLocations.some(item => "page" in item && item.page === 1)).toBe(true);
  const marker = page.getByLabel("Source location", { exact: true });
  const point = await marker.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    const canvas = node.parentElement?.querySelector("canvas")?.getBoundingClientRect();
    if (!canvas) throw new TypeError("Canvas missing beside SyncTeX highlight");
    return { x: bounds.x - canvas.x + 1, y: bounds.y - canvas.y + 1 };
  });
  const reverse = page.waitForResponse(response => new URL(response.url()).pathname === syncPath
    && response.request().method() === endpoints.synctex.method, { timeout: 30_000 });
  await page.evaluate(() => {
    window.pdfSourceWait = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { document.removeEventListener("pdf-source-revealed", received); reject(new Error("Source navigation timed out")); }, 30_000);
      function received() {
        document.removeEventListener("pdf-source-revealed", received); clearTimeout(timeout); resolve();
      }
      document.addEventListener("pdf-source-revealed", received);
    });
  });
  const [backward] = await Promise.all([reverse, page.evaluate(() => window.pdfSourceWait), page.locator("canvas").dblclick({ position: point })]);
  const locations = await page.evaluate(() => window.pdfFixture.revealed);
  expect(locations.some(location => location.fileId === project.settings.mainFileId && location.line === 3)).toBe(true);
  const sourceLocations = editorValue(resultSchema(endpoints.synctex.output).parse(await backward.json()));
  expect(sourceLocations.some(item => "fileId" in item && item.fileId === project.settings.mainFileId && item.line === 3)).toBe(true);
  await Bun.write(`${evidence}/synctex-${width}-http.json`, JSON.stringify({
    forward: { status: forward.status(), body: await forward.json() },
    reverse: { status: backward.status(), body: await backward.json() },
  }, null, 2));
  const fullscreen = page.evaluate(() => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { document.removeEventListener("fullscreenchange", changed); reject(new Error("Fullscreen did not enter")); }, 10_000);
    function changed() {
      if (!document.fullscreenElement) return;
      document.removeEventListener("fullscreenchange", changed); clearTimeout(timeout); resolve();
    }
    document.addEventListener("fullscreenchange", changed);
  }));
  await Promise.all([fullscreen, page.getByRole("button", { name: "Presentation", exact: true }).click()]);
  expect(await page.evaluate(() => document.fullscreenElement?.className)).toBe("q-pdf-viewer");
  await page.evaluate(() => document.exitFullscreen());
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("link", { name: "Download PDF", exact: true }).click(),
  ]);
  await download.saveAs(`${evidence}/viewer-download-${width}.pdf`);
  const nativeFrame = page.waitForEvent("framenavigated", {
    predicate: frame => frame.url().startsWith("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/"), timeout: 30_000,
  });
  const [native] = await Promise.all([nativeFrame, page.getByLabel("Viewer", { exact: true }).selectOption("browser")]);
  await native.waitForLoadState("load");
  await native.evaluate(() => new Promise<void>((resolve, reject) => {
      const viewer = document.querySelector("pdf-viewer");
      if (viewer && "getLoadSucceededForTesting" in viewer
        && typeof viewer.getLoadSucceededForTesting === "function" && viewer.getLoadSucceededForTesting() === true) {
        resolve(); return;
      }
      const timeout = setTimeout(() => finish(new Error("Native PDF document did not load")), 30_000);
      function finish(error?: Error) {
        clearTimeout(timeout);
        window.removeEventListener("message", received);
        if (error) reject(error); else resolve();
      }
      function received(event: MessageEvent) {
        if (event.origin !== window.location.origin) return;
        const message: unknown = event.data;
        if (typeof message !== "object" || message === null || !("type" in message)
          || message.type !== "documentLoaded" || !("load_state" in message)) return;
        if (message.load_state === "success") finish();
        else if (message.load_state === "failed") finish(new Error("Native PDF viewer reported failure"));
      }
      window.addEventListener("message", received);
      window.postMessage({ type: "initialize" }, window.location.origin);
  }));
  expect(await page.getByTitle("Browser PDF viewer").getAttribute("src")).toStartWith("blob:");
  await page.screenshot({ path: `${evidence}/browser-viewer-${width}.png` });
  await page.getByLabel("Viewer", { exact: true }).selectOption("builtin");
  // Then mobile/desktop light/dark all contain a real composited canvas without horizontal primary overflow.
  await captureMatrix(page, "viewer");
  expect(fixture.errors).toEqual([]);
}), 180_000);
