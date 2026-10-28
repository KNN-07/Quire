import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { nextApplicationEvent, startEditorApplication, startEditorBrowser } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { PdfDifferenceSchema } from "../../../apps/web/src/features/editor/pdf/difference";
import { armDom, captureMatrix, discoverJob, edit, evidence, pdfBrowser, rendered } from "./browser-helpers";
import { pdfScenario } from "./scenario";

const resources = new AsyncDisposableStack();
let app: EditorApplication;
let browser: EditorBrowser;
beforeAll(async () => {
  try {
    await mkdir(evidence, { recursive: true });
    app = resources.use(await startEditorApplication());
    console.info("PDF_DIFF_FIXTURE_OPENED", { web: app.url.origin, api: app.apiUrl.origin, root: app.dataDir });
    browser = resources.use(await startEditorBrowser());
  } catch (error) { await resources.disposeAsync(); throw error; }
}, 120_000);
afterAll(async () => {
  await resources.disposeAsync();
  console.info("PDF_DIFF_FIXTURE_CLOSED", { web: app.url.origin, api: app.apiUrl.origin, root: app.dataDir });
}, 30_000);

test.each([
  { mode: "side-by-side", width: 1440 }, { mode: "side-by-side", width: 390 },
  { mode: "overlay", width: 1440 }, { mode: "overlay", width: 390 },
] as const)("compares historical rendered PDFs in %j", async ({ mode, width }) => pdfScenario(async () => {
  // Given two durable historical snapshots whose actual rendered number and paragraph position differ.
  await using fixture = await pdfBrowser(app, browser, { width });
  const { page, project } = fixture;
  const snapshots: string[] = [];
  for (const body of ["Result 42.\\par Moved paragraph.", "Result 43.\\vspace{2cm}\\par Moved paragraph."]) {
    await edit(page, `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`);
    using completed = nextApplicationEvent(app, event => event.topic === "job.changed"
      && event.aggregateId === project.id && event.payload.status === "succeeded", 90_000);
    const [event] = await Promise.all([completed.promise, page.getByRole("button", { name: "Recompile", exact: true }).click()]);
    if (event.topic !== "job.changed") throw new TypeError("Wrong completion event");
    const state = await discoverJob(page, event.payload.resourceId);
    if (!state.preview) throw new TypeError("Historical successful PDF missing");
    snapshots.push(state.preview.snapshot.id);
  }
  const ordinary = await page.evaluate(() => window.pdfFixture.controller.getSnapshot().preview);
  if (!ordinary) throw new TypeError("Ordinary preview missing before historical comparison");
  await page.getByRole("tab", { name: "PDF comparison", exact: true }).click();
  await armDom(page, 'select option[value="' + snapshots[1] + '"]');
  await rendered(page);
  await page.getByLabel("From revision", { exact: true }).selectOption(snapshots[0] ?? "");
  await page.getByLabel("To revision", { exact: true }).selectOption(snapshots[1] ?? "");
  await page.getByLabel("Comparison mode", { exact: true }).selectOption(mode);
  using completed = nextApplicationEvent(app, event => event.topic === "operation.changed"
    && event.aggregateId === project.id && event.payload.status === "succeeded", 120_000);
  const operationResponse = page.waitForResponse(response => response.url().includes("/api/operations/")
    && response.status() === 200, { timeout: 120_000 });
  await armDom(page, '[role="tabpanel"]:not([hidden]) .q-pdf-difference-region');
  // When the actual controls request a sandboxed backend rendered comparison.
  const [event, firstResponse] = await Promise.all([
    completed.promise, operationResponse, page.getByRole("button", { name: "Compare PDFs", exact: true }).click(),
  ]);
  await rendered(page);
  expect(firstResponse.status()).toBe(200);
  if (event.topic !== "operation.changed") throw new TypeError("Wrong operation event");
  const operation = await fixture.actor.context.request.get(`/api/operations/${event.payload.resourceId}`);
  const envelope = await operation.json();
  const result = PdfDifferenceSchema.parse(envelope.data.result);
  const previewResponse = await fixture.actor.context.request.get(`/api/projects/${project.id}/compile-preview?branch=main`);
  const preview = editorValue(resultSchema(endpoints.compilePreview.output).parse(await previewResponse.json()));
  expect(preview.preview?.artifact.id).toBe(ordinary.artifact.id);
  expect(preview.preview?.snapshot.id).toBe(ordinary.snapshot.id);
  // Then the pages, bounding boxes, downloadable PDF and on-screen rendering are real outputs.
  expect(result.mode).toBe(mode);
  expect(result.regions.length).toBeGreaterThan(0);
  expect(result.pages.some(artifact => artifact.mime === "image/png")).toBe(true);
  expect(await page.getByRole("button", { name: "Page 1", exact: true }).count()).toBe(1);
  await captureMatrix(page, `diff-${mode}-regions`);
  await armDom(page, '[role="tabpanel"]:not([hidden]) canvas[data-rendered="true"]');
  await page.getByRole("button", { name: "View diff PDF", exact: true }).click();
  await rendered(page);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("tabpanel").filter({ visible: true }).getByRole("link", { name: "Download diff PDF", exact: true }).click(),
  ]);
  await download.saveAs(`${evidence}/diff-${mode}-${width}.pdf`);
  await captureMatrix(page, `diff-${mode}`);
  await Bun.write(`${evidence}/diff-${mode}-${width}-http.json`, JSON.stringify({
    status: operation.status(), result, ordinaryPreview: preview,
  }, null, 2));
  expect(fixture.errors).toEqual([]);
}), 240_000);
