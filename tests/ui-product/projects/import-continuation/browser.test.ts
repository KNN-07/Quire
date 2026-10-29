import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { zipSync } from "fflate";
import { endpoints, IdSchema, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, projectDocument, startEditorBrowser } from "../../../ui-editor/shared/browser";

test("native ZIP operation opens its real imported project and source exports do not masquerade as imports", async () => {
  const evidence = `docs/evidence/p36-import-continuation/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    console.info("IMPORT_CONTINUATION_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence });
    await using browser = await startEditorBrowser();
    await using owner = await authenticatedContext(browser, app);
    const page = await owner.context.newPage();
    await page.goto("/projects?new=import", { waitUntil: "domcontentloaded" });
    const dialog = page.getByRole("dialog", { name: "New project", exact: true });
    await dialog.getByLabel("Project name", { exact: true }).fill("Imported reviewer draft");
    const source = "\\documentclass{article}\n\\begin{document}\nImported source survives reopening.\n\\end{document}\n";
    const archive = zipSync({ "main.tex": new TextEncoder().encode(source),
      "sections/note.tex": new TextEncoder().encode("A preserved nested file.\n") });
    await dialog.getByLabel("Choose file", { exact: true }).setInputFiles({
      name: "reviewer.zip", mimeType: "application/zip", buffer: Buffer.from(archive),
    });
    const importedResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === endpoints.importCreate.path && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Upload and create", exact: true }).click();
    const operation = editorValue(resultSchema(endpoints.importCreate.output).parse(await (await importedResponse).json()));
    expect(operation.status).toBe("succeeded");
    expect(operation.kind).toBe("zip-import");
    const ids = IdSchema.array().length(1).parse(operation.result?.["projectIds"]);
    const projectId = ids[0];
    if (!projectId) throw new TypeError("Imported project required");
    expect(operation.result?.["projectId"]).toBeUndefined();
    const open = dialog.getByRole("button", { name: "Open imported project", exact: true });
    await open.waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await open.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/${width}-${colorScheme}.png` });
      }
    }
    const opened = page.waitForURL(`**/projects/${projectId}/edit`);
    await open.click();
    await opened;
    await page.locator(".qe-main .cm-content").waitFor();
    const projectResponse = await owner.context.request.get(`/api/projects/${projectId}`, { params: { branch: "main" } });
    const project = editorValue(resultSchema(endpoints.projectGet.output).parse(await projectResponse.json()));
    const scope = { projectId, branch: project.defaultBranch, fileId: project.settings.mainFileId };
    expect((await projectDocument(owner.context, scope)).text).toBe(source);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".qe-main .cm-content").waitFor();
    expect((await projectDocument(owner.context, scope)).text).toBe(source);
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Select Imported reviewer draft", { exact: true }).check();
    const exportedResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === endpoints.projectBulk.path && response.request().method() === "POST");
    await page.getByRole("button", { name: "Download source", exact: true }).click();
    const exported = editorValue(resultSchema(endpoints.projectBulk.output).parse(await (await exportedResponse).json()));
    expect(exported.status).toBe("succeeded");
    const status = page.getByRole("region", { name: "Operation status", exact: true });
    await status.getByRole("button", { name: "Download source ZIP", exact: true }).waitFor();
    expect(await status.getByRole("button", { name: "Open imported project", exact: true }).count()).toBe(0);
    console.info("IMPORT_CONTINUATION_VERIFIED", { operationId: operation.id, projectId, exportKind: exported.kind });
    await page.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("IMPORT_CONTINUATION_CLOSED", { root, evidence });
}, 180_000);
