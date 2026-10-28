import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticatedContext, projectDocument, startEditorApplication, startEditorBrowser, waitForRenderedText } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { createInputFile, createProject, disposePage, mount, responseAfter, waitForDocument } from "./helpers";

describe("real tool insertion, targets and linked sources", () => {
  const resources = new AsyncDisposableStack();
  let app: EditorApplication;
  let browser: EditorBrowser;
  beforeAll(async () => {
    try { app = resources.use(await startEditorApplication()); browser = resources.use(await startEditorBrowser()); }
    catch (error) { await resources.disposeAsync(); throw error; }
  }, 120_000);
  afterAll(async () => {
    await resources.disposeAsync();
    console.info("TOOLS_FEATURES_CLOSED", { api: app.apiUrl.origin, web: app.url.origin, root: app.dataDir });
  }, 30_000);
  test("persists symbol commands and package requirements when inserted through the active source handle", async () => {
    // Given an editable main source using the actual transport.
    await using actor = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
    const project = await createProject(actor, { name: "Symbol insertion", origin: app.url.origin });
    const page = await actor.context.newPage();
    await mount(page, project.id);
    const before = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: project.settings.mainFileId });
    await page.getByLabel("Source test consumer", { exact: true }).focus();
    await page.getByLabel("Source test consumer", { exact: true }).press("Control+End");
    await page.getByLabel("Editor tool", { exact: true }).selectOption("symbols");
    await page.getByRole("button", { name: "Misc", exact: true }).click();
    // When a symbol requiring AMS fonts is inserted and flushed by a real search.
    await page.getByRole("button", { name: "Insert \\mathbb{R} with amssymb", exact: true }).click();
    await waitForRenderedText(page, "Inserted \\mathbb{R}");
    await page.screenshot({ path: fileURLToPath(new URL("./evidence/symbols-1440-light.png", import.meta.url)), fullPage: true });
    await page.getByLabel("Editor tool", { exact: true }).selectOption("search");
    await page.getByLabel("Find in project source").fill("mathbb");
    await responseAfter(page, { path: `/api/projects/${project.id}/search`, method: "GET" }, () => page.getByRole("button", { name: "Search", exact: true }).click());
    // Then durable source contains the command and exactly one required package.
    const after = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: project.settings.mainFileId });
    expect(after.text).toContain("\\mathbb{R}");
    expect(after.text.match(/\\usepackage\{amssymb\}/g)?.length).toBe(1);
    expect(after.text.replace("\\usepackage{amssymb}\n", "").replace("\\mathbb{R}", "")).toBe(before.text);
    await disposePage(page);
  }, 60_000);
  test("requires explicit target selection when multiple editable bibliographies exist", async () => {
    // Given two native bibliography files and a Library import through the real UI.
    await using actor = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
    const project = await createProject(actor, { name: "Deterministic bibliography", origin: app.url.origin });
    const first = await createInputFile(actor, { projectId: project.id, origin: app.url.origin, path: "first.bib", text: "@article{first,title={First}}" });
    const second = await createInputFile(actor, { projectId: project.id, origin: app.url.origin, path: "second.bib", text: "@article{second,title={Second}}" });
    const page = await actor.context.newPage();
    await mount(page, project.id);
    await page.getByLabel("Editor tool", { exact: true }).selectOption("bibliography");
    const record = "@book{targetproof,title={Imported proof},author={Researcher},year={2026}}";
    await page.getByLabel("Import bibliography", { exact: true }).setInputFiles({
      name: "proof.bib", mimeType: "text/plain", buffer: Buffer.from(record),
    });
    const review = page.getByRole("dialog", { name: "Review .bib import", exact: true });
    expect(await review.getByLabel("BibTeX", { exact: true }).inputValue()).toBe(record);
    await responseAfter(page, { path: "/api/me/library/import", method: "POST" }, () =>
      review.getByRole("button", { name: "Save record", exact: true }).click());
    await waitForRenderedText(page, "targetproof");
    const importedRecord = page.getByRole("region", { name: "Local Library", exact: true })
      .getByRole("listitem").filter({ hasText: "targetproof" });
    expect(await importedRecord.getByRole("button", { name: "Copy to project", exact: true }).isDisabled()).toBe(true);
    // When the user explicitly chooses the second target and copies.
    await page.getByLabel("Bibliography target", { exact: true }).selectOption(second.id);
    await responseAfter(page, { path: `/api/projects/${project.id}/citations`, method: "POST" }, () =>
      importedRecord.getByRole("button", { name: "Copy to project", exact: true }).click());
    await waitForRenderedText(page, "Copied targetproof to second.bib");
    // Then only the selected file receives the independent copy.
    const firstSource = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: first.id });
    const secondSource = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: second.id });
    expect(firstSource.text).toBe("@article{first,title={First}}");
    expect(secondSource.text).toContain(record);
    await disposePage(page);
  }, 60_000);
  test("opens and refreshes native read-only project links without permitting source insertion", async () => {
    // Given separate real source and destination projects.
    await using actor = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
    const source = await createProject(actor, { name: "Link source", origin: app.url.origin });
    const destination = await createProject(actor, { name: "Link destination", origin: app.url.origin });
    // This case must also work when run without the preceding import case.
    const recordResponse = await actor.context.request.post("/api/me/library", {
      headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
      data: { origin: "manual", bibtex: "@book{readonlylibraryproof,title={Read-only target guard}}" },
    });
    const record = editorValue(resultSchema(endpoints.libraryCreate.output).parse(await recordResponse.json()));
    const sourceBib = await createInputFile(actor, { projectId: source.id, origin: app.url.origin,
      path: "linked-source.bib", text: "@article{readonlyproof,title={Linked bibliography}}" });
    const accessResponse = await actor.context.request.get(`/api/projects/${destination.id}/effective-access`, { params: { branch: "main" } });
    const access = editorValue(resultSchema(endpoints.projectAccess.output).parse(await accessResponse.json()));
    const bibliographyLink = await actor.context.request.post(`/api/projects/${destination.id}/links`, {
      headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
      data: { scope: { projectId: destination.id, branch: "main" }, path: "references.bib", kind: "project",
        sourceProjectId: source.id, sourceFileId: sourceBib.id, expectedVersion: access.branchRevision },
    });
    editorValue(resultSchema(endpoints.linkCreate.output).parse(await bibliographyLink.json()));
    const original = await projectDocument(actor.context, { projectId: source.id, branch: "main", fileId: source.settings.mainFileId });
    const page = await actor.context.newPage();
    await mount(page, destination.id);
    await page.getByRole("button", { name: "Link file", exact: true }).click();
    await page.getByLabel("Project path").fill("linked.tex");
    await page.getByLabel("Link source", { exact: true }).selectOption("project");
    await page.getByLabel("Source project ID", { exact: true }).fill(source.id);
    await page.getByLabel("Source file ID", { exact: true }).fill(source.settings.mainFileId);
    const response = await responseAfter(page, { path: `/api/projects/${destination.id}/links`, method: "POST" }, () =>
      page.getByRole("button", { name: "Create", exact: true }).click());
    const linked = editorValue(resultSchema(endpoints.linkCreate.output).parse(await response.json()));
    await waitForRenderedText(page, "linked.tex");
    // When the linked source is opened and manually refreshed.
    await page.getByRole("treeitem", { name: /linked\.tex/ }).click();
    await waitForDocument(page, linked.id);
    expect(await page.getByLabel("Source test consumer", { exact: true }).getAttribute("readonly")).not.toBeNull();
    await responseAfter(page, { path: `/api/projects/${destination.id}/links/${linked.id}/refresh`, method: "POST" }, () =>
      page.getByRole("button", { name: "Refresh linked file", exact: true }).click());
    // Then link bytes match the authorized source and insertion remains disabled.
    const copied = await actor.context.request.get(`/api/projects/${destination.id}/files/${linked.id}/content`, { params: { branch: "main" } });
    expect(new TextDecoder().decode(await copied.body())).toBe(original.text);
    await page.getByLabel("Editor tool", { exact: true }).selectOption("symbols");
    expect(await page.getByRole("button", { name: "Insert \\alpha", exact: true }).isDisabled()).toBe(true);
    await page.getByLabel("Editor tool", { exact: true }).selectOption("bibliography");
    await waitForRenderedText(page, "readonlyproof");
    await waitForRenderedText(page, "Create a new .bib file in Files before copying");
    const ownRecord = page.getByRole("region", { name: "Local Library", exact: true })
      .getByRole("listitem").filter({ hasText: record.citationKey });
    expect(await ownRecord.getByRole("button", { name: "Copy to project", exact: true }).isDisabled()).toBe(true);
    await disposePage(page);
  }, 60_000);
  test("inserts a real uploaded figure with caption, label, width and graphicx", async () => {
    // Given an actual uploaded PNG and the main document's transport.
    await using actor = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
    const project = await createProject(actor, { name: "Figure insertion", origin: app.url.origin });
    const page = await actor.context.newPage();
    await mount(page, project.id);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFioAAAAASUVORK5CYII=", "base64");
    const upload = await responseAfter(page, { path: `/api/projects/${project.id}/uploads`, method: "POST" }, () =>
      page.getByLabel("Upload files", { exact: true }).setInputFiles({ name: "figure.png", mimeType: "image/png", buffer: png }));
    const image = editorValue(resultSchema(endpoints.filesUpload.output).parse(await upload.json()))[0];
    if (!image) throw new TypeError("Image upload returned no file");
    const source = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: project.settings.mainFileId });
    await page.getByLabel("Source test consumer", { exact: true }).evaluate((node, offset) => {
      if (!(node instanceof HTMLTextAreaElement)) throw new TypeError("Source input missing");
      node.focus(); node.setSelectionRange(offset, offset);
      document.dispatchEvent(new Event("selectionchange"));
    }, source.text.indexOf("\\end{document}"));
    await page.getByLabel("Editor tool", { exact: true }).selectOption("figure");
    await page.getByLabel("Project image", { exact: true }).selectOption(image.path);
    await page.getByLabel("Caption (LaTeX)", { exact: true }).fill("Native figure proof");
    await page.getByLabel("Label", { exact: true }).fill("fig:proof");
    await page.getByLabel("Width (fraction of line)", { exact: true }).fill("0.75");
    // When the figure is inserted and persisted through a subsequent project search.
    await page.getByRole("button", { name: "Insert figure", exact: true }).click();
    await waitForRenderedText(page, "Figure inserted.");
    await page.getByLabel("Editor tool", { exact: true }).selectOption("search");
    await page.getByLabel("Find in project source").fill("Native figure proof");
    await responseAfter(page, { path: `/api/projects/${project.id}/search`, method: "GET" }, () =>
      page.getByRole("button", { name: "Search", exact: true }).click());
    // Then source and uploaded binary bytes are genuinely persisted.
    const saved = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: project.settings.mainFileId });
    expect(saved.text).toContain("\\usepackage{graphicx}");
    expect(saved.text).toContain("\\includegraphics[width=0.75\\linewidth]{figure.png}");
    expect(saved.text).toContain("\\caption{Native figure proof}\n\\label{fig:proof}");
    const binary = await actor.context.request.get(`/api/projects/${project.id}/files/${image.id}/content`, { params: { branch: "main" } });
    expect(new Uint8Array(await binary.body())).toEqual(new Uint8Array(png));
    await disposePage(page);
  }, 60_000);
});
