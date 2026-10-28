import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access as accessPath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { fixtureIds } from "../../fixtures/foundation";
import { referenceProvider } from "../../adapters/references/provider";
import { authenticatedContext, nextApplicationEvent, projectDocument, startEditorBrowser, waitForRenderedText } from "../shared";
import type { EditorBrowser } from "../shared";
import { startAssemblyApplication } from "../assembly/application";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";
import { createInputFile, createProject, responseAfter } from "../tools/helpers";

const evidence = fileURLToPath(new URL("../../../docs/evidence/p10-library/", import.meta.url));
async function bibliography(page: Page, project: string, prepareInsertion = false) {
  await openSurface(page, { path: `/projects/${project}/edit`, selector: ".qe-main .cm-content" });
  if (prepareInsertion) {
    const ready = await surfaceSignal(page, ".qe-source-header:has(button:not(:disabled))");
    await ready.observed;
    await page.locator(".qe-main .cm-line").nth(2).click();
    await waitForRenderedText(page, "Ln 3, Col 1");
  }
  if (!await page.getByLabel("Editor tool", { exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Files", exact: true }).last().click();
  }
  const ready = await surfaceSignal(page, 'section[aria-label="Local Library"]');
  await page.getByLabel("Editor tool", { exact: true }).selectOption("bibliography");
  await ready.observed;
}
async function capture(page: Page, name: string, width: number) {
  if (await page.locator("dialog[open]").count()) {
    await page.locator("dialog[open]").last().evaluate(node => { node.scrollTop = 0; });
  }
  await page.locator(".editor-tools__body").evaluate(node => { node.scrollTop = 0; });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({ path: `${evidence}/${name}-${width}-${theme}.png`, fullPage: true });
  }
}

describe("P10 actual mounted native Library workflow", () => {
  const resources = new AsyncDisposableStack();
  let app: Awaited<ReturnType<typeof startAssemblyApplication>>;
  let browser: EditorBrowser;
  let provider: ReturnType<typeof referenceProvider>;
  beforeAll(async () => {
    try {
      expect(Bun.version).toBe("1.4.4");
      provider = resources.use(referenceProvider());
      app = resources.use(await startAssemblyApplication({ http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) }));
      browser = resources.use(await startEditorBrowser());
      await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
      const configured = await operator.context.request.put("/api/admin/providers/doi", {
        headers: { origin: app.url.origin, "x-csrf-token": operator.session.csrfToken, "if-match": '"0"' },
        data: { baseUrl: provider.origin, policy: defaultPolicy, expectedVersion: 0 },
      });
      expect(configured.status()).toBe(200);
      console.info("P10_OWNED", { root: app.dataDir, api: app.apiUrl.origin, web: app.url.origin, provider: provider.origin });
    } catch (error) { await resources.disposeAsync(); throw error; }
  }, 120_000);
  afterAll(async () => {
    await resources.disposeAsync();
    expect(await accessPath(app.dataDir).then(() => true, () => false)).toBe(false);
    for (const url of [app.apiUrl.origin, app.url.origin, provider.origin]) {
      expect(await fetch(url, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false)).toBe(false);
    }
    expect(browser.browser.isConnected()).toBe(false);
    console.info("P10_CLEANUP_COMPLETE", { rootAbsent: app.dataDir, listenersClosed: [app.apiUrl.origin, app.url.origin, provider.origin], browserClosed: true });
  }, 60_000);
  test.each([1440, 390])("forms, reviewed upload, DOI and rich-search insertion persist exact bytes at %i", async width => {
    await using actor = await authenticatedContext(browser, app, { email: width === 390 ? "mai@quire.local" : "kien@quire.local",
      viewport: { width, height: width === 390 ? 844 : 900 },
      ...(width === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
    const page = await actor.context.newPage();
    page.on("pageerror", error => console.error("P10_PAGE_ERROR", error.message));
    try {
    const project = await createProject(actor, { name: `P10 Library ${width}`, origin: app.url.origin });
    const mainScope = { projectId: project.id, branch: "main", fileId: project.settings.mainFileId };
    const original = await projectDocument(actor.context, mainScope);
    await bibliography(page, project.id, true);
    await page.getByRole("button", { name: "Add Library record", exact: true }).click();
    await page.getByLabel("Entry method", { exact: true }).selectOption("fields");
    const key = `native${width}`;
    await page.getByLabel("Citation key", { exact: true }).fill(key);
    await page.getByLabel("Entry type", { exact: true }).selectOption("online");
    await page.getByLabel("Title", { exact: true }).fill("Native & verified");
    await page.getByLabel("Author", { exact: true }).fill("Ada Lovelace and Grace Hopper");
    await page.getByLabel("Journal", { exact: true }).fill("Journal of Native Workflows");
    await page.getByLabel("Year", { exact: true }).fill("2026");
    await page.getByLabel("Date", { exact: true }).fill("2026-10-27");
    await page.getByText("More bibliographic fields", { exact: true }).click();
    await page.getByLabel("Publisher", { exact: true }).fill("Quire Press");
    await page.getByLabel("URL", { exact: true }).fill("https://example.org/native");
    await capture(page, "manual-form", width);
    await page.getByRole("button", { name: "Edit generated BibTeX", exact: true }).click();
    const raw = await page.getByLabel("BibTeX", { exact: true }).inputValue();
    expect(raw).toContain("publisher = {Quire Press}");
    expect(raw).toContain("title = {Native \\& verified}");
    const saved = await responseAfter(page, { path: "/api/me/library", method: "POST" }, () =>
      page.getByRole("button", { name: "Save record", exact: true }).click());
    const entry = editorValue(resultSchema(endpoints.libraryCreate.output).parse(await saved.json()));
    expect(entry.bibtex).toBe(raw);
    await waitForRenderedText(page, "Library record saved.");
    const library = page.locator('section[aria-label="Local Library"]');
    await library.getByLabel("Find Library records field", { exact: true }).selectOption("journal");
    await library.getByLabel("Find Library records", { exact: true }).fill("Native Workflows");
    expect(await library.locator("li").count()).toBe(1);
    // Zero targets creates references.bib; copying alone does not insert source.
    const copiedResponse = await responseAfter(page, { path: `/api/projects/${project.id}/citations`, method: "POST" }, () =>
      library.getByRole("button", { name: "Copy to project", exact: true }).click());
    const copied = editorValue(resultSchema(endpoints.citationCreate.output).parse(await copiedResponse.json()));
    await waitForRenderedText(page, `Copied ${key}`);
    expect(copied.path).toBe("references.bib");
    expect((await projectDocument(actor.context, mainScope)).text).toBe(original.text);
    expect((await projectDocument(actor.context, { ...mainScope, fileId: copied.id })).text).toBe(raw + "\n");
    // Import is reviewed and editable before committing, including multiple BibLaTeX records.
    await page.getByLabel("Import bibliography", { exact: true }).setInputFiles({
      name: "review.bib", mimeType: "text/plain", buffer: Buffer.from("@book{upload,title={Before review}}"),
    });
    const importedRaw = `@book{upload${width},title={Reviewed upload},author={Emmy Noether},year={2025},date={2025-04-02}}\n@article{second${width},title={Second upload},journaltitle={Native Journal},year=2024}`;
    await page.getByLabel("BibTeX", { exact: true }).fill(importedRaw);
    const importedResponse = await responseAfter(page, { path: "/api/me/library/import", method: "POST" }, () =>
      page.getByRole("button", { name: "Save record", exact: true }).click());
    const imported = editorValue(resultSchema(endpoints.libraryImport.output).parse(await importedResponse.json()));
    expect(imported.map(item => item.citationKey)).toEqual([`upload${width}`, `second${width}`]);
    await waitForRenderedText(page, "Imported 2 Library records.");
    await library.getByLabel("Find Library records", { exact: true }).fill("");
    // DOI goes through actual configured native provider parsing and persists a Library record.
    await page.getByLabel("DOI lookup", { exact: true }).fill("https://doi.org/10.1234/PROTOCOL");
    const doiResponse = await responseAfter(page, { path: "/api/me/library/doi", method: "POST" }, () =>
      page.getByRole("button", { name: "Look up DOI", exact: true }).click());
    const doi = editorValue(resultSchema(endpoints.libraryDoi.output).parse(await doiResponse.json()));
    expect(doi.origin).toBe("doi");
    expect(doi.publication?.authors).toEqual(["Grace Hopper"]);
    expect(provider.state.requests.some(request => request.path === "/works/10.1234%2Fprotocol")).toBe(true);
    await waitForRenderedText(page, `DOI record ${doi.citationKey}`);
    await library.getByLabel("Find Library records field", { exact: true }).selectOption("key");
    await library.getByLabel("Find Library records", { exact: true }).fill(doi.citationKey);
    const sole = await responseAfter(page, { path: `/api/projects/${project.id}/citations`, method: "POST" }, () =>
      library.getByRole("button", { name: "Copy to project", exact: true }).click());
    expect(editorValue(resultSchema(endpoints.citationCreate.output).parse(await sole.json())).id).toBe(copied.id);
    await waitForRenderedText(page, `Copied ${doi.citationKey}`);
    const secondFile = await createInputFile(actor, { projectId: project.id, origin: app.url.origin, path: "other.bib", text: "" });
    await bibliography(page, project.id, true);
    await library.getByLabel("Find Library records field", { exact: true }).selectOption("key");
    await library.getByLabel("Find Library records", { exact: true }).fill(`upload${width}`);
    expect(await library.getByRole("button", { name: "Cite in project", exact: true }).isDisabled()).toBe(true);
    await page.getByLabel("Bibliography target", { exact: true }).selectOption(secondFile.id);
    // Multiple targets: citation copies only to the selected file, then inserts using source authoring.
    using inserted = nextApplicationEvent(app, event => event.topic === "document.saved"
      && event.aggregateId === project.id && event.payload.resourceId === project.settings.mainFileId);
    const citationResponse = await responseAfter(page, { path: `/api/projects/${project.id}/citations`, method: "POST" }, () =>
      library.getByRole("button", { name: "Cite in project", exact: true }).click());
    expect(editorValue(resultSchema(endpoints.citationCreate.output).parse(await citationResponse.json())).id).toBe(secondFile.id);
    await inserted.promise;
    await waitForRenderedText(page, `Inserted citation upload${width}`);
    const committed = await projectDocument(actor.context, mainScope);
    const at = original.text.indexOf("\n\n") + 1;
    expect(committed.text).toBe(original.text.slice(0, at) + `\\cite{upload${width}}` + original.text.slice(at));
    expect(committed.text.split(`\\cite{upload${width}}`).length).toBe(2);
    expect((await projectDocument(actor.context, { ...mainScope, fileId: secondFile.id })).text).toBe(imported[0]?.bibtex + "\n");
    const projectSearch = page.getByLabel("Find citation key", { exact: true });
    for (const [field, query] of [["author", "Emmy"], ["title", "Reviewed"], ["year", "2025"], ["date", "04-02"], ["key", `upload${width}`]] as const) {
      await page.getByLabel("Find citation key field", { exact: true }).selectOption(field);
      await projectSearch.fill(query);
      expect(await page.locator('section[aria-label="Bibliography"] > ul > li').count()).toBe(1);
    }
    await capture(page, "search-insert", width);
    await bibliography(page, project.id);
    expect((await projectDocument(actor.context, mainScope)).text).toBe(committed.text);
    expect((await projectDocument(actor.context, { ...mainScope, fileId: secondFile.id })).text).toBe(imported[0]?.bibtex + "\n");
    console.info("P10_ROUNDTRIP", { width, project: project.id, zeroAndSoleTarget: copied.id, multipleTarget: secondFile.id,
      source: committed.text, copiedBibtex: imported[0]?.bibtex, provider: "controlled Crossref contract, not live success" });
    } catch (error) {
      console.error("P10_FAILURE_DOM", await page.locator("body").innerText());
      await page.screenshot({ path: `${evidence}/failure-${width}.png`, fullPage: true });
      throw error;
    } finally { await page.close(); }
  }, 120_000);
  test("linked references.bib stays readable and cannot be selected or overwritten by Library copying", async () => {
    await using actor = await authenticatedContext(browser, app);
    const project = await createProject(actor, { name: "P10 linked bibliography", origin: app.url.origin });
    const scope = { projectId: project.id, branch: "main" };
    const accessResponse = await actor.context.request.get(`/api/projects/${project.id}/effective-access`, { params: { branch: "main" } });
    const access = editorValue(resultSchema(endpoints.projectAccess.output).parse(await accessResponse.json()));
    const linkedResponse = await actor.context.request.post(`/api/projects/${project.id}/links`, {
      headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
      data: { scope, path: "references.bib", kind: "url", url: `${provider.origin}/source.bib`, expectedVersion: access.branchRevision },
    });
    const linked = editorValue(resultSchema(endpoints.linkCreate.output).parse(await linkedResponse.json()));
    const recordResponse = await actor.context.request.post("/api/me/library", {
      headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
      data: { bibtex: "@article{p10_link_boundary,title={Boundary}}", origin: "manual" },
    });
    expect(recordResponse.status()).toBe(200);
    const page = await actor.context.newPage();
    await bibliography(page, project.id);
    await waitForRenderedText(page, "url_source");
    await waitForRenderedText(page, "references.bib is not an editable bibliography.");
    expect(await page.getByLabel("Bibliography target", { exact: true }).locator("option").count()).toBe(1);
    await page.getByLabel("Find Library records field", { exact: true }).selectOption("key");
    await page.getByLabel("Find Library records", { exact: true }).fill("p10_link_boundary");
    expect(await page.getByRole("button", { name: "Copy to project", exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Cite in project", exact: true }).isDisabled()).toBe(true);
    const publication = { provider: "local", providerId: "p10-boundary", title: "Boundary", authors: [], year: null, doi: null, url: null,
      bibtex: "@article{p10_boundary,title={Boundary}}" };
    const freshAccessResponse = await actor.context.request.get(`/api/projects/${project.id}/effective-access`, { params: { branch: "main" } });
    const fresh = editorValue(resultSchema(endpoints.projectAccess.output).parse(await freshAccessResponse.json()));
    for (const targetFileId of [undefined, linked.id]) {
      const denied = await actor.context.request.post(`/api/projects/${project.id}/citations`, {
        headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
        data: { scope, publication, command: "cite", expectedVersion: fresh.branchRevision, ...(targetFileId ? { targetFileId } : {}) },
      });
      expect(denied.status()).toBe(targetFileId ? 403 : 409);
    }
    const bytes = await actor.context.request.get(`/api/projects/${project.id}/files/${linked.id}/content`, { params: { branch: "main" } });
    expect(await bytes.text()).toBe("@misc{url_source,title={Protocol paper}}\n");
    await page.close();
  }, 90_000);
  test("Viewer cannot copy or cite, another actor cannot edit Library, and invalid DOI is visible", async () => {
    await using viewer = await authenticatedContext(browser, app, { email: "alex@quire.local" });
    const page = await viewer.context.newPage();
    await bibliography(page, fixtureIds.project);
    await page.getByRole("button", { name: "Add Library record", exact: true }).click();
    const bibtex = "@article{viewer_local,title={Viewer account Library},journal={Role Journal},date={2026-10-27}}";
    await page.getByLabel("BibTeX", { exact: true }).fill(bibtex);
    const created = await responseAfter(page, { path: "/api/me/library", method: "POST" }, () =>
      page.getByRole("button", { name: "Save record", exact: true }).click());
    const entry = editorValue(resultSchema(endpoints.libraryCreate.output).parse(await created.json()));
    await waitForRenderedText(page, "Library record saved.");
    expect(await page.getByRole("button", { name: "Copy to project", exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Cite in project", exact: true }).isDisabled()).toBe(true);
    const denied = await viewer.context.request.post(`/api/projects/${fixtureIds.project}/citations`, {
      headers: { origin: app.url.origin, "x-csrf-token": viewer.session.csrfToken, "idempotency-key": crypto.randomUUID() },
      data: { scope: { projectId: fixtureIds.project, branch: "main" }, expectedVersion: 0, command: "cite",
        publication: { provider: "local", providerId: entry.id, title: "Viewer", authors: [], year: null, doi: null, url: null, bibtex } },
    });
    expect(denied.status()).toBe(403);
    await using owner = await authenticatedContext(browser, app);
    const notOwned = await owner.context.request.patch(`/api/me/library/${entry.id}`, {
      headers: { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken },
      data: { expectedVersion: entry.version, bibtex },
    });
    expect(notOwned.status()).toBe(404);
    await page.getByRole("button", { name: "Edit record", exact: true }).click();
    const concurrent = await viewer.context.request.patch(`/api/me/library/${entry.id}`, {
      headers: { origin: app.url.origin, "x-csrf-token": viewer.session.csrfToken },
      data: { expectedVersion: entry.version, bibtex: bibtex.replace("Viewer account", "Concurrent account") },
    });
    expect(concurrent.status()).toBe(200);
    const attempted = bibtex.replace("Viewer account", "Unsaved account");
    await page.getByLabel("BibTeX", { exact: true }).fill(attempted);
    const conflict = await responseAfter(page, { path: `/api/me/library/${entry.id}`, method: "PATCH" }, () =>
      page.getByRole("button", { name: "Save record", exact: true }).click());
    expect(conflict.status()).toBe(409);
    expect(await page.getByLabel("BibTeX", { exact: true }).inputValue()).toBe(attempted);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByLabel("DOI lookup", { exact: true }).fill("not-a-doi");
    const invalid = await responseAfter(page, { path: "/api/me/library/doi", method: "POST" }, () =>
      page.getByRole("button", { name: "Look up DOI", exact: true }).click());
    expect(invalid.status()).toBe(400);
    const failure = resultSchema(endpoints.libraryDoi.output).parse(await invalid.json());
    if (!("error" in failure)) throw new TypeError("Expected DOI validation error");
    await waitForRenderedText(page, failure.error.message);
    expect(await page.locator('[role="alert"]').count()).toBeGreaterThan(0);
    provider.state.status = 503;
    try {
      await page.getByLabel("DOI lookup", { exact: true }).fill("10.1234/protocol");
      const unavailable = await responseAfter(page, { path: "/api/me/library/doi", method: "POST" }, () =>
        page.getByRole("button", { name: "Look up DOI", exact: true }).click());
      expect(unavailable.status()).toBe(502);
      await waitForRenderedText(page, "Provider returned HTTP 503");
    } finally { provider.state.status = 200; }
    await page.close();
  }, 90_000);
});
