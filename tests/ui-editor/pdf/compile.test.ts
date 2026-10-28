import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { nextApplicationEvent, startEditorApplication, startEditorBrowser } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { armDom, captureMatrix, edit, evidence, pdfBrowser, rendered, validSource } from "./browser-helpers";
import { pdfScenario } from "./scenario";

const invalidSource = "\\documentclas{article}\n\\begin{document}\n\\unknownAcceptanceCommand\n\\end{document}";

const resources = new AsyncDisposableStack();
let app: EditorApplication;
let browser: EditorBrowser;
beforeAll(async () => {
  try {
    await mkdir(evidence, { recursive: true });
    app = resources.use(await startEditorApplication());
    console.info("PDF_COMPILE_FIXTURE_OPENED", { web: app.url.origin, api: app.apiUrl.origin, root: app.dataDir });
    browser = resources.use(await startEditorBrowser());
  } catch (error) { await resources.disposeAsync(); throw error; }
}, 120_000);
afterAll(async () => {
  await resources.disposeAsync();
  console.info("PDF_COMPILE_FIXTURE_CLOSED", { web: app.url.origin, api: app.apiUrl.origin, root: app.dataDir });
}, 30_000);

test.each([1440, 390] as const)("retains the actual successful PDF through invalid source and browser reload at %s", async width => pdfScenario(async () => {
  // Given an owned real browser, persistent source and sandboxed compiler.
  await using fixture = await pdfBrowser(app, browser, { width });
  const { page, project } = fixture;
  await page.getByLabel("Stop on first error", { exact: true }).check();
  await edit(page, validSource);
  using succeeded = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === project.id && event.payload.status === "succeeded", 90_000);
  await armDom(page, 'canvas[data-rendered="true"]');
  // When a valid PDF is compiled, then source becomes invalid and the preview is reloaded.
  await Promise.all([succeeded.promise, page.getByRole("button", { name: "Recompile", exact: true }).click()]);
  await rendered(page);
  const good = await page.evaluate(() => window.pdfFixture.controller.getSnapshot());
  expect(good.job?.status).toBe("succeeded");
  expect(good.preview?.snapshot.revision).toBeGreaterThan(0);
  expect(await page.getByLabel("Page", { exact: true }).inputValue()).toBe("1");
  expect(await page.getByText("of 2", { exact: true }).count()).toBe(1);
  await page.screenshot({ path: `${evidence}/valid-${width}-light.png` });
  const pdf = good.preview?.artifact;
  if (!pdf) throw new TypeError("Actual PDF absent");
  const bytes = await fixture.actor.context.request.get(`/api/artifacts/${pdf.id}/content`);
  await Bun.write(`${evidence}/valid-output-${width}.pdf`, await bytes.body());
  const previewPattern = /\/compile-preview\?branch=main$/;
  const previewRequested = Promise.withResolvers<void>();
  const releasePreview = Promise.withResolvers<void>();
  const deadline = setTimeout(() => previewRequested.reject(new Error("Source-change discovery request not observed")), 30_000);
  await page.route(previewPattern, async route => {
    previewRequested.resolve();
    await releasePreview.promise;
    await route.continue();
  });
  try {
    await edit(page, invalidSource);
    await previewRequested.promise;
    expect(await page.locator(".q-pdf-status").getAttribute("data-preview-stale")).toBe("true");
  } finally {
    clearTimeout(deadline);
    releasePreview.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
  const invalidResponse = await fixture.actor.context.request.get(
    `/api/projects/${project.id}/files/${project.settings.mainFileId}/document?branch=main`,
  );
  const invalidDocument = editorValue(resultSchema(endpoints.fileDocument.output).parse(await invalidResponse.json()));
  expect(invalidDocument.text).toBe(invalidSource);
  await Bun.write(`${evidence}/invalid-source-http-${width}.json`,
    JSON.stringify({ status: invalidResponse.status(), document: invalidDocument }, null, 2));
  using failed = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === project.id && event.payload.status === "failed", 90_000);
  await Promise.all([failed.promise, page.getByRole("button", { name: "Recompile", exact: true }).click()]);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const controller = window.pdfFixture.controller;
    const unsubscribe = controller.subscribe(check);
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error("Failure discovery timed out")); }, 30_000);
    function check() {
      if (controller.getSnapshot().job?.status !== "failed") return;
      unsubscribe(); clearTimeout(timeout); resolve();
    }
    check();
  }));
  const failure = await page.evaluate(() => window.pdfFixture.controller.getSnapshot());
  const job = failure.job;
  if (!job) throw new TypeError("Failed compile job was not discovered");
  const stored = await app.application.runtime.db.get<{ settings_json: string }>(
    "SELECT settings_json FROM compile_jobs WHERE id=?", [job.id]);
  if (!stored) throw new TypeError("Failed compile settings were not persisted");
  expect(JSON.parse(stored.settings_json)).toMatchObject({ stopOnFirstError: true });
  expect(failure.preview?.artifact.id).toBe(pdf.id);
  expect(failure.preview?.stale).toBe(true);
  expect(job.diagnostics.some(diagnostic => diagnostic.severity === "error")).toBe(true);
  expect(job.snapshot.revision).toBe(invalidDocument.file.version.revision);
  await page.getByRole("tab", { name: "Logs", exact: true }).click();
  const diagnostic = job.diagnostics.find(item => item.fileId === project.settings.mainFileId && item.line !== null);
  if (!diagnostic || diagnostic.line === null) throw new TypeError("Compiler did not return a source-linked diagnostic");
  await page.getByRole("button", { name: `Go to ${invalidDocument.file.path}:${diagnostic.line}`, exact: true }).first().click();
  expect(await page.evaluate(() => window.pdfFixture.revealed)).toContainEqual({
    fileId: project.settings.mainFileId, line: diagnostic.line, column: Math.max(1, diagnostic.column ?? 1),
  });
  for (const [severity, label] of [["error", "Errors"], ["warning", "Warnings"], ["typesetting", "Typesetting"], ["all", "All"]] as const) {
    const expected = job.diagnostics.filter(item => severity === "all" || item.severity === severity);
    const button = page.getByRole("button", { name: `${label} (${expected.length})`, exact: true });
    await button.evaluate(node => {
      window.pdfDomWait = new Promise<void>((resolve, reject) => {
        const observer = new MutationObserver(() => {
          if (node.getAttribute("aria-pressed") !== "true") return;
          observer.disconnect(); clearTimeout(timeout); resolve();
        });
        const timeout = setTimeout(() => { observer.disconnect(); reject(new Error("Diagnostic filter did not select")); }, 5_000);
        observer.observe(node, { attributes: true });
      });
    });
    await button.click();
    await rendered(page);
    expect(await page.locator(".q-pdf-diagnostics > li").count()).toBe(expected.length);
  }
  await captureMatrix(page, "invalid-logs");
  await armDom(page, 'pre[aria-label="Raw compiler log"][aria-busy="false"]');
  await page.getByRole("button", { name: "Raw log", exact: true }).click();
  await rendered(page);
  const rawResponse = await fixture.actor.context.request.get(`/api/compiles/${job.id}/log`);
  const rawBytes = await rawResponse.body();
  expect(rawBytes.length).toBeGreaterThan(0);
  expect(await page.getByLabel("Raw compiler log").textContent()).toBe(rawBytes.toString("utf8"));
  await Bun.write(`${evidence}/raw-log-${width}.txt`, rawBytes);
  const [log] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("button", { name: /^Download build\.log / }).click(),
  ]);
  await log.saveAs(`${evidence}/generated-output-${width}.log`);
  expect(await Bun.file(`${evidence}/generated-output-${width}.log`).text()).toBe(rawBytes.toString("utf8"));
  // Recreate the consumer on a fresh real page; no localStorage or job ID is supplied.
  await page.evaluate(async () => window.pdfFixture.dispose());
  await page.reload({ waitUntil: "load" });
  await page.evaluate(() => window.pdfReady);
  await armDom(page, 'canvas[data-rendered="true"]');
  await rendered(page);
  // Then the old PDF has its own snapshot and explicit failure/stale label after discovery.
  const reloaded = await page.evaluate(() => window.pdfFixture.controller.getSnapshot());
  expect(reloaded.preview?.artifact.id).toBe(pdf.id);
  expect(await page.locator(".q-pdf-status").getAttribute("data-compile-status")).toBe("failed");
  expect(await page.locator(".q-pdf-status").getAttribute("data-preview-stale")).toBe("true");
  await captureMatrix(page, "failed-reloaded");
  const discovery = await fixture.actor.context.request.get(`/api/projects/${project.id}/compile-preview?branch=main`);
  const http = editorValue(resultSchema(endpoints.compilePreview.output).parse(await discovery.json()));
  expect(http.preview?.artifact.id).toBe(pdf.id);
  await Bun.write(`${evidence}/failed-preview-http-${width}.json`, JSON.stringify({ status: discovery.status(), state: http }, null, 2));
  expect(fixture.errors).toEqual([]);
}), 180_000);
