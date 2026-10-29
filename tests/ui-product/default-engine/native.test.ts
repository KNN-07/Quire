import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticatedContext, projectDocument, startEditorBrowser } from "../../ui-editor/shared/browser";
import { startEditorApplication } from "../../ui-editor/shared/application";
import { nextApplicationEvent } from "../../ui-editor/shared/events";
import { openSurface, surfaceSignal } from "../../ui-editor/assembly/actual-browser";

const inputs = [
  "services/core/base/projects.ts", "apps/web/src/features/projects/NewProjectDialog.tsx",
  "packages/contracts/src/routes-core.ts", "tests/core/base/default-engine.test.ts",
  "tests/ui-product/default-engine/native.test.ts", "tests/ui-product/default-engine/tsconfig.json",
];
function record(kind: string, data: unknown) {
  console.info("P61_RECEIPT", JSON.stringify({ utc: new Date().toISOString(), kind, data }));
}
async function fingerprints(phase: string) {
  for (const path of inputs) record("input", { phase, path,
    sha256: new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex") });
}

test("native saved compiler selection survives creation, reopen and real compilation without crossing actors", async () => {
  const evidence = `docs/evidence/p61-default-engine/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  record("run", { cwd: process.cwd(), command: "bun test tests/ui-product/default-engine/native.test.ts",
    runtime: Bun.version, executable: process.execPath, evidence });
  await fingerprints("before");
  let root = "";
  {
    await using app = await startEditorApplication();
    root = app.dataDir;
    record("owned", { root, web: app.url.origin, api: app.apiUrl.origin });
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app);
    await using other = await authenticatedContext(browser, app, { email: "mai@quire.local" });
    const page = await owner.context.newPage();
    await using surface = new AsyncDisposableStack();
    surface.defer(async () => {
      await Bun.write(`${evidence}/terminal.html`, await page.content());
      await page.screenshot({ path: `${evidence}/terminal.png`, fullPage: true });
    });
    const admission = await owner.context.request.get(endpoints.environmentsAdmission.path);
    const environments = editorValue(resultSchema(endpoints.environmentsAdmission.output).parse(await admission.json()));
    const admitted = environments.find(item => item.selectable && item.environment.engines.includes("xelatex"));
    if (!admitted) throw new Error("A genuinely probed executable XeLaTeX environment is required");
    record("environment", { status: admission.status(), admitted });
    const otherBefore = editorValue(resultSchema(endpoints.preferencesGet.output).parse(
      await (await other.context.request.get(endpoints.preferencesGet.path)).json()));
    await page.goto("/settings/editor", { waitUntil: "domcontentloaded" });
    await page.getByRole("combobox", { name: "Default compiler", exact: true }).selectOption("xelatex");
    const saved = page.waitForResponse(response => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === endpoints.preferencesPatch.path);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    const savedResponse = await saved;
    const savedBody: unknown = await savedResponse.json();
    expect(editorValue(resultSchema(endpoints.preferencesPatch.output).parse(savedBody)).defaultEngine).toBe("xelatex");
    record("preference-action", { url: savedResponse.url(), status: savedResponse.status(),
      request: savedResponse.request().postData(), body: savedBody });
    await page.locator(".account-notice[role='status']").waitFor({ state: "visible" });
    const otherAfter = editorValue(resultSchema(endpoints.preferencesGet.output).parse(
      await (await other.context.request.get(endpoints.preferencesGet.path)).json()));
    expect(otherAfter).toEqual(otherBefore);
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    const preferencesLoaded = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.preferencesGet.path);
    await page.getByRole("button", { name: "New project", exact: true }).first().click();
    await preferencesLoaded;
    const dialog = page.getByRole("dialog", { name: "New project", exact: true });
    await dialog.getByRole("tab", { name: "Blank", exact: true }).click();
    await (await surfaceSignal(page, 'select[aria-label="Compiler"]:not(:has(option[value=""]))')).observed;
    await dialog.getByLabel("Project name", { exact: true }).fill("Saved XeLaTeX native");
    expect(await dialog.getByLabel("Compiler", { exact: true }).inputValue()).toBe("xelatex");
    await page.reload({ waitUntil: "domcontentloaded" });
    const reloadedPreferences = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.preferencesGet.path);
    await page.getByRole("button", { name: "New project", exact: true }).first().click();
    await reloadedPreferences;
    await dialog.getByRole("tab", { name: "Blank", exact: true }).click();
    await (await surfaceSignal(page, 'select[aria-label="Compiler"]:not(:has(option[value=""]))')).observed;
    await dialog.getByLabel("Project name", { exact: true }).fill("Saved XeLaTeX native");
    expect(await dialog.getByLabel("Compiler", { exact: true }).inputValue()).toBe("xelatex");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/selection-${width}-${colorScheme}.png` });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    let projectPatches = 0;
    page.on("request", request => {
      if (request.method() === "PATCH" && /^\/api\/projects\/[^/]+$/.test(new URL(request.url()).pathname)) projectPatches += 1;
    });
    const createdResponse = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === endpoints.projectCreate.path);
    const opened = page.waitForURL("**/projects/*/edit");
    await dialog.getByRole("button", { name: "Create project", exact: true }).click();
    const response = await createdResponse;
    const body: unknown = await response.json();
    const project = editorValue(resultSchema(endpoints.projectCreate.output).parse(body));
    record("create-action", { url: response.url(), status: response.status(), request: response.request().postData(),
      key: response.request().headers()["idempotency-key"], body });
    expect(project.settings.engine).toBe("xelatex");
    expect(project.settings.environmentId).toBe(admitted.environment.id);
    expect(project.version).toBe(1);
    await opened;
    await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).waitFor();
    expect(projectPatches).toBe(0);
    const getPath = endpoints.projectGet.path.replace(":p", project.id);
    const reopenedResponse = page.waitForResponse(entry => new URL(entry.url()).pathname === getPath && entry.request().method() === "GET");
    await page.reload({ waitUntil: "domcontentloaded" });
    const reopened = editorValue(resultSchema(endpoints.projectGet.output).parse(await (await reopenedResponse).json()));
    expect(reopened.settings).toEqual(project.settings);
    await openSurface(page, { path: `/projects/${project.id}/edit`,
      selector: '.qe-main .cm-content[contenteditable="true"]' });
    const source = "\\documentclass{article}\n\\begin{document}\nSaved XeLaTeX compiler preference.\n\\end{document}\n";
    using sourceSaved = nextApplicationEvent(app, event => event.topic === "document.saved"
      && event.aggregateId === project.id && event.payload.resourceId === project.settings.mainFileId);
    const sourceEditor = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
    await sourceEditor.click();
    await sourceEditor.press("ControlOrMeta+A");
    await page.keyboard.insertText(source);
    await sourceSaved.promise;
    const persistedSource = await projectDocument(owner.context, {
      projectId: project.id, branch: project.defaultBranch, fileId: project.settings.mainFileId,
    });
    expect(persistedSource.text).toBe(source);
    record("source-edit", { fileId: persistedSource.file.id, version: persistedSource.file.version, source: persistedSource.text });
    const ready = await surfaceSignal(page, '.qe-status [data-environment-state="ready"]');
    await ready.observed;
    using succeeded = nextApplicationEvent(app, event => event.topic === "job.changed"
      && event.aggregateId === project.id && (event.payload.status === "succeeded" || event.payload.status === "failed"), 90_000);
    const compileResponse = page.waitForResponse(entry => entry.request().method() === "POST"
      && new URL(entry.url()).pathname === endpoints.compileCreate.path.replace(":p", project.id));
    await page.getByRole("button", { name: "Recompile", exact: true }).click();
    const compile = await compileResponse;
    const compileBody: unknown = await compile.json();
    const job = editorValue(resultSchema(endpoints.compileCreate.output).parse(compileBody));
    const outcome = await succeeded.promise;
    expect(outcome.topic).toBe("job.changed");
    if (outcome.topic !== "job.changed") throw new Error("Compile event required");
    expect(outcome.payload.resourceId).toBe(job.id);
    expect(outcome.payload.status).toBe("succeeded");
    const previewResponse = await owner.context.request.get(`/api/projects/${project.id}/compile-preview`, { params: { branch: "main" } });
    const preview = editorValue(resultSchema(endpoints.compilePreview.output).parse(await previewResponse.json()));
    if (!preview.preview) throw new Error("Real compiled artifact required");
    const artifact = await owner.context.request.get(`/api/artifacts/${preview.preview.artifact.id}/content`);
    const bytes = await artifact.body();
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    record("compile-action", { url: compile.url(), status: compile.status(), request: compile.request().postData(),
      body: compileBody, outcome, artifactId: preview.preview.artifact.id, artifactStatus: artifact.status(),
      pdfBytes: bytes.length, pdfSha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.screenshot({ path: `${evidence}/outcome-${width}-${colorScheme}.png` });
      }
    }
    const secondPage = await other.context.newPage();
    await secondPage.goto("/projects", { waitUntil: "domcontentloaded" });
    const secondLoaded = secondPage.waitForResponse(entry => new URL(entry.url()).pathname === endpoints.preferencesGet.path);
    await secondPage.getByRole("button", { name: "New project", exact: true }).first().click();
    await secondLoaded;
    const secondDialog = secondPage.getByRole("dialog", { name: "New project", exact: true });
    await secondDialog.getByRole("tab", { name: "Blank", exact: true }).click();
    await (await surfaceSignal(secondPage, 'select[aria-label="Compiler"]:not(:has(option[value=""]))')).observed;
    expect(await secondDialog.getByLabel("Compiler", { exact: true }).inputValue()).toBe(otherBefore.defaultEngine);
    record("isolation", { ownerEngine: project.settings.engine, otherEngine: otherAfter.defaultEngine, projectPatches });
    const preferences = editorValue(resultSchema(endpoints.preferencesGet.output).parse(
      await (await owner.context.request.get(endpoints.preferencesGet.path)).json()));
    const { version, ...writable } = preferences;
    const unavailablePreference = await owner.context.request.patch(endpoints.preferencesPatch.path, {
      headers: { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken },
      data: { ...writable, defaultEngine: "plain", expectedVersion: version },
    });
    expect(unavailablePreference.status()).toBe(200);
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    const unavailableLoaded = page.waitForResponse(entry => new URL(entry.url()).pathname === endpoints.preferencesGet.path);
    await page.getByRole("button", { name: "New project", exact: true }).first().click();
    await unavailableLoaded;
    await dialog.getByRole("tab", { name: "Blank", exact: true }).click();
    await (await surfaceSignal(page, 'select[aria-label="Compiler"]:not(:has(option[value=""]))')).observed;
    expect(await dialog.getByLabel("Compiler", { exact: true }).inputValue()).toBe("plain");
    expect(await dialog.getByRole("button", { name: "Create project", exact: true }).isDisabled()).toBe(true);
    expect(await dialog.getByRole("alert").isVisible()).toBe(true);
    await dialog.screenshot({ path: `${evidence}/unavailable-saved-engine.png` });
    await dialog.getByLabel("Compiler", { exact: true }).selectOption("lualatex");
    await dialog.getByLabel("Project name", { exact: true }).fill("Explicit LuaLaTeX native");
    const overrideResponse = page.waitForResponse(entry => entry.request().method() === "POST"
      && new URL(entry.url()).pathname === endpoints.projectCreate.path);
    await dialog.getByRole("button", { name: "Create project", exact: true }).click();
    const override = await overrideResponse;
    const overrideBody: unknown = await override.json();
    const explicit = editorValue(resultSchema(endpoints.projectCreate.output).parse(overrideBody));
    expect(explicit.settings.engine).toBe("lualatex");
    record("explicit-override", { url: override.url(), status: override.status(), request: override.request().postData(),
      key: override.request().headers()["idempotency-key"], body: overrideBody });
  }
  await rejects(stat(root), { code: "ENOENT" });
  record("cleanup", { root, removed: true, scope: "Owned fixture API, Vite, application, browser and contexts disposed; no live services touched." });
  await fingerprints("after");
}, 180_000);
