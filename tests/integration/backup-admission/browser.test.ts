import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticatedContext, nextApplicationEvent, projectDocument, startEditorApplication, startEditorBrowser, waitForRenderedText } from "../../ui-editor/shared";
import type { EditorApplication, EditorBrowser } from "../../ui-editor/shared";
import { createProject, disposePage, mount, responseAfter, waitForDocument } from "../../ui-editor/tools/helpers";

describe("assembled browser admission regression", () => {
  const resources = new AsyncDisposableStack();
  let app: EditorApplication;
  let browser: EditorBrowser;
  beforeAll(async () => {
    try {
      app = resources.use(await startEditorApplication());
      browser = resources.use(await startEditorBrowser());
    } catch (error) { await resources.disposeAsync(); throw error; }
  }, 300000);
  afterAll(async () => {
    await resources.disposeAsync();
    console.info("ADMISSION_BROWSER_CLEANED", { root: app.dataDir, api: app.apiUrl.origin, web: app.url.origin });
  }, 30000);

  test.each([1440, 390])("keeps source editing authorized after binary upload at width %i", async width => {
    // Given the actual assembled application, authenticated browser and live source transport.
    await using actor = await authenticatedContext(browser, app, { viewport: { width, height: 900 } });
    const project = await createProject(actor, { name: `Admission browser ${width}`, origin: app.url.origin });
    const page = await actor.context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      const response = await actor.context.request.get(`/api/projects/${project.id}/files`, { params: { branch: "main" } });
      const files = editorValue(resultSchema(endpoints.filesList.output).parse(await response.json()));
      const source = files.find(file => file.path === "main.tex");
      if (!source) throw new Error("Real source file required");
      await mount(page, project.id);
      await waitForDocument(page, source.id);
      const bytes = Buffer.from([0, 255, 128, 10, 13, 75]);

      // When an actual binary upload triggers asynchronous tree/access refresh.
      const uploaded = await responseAfter(page, { path: `/api/projects/${project.id}/uploads`, method: "POST" }, () =>
        page.getByLabel("Upload files", { exact: true }).setInputFiles({ name: "admission.bin", mimeType: "application/octet-stream", buffer: bytes }));
      expect(uploaded.status()).toBe(endpoints.filesUpload.successStatus);
      await waitForRenderedText(page, "admission.bin");
      await waitForDocument(page, source.id);
      expect(await page.getByRole("treeitem", { name: /admission\.bin/ }).isDisabled()).toBe(false);

      // Then a subsequent real websocket edit still persists and receives its durable acknowledgment.
      const before = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: source.id });
      await page.getByLabel("Editor tool", { exact: true }).selectOption("symbols");
      using saved = nextApplicationEvent(app, event => event.topic === "document.saved" && event.aggregateId === project.id);
      await Promise.all([saved.promise, page.getByRole("button", { name: "Insert \\alpha", exact: true }).click()]);
      await waitForDocument(page, source.id);
      expect((await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: source.id })).text).toBe(`\\alpha${before.text}`);
      expect(await page.locator(".tools-harness").getAttribute("data-persistence")).toBe("saved");
      expect(errors).toEqual([]);
      await page.getByLabel("Editor tool", { exact: true }).selectOption("files");
      await waitForRenderedText(page, "admission.bin");
      await mkdir(join(import.meta.dir, "evidence"), { recursive: true });
      await page.screenshot({ path: join(import.meta.dir, "evidence", `upload-${width}.png`), fullPage: true });
    } finally { await disposePage(page); await page.close(); }
  }, 120000);
});
