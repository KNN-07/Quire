import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { AdapterGrantSchema, IdSchema, endpoints, resultSchema } from "@quire/contracts";
import { DropboxFolderImportSchema } from "../../../packages/contracts/src/routes-adapters";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { dropboxServer } from "../../adapters/dropbox/provider";
import { defaultPolicy } from "../../fixtures/foundation";
import { authenticateApi } from "../../ui-editor/shared/api-session";
import { authenticatedContext, projectDocument, startEditorBrowser } from "../../ui-editor/shared/browser";
import { folderApplication } from "./application";

test("native explicit recovery retains the prepared project and then synchronizes newer Dropbox content", async () => {
  const evidence = `docs/evidence/p55-dropbox-reauthorization/browser-${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  await using provider = dropboxServer();
  const folder = provider.mkdir("/Resume");
  const original = "\\documentclass{article}\n\\begin{document}Prepared contents\\end{document}\n";
  const newer = original.replace("Prepared contents", "Newer Dropbox contents");
  provider.put("/Resume/main.tex", original);
  await using app = await folderApplication(provider);
  const operator = await authenticateApi(app, "operator@quire.local");
  const configuration = { baseUrl: provider.origin, secret: "dropbox-client-secret", policy: defaultPolicy };
  expect((await operator.http.put("api/admin/providers/dropbox", { headers: { "if-match": '"0"' },
    json: { ...configuration, expectedVersion: 0 } })).status).toBe(200);
  await using browser = await startEditorBrowser();
  await using owner = await authenticatedContext(browser, app);
  const page = await owner.context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const headers = { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken };
  const started = await owner.context.request.post("/api/connections/dropbox/start", {
    headers, data: { returnTo: "/settings/connections" },
  });
  await page.goto(z.object({ data: z.object({ url: z.url() }) }).parse(await started.json()).data.url);
  await page.waitForURL("**/settings/connections**");
  const list = await owner.context.request.get("/api/connections");
  const grant = z.object({ data: z.object({ items: z.array(AdapterGrantSchema) }) }).parse(await list.json()).data.items
    .find(item => item.provider === "dropbox");
  if (!grant) throw new TypeError("Expected actual Dropbox grant");

  // Given: a retained unpublished snapshot, then an authorized configuration update and newer remote bytes.
  await app.application.runtime.db.exec(`CREATE TRIGGER interrupt_native_folder BEFORE UPDATE ON operations
    WHEN NEW.kind='dropbox.importFolder' AND NEW.status='succeeded'
    BEGIN SELECT RAISE(ABORT,'owned interrupted folder import'); END;`);
  expect((await owner.context.request.post(`/api/connections/${grant.id}/actions`, {
    headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    data: { action: "importFolder", expectedVersion: grant.version, expectedCursor: null,
      parameters: { folderId: folder.id, name: "Original chosen name", mainPath: "main.tex" } },
  })).status()).toBe(502);
  await app.application.runtime.db.exec("DROP TRIGGER interrupt_native_folder");
  const saved = z.object({ project_id: IdSchema }).parse(
    await app.application.runtime.db.get("SELECT project_id FROM dropbox_folder_imports"));
  expect((await operator.http.put("api/admin/providers/dropbox", { headers: { "if-match": '"1"' },
    json: { ...configuration, expectedVersion: 1 } })).status).toBe(200);
  provider.put("/Resume/main.tex", newer);
  await page.reload({ waitUntil: "domcontentloaded" });
  const response = () => page.waitForResponse(value => {
    const path = new URL(value.url()).pathname;
    return path.startsWith("/api/connections/") && path.endsWith("/actions") && value.request().method() === "POST";
  });
  const discovery = response();
  await page.getByRole("button", { name: "Discover Dropbox folders", exact: true }).click();
  expect((await discovery).status()).toBe(202);
  await page.getByLabel("Dropbox project folder", { exact: true }).selectOption(folder.id);
  const inspection = response();
  await page.getByRole("button", { name: "Inspect selected folder", exact: true }).click();
  expect((await inspection).status()).toBe(202);
  const resume = page.getByRole("button", { name: "Resume prepared import", exact: true });
  await resume.waitFor();
  expect(await page.getByLabel("Imported project name", { exact: true }).inputValue()).toBe("Original chosen name");
  expect(await resume.isDisabled()).toBe(true);
  expect(await app.application.runtime.db.get("SELECT id FROM projects WHERE id=?", [saved.project_id])).toBeNull();

  // When: the owner confirms this snapshot through the real native recovery controls.
  await page.getByRole("checkbox", { name: "Authorize the prepared import with current access", exact: true }).check();
  const panel = page.getByRole("region", { name: "Create project from Dropbox folder", exact: true });
  for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: `${evidence}/recovery-${width}-${colorScheme}.png` });
  }
  const resumed = response();
  await resume.click();
  const operation = editorValue(resultSchema(endpoints.connectionAction.output).parse(await (await resumed).json()));
  expect(operation.kind).toBe("dropbox.reauthorizeFolderImport");
  const result = DropboxFolderImportSchema.parse(operation.result);

  // Then: the original identity and snapshot are recovered; ordinary explicit sync reconciles later changes.
  expect(result.projectId).toBe(saved.project_id);
  const project = editorValue(resultSchema(endpoints.projectGet.output).parse(await (
    await owner.context.request.get(`/api/projects/${result.projectId}`, { params: { branch: "main" } })).json()));
  const scope = { projectId: project.id, branch: project.defaultBranch, fileId: project.settings.mainFileId };
  expect((await projectDocument(owner.context, scope)).text).toBe(original);
  await page.getByRole("link", { name: "Open imported project", exact: true }).click();
  await page.waitForURL(`**/projects/${project.id}/edit`);
  await page.goto(`${app.url.origin}/settings/connections`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Dropbox policy scope", { exact: true }).selectOption(`project:${project.id}`);
  const synced = response();
  await page.getByRole("button", { name: "Sync project now", exact: true }).click();
  expect((await synced).status()).toBe(202);
  expect((await projectDocument(owner.context, scope)).text).toBe(newer);
  expect(await app.application.runtime.db.all("SELECT * FROM dropbox_folder_bindings")).toHaveLength(1);
  expect(errors).toEqual([]);
  console.info("P55_NATIVE_RECOVERY", JSON.stringify({
    evidence, root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin, provider: provider.origin,
    projectId: project.id, operationId: operation.id, folderId: folder.id, original, newer,
  }));
}, 180000);
