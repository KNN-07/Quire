import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import { bootstrapApplication } from "./application";
import { authenticatedContext, projectDocument, startEditorBrowser } from "../../../ui-editor/shared/browser";
import { nextApplicationEvent } from "../../../ui-editor/shared/events";
import { surfaceSignal } from "../../../ui-editor/assembly/actual-browser";
import { seedCommand } from "../../../core/catalog/bootstrap-template/fixture";

test("ordinary user selects the clean-seeded article, edits and reopens exact native source", async () => {
  const evidence = `docs/evidence/p40-bootstrap-template/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await bootstrapApplication();
    root = app.dataDir;
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app, { email: "outsider@quire.local" });
    const page = await owner.context.newPage();
    const catalog = await owner.context.request.get("/api/templates");
    const templates = editorValue(resultSchema(endpoints.templatesList.output).parse(await catalog.json())).items;
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ name: "Starter Article", status: "published", license: "CC0-1.0" });
    const admission = await owner.context.request.get(endpoints.environmentsAdmission.path);
    const environments = editorValue(resultSchema(endpoints.environmentsAdmission.output).parse(await admission.json()));
    expect(environments.some(item => item.selectable && item.environment.available && item.environment.probeAt !== null)).toBe(true);
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Use template Starter Article", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New project", exact: true });
    await dialog.getByLabel("Project name", { exact: true }).fill("Clean bootstrap article");
    const card = dialog.getByRole("button", { name: "Select template Starter Article", exact: true });
    await card.click();
    expect(await card.getAttribute("aria-pressed")).toBe("true");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await card.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/selection-${width}-${colorScheme}.png` });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const createdResponse = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.projectCreate.path
      && response.request().method() === "POST");
    const opened = page.waitForURL("**/projects/*/edit");
    const editable = await surfaceSignal(page, '.qe-main .cm-content[contenteditable="true"]');
    await dialog.getByRole("button", { name: "Create from template", exact: true }).click();
    const project = editorValue(resultSchema(endpoints.projectCreate.output).parse(await (await createdResponse).json()));
    await opened;
    await editable.observed;
    const source = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
    await source.waitFor();
    const scope = { projectId: project.id, branch: project.defaultBranch, fileId: project.settings.mainFileId };
    const original = await Bun.file(new URL("../../../../scripts/templates/article/main.tex", import.meta.url)).text();
    expect((await projectDocument(owner.context, scope)).text).toBe(original);
    console.info("BOOTSTRAP_NATIVE_EDIT_READY", { projectId: project.id, editable: await source.getAttribute("contenteditable") });
    const marker = "\n% User-edited article persists after clean initialization repeats.\n";
    using saved = nextApplicationEvent(app, event => event.topic === "document.saved"
      && event.aggregateId === project.id && event.payload.resourceId === scope.fileId);
    await source.press("ControlOrMeta+End");
    await page.keyboard.insertText(marker);
    const savedEvent = await saved.promise;
    if (savedEvent.topic !== "document.saved") throw new Error("Exact document save required");
    const acknowledged = await surfaceSignal(page, `.qe-status [data-save-revision="${savedEvent.payload.revision}"]`);
    await acknowledged.observed;
    expect((await projectDocument(owner.context, scope)).text).toBe(original + marker);
    const reloaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/files/${scope.fileId}/document`));
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(editorValue(resultSchema(endpoints.fileDocument.output).parse(await (await reloaded).json())).text).toBe(original + marker);
    await source.waitFor();
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    const reopened = await surfaceSignal(page, '.qe-main .cm-content[contenteditable="true"]');
    await page.getByRole("button", { name: "Clean bootstrap article", exact: true }).click();
    await reopened.observed;
    await source.waitFor();
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
        expect(await page.getByRole("dialog").count()).toBe(0);
        await page.screenshot({ path: `${evidence}/outcome-${width}-${colorScheme}.png` });
      }
    }
    const before = await app.application.runtime.db.all("SELECT * FROM blobs ORDER BY digest");
    await seedCommand(root, "seed");
    expect(await app.application.runtime.db.all("SELECT * FROM blobs ORDER BY digest")).toEqual(before);
    expect((await projectDocument(owner.context, scope)).text).toBe(original + marker);
    expect(await app.application.runtime.db.all("SELECT id FROM templates")).toHaveLength(1);
    expect(await app.application.runtime.db.all("SELECT id FROM template_versions")).toHaveLength(1);
    console.info("BOOTSTRAP_NATIVE_VERIFIED", { evidence, projectId: project.id, template: templates[0],
      environment: project.settings.environmentId, exactSource: original + marker });
    await page.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("BOOTSTRAP_NATIVE_ROOT_ABSENT", root);
}, 180_000);
