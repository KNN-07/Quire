import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { endpoints, OperationSchema, resultSchema } from "@quire/contracts";
import type { Page } from "@playwright/test";
import { fixtureIds } from "../../fixtures/foundation";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import {
  authenticateApi,
  nextApplicationEvent,
  projectDocument,
  startEditorApplication,
  startEditorBrowser,
  waitForRenderedText,
} from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";

const evidence = process.env["QUIRE_NATIVE_ACCEPTANCE_EVIDENCE"]
  ?? fileURLToPath(new URL("../../../docs/evidence/p2u/runtime/", import.meta.url));
const projectPath = `/projects/${fixtureIds.project}`;
const sourceSelector = '.qe-main .cm-content[contenteditable="true"]';

async function settle(page: Page, selector: string) {
  const ready = await surfaceSignal(page, selector);
  await ready.observed;
}

describe("independent native editor acceptance", () => {
  const resources = new AsyncDisposableStack();
  let app: EditorApplication;
  let browser: EditorBrowser;
  let owner: Awaited<ReturnType<typeof authenticateApi>>;

  const context = async (email = "kien@quire.local") => {
    const identity = email === owner.user.primaryEmail ? owner : await authenticateApi(app, email);
    const browserContext = await browser.browser.newContext({ baseURL: app.url.origin });
    try {
      await browserContext.addCookies([identity.cookie]);
      return {
        context: browserContext,
        identity,
        async [Symbol.asyncDispose]() { await browserContext.close(); },
      };
    } catch (cause) { await browserContext.close(); throw cause; }
  };

  beforeAll(async () => {
    await mkdir(evidence, { recursive: true });
    app = await startEditorApplication();
    resources.defer(() => app[Symbol.asyncDispose]());
    browser = await startEditorBrowser();
    resources.defer(() => browser[Symbol.asyncDispose]());
    owner = await authenticateApi(app);
    console.info("P2U_ACCEPTANCE_OWNED", {
      runtime: Bun.version, web: app.url.origin, api: app.apiUrl.origin, root: app.dataDir,
    });
  }, 120_000);

  afterAll(async () => {
    await resources.disposeAsync();
    console.info("P2U_ACCEPTANCE_CLOSED", {
      web: app?.url.origin, api: app?.apiUrl.origin, root: app?.dataDir,
    });
  }, 90_000);

  test("creates blank/template projects and performs native ZIP import/source export", async () => {
    await using actor = await context();
    await using operator = await context("operator@quire.local");
    const page = await actor.context.newPage();
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Blank project", exact: true }).click();
    await page.getByRole("textbox", { name: "Project name", exact: true }).fill("Acceptance blank");
    await page.getByRole("checkbox", { name: "Start with an example document and introduction", exact: true }).uncheck();
    await Promise.all([
      page.waitForURL(/\/projects\/[^/]+\/edit$/u, { timeout: 30_000 }),
      page.getByRole("button", { name: "Create project", exact: true }).click(),
    ]);
    const blankId = new URL(page.url()).pathname.split("/")[2];
    if (!blankId) throw new TypeError("Blank project did not navigate to an editor");

    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    const templateHeaders = {
      origin: app.url.origin,
      "x-csrf-token": actor.identity.session.csrfToken,
      "idempotency-key": crypto.randomUUID(),
    };
    let templateVersion = editorValue(resultSchema(endpoints.templateCreate.output).parse(await (await actor.context.request.post(
      endpoints.templateCreate.path, {
        headers: templateHeaders,
        data: {
          name: "Acceptance published template",
          category: "Article",
          description: "Independent acceptance source",
          license: "MIT",
          visibility: "public",
          sourceProjectId: fixtureIds.project,
        },
      })).json()));
    templateVersion = editorValue(resultSchema(endpoints.templateSubmit.output).parse(await (await actor.context.request.post(
      endpoints.templateSubmit.path.replace(":id", templateVersion.templateId), {
        headers: { ...templateHeaders, "idempotency-key": crypto.randomUUID() },
        data: { expectedVersion: templateVersion.version },
      })).json()));
    const operatorHeaders = {
      origin: app.url.origin,
      "x-csrf-token": operator.identity.session.csrfToken,
      "idempotency-key": crypto.randomUUID(),
    };
    templateVersion = editorValue(resultSchema(endpoints.templateApprove.output).parse(await (await operator.context.request.post(
      endpoints.templateApprove.path.replace(":id", templateVersion.templateId), {
        headers: operatorHeaders,
        data: { expectedVersion: templateVersion.version, versionId: templateVersion.id },
      })).json()));
    templateVersion = editorValue(resultSchema(endpoints.templatePublish.output).parse(await (await operator.context.request.post(
      endpoints.templatePublish.path.replace(":id", templateVersion.templateId), {
        headers: { ...operatorHeaders, "idempotency-key": crypto.randomUUID() },
        data: { expectedVersion: templateVersion.version, versionId: templateVersion.id },
      })).json()));
    await page.getByRole("button", { name: "New project", exact: true }).click();
    const template = page.getByRole("button", {
      name: `Select template ${templateVersion.name}`,
      exact: true,
    });
    await template.click();
    await page.getByRole("textbox", { name: "Project name", exact: true }).fill("Acceptance template");
    await Promise.all([
      page.waitForURL(/\/projects\/[^/]+\/edit$/u, { timeout: 30_000 }),
      page.getByRole("button", { name: "Create from template", exact: true }).click(),
    ]);
    const templateId = new URL(page.url()).pathname.split("/")[2];
    if (!templateId) throw new TypeError("Template project did not navigate to an editor");

    const archive = zipSync({
      "main.tex": new TextEncoder().encode("\\documentclass{article}\n\\begin{document}Imported native ZIP\\end{document}\n"),
      "notes.txt": new TextEncoder().encode("preserved import bytes"),
    });
    const importedResponse = await actor.context.request.post(endpoints.importCreate.path, {
      headers: {
        origin: app.url.origin,
        "x-csrf-token": actor.identity.session.csrfToken,
        "idempotency-key": crypto.randomUUID(),
      },
      multipart: {
        kind: "zip",
        name: "Acceptance ZIP",
        source: { name: "acceptance.zip", mimeType: "application/zip", buffer: Buffer.from(archive) },
      },
    });
    expect(importedResponse.status()).toBe(202);
    const imported = editorValue(resultSchema(endpoints.importCreate.output).parse(await importedResponse.json()));
    const importedId = OperationSchema.parse(imported).result?.["projectIds"];
    const projectIds = Array.isArray(importedId) ? importedId : [];
    expect(projectIds).toHaveLength(1);

    const exportedResponse = await actor.context.request.post(`/api/projects/${blankId}/exports`, {
      headers: {
        origin: app.url.origin,
        "x-csrf-token": actor.identity.session.csrfToken,
        "idempotency-key": crypto.randomUUID(),
      },
      data: { kind: "source" },
    });
    expect(exportedResponse.status()).toBe(202);
    const exported = editorValue(resultSchema(endpoints.projectExport.output).parse(await exportedResponse.json()));
    const download = await actor.context.request.get(`/api/operations/${exported.id}/download`);
    expect(download.status()).toBe(200);
    const bytes = await download.body();
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    await Bun.write(`${evidence}/native-source-export.zip`, bytes);
    await Bun.write(`${evidence}/project-flows.json`, JSON.stringify({
      blankId, templateId, importedProjectIds: projectIds, exportOperation: exported.id,
      exportBytes: bytes.length,
    }, null, 2));
  }, 120_000);

  test("persists source, compiles valid/invalid drafts, and exercises tools/review/history/Git", async () => {
    await using ownerActor = await context();
    await using collaborator = await context("mai@quire.local");
    await using viewer = await context("alex@quire.local");
    const ownerPage = await ownerActor.context.newPage();
    const collaboratorPage = await collaborator.context.newPage();
    const viewerPage = await viewer.context.newPage();
    const scope = { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile };

    await openSurface(ownerPage, { path: `${projectPath}/edit`, selector: sourceSelector });
    await openSurface(collaboratorPage, { path: `${projectPath}/edit`, selector: sourceSelector });
    const source = ownerPage.getByRole("textbox", { name: "Source: main.tex", exact: true });
    const valid = "\\documentclass{article}\n\\newcommand{\\unknownisland}{preserved}\n\\begin{document}\nAcceptance valid \\unknownisland\n\\end{document}\n";
    using saved = nextApplicationEvent(app, event => event.topic === "document.saved"
      && event.aggregateId === fixtureIds.project && event.payload.resourceId === fixtureIds.mainFile);
    await source.press("ControlOrMeta+A");
    await Promise.all([saved.promise, ownerPage.keyboard.insertText(valid)]);
    expect((await projectDocument(ownerActor.context, scope)).text).toBe(valid);

    using collaboratorSaved = nextApplicationEvent(app, event => event.topic === "document.saved"
      && event.aggregateId === fixtureIds.project && event.payload.resourceId === fixtureIds.mainFile);
    const collaboratorSource = collaboratorPage.getByRole("textbox", { name: "Source: main.tex", exact: true });
    await collaboratorSource.press("ControlOrMeta+End");
    await Promise.all([collaboratorSaved.promise, collaboratorPage.keyboard.insertText("\n% independent collaborator\n")]);
    await settle(ownerPage, '.qe-status [data-save-state="saved"]');
    expect((await projectDocument(ownerActor.context, scope)).text).toContain("% independent collaborator");

    using compiled = nextApplicationEvent(app, event => event.topic === "job.changed"
      && event.aggregateId === fixtureIds.project && event.payload.status === "succeeded", 90_000);
    await ownerPage.getByRole("button", { name: "Recompile", exact: true }).click();
    await compiled.promise;
    await settle(ownerPage, 'canvas[data-rendered="true"]');

    const collaborating = (await projectDocument(ownerActor.context, scope)).text;
    const invalid = collaborating.replace("\\end{document}", "\\unknownAcceptanceCommand\n\\end{document}");
    using invalidSaved = nextApplicationEvent(app, event => event.topic === "document.saved"
      && event.aggregateId === fixtureIds.project && event.payload.resourceId === fixtureIds.mainFile);
    await source.press("ControlOrMeta+A");
    await Promise.all([invalidSaved.promise, ownerPage.keyboard.insertText(invalid)]);
    using failed = nextApplicationEvent(app, event => event.topic === "job.changed"
      && event.aggregateId === fixtureIds.project && event.payload.status === "failed", 90_000);
    await ownerPage.getByRole("button", { name: "Recompile", exact: true }).click();
    await failed.promise;
    await ownerPage.goto(`${projectPath}/logs`, { waitUntil: "domcontentloaded" });
    await settle(ownerPage, ".q-pdf-log");
    expect(await ownerPage.getByText("PDF remains the last successful build.", { exact: false }).count()).toBeGreaterThan(0);
    expect(await ownerPage.getByRole("button", { name: /Go to main\.tex:/u }).count()).toBeGreaterThan(0);

    await ownerPage.goto(`${projectPath}/edit`, { waitUntil: "domcontentloaded" });
    await settle(ownerPage, sourceSelector);
    await ownerPage.getByRole("button", { name: "Project search", exact: true }).click();
    await ownerPage.getByRole("textbox", { name: "Find in project source", exact: true }).fill("unknownAcceptanceCommand");
    const searchReady = await surfaceSignal(ownerPage, ".editor-tools__results button");
    const searchResponse = ownerPage.waitForResponse(response => response.request().method() === "GET"
      && new URL(response.url()).pathname === endpoints.projectSearch.path.replace(":p", fixtureIds.project));
    const [searchResult] = await Promise.all([
      searchResponse, searchReady.observed,
      ownerPage.getByRole("button", { name: "Search", exact: true }).click(),
    ]);
    const matches = editorValue(resultSchema(endpoints.projectSearch.output).parse(await searchResult.json()));
    expect(matches.matches.some(match => match.fileId === fixtureIds.mainFile)).toBe(true);
    expect(await ownerPage.getByRole("button", { name: /main\.tex:/u }).count()).toBeGreaterThan(0);

    await ownerPage.getByRole("combobox", { name: "Editor tool", exact: true }).selectOption("bibliography");
    await settle(ownerPage, 'section[aria-label="Bibliography"]');
    expect(await ownerPage.getByRole("textbox", { name: "Find citation key", exact: true }).count()).toBe(1);
    await ownerPage.getByRole("combobox", { name: "Editor tool", exact: true }).selectOption("settings");
    await settle(ownerPage, 'section[aria-label="Project settings"]');

    await ownerPage.goto(`${projectPath}/review`, { waitUntil: "domcontentloaded" });
    await settle(ownerPage, '.quire-review__review-grid[data-review-live="true"], .quire-review__section[data-review-live="true"]');
    const comment = `Acceptance comment ${crypto.randomUUID()}`;
    await ownerPage.getByPlaceholder("Add a comment. Use @ to mention a collaborator.").fill(comment);
    await ownerPage.getByRole("button", { name: "Comment", exact: true }).click();
    await settle(ownerPage, ".quire-thread");
    expect(await ownerPage.getByText(comment, { exact: true }).count()).toBe(1);

    await ownerPage.goto(`${projectPath}/history`, { waitUntil: "domcontentloaded" });
    await settle(ownerPage, '.quire-history button[data-history-id][aria-pressed="true"]');
    await ownerPage.getByRole("button", { name: "Restore selected version", exact: true }).click();
    const restored = ownerPage.waitForResponse(response =>
      response.request().method() === "POST" && /\/history\/[^/]+\/restore$/u.test(new URL(response.url()).pathname));
    await Promise.all([restored, ownerPage.getByRole("button", { name: "Restore version", exact: true }).click()]);

    await ownerPage.goto(`${projectPath}/git`, { waitUntil: "domcontentloaded" });
    await settle(ownerPage, ".git-workspace");
    expect(await ownerPage.getByRole("heading", { name: "Changes", exact: false }).count()).toBeGreaterThan(0);
    expect(await ownerPage.getByText("Clone with Git", { exact: true }).count()).toBe(1);

    await viewerPage.goto(`${projectPath}/edit`, { waitUntil: "domcontentloaded" });
    await settle(viewerPage, '.qe-status [data-save-state="saved"]');
    expect(await viewerPage.getByRole("textbox", { name: "Source: main.tex", exact: true }).getAttribute("contenteditable")).toBe("false");
    await viewerPage.goto(`${projectPath}/git`, { waitUntil: "domcontentloaded" });
    await settle(viewerPage, ".git-workspace");
    await waitForRenderedText(viewerPage, "Viewer access: Git writes are disabled.");
    expect(await viewerPage.getByRole("button", { name: "New branch", exact: true }).isDisabled()).toBe(true);
    await viewerPage.screenshot({ path: `${evidence}/viewer-git.png` });
    await Bun.write(`${evidence}/viewer-git.aria.yml`, await viewerPage.locator("body").ariaSnapshot());
    await Bun.write(`${evidence}/viewer-access.json`, JSON.stringify({
      identity: viewer.identity.user,
      access: await (await viewer.context.request.get(`${projectPath.replace("/projects/", "/api/projects/")}/effective-access?branch=main`)).json(),
    }, null, 2));
    const deniedBranch = await viewer.context.request.post(`${projectPath.replace("/projects/", "/api/projects/")}/git/branches`, {
      headers: {
        origin: app.url.origin,
        "x-csrf-token": viewer.identity.session.csrfToken,
        "idempotency-key": crypto.randomUUID(),
      },
      data: { name: "viewer-forbidden", from: "main", expectedVersion: 0 },
    });
    expect(deniedBranch.status()).toBe(403);

    const persisted = await projectDocument(ownerActor.context, scope);
    await Bun.write(`${evidence}/functional-observations.json`, JSON.stringify({
      revision: persisted.file.version.revision,
      epoch: persisted.file.version.epoch,
      bytes: persisted.file.bytes,
      unknownSourcePreserved: persisted.text.includes("\\unknownAcceptanceCommand"),
      collaboratorTextPreserved: persisted.text.includes("% independent collaborator"),
      comment,
      viewerSourceReadOnly: true,
      viewerGitReadOnly: true,
    }, null, 2));
  }, 240_000);
});
