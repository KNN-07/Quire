import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import { endpoints, resultSchema } from "@quire/contracts";
import { DropboxFolderImportSchema } from "../../../packages/contracts/src/routes-adapters";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { dropboxServer } from "../../adapters/dropbox/provider";
import { defaultPolicy } from "../../fixtures/foundation";
import { authenticateApi } from "../../ui-editor/shared/api-session";
import { authenticatedContext, projectDocument, startEditorBrowser } from "../../ui-editor/shared/browser";
import { nextApplicationEvent } from "../../ui-editor/shared/events";
import { surfaceSignal } from "../../ui-editor/assembly/actual-browser";
import { folderApplication } from "./application";

test("native Dropbox discovery, explicit import and real editor persist original source", async () => {
  const evidence = `docs/evidence/p49-dropbox-folder-project/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using provider = dropboxServer();
    const original = "\\documentclass{article}\n\\begin{document}\nOriginal Dropbox browser paper.\n\\end{document}\n";
    const folder = provider.mkdir("/Browser Research");
    provider.put("/Browser Research/paper/main.tex", original);
    provider.putBytes("/Browser Research/images/data.bin", new Uint8Array([0, 255, 44, 128]));
    await using app = await folderApplication(provider);
    root = app.dataDir;
    const operator = await authenticateApi(app, "operator@quire.local");
    const configured = await operator.http.put("api/admin/providers/dropbox", { headers: { "if-match": '"0"' },
      json: { baseUrl: provider.origin, secret: "dropbox-client-secret", policy: defaultPolicy, expectedVersion: 0 } });
    expect(configured.status).toBe(200);
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app);
    const page = await owner.context.newPage();
    const actionResponse = () => page.waitForResponse(response => {
      const path = new URL(response.url()).pathname;
      return path.startsWith("/api/connections/") && path.endsWith("/actions")
        && response.request().method() === "POST";
    });
    async function receipt(response: Awaited<ReturnType<typeof actionResponse>>, action: string) {
      const body: unknown = await response.json();
      console.info("P49_BROWSER_OPERATION", JSON.stringify(body));
      const operation = editorValue(resultSchema(endpoints.connectionAction.output).parse(body));
      expect(operation.kind).toBe(`dropbox.${action}`);
      return operation;
    }
    // Native OAuth start and callback, through the loopback provider with a real encrypted grant.
    const started = await owner.context.request.post("/api/connections/dropbox/start", {
      headers: { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken },
      data: { returnTo: "/settings/connections" },
    });
    const url = z.object({ data: z.object({ url: z.url() }) }).parse(await started.json()).data.url;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForURL("**/settings/connections**");
    const discovery = page.getByRole("button", { name: "Discover Dropbox folders", exact: true });
    await discovery.waitFor();
    await page.screenshot({ path: `${evidence}/before-discovery.png` });
    console.info("P49_DISCOVERY_READY", { disabled: await discovery.isDisabled(),
      text: await page.getByRole("region", { name: "Create project from Dropbox folder", exact: true }).innerText() });
    const cursorResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/cursor")
      && new URL(response.url()).searchParams.get("action") === "discoverFolders");
    const discovered = actionResponse();
    void discovered.catch(() => undefined);
    const discoveryState = await surfaceSignal(page,
      `[aria-label="Create project from Dropbox folder"] [role="alert"], [aria-label="Create project from Dropbox folder"] select:has(option[value="${folder.id}"])`);
    await discovery.click();
    const cursor = await cursorResponse;
    console.info("P49_DISCOVERY_CURSOR", cursor.status(), await cursor.text());
    await discoveryState.observed;
    await page.screenshot({ path: `${evidence}/after-discovery.png` });
    const discoveryError = await page.getByRole("region", { name: "Create project from Dropbox folder", exact: true }).getByRole("alert").allTextContents();
    if (discoveryError.length) throw new Error(discoveryError.join("\n"));
    await receipt(await discovered, "discoverFolders");
    const select = page.getByLabel("Dropbox project folder", { exact: true });
    await select.waitFor();
    await select.selectOption(folder.id);
    const inspected = actionResponse();
    await page.getByRole("button", { name: "Inspect selected folder", exact: true }).click();
    await receipt(await inspected, "inspectFolder");
    await page.getByLabel("Imported project name", { exact: true }).fill("Browser Dropbox paper");
    await page.getByLabel("Dropbox main file", { exact: true }).selectOption("paper/main.tex");
    const panel = page.getByRole("region", { name: "Create project from Dropbox folder", exact: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await panel.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/selection-${width}-${colorScheme}.png` });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const importedResponse = actionResponse();
    await page.getByRole("button", { name: "Import folder as project", exact: true }).click();
    const operation = await receipt(await importedResponse, "importFolder");
    const imported = DropboxFolderImportSchema.parse(operation.result);
    const projectResponse = await owner.context.request.get(`/api/projects/${imported.projectId}`, { params: { branch: "main" } });
    const project = editorValue(resultSchema(endpoints.projectGet.output).parse(await projectResponse.json()));
    const opened = page.waitForURL(`**/projects/${project.id}/edit`);
    await page.getByRole("link", { name: "Open imported project", exact: true }).click();
    await opened;
    await (await surfaceSignal(page, '.qe-main .cm-content[contenteditable="true"]')).observed;
    const source = page.getByRole("textbox", { name: "Source: paper/main.tex", exact: true });
    await source.waitFor();
    const scope = { projectId: project.id, branch: project.defaultBranch, fileId: project.settings.mainFileId };
    expect((await projectDocument(owner.context, scope)).text).toBe(original);
    const marker = "\n% Native edit persists in the imported Dropbox project.\n";
    using saved = nextApplicationEvent(app, event => event.topic === "document.saved"
      && event.aggregateId === project.id && event.payload.resourceId === scope.fileId);
    await source.press("ControlOrMeta+End");
    await page.keyboard.insertText(marker);
    const savedEvent = await saved.promise;
    if (savedEvent.topic !== "document.saved") throw new Error("Exact source save required");
    await (await surfaceSignal(page, `.qe-status [data-save-revision="${savedEvent.payload.revision}"]`)).observed;
    expect((await projectDocument(owner.context, scope)).text).toBe(original + marker);
    const reloaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/files/${scope.fileId}/document`));
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(editorValue(resultSchema(endpoints.fileDocument.output).parse(await (await reloaded).json())).text).toBe(original + marker);
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    const reopened = await surfaceSignal(page, '.qe-main .cm-content[contenteditable="true"]');
    await page.getByRole("button", { name: "Browser Dropbox paper", exact: true }).click();
    await reopened.observed; await source.waitFor();
    expect((await projectDocument(owner.context, scope)).text).toBe(original + marker);
    const header = page.locator(".qe-project-header");
    const assistant = header.getByRole("button", { name: "Assistant", exact: true });
    if (await assistant.getAttribute("aria-pressed") === "true") await assistant.click();
    await header.getByRole("button", { name: "Source", exact: true }).click();
    const files = page.locator(".qe-rail").getByRole("button", { name: "Files", exact: true });
    if (await files.getAttribute("aria-pressed") === "true") await files.click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/editor-${width}-${colorScheme}.png` });
      }
    }
    expect(await app.application.runtime.db.get("SELECT folder_id,path FROM dropbox_folder_bindings WHERE project_id=?", [project.id]))
      .toEqual({ folder_id: folder.id, path: "/Browser Research" });
    // Return to native controls and send the actual editor change to the original remote path.
    await page.goto("/settings/connections", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Dropbox policy scope", { exact: true }).selectOption(`project:${project.id}`);
    const synced = actionResponse();
    await page.getByRole("button", { name: "Sync project now", exact: true }).click();
    expect((await receipt(await synced, "sync")).status).toBe("succeeded");
    expect(provider.text("/Browser Research/paper/main.tex")).toBe(original + marker);
    expect(provider.text(`/${project.id}/paper/main.tex`)).toBeNull();
    console.info("P49_BROWSER_VERIFIED", { evidence, projectId: project.id, operationId: operation.id,
      folderId: folder.id, scope, exactSource: original + marker });
    await page.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("P49_ROOT_ABSENT", root);
}, 180_000);
