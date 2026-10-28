import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticatedContext, projectDocument, startEditorApplication, startEditorBrowser, waitForRenderedText } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { createProject, disposePage, mount, responseAfter, waitForDocument } from "./helpers";

describe("real editor file tools", () => {
  const resources = new AsyncDisposableStack();
  let app: EditorApplication;
  let browser: EditorBrowser;
  beforeAll(async () => {
    try { app = resources.use(await startEditorApplication()); browser = resources.use(await startEditorBrowser()); }
    catch (error) { await resources.disposeAsync(); throw error; }
  }, 120_000);
  afterAll(async () => {
    await resources.disposeAsync();
    console.info("TOOLS_FILES_CLOSED", { api: app.apiUrl.origin, web: app.url.origin, root: app.dataDir });
  }, 30_000);
  test.each([1440, 390])("persists file CRUD, source search and binary bytes at width %i", async width => {
    // Given a real project and an authenticated browser consuming the injected client.
    await using actor = await authenticatedContext(browser, app, { viewport: { width, height: width === 390 ? 844 : 900 },
      ...(width === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
    const project = await createProject(actor, { name: `Tools files ${width}`, origin: app.url.origin });
    const page = await actor.context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await mount(page, project.id);
    const filesPath = `/api/projects/${project.id}/files`;
    const source = "\\section{Tools proof}\nUnique needle 😀\n";
    await page.getByRole("button", { name: "New folder", exact: true }).click();
    await page.getByLabel("Project path").fill("chapters");
    const folderCreated = await responseAfter(page, { path: filesPath, method: "POST" }, () => page.getByRole("button", { name: "Create", exact: true }).click());
    const folder = editorValue(resultSchema(endpoints.fileCreate.output).parse(await folderCreated.json()));
    await waitForRenderedText(page, "chapters");
    const folderRow = page.getByRole("treeitem", { name: /chapters$/ });
    await folderRow.focus();
    await folderRow.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("title"))).toBe(folder.path);
    await folderRow.press("ArrowDown");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("title"))).toBe("main.tex");
    await page.getByRole("treeitem", { name: /main\.tex/ }).press("Home");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("title"))).toBe(folder.path);
    await page.getByRole("button", { name: "New file", exact: true }).click();
    await page.getByLabel("Project path").fill("chapters/proof.tex");
    await page.getByLabel("Initial source").fill(source);
    // When the file is created, reopened and moved through real controls.
    const createdResponse = await responseAfter(page, { path: filesPath, method: "POST" }, () => page.getByRole("button", { name: "Create", exact: true }).click());
    const file = editorValue(resultSchema(endpoints.fileCreate.output).parse(await createdResponse.json()));
    await waitForRenderedText(page, file.path);
    await page.getByRole("treeitem", { name: /chapters\/proof\.tex/ }).click();
    await waitForDocument(page, file.id);
    await page.getByRole("button", { name: "Rename or move", exact: true }).click();
    await page.getByLabel("Project path").fill("chapters/renamed.tex");
    await responseAfter(page, { path: `${filesPath}/${file.id}`, method: "PATCH" }, () => page.getByRole("button", { name: "Save path" }).click());
    await waitForRenderedText(page, "chapters/renamed.tex");
    await page.getByRole("treeitem", { name: /chapters$/ }).click();
    await page.getByRole("button", { name: "Rename or move", exact: true }).click();
    await page.getByLabel("Project path").fill("moved-chapters");
    await responseAfter(page, { path: `${filesPath}/${folder.id}`, method: "PATCH" }, () => page.getByRole("button", { name: "Save path" }).click());
    await waitForRenderedText(page, "moved-chapters/renamed.tex");
    const persisted = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: file.id });
    expect(persisted.text).toBe(source);
    expect(persisted.file.path).toBe("moved-chapters/renamed.tex");
    const binary = Buffer.from([0, 255, 128, 10, 13, 0, 75]);
    const uploadResponse = await responseAfter(page, { path: `/api/projects/${project.id}/uploads`, method: "POST" }, () =>
      page.getByLabel("Upload files", { exact: true }).setInputFiles({ name: "bytes.bin", mimeType: "application/octet-stream", buffer: binary }));
    const uploaded = editorValue(resultSchema(endpoints.filesUpload.output).parse(await uploadResponse.json()));
    const image = uploaded[0];
    if (!image) throw new TypeError("Upload returned no file");
    await waitForRenderedText(page, "bytes.bin");
    console.info("TOOLS_DOCUMENT_AFTER_UPLOAD", await page.locator(".tools-harness").getAttribute("data-document-state"),
      await page.getByRole("complementary", { name: "Editor tools", exact: true }).innerText());
    expect(await page.getByRole("treeitem", { name: /bytes\.bin/ }).isDisabled()).toBe(false);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      page.getByRole("treeitem", { name: /bytes\.bin/ }).click(),
    ]);
    const saved = await download.path();
    if (!saved) throw new TypeError("Download had no saved bytes");
    expect(new Uint8Array(await Bun.file(saved).arrayBuffer())).toEqual(new Uint8Array(binary));
    const directory = await mkdtemp(join(app.dataDir, "folder-input-"));
    await mkdir(join(directory, "nested"));
    const nestedBytes = new TextEncoder().encode("Folder upload preserves bytes 😀\n");
    await writeFile(join(directory, "nested", "source.tex"), nestedBytes);
    const directoryResponse = await responseAfter(page, { path: `/api/projects/${project.id}/uploads`, method: "POST" }, () =>
      page.getByLabel("Upload folder", { exact: true }).setInputFiles(directory));
    const nested = editorValue(resultSchema(endpoints.filesUpload.output).parse(await directoryResponse.json()))[0];
    if (!nested) throw new TypeError("Directory upload returned no file");
    const nestedSource = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: nested.id });
    expect(nested.path.endsWith("/nested/source.tex")).toBe(true);
    expect(new TextEncoder().encode(nestedSource.text)).toEqual(nestedBytes);
    await page.getByLabel("Editor tool", { exact: true }).selectOption("search");
    await page.getByLabel("Find in project source").fill("Unique needle");
    const searchResponse = await responseAfter(page, { path: `/api/projects/${project.id}/search`, method: "GET" }, () => page.getByRole("button", { name: "Search", exact: true }).click());
    const result = editorValue(resultSchema(endpoints.projectSearch.output).parse(await searchResponse.json()));
    await waitForRenderedText(page, "PDF content is not searched");
    // Then search reports real source coordinates and explicit binary exclusions.
    expect(result.matches.some(match => match.fileId === file.id && match.line === 2)).toBe(true);
    expect(result.excluded.some(entry => entry.fileId === image.id && entry.reason.length > 0)).toBe(true);
    await page.evaluate(() => window.addEventListener("tools:navigation", event => {
      if (event instanceof CustomEvent) console.info("TOOLS_SOURCE_LOCATION", JSON.stringify(event.detail));
    }, { once: true }));
    const navigation = page.waitForEvent("console", { predicate: message => message.text().startsWith("TOOLS_SOURCE_LOCATION"), timeout: 30_000 });
    await page.getByRole("button", { name: /moved-chapters\/renamed\.tex:2:/ }).click();
    expect((await navigation).text()).toContain(file.id);
    expect(await page.getByRole("heading", { level: 1, includeHidden: true }).textContent()).toBe("moved-chapters/renamed.tex");
    await page.screenshot({ path: fileURLToPath(new URL(`./evidence/search-${width}-light.png`, import.meta.url)), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: fileURLToPath(new URL(`./evidence/search-${width}-dark.png`, import.meta.url)), fullPage: true });
    await page.getByLabel("Editor tool", { exact: true }).selectOption("files");
    await page.getByRole("treeitem", { name: /moved-chapters\/renamed\.tex/ }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await responseAfter(page, { path: `${filesPath}/${file.id}`, method: "DELETE" }, () => page.getByRole("button", { name: "Delete permanently" }).click());
    await waitForRenderedText(page, "Project files updated.");
    const reopened = await actor.context.request.get(filesPath, { params: { branch: "main" } });
    const files = editorValue(resultSchema(endpoints.filesList.output).parse(await reopened.json()));
    expect(files.some(item => item.id === file.id)).toBe(false);
    expect(errors).toEqual([]);
    await disposePage(page);
  }, 120_000);
  test.each([1440, 390])("creates and uploads through compact file actions at width %i", async width => {
    await using actor = await authenticatedContext(browser, app, { viewport: { width, height: width === 390 ? 844 : 900 },
      ...(width === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
    const project = await createProject(actor, { name: `Tools compact ${width}`, origin: app.url.origin });
    const page = await actor.context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await mount(page, project.id, "compact");
    expect(await page.getByRole("button", { name: "New file", exact: true }).isVisible()).toBe(false);
    expect(await page.getByRole("treeitem", { name: /main\.tex/ }).isVisible()).toBe(true);
    const disclosure = page.locator("summary").filter({ hasText: "File actions" });
    await disclosure.focus(); await disclosure.press("Enter");
    await page.getByRole("button", { name: "New file", exact: true }).click();
    await page.getByLabel("Project path").fill("compact.tex");
    const text = "Compact creation preserves source 😀\n";
    await page.getByLabel("Initial source").fill(text);
    const created = await responseAfter(page, { path: `/api/projects/${project.id}/files`, method: "POST" }, () =>
      page.getByRole("button", { name: "Create", exact: true }).click());
    const file = editorValue(resultSchema(endpoints.fileCreate.output).parse(await created.json()));
    await waitForRenderedText(page, "Project files updated.");
    expect((await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: file.id })).text).toBe(text);
    const bytes = Uint8Array.of(0, 255, 10, 13, 128);
    await disclosure.press("Enter");
    const upload = await responseAfter(page, { path: `/api/projects/${project.id}/uploads`, method: "POST" }, () =>
      page.getByLabel("Upload files", { exact: true }).setInputFiles({ name: "compact.bin", mimeType: "application/octet-stream", buffer: Buffer.from(bytes) }));
    const binary = editorValue(resultSchema(endpoints.filesUpload.output).parse(await upload.json()))[0];
    if (!binary) throw new TypeError("Compact upload returned no file");
    await waitForRenderedText(page, "Files uploaded.");
    const download = await actor.context.request.get(`/api/projects/${project.id}/files/${binary.id}/content`, { params: { branch: "main" } });
    expect(new Uint8Array(await download.body())).toEqual(bytes);
    const directory = join(app.dataDir, `compact-folder-${width}`);
    await mkdir(join(directory, "nested"), { recursive: true });
    await writeFile(join(directory, "nested", "source.tex"), text);
    await disclosure.press("Enter");
    const folderUpload = await responseAfter(page, { path: `/api/projects/${project.id}/uploads`, method: "POST" }, () =>
      page.getByLabel("Upload folder", { exact: true }).setInputFiles(directory));
    const nested = editorValue(resultSchema(endpoints.filesUpload.output).parse(await folderUpload.json()))[0];
    if (!nested) throw new TypeError("Compact folder upload returned no file");
    expect(nested.path.endsWith("/nested/source.tex")).toBe(true);
    expect((await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: nested.id })).text).toBe(text);
    await waitForRenderedText(page, nested.path);
    expect(await page.getByLabel("Upload files", { exact: true }).isVisible()).toBe(false);
    expect(await page.getByRole("treeitem", { name: /compact\.tex/ }).isVisible()).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`./evidence/files-compact-${width}-light.png`, import.meta.url)), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: fileURLToPath(new URL(`./evidence/files-compact-${width}-dark.png`, import.meta.url)), fullPage: true });
    expect(errors).toEqual([]);
    await disposePage(page);
  }, 120_000);
});
