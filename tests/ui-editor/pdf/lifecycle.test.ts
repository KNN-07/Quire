import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { endpoints, resultSchema } from "@quire/contracts";
import type { CompileJob } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { nextApplicationEvent, startEditorApplication, startEditorBrowser } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { discoverJob, edit, evidence, pdfBrowser, validSource } from "./browser-helpers";

const resources = new AsyncDisposableStack();
let app: EditorApplication;
let browser: EditorBrowser;
beforeAll(async () => {
  try {
    await mkdir(evidence, { recursive: true });
    app = resources.use(await startEditorApplication());
    console.info("PDF_LIFECYCLE_FIXTURE_OPENED", { web: app.url.origin, api: app.apiUrl.origin, root: app.dataDir });
    browser = resources.use(await startEditorBrowser());
  } catch (error) { await resources.disposeAsync(); throw error; }
}, 120_000);
afterAll(async () => {
  await resources.disposeAsync();
  console.info("PDF_LIFECYCLE_FIXTURE_CLOSED", { web: app.url.origin, api: app.apiUrl.origin, root: app.dataDir });
}, 30_000);

test("automatic compilation follows durable acknowledgment and cache clear preserves source", async () => {
  // Given an owner editing through the real durable transport.
  await using fixture = await pdfBrowser(app, browser);
  const { page, project } = fixture;
  await page.getByLabel("Automatic compile", { exact: true }).check();
  await page.getByLabel("Draft (skip images)", { exact: true }).check();
  await page.getByLabel("Stop on first error", { exact: true }).uncheck();
  using complete = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === project.id && event.payload.status === "succeeded", 90_000);
  // When a source edit is durably acknowledged and automatically compiled.
  const [event] = await Promise.all([complete.promise, edit(page, validSource)]);
  if (event.topic !== "job.changed") throw new TypeError("Wrong compile event");
  const state = await discoverJob(page, event.payload.resourceId);
  const document = await page.evaluate(() => ({
    persistence: window.pdfFixture.document.getSnapshot().persistence,
    text: window.pdfFixture.document.source.toJSON(),
  }));
  expect(document.persistence.kind).toBe("saved");
  if (document.persistence.kind !== "saved") throw new TypeError("Missing durable acknowledgment");
  expect(state.preview?.snapshot.revision).toBe(document.persistence.revision);
  const accessResponse = await fixture.actor.context.request.get(`/api/projects/${project.id}/effective-access?branch=main`);
  const access = editorValue(resultSchema(endpoints.projectAccess.output).parse(await accessResponse.json()));
  const payload = Buffer.from([0, 255, 128, 0, 37, 80, 68, 70]);
  const uploadResponse = await fixture.actor.context.request.post(`/api/projects/${project.id}/uploads`, {
    headers: { origin: app.url.origin, "x-csrf-token": fixture.actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
    multipart: { scope: JSON.stringify({ projectId: project.id, branch: "main" }),
      paths: JSON.stringify(["preserved-asset.bin"]), expectedVersion: String(access.branchRevision),
      files: { name: "preserved-asset.bin", mimeType: "application/octet-stream", buffer: payload } },
  });
  const uploaded = editorValue(resultSchema(endpoints.filesUpload.output).parse(await uploadResponse.json()))[0];
  if (!uploaded) throw new TypeError("Uploaded asset missing");
  const [cleared] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/compile-cache")
      && response.request().method() === "DELETE", { timeout: 30_000 }),
    page.getByRole("button", { name: "Clear generated cache", exact: true }).click(),
  ]);
  expect(cleared.status()).toBe(200);
  // Then the saved source and its published immutable snapshot remain intact.
  expect(await page.evaluate(() => window.pdfFixture.document.source.toJSON())).toBe(validSource);
  const asset = await fixture.actor.context.request.get(`/api/projects/${project.id}/files/${uploaded.id}/content?branch=main`);
  expect(Buffer.from(await asset.body())).toEqual(payload);
  const job = await app.application.runtime.db.get<{ settings_json: string }>(
    "SELECT settings_json FROM compile_jobs WHERE id=?", [event.payload.resourceId]);
  if (!job) throw new TypeError("Durable compile job missing");
  expect(JSON.parse(job.settings_json)).toMatchObject({ draft: true, stopOnFirstError: false });
  expect(fixture.errors).toEqual([]);
}, 150_000);

