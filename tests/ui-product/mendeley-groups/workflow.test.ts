import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints, FileEntrySchema, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { GrantStore, SafeHttpClient } from "../../../services/adapters/shared";
import { fixtureIds } from "../../fixtures/foundation";
import { mendeleyGroupId, mendeleyGroupProvider } from "../../adapters/references/mendeley-provider";
import { mendeleyToken } from "../../adapters/references/provider";
import { startAssemblyApplication } from "../../ui-editor/assembly/application";
import { openSurface, surfaceSignal } from "../../ui-editor/assembly/actual-browser";
import { authenticateApi, authenticatedContext, nextApplicationEvent, projectDocument, startEditorBrowser, waitForRenderedText } from "../../ui-editor/shared";
import { createInputFile, createProject, responseAfter } from "../../ui-editor/tools/helpers";
import { previewBoundaries } from "./preview-boundaries";

test("native Mendeley group selection creates a durable read-only bibliography and refreshes the original group after reload", async () => {
  const evidence = resolve(`docs/evidence/p50-mendeley-groups/${crypto.randomUUID()}`);
  await mkdir(evidence, { recursive: true });
  const resources = new AsyncDisposableStack();
  const errors: string[] = [];
  const provider = resources.use(mendeleyGroupProvider());
  const app = resources.use(await startAssemblyApplication({
    http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }),
  }));
  const browser = resources.use(await startEditorBrowser());
  const owned = { data: app.dataDir, web: app.url.origin, api: app.apiUrl.origin, provider: provider.origin };
  console.info("P50_OWNED", { evidence, ...owned });
  try {
    const operator = await authenticateApi(app, "operator@quire.local");
    const configured = await operator.http.put("api/admin/providers/mendeley", { headers: { "if-match": '"0"' },
      json: { baseUrl: provider.origin, model: "registered-fixture", secret: "registered-fixture-secret",
        policy: defaultPolicy, expectedVersion: 0 } });
    expect(configured.status).toBe(200);
    const grant = await app.application.runtime.uow.run(tx =>
      new GrantStore({ ...app.application.runtime, routes: app.application.runtime.routes.forLane("X") }).create({
        actorId: fixtureIds.kien, provider: "mendeley", label: "P50 owned Mendeley fixture",
        tokens: { accessToken: mendeleyToken, refreshToken: null, tokenType: "Bearer", scopes: ["all"], expiresAt: null },
      }, tx));
    await using actor = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
    const page = await actor.context.newPage();
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    const project = await createProject(actor, { name: "P50 Mendeley groups", origin: app.url.origin });
    const target = await createInputFile(actor, { projectId: project.id, origin: app.url.origin,
      path: "editable-copy.bib", text: "" });
    async function bibliography() {
      await openSurface(page, { path: `/projects/${project.id}/edit`, selector: ".qe-main .cm-content" });
      if (!await page.getByLabel("Editor tool", { exact: true }).isVisible()) {
        await page.getByRole("button", { name: "Files", exact: true }).last().click();
      }
      const ready = await surfaceSignal(page, 'section[aria-label="Mendeley bibliography"]');
      await page.getByLabel("Editor tool", { exact: true }).selectOption("bibliography");
      await ready.observed;
      await waitForRenderedText(page, "P50 owned Mendeley fixture");
    }
    await bibliography();
    const panel = page.getByRole("region", { name: "Mendeley bibliography", exact: true });
    const load = await responseAfter(page, { path: `/api/connections/${grant.id}/actions`, method: "POST" }, () =>
      panel.getByRole("button", { name: "Load Mendeley libraries", exact: true }).click());
    expect(load.status()).toBe(202);
    await waitForRenderedText(page, "Topology reading group");
    await panel.getByLabel("Mendeley library", { exact: true }).selectOption(`${provider.origin}/groups/v2/${mendeleyGroupId}`);
    await panel.getByLabel("Mendeley bibliography path", { exact: true }).fill("topology-group.bib");
    const created = await responseAfter(page, { path: `/api/projects/${project.id}/links`, method: "POST" }, () =>
      panel.getByRole("button", { name: "Link Mendeley bibliography", exact: true }).click());
    expect(created.status()).toBe(200);
    const file = z.object({ data: FileEntrySchema }).parse(await created.json()).data;
    expect(file.editable).toBe(false);
    if (!file.blob) throw new TypeError("Actual group bibliography blob required");
    const initialText = new TextDecoder().decode(await app.application.runtime.blobs.get(file.blob));
    const expectedGroupText = (title: string) => `@misc{mendeley_e1fe7595ab1e5a06,\n  title = {${title}},\n  author = {Emmy Noether},\n  year = {2026}\n}\n\n@misc{mendeley_eb6aa2348f6f0bbb,\n  title = {${title} supplement},\n  author = {Emmy Noether},\n  year = {2026}\n}\n`;
    expect(initialText).toBe(expectedGroupText("Group topology paper"));
    const retained = await app.application.runtime.db.get("SELECT selection_json FROM reference_links WHERE file_id=?", [file.id]);
    expect(retained).toEqual({ selection_json: JSON.stringify({ provider: "mendeley", libraryType: "groups", groupId: mendeleyGroupId }) });
    await waitForRenderedText(page, "Linked topology-group.bib as read only.");
    // Render and inspect each actual native responsive surface in both themes.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      const assistant = page.getByRole("dialog", { name: "Assistant", exact: true });
      if (await assistant.isVisible()) await assistant.getByRole("button", { name: "Close dialog", exact: true }).click();
      if (!await page.getByLabel("Editor tool", { exact: true }).isVisible()) {
        await page.getByRole("button", { name: "Files", exact: true }).last().click();
      }
      await waitForRenderedText(page, "Mendeley bibliography");
      if (await panel.getByLabel("Mendeley library", { exact: true }).count() === 0) {
        const reloadedLibraries = await responseAfter(page, { path: `/api/connections/${grant.id}/actions`, method: "POST" }, () =>
          panel.getByRole("button", { name: "Load Mendeley libraries", exact: true }).click());
        expect(reloadedLibraries.status()).toBe(202);
        await waitForRenderedText(page, "Topology reading group");
        await panel.getByLabel("Mendeley library", { exact: true }).selectOption(`${provider.origin}/groups/v2/${mendeleyGroupId}`);
      }
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await panel.getByRole("heading", { name: "Mendeley bibliography", exact: true })
          .evaluate(node => node.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: `${evidence}/${width}-${theme}.png`, fullPage: true });
        const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        expect(geometry.scroll).toBeLessThanOrEqual(width);
      }
      const shownPreview = await surfaceSignal(page, 'section[aria-label="Mendeley bibliography"] section[aria-label="Read-only bibliography: topology-group.bib"] pre');
      await panel.getByRole("button", { name: "Open topology-group.bib", exact: true }).click();
      await shownPreview.observed;
      expect(await panel.locator("pre").innerText()).toBe(initialText);
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await panel.getByRole("region", { name: "Read-only bibliography: topology-group.bib", exact: true })
          .evaluate(node => node.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: `${evidence}/preview-${width}-${theme}.png`, fullPage: true });
      }
      await panel.getByRole("button", { name: "Close bibliography preview", exact: true }).click();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await bibliography();
    await panel.getByRole("button", { name: "Open topology-group.bib", exact: true }).click();
    await waitForRenderedText(page, "Group topology paper");
    const preview = page.getByRole("region", { name: "Read-only bibliography: topology-group.bib", exact: true });
    expect(await preview.locator("pre").innerText()).toBe(initialText);
    expect(await preview.locator("[contenteditable=true],textarea,input").count()).toBe(0);
    await panel.getByRole("button", { name: "Close bibliography preview", exact: true }).click();
    const linkedEntry = page.getByRole("region", { name: "Bibliography", exact: true })
      .getByRole("listitem").filter({ hasText: "mendeley_e1fe7595ab1e5a06" });
    const entryPreview = await surfaceSignal(page, 'section[aria-label="Read-only bibliography: topology-group.bib"] pre');
    await linkedEntry.getByRole("button", { name: "Open bibliography", exact: true }).click();
    await entryPreview.observed;
    expect(await preview.locator("pre").innerText()).toBe(initialText);
    await page.reload({ waitUntil: "domcontentloaded" });
    await bibliography();
    provider.state.groupTitle = "Reloaded group refresh paper";
    const refreshed = await responseAfter(page, { path: `/api/projects/${project.id}/links/${file.id}/refresh`, method: "POST" }, () =>
      panel.getByRole("button", { name: "Refresh topology-group.bib", exact: true }).click());
    expect(refreshed.status()).toBe(200);
    const updated = z.object({ data: FileEntrySchema }).parse(await refreshed.json()).data;
    if (!updated.blob) throw new TypeError("Actual refreshed group bibliography required");
    const refreshedText = new TextDecoder().decode(await app.application.runtime.blobs.get(updated.blob));
    expect(refreshedText).toBe(expectedGroupText("Reloaded group refresh paper"));
    expect(await app.application.runtime.db.get("SELECT selection_json FROM reference_links WHERE file_id=?", [file.id])).toEqual(retained);
    await waitForRenderedText(page, "Refreshed topology-group.bib from its original library.");
    // Individual search/copy is the real native flow and writes only the editable target.
    const remote = page.getByRole("region", { name: "Remote references", exact: true });
    await remote.getByLabel("Reference provider", { exact: true }).selectOption("mendeley");
    await remote.getByLabel("Remote reference query", { exact: true }).fill("Individual");
    const searched = await responseAfter(page, { path: "/api/references/search", method: "GET" }, () =>
      remote.getByRole("button", { name: "Search provider", exact: true }).click());
    expect(searched.status()).toBe(200);
    const publication = editorValue(resultSchema(endpoints.referencesSearch.output).parse(await searched.json())).items[0];
    if (!publication) throw new TypeError("Actual Mendeley individual result required");
    await waitForRenderedText(page, publication.title);
    await page.getByLabel("Bibliography target", { exact: true }).selectOption(target.id);
    await remote.getByRole("radio", { name: publication.title, exact: true }).check();
    const copied = await responseAfter(page, { path: `/api/projects/${project.id}/citations`, method: "POST" }, () =>
      remote.getByRole("button", { name: "Copy remote to project", exact: true }).click());
    expect(copied.status()).toBe(200);
    const copiedFile = editorValue(resultSchema(endpoints.citationCreate.output).parse(await copied.json()));
    expect(copiedFile).toMatchObject({ id: target.id, editable: true, link: null });
    expect((await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: target.id })).text)
      .toBe(publication.bibtex + "\n");
    await waitForRenderedText(page, `Copied`);
    const mainScope = { projectId: project.id, branch: "main", fileId: project.settings.mainFileId };
    const beforeCite = await projectDocument(actor.context, mainScope);
    await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+Home");
    using citedSave = nextApplicationEvent(app, event => event.topic === "document.saved"
      && event.aggregateId === project.id && event.payload.resourceId === project.settings.mainFileId);
    const [citedResponse] = await Promise.all([
      responseAfter(page, { path: `/api/projects/${project.id}/citations`, method: "POST" }, () =>
        remote.getByRole("button", { name: "Cite remote in project", exact: true }).click()),
      citedSave.promise,
    ]);
    expect(citedResponse.status()).toBe(200);
    await waitForRenderedText(page, "Inserted citation mendeley_b68f96c2100b0f55");
    expect((await projectDocument(actor.context, mainScope)).text)
      .toBe("\\cite{mendeley_b68f96c2100b0f55}" + beforeCite.text);
    expect((await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: target.id })).text)
      .toBe(publication.bibtex + "\n");
    const entry = page.getByRole("region", { name: "Bibliography", exact: true })
      .getByRole("listitem").filter({ hasText: publication.title });
    const copyReady = await surfaceSignal(page, '.cm-content[aria-label="Source: editable-copy.bib"][contenteditable="true"]');
    await entry.getByRole("button", { name: "Open bibliography", exact: true }).click();
    await copyReady.observed;
    const editableSource = page.getByRole("textbox", { name: "Source: editable-copy.bib", exact: true });
    expect(await editableSource.getAttribute("contenteditable")).toBe("true");
    using savedCopy = nextApplicationEvent(app, event => event.topic === "document.saved"
      && event.aggregateId === project.id && event.payload.resourceId === target.id);
    await editableSource.press("ControlOrMeta+End");
    const edit = "% independent editable copy\n";
    await Promise.all([savedCopy.promise, page.keyboard.insertText(edit)]);
    expect((await projectDocument(actor.context, { projectId: project.id, branch: "main", fileId: target.id })).text)
      .toBe(publication.bibtex + "\n" + edit);
    expect(await app.application.runtime.blobs.get(updated.blob)).toEqual(new TextEncoder().encode(refreshedText));
    expect(errors).toEqual([]);
    await Bun.write(`${evidence}/workflow.json`, JSON.stringify({ owned, grant: grant.id, project: project.id,
      group: mendeleyGroupId, file, updated, retained, initialText, refreshedText, publication, copiedFile,
      requests: provider.state.requests, errors }, null, 2));
    // A real Viewer can discover its authorized groups but cannot bulk-write this seeded project.
    const viewerGrant = await app.application.runtime.uow.run(tx =>
      new GrantStore({ ...app.application.runtime, routes: app.application.runtime.routes.forLane("X") }).create({
        actorId: fixtureIds.alex, provider: "mendeley", label: "P50 Viewer fixture",
        tokens: { accessToken: mendeleyToken, refreshToken: null, tokenType: "Bearer", scopes: ["all"], expiresAt: null },
      }, tx));
    await using viewer = await authenticatedContext(browser, app, { email: "alex@quire.local", viewport: { width: 1440, height: 1000 } });
    const viewerPage = await viewer.context.newPage();
    await openSurface(viewerPage, { path: `/projects/${fixtureIds.project}/edit`, selector: ".qe-main .cm-content" });
    const viewerReady = await surfaceSignal(viewerPage, 'section[aria-label="Mendeley bibliography"]');
    await viewerPage.getByLabel("Editor tool", { exact: true }).selectOption("bibliography");
    await viewerReady.observed;
    await waitForRenderedText(viewerPage, "P50 Viewer fixture");
    const viewerPanel = viewerPage.getByRole("region", { name: "Mendeley bibliography", exact: true });
    const viewerGroups = await responseAfter(viewerPage, { path: `/api/connections/${viewerGrant.id}/actions`, method: "POST" }, () =>
      viewerPanel.getByRole("button", { name: "Load Mendeley libraries", exact: true }).click());
    expect(viewerGroups.status()).toBe(202);
    await waitForRenderedText(viewerPage, "Topology reading group");
    expect(await viewerPanel.getByRole("button", { name: "Link Mendeley bibliography", exact: true }).isDisabled()).toBe(true);
    await Bun.write(`${evidence}/viewer.json`, JSON.stringify({ actor: fixtureIds.alex, grant: viewerGrant.id,
      groupDiscoveryStatus: viewerGroups.status(), bulkLinkDisabled: true }, null, 2));
    await previewBoundaries({ app, actor, page, projectId: project.id, groupFile: updated, grantId: grant.id, evidence });
    expect(errors).toEqual([]);
  } finally {
    await resources.disposeAsync();
    const absent = await access(app.dataDir).then(() => false, () => true);
    const listeners = await Promise.all([app.url.origin, app.apiUrl.origin, provider.origin].map(async origin =>
      ({ origin, closed: await fetch(origin, { signal: AbortSignal.timeout(2000) }).then(() => false, () => true) })));
    const cleanup = { owned, absent, browserClosed: !browser.browser.isConnected(), listeners, errors };
    await Bun.write(`${evidence}/cleanup.json`, JSON.stringify(cleanup, null, 2));
    expect(absent).toBe(true);
    expect(cleanup.browserClosed).toBe(true);
    expect(listeners.every(listener => listener.closed)).toBe(true);
    console.info("P50_CLEANUP", cleanup);
  }
}, 180_000);
