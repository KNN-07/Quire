import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { mkdir, readFile } from "node:fs/promises";
import { endpoints, IdSchema, resultSchema } from "@quire/contracts";
import type { Environment } from "@quire/contracts";
import { manifestFromProbe } from "../../../services/operations/environments/probe";
import { ManifestInputSchema, ProbeReportSchema, profileHelpers } from "../../../services/operations/environments/model";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { authenticatedContext, projectDocument, startEditorApplication, startEditorBrowser, waitForRenderedText } from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { createInputFile, createProject, disposePage, mount, responseAfter, toolScenario } from "./helpers";

const evidence = process.env["QUIRE_CATALOG_EVIDENCE"] ?? fileURLToPath(new URL("./evidence/", import.meta.url));

describe("real editor bibliography and settings", () => {
  const resources = new AsyncDisposableStack();
  let app: EditorApplication;
  let browser: EditorBrowser;
  let rnwEnvironments: { readonly knitr: Environment; readonly texOnly: Environment } | null = null;
  beforeAll(async () => {
    try {
      await mkdir(evidence, { recursive: true });
      app = resources.use(await startEditorApplication()); browser = resources.use(await startEditorBrowser());
    }
    catch (error) { await resources.disposeAsync(); throw error; }
  }, 120_000);
  afterAll(async () => {
    await resources.disposeAsync();
    console.info("TOOLS_CATALOG_CLOSED", { api: app.apiUrl.origin, web: app.url.origin, root: app.dataDir });
  }, 30_000);
  test.each([1440, 390])("copies independent bibliography bytes and persists settings at width %i", width => toolScenario(async () => {
    // Given a blank native project and real browser.
    await using actor = await authenticatedContext(browser, app, { viewport: { width, height: width === 390 ? 844 : 900 },
      ...(width === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
    const project = await createProject(actor, { name: `Tools catalog ${width}`, origin: app.url.origin });
    const page = await actor.context.newPage();
    await mount(page, project.id);
    await page.getByLabel("Editor tool", { exact: true }).selectOption("bibliography");
    await waitForRenderedText(page, "Add Library record");
    await page.getByRole("button", { name: "Add Library record", exact: true }).click();
    const key = `toolproof${width}`;
    const bibtex = `@article{${key}, title={Independent original}, author={Researcher}, year={2026}}`;
    await page.getByLabel("BibTeX", { exact: true }).fill(bibtex);
    const libraryResponse = await responseAfter(page, { path: "/api/me/library", method: "POST" }, () =>
      page.getByRole("button", { name: "Save record", exact: true }).click());
    const library = editorValue(resultSchema(endpoints.libraryCreate.output).parse(await libraryResponse.json()));
    await waitForRenderedText(page, key);
    // When a local record is copied into a zero-bibliography project.
    const copiedResponse = await responseAfter(page, { path: `/api/projects/${project.id}/citations`, method: "POST" }, () =>
      page.getByRole("button", { name: "Copy to project", exact: true }).last().click());
    const copied = editorValue(resultSchema(endpoints.citationCreate.output).parse(await copiedResponse.json()));
    await waitForRenderedText(page, `Copied ${key}`);
    const before = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: copied.id });
    expect(before.text).toContain(bibtex);
    expect(copied.path).toBe("references.bib");
    console.info("TOOLS_DOCUMENT_AFTER_CITATION", await page.locator(".tools-harness").getAttribute("data-document-state"),
      await page.getByRole("complementary", { name: "Editor tools", exact: true }).innerText());
    await page.getByRole("button", { name: "Insert citation", exact: true }).click();
    await waitForRenderedText(page, `Inserted citation ${key}`);
    await page.getByRole("button", { name: "Edit record", exact: true }).last().click();
    await page.getByLabel("BibTeX", { exact: true }).fill(bibtex.replace("Independent original", "Changed Library only"));
    await responseAfter(page, { path: `/api/me/library/${library.id}`, method: "PATCH" }, () =>
      page.getByRole("button", { name: "Save record", exact: true }).click());
    await waitForRenderedText(page, "Library record saved.");
    // Then editing the Library leaves copied project bytes unchanged.
    const after = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: copied.id });
    expect(after.text).toBe(before.text);
    await page.screenshot({ path: `${evidence}/bibliography-${width}-light.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: `${evidence}/bibliography-${width}-dark.png`, fullPage: true });
    await page.getByLabel("Editor tool", { exact: true }).selectOption("settings");
    await waitForRenderedText(page, "Installed");
    await page.getByLabel("Draft mode (skip figure rendering)").check();
    const changedResponse = await responseAfter(page, { path: `/api/projects/${project.id}`, method: "PATCH" }, () =>
      page.getByRole("button", { name: "Save project settings" }).click());
    const changed = editorValue(resultSchema(endpoints.projectPatch.output).parse(await changedResponse.json()));
    await waitForRenderedText(page, "Project settings saved.");
    expect(changed.settings.draft).toBe(true);
    const source = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: project.settings.mainFileId });
    expect(source.text).toContain(`\\cite{${key}}`);
    await page.screenshot({ path: fileURLToPath(new URL(`./evidence/settings-${width}-dark.png`, import.meta.url)), fullPage: true });
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({ path: fileURLToPath(new URL(`./evidence/settings-${width}-light.png`, import.meta.url)), fullPage: true });
    await page.getByLabel("Editor tool", { exact: true }).selectOption("preferences");
    await waitForRenderedText(page, "Save editor preferences");
    await page.getByLabel("Theme", { exact: true }).selectOption("system");
    await page.getByLabel("Spelling dictionary", { exact: true }).selectOption("vi");
    await page.getByLabel("Check spelling", { exact: true }).uncheck();
    await page.getByLabel("Custom dictionary words", { exact: true }).fill("Quire\nLatentDynamics");
    const preferenceResponse = await responseAfter(page, { path: "/api/me/preferences", method: "PATCH" }, () =>
      page.getByRole("button", { name: "Save editor preferences" }).click());
    const preferences = editorValue(resultSchema(endpoints.preferencesPatch.output).parse(await preferenceResponse.json()));
    await waitForRenderedText(page, "Editor preferences saved.");
    expect(preferences.dictionary).toBe("vi");
    expect(preferences.spellCheck).toBe(false);
    expect(preferences.customWords).toEqual(["Quire", "LatentDynamics"]);
    expect(await page.getByLabel("Applied preferences", { exact: true }).textContent()).toBe("system/vi/false");
    await page.getByLabel("Interface language", { exact: true }).selectOption("zh");
    const profileResponse = await responseAfter(page, { path: "/api/me", method: "PATCH" }, () =>
      page.getByRole("button", { name: "Save interface language" }).click());
    const profile = editorValue(resultSchema(endpoints.profilePatch.output).parse(await profileResponse.json()));
    await waitForRenderedText(page, "Interface language saved.");
    expect(profile.interfaceLanguage).toBe("zh");
    const reopenedProjectResponse = await actor.context.request.get(`/api/projects/${project.id}`, { params: { branch: "main" } });
    const reopenedProject = editorValue(resultSchema(endpoints.projectGet.output).parse(await reopenedProjectResponse.json()));
    expect(reopenedProject.settings.draft).toBe(true);
    await disposePage(page);
    await mount(page, project.id);
    const reopenSource = await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: copied.id });
    expect(reopenSource.text).toBe(before.text);
    await disposePage(page);
  }), 120_000);
  test.each([1440, 390])("selects and reloads exact main.Rnw only for a chosen Docker knitr environment at width %i", width => toolScenario(async () => {
    // Given real operator registration: availability is re-probed, not fabricated.
    if (!rnwEnvironments) {
      await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
      const report = ProbeReportSchema.parse(JSON.parse(await readFile(new URL("../../../docs/evidence/p2o-environments/knitr-report.json", import.meta.url), "utf8")));
      const manifest = ManifestInputSchema.parse(manifestFromProbe({ id: crypto.randomUUID(), label: "Tools knitr selector", report }));
      const register = async (requested: ReturnType<typeof ManifestInputSchema.parse>) => {
        const response = await operator.context.request.post("/api/admin/environments", {
          headers: { origin: app.url.origin, "x-csrf-token": operator.session.csrfToken, "idempotency-key": crypto.randomUUID() },
          data: { manifest: requested }, timeout: 180_000,
        });
        return editorValue(resultSchema(endpoints.environmentCreate.output).parse(await response.json()));
      };
      rnwEnvironments = { knitr: await register(manifest), texOnly: await register({
        ...manifest, id: IdSchema.parse(crypto.randomUUID()), label: "Tools Docker without knitr", helpers: profileHelpers.default,
      }) };
    }
    await using actor = await authenticatedContext(browser, app, { viewport: { width, height: width === 390 ? 844 : 900 },
      ...(width === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
    const project = await createProject(actor, { name: `Rnw selector ${width}`, origin: app.url.origin });
    const text = String.raw`\documentclass{article}
\begin{document}Rnw selector proof.\end{document}`;
    const rnw = await createInputFile(actor, { projectId: project.id, origin: app.url.origin, path: "main.Rnw", text });
    await createInputFile(actor, { projectId: project.id, origin: app.url.origin, path: "other.Rnw", text });
    await createInputFile(actor, { projectId: project.id, origin: app.url.origin, path: "nested/main.Rnw", text });
    expect(rnw.editable).toBe(true);
    const page = await actor.context.newPage();
    await mount(page, project.id);
    await page.getByLabel("Editor tool", { exact: true }).selectOption("settings");
    await waitForRenderedText(page, "Installed");
    const main = page.getByLabel("Main document", { exact: true });
    expect(await main.getByRole("option", { name: "main.Rnw", exact: true }).count()).toBe(0);
    await page.getByLabel("TeX environment", { exact: true }).selectOption(rnwEnvironments.texOnly.id);
    expect(await main.getByRole("option", { name: "main.Rnw", exact: true }).count()).toBe(0);
    // When the actual knitr environment is chosen, only the exact root path is offered.
    await page.getByLabel("TeX environment", { exact: true }).selectOption(rnwEnvironments.knitr.id);
    expect(await main.getByRole("option", { name: "main.Rnw", exact: true }).count()).toBe(1);
    expect(await main.getByRole("option", { name: /other\.Rnw|nested\/main\.Rnw/ }).count()).toBe(0);
    await main.selectOption(rnw.id);
    const saved = await responseAfter(page, { path: `/api/projects/${project.id}`, method: "PATCH" }, () =>
      page.getByRole("button", { name: "Save project settings" }).click());
    const persisted = editorValue(resultSchema(endpoints.projectPatch.output).parse(await saved.json()));
    expect(persisted.settings.mainFileId).toBe(rnw.id);
    expect(persisted.settings.environmentId).toBe(rnwEnvironments.knitr.id);
    await waitForRenderedText(page, "Project settings saved.");
    await page.screenshot({ path: fileURLToPath(new URL(`./evidence/settings-rnw-${width}-light.png`, import.meta.url)), fullPage: true });
    await disposePage(page);
    // Then a fresh workspace and editable source reopen the persisted main/environment pair.
    await mount(page, project.id);
    await page.getByLabel("Editor tool", { exact: true }).selectOption("settings");
    await waitForRenderedText(page, "Installed");
    expect(await main.inputValue()).toBe(rnw.id);
    expect(await page.getByLabel("TeX environment", { exact: true }).inputValue()).toBe(rnwEnvironments.knitr.id);
    expect((await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: rnw.id })).text).toBe(text);
    await page.getByLabel("TeX environment", { exact: true }).selectOption(rnwEnvironments.texOnly.id);
    expect(await page.getByRole("button", { name: "Save project settings" }).isDisabled()).toBe(true);
    await disposePage(page);
  }), 300_000);
});