test("cancel stops the actual running sandbox compile", async () => {
  // Given an actual bounded sandbox job with a nonterminating TeX loop.
  await using fixture = await pdfBrowser(app, browser);
  const { page, project } = fixture;
  await edit(page, "\\documentclass{article}\n\\begin{document}\n\\loop\\iftrue\\repeat\n\\end{document}");
  using running = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === project.id && event.payload.status === "running", 90_000);
  await Promise.all([running.promise, page.getByRole("button", { name: "Recompile", exact: true }).click()]);
  using canceled = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === project.id && event.payload.status === "canceled", 30_000);
  // When the actual versioned Cancel control is activated.
  const [event] = await Promise.all([canceled.promise, page.getByRole("button", { name: "Cancel compile", exact: true }).click()]);
  if (event.topic !== "job.changed") throw new TypeError("Wrong cancellation event");
  // Then discovery records canceled, never a successful PDF.
  const state = await discoverJob(page, event.payload.resourceId);
  expect(state.job?.status).toBe("canceled");
  expect(state.preview).toBeNull();
  expect(fixture.errors).toEqual([]);
}, 150_000);

test("automatic compilation follows durable source events without an active panel document", async () => {
  // Given PDF-only composition with no active document passed to the PDF panel.
  await using fixture = await pdfBrowser(app, browser, { activeFile: false });
  const { page, project } = fixture;
  await page.getByLabel("Automatic compile", { exact: true }).check();
  using completed = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === project.id && event.payload.status === "succeeded", 90_000);
  // When another authoring handle saves source through the real transport.
  const [event] = await Promise.all([completed.promise, edit(page, validSource)]);
  if (event.topic !== "job.changed") throw new TypeError("Wrong automatic compile event");
  // Then the event-driven preview uses that durably acknowledged revision.
  const state = await discoverJob(page, event.payload.resourceId);
  const persistence = await page.evaluate(() => window.pdfFixture.document.getSnapshot().persistence);
  if (persistence.kind !== "saved") throw new TypeError("Source was not acknowledged");
  expect(state.preview?.snapshot.revision).toBe(persistence.revision);
  expect(fixture.errors).toEqual([]);
}, 150_000);

test("header recompile uses live panel settings and flushes the current document", async () => {
  await using fixture = await pdfBrowser(app, browser);
  const { page, project } = fixture;
  await page.evaluate(() => {
    const handle = window.pdfFixture.viewer;
    if (!handle) throw new TypeError("PDF panel handle missing");
    window.pdfHeaderRecompile = () => handle.recompile();
  });
  const draft = !project.settings.draft;
  const stopOnFirstError = !project.settings.stopOnFirstError;
  await page.getByLabel("Draft (skip images)", { exact: true }).setChecked(draft);
  await page.getByLabel("Stop on first error", { exact: true }).setChecked(stopOnFirstError);
  await page.getByLabel("Automatic compile", { exact: true }).check();
  using completed = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === project.id && event.payload.status === "succeeded", 90_000);
  const created = page.waitForResponse(response => new URL(response.url()).pathname === `/api/projects/${project.id}/compiles`
    && response.request().method() === endpoints.compileCreate.method, { timeout: 30_000 });
  const [event, submitted, response] = await Promise.all([completed.promise, page.evaluate(async source => {
    const document = window.pdfFixture.document;
    document.replace([{ from: 0, to: document.source.length, insert: source }]);
    const job = await window.pdfHeaderRecompile();
    return { job, persistence: document.getSnapshot().persistence };
  }, validSource), created]);
  if (event.topic !== "job.changed") throw new TypeError("Wrong header compile event");
  expect(submitted.job.id).toBe(event.payload.resourceId);
  if (submitted.persistence.kind !== "saved") throw new TypeError("Header compile did not flush source");
  expect(submitted.job.snapshot.revision).toBe(submitted.persistence.revision);
  const stored = await app.application.runtime.db.get<{ settings_json: string }>(
    "SELECT settings_json FROM compile_jobs WHERE id=?", [submitted.job.id]);
  if (!stored) throw new TypeError("Header compile settings missing");
  expect(JSON.parse(stored.settings_json)).toMatchObject({ draft, stopOnFirstError });
  expect(await page.getByLabel("Automatic compile", { exact: true }).isChecked()).toBe(true);
  const state = await discoverJob(page, submitted.job.id);
  expect(state.preview?.artifact.jobId).toBe(submitted.job.id);
  await Bun.write(`${evidence}/header-settings-http.json`, JSON.stringify({
    status: response.status(), request: response.request().postDataJSON(),
    settings: JSON.parse(stored.settings_json), submitted, state,
  }, null, 2));
  expect(fixture.errors).toEqual([]);
}, 150_000);

declare global { interface Window { pdfHeaderRecompile: () => Promise<CompileJob> } }
