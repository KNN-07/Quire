import { expect, test } from "bun:test";
import { endpoints, resultSchema } from "@quire/contracts";
import type { Page } from "@playwright/test";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { bibliographyKeys } from "../../../apps/web/src/features/editor/tools/insertion";
import { authenticatedContext, nextApplicationEvent, projectDocument, waitForRenderedText } from "../shared";
import { fixtureIds } from "../../fixtures/foundation";
import { createInputFile, createProject, responseAfter } from "../tools/helpers";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";
import { remoteFixture } from "./fixture";
import type { RemoteFixture } from "./fixture";

async function enable(page: Page, project: string, target?: string) {
  await openSurface(page, { path: `/projects/${project}/edit`, selector: ".qe-main .cm-content" });
  await page.getByRole("button", { name: "Source", exact: true }).first().click();
  await page.locator(".q-source-references summary").click();
  if (target) {
    expect(await page.getByLabel("Inline bibliography destination").inputValue()).toBe("");
    await page.getByLabel("Inline bibliography destination").selectOption(target);
  }
  await page.getByLabel("Inline reference provider", { exact: true }).selectOption("crossref");
  await page.getByRole("button", { name: "Done configuring references" }).click();
}

async function suggest(page: Page, query: string, setup: RemoteFixture, projectId: string) {
  const source = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
  await source.press("ControlOrMeta+Home");
  const shown = await surfaceSignal(page, ".cm-tooltip-autocomplete [role=option]");
  using saved = nextApplicationEvent(setup.app, event => event.topic === "document.saved" && event.aggregateId === projectId);
  const searched = await responseAfter(page, { path: "/api/references/search", method: "GET" }, () =>
    page.keyboard.insertText(`\\cite{${query}`));
  const publication = editorValue(resultSchema(endpoints.referencesSearch.output).parse(await searched.json())).items[0];
  if (!publication) throw new TypeError("Fixture must return an actual publication.");
  await shown.observed;
  await saved.promise;
  return publication;
}

test("inline acceptance persists exact provider entries for zero, one and explicitly selected multiple destinations", async () => {
  // Given: the real mounted editor and a controlled implemented provider.
  await using setup = await remoteFixture();
  await using actor = await authenticatedContext(setup.browser, setup.app, { viewport: { width: 1440, height: 900 } });
  const page = await actor.context.newPage();
  page.on("pageerror", error => setup.errors.push(error.message));
  const results = [];
  for (const count of [0, 1, 2]) {
    const project = await createProject(actor, { name: `P71 destinations ${count}`, origin: setup.app.url.origin });
    const scope = { projectId: project.id, branch: "main", fileId: project.settings.mainFileId };
    const targets = [];
    for (let index = 0; index < count; index++) targets.push(await createInputFile(actor, {
      projectId: project.id, origin: setup.app.url.origin, path: `target${index}.bib`, text: "",
    }));
    const before = await projectDocument(actor.context, scope);
    await enable(page, project.id, count === 2 ? targets[1]?.id : undefined);
    // When: typing a citation query automatically searches, but does not copy.
    const publication = await suggest(page, `dest${count}`, setup, project.id);
    const key = bibliographyKeys(publication.bibtex)[0]?.key;
    if (!key) throw new TypeError("Provider citation key required.");
    const citationCount = await setup.app.application.runtime.db.all<{ n: number }>(
      "SELECT count(*) AS n FROM reference_provenance WHERE owner_id=?", [fixtureIds.kien]);
    expect(citationCount[0]?.n).toBe(count + 1);
    expect((await projectDocument(actor.context, scope)).text).toBe(`\\cite{dest${count}` + before.text);
    const listed = await actor.context.request.get(`/api/projects/${project.id}/files`, { params: { branch: "main" } });
    expect(editorValue(resultSchema(endpoints.filesList.output).parse(await listed.json())).filter(file => /\.bib$/.test(file.path))).toHaveLength(count);
    for (const target of targets) expect((await projectDocument(actor.context, { ...scope, fileId: target.id })).text).toBe("");
    if (count === 0) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const assistant = page.getByRole("dialog", { name: "Assistant", exact: true });
        if (await assistant.isVisible()) await assistant.getByRole("button", { name: "Close dialog", exact: true }).click();
        for (const theme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme: theme });
          await page.keyboard.press("Escape");
          const popup = await surfaceSignal(page, ".cm-tooltip-autocomplete [role=option]");
          await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("Control+Space");
          await popup.observed;
          await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
          await page.screenshot({ path: `${setup.evidence}/completion-${width}-${theme}.png` });
          const geometry = await page.evaluate(() => ({
            width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            scrollers: [...document.querySelectorAll("*")].filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY)
              && el.scrollHeight > el.clientHeight).map(el => el.className),
          }));
          expect(geometry.scrollWidth).toBeLessThanOrEqual(width);
          await Bun.write(`${setup.evidence}/completion-${width}-${theme}.json`, JSON.stringify(geometry, null, 2));
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    const copied = await responseAfter(page, { path: `/api/projects/${project.id}/citations`, method: "POST" }, () => acceptSuggestion(page));
    expect(copied.status()).toBe(200);
    const file = editorValue(resultSchema(endpoints.citationCreate.output).parse(await copied.json()));
    await waitForRenderedText(page, "Inserted citation key in the existing command.");
    // Then: only the current query is replaced; the exact returned entry survives reopen.
    const after = await projectDocument(actor.context, scope);
    expect(after.text).toBe(`\\cite{${key}` + before.text);
    expect((await projectDocument(actor.context, { ...scope, fileId: file.id })).text).toBe(publication.bibtex + "\n");
    expect(file.path).toBe(count === 0 ? "references.bib" : `target${count - 1}.bib`);
    await openSurface(page, { path: `/projects/${project.id}/edit`, selector: ".qe-main .cm-content" });
    expect(await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).innerText()).toContain(`\\cite{${key}`);
    results.push({ count, file, publication, before: before.text, after: after.text });
  }
  await Bun.write(`${setup.evidence}/acceptance.json`, JSON.stringify({ results, requests: setup.requests }, null, 2));
  expect(setup.errors).toEqual([]);
}, 180_000);

async function acceptSuggestion(page: Page) {
  // Pointer acceptance has no elapsed-time guard; keyboard timing is a separate scenario.
  await page.locator(".cm-tooltip-autocomplete [role=option]").first().click();
}

test("inline cancellation discards old query and provider results and Escape does not publish", async () => {
  // Given: an in-flight real provider lookup.
  await using setup = await remoteFixture();
  await using actor = await authenticatedContext(setup.browser, setup.app);
  const project = await createProject(actor, { name: "P71 cancel", origin: setup.app.url.origin });
  const page = await actor.context.newPage();
  await enable(page, project.id);
  const held = setup.hold("delayed");
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+Home");
  await page.keyboard.insertText("\\cite{delayed");
  await held.started;
  const canceled = page.waitForEvent("requestfailed", { predicate: request =>
    new URL(request.url()).searchParams.get("query") === "delayed", timeout: 30_000 });
  // When: the query changes before the vendor response.
  const shown = await surfaceSignal(page, ".cm-tooltip-autocomplete [role=option]");
  await page.keyboard.insertText("latest");
  await canceled;
  await shown.observed;
  held.release(); await held.completed;
  // Then: only the new result appears; Escape leaves no bibliography copy.
  expect(await page.locator(".cm-tooltip-autocomplete").innerText()).toContain("Research delayedlatest");
  expect(await page.locator(".cm-tooltip-autocomplete").innerText()).not.toContain("Research delayed\n");
  await page.keyboard.press("Escape");
  expect(await page.locator(".cm-tooltip-autocomplete").count()).toBe(0);
  const files = await actor.context.request.get(`/api/projects/${project.id}/files`, { params: { branch: "main" } });
  expect(editorValue(resultSchema(endpoints.filesList.output).parse(await files.json())).some(file => /\.bib$/.test(file.path))).toBe(false);
  const providerHeld = setup.hold("delayedlatestprovider");
  await page.keyboard.insertText("provider");
  await providerHeld.started;
  await page.locator(".q-source-references summary").click();
  await page.getByLabel("Inline reference provider").selectOption("arxiv");
  providerHeld.release(); await providerHeld.completed;
  expect(await page.locator(".cm-tooltip-autocomplete").count()).toBe(0);
  await Bun.write(`${setup.evidence}/cancellation.json`, JSON.stringify({ escapeNoCopy: true, providerStaleDiscarded: true, requests: setup.requests }, null, 2));
}, 120_000);

test("a committed bibliography copy is disclosed when the source caret becomes stale before insertion", async () => {
  // Given: an accepted candidate whose real bibliography commit precedes its HTTP response.
  await using setup = await remoteFixture();
  await using actor = await authenticatedContext(setup.browser, setup.app);
  const project = await createProject(actor, { name: "P71 stale insertion", origin: setup.app.url.origin });
  const scope = { projectId: project.id, branch: "main", fileId: project.settings.mainFileId };
  const page = await actor.context.newPage();
  await enable(page, project.id);
  const publication = await suggest(page, "stalecopy", setup, project.id);
  const held = setup.holdCopy();
  await acceptSuggestion(page);
  await held.started;
  // When: the caret changes while the already committed copy response is held.
  await page.keyboard.press("ArrowLeft");
  const disclosed = waitForRenderedText(page, "The bibliography copy remains.");
  held.release();
  await disclosed;
  // Then: the query stays untouched and the actual copied entry remains visible on reopen.
  expect((await projectDocument(actor.context, scope)).text).toContain("\\cite{stalecopy");
  const listed = await actor.context.request.get(`/api/projects/${project.id}/files`, { params: { branch: "main" } });
  const file = editorValue(resultSchema(endpoints.filesList.output).parse(await listed.json())).find(item => item.path === "references.bib");
  if (!file) throw new TypeError("Committed bibliography required.");
  expect((await projectDocument(actor.context, { ...scope, fileId: file.id })).text).toBe(publication.bibtex + "\n");
  await openSurface(page, { path: `/projects/${project.id}/edit`, selector: ".qe-main .cm-content" });
  await waitForRenderedText(page, "The bibliography copy remains.");
  await Bun.write(`${setup.evidence}/stale-copy.json`, JSON.stringify({ publication, file, source: (await projectDocument(actor.context, scope)).text }, null, 2));
}, 120_000);

test("saved autocomplete off and Viewer authority prevent automatic external requests", async () => {
  // Given: saved autocomplete=false, independent of deliberate provider selection.
  await using setup = await remoteFixture();
  await using actor = await authenticatedContext(setup.browser, setup.app);
  const preferencesResponse = await actor.context.request.get("/api/me/preferences");
  const preferences = editorValue(resultSchema(endpoints.preferencesGet.output).parse(await preferencesResponse.json()));
  const changed = await actor.context.request.patch("/api/me/preferences", {
    headers: { origin: setup.app.url.origin, "x-csrf-token": actor.session.csrfToken },
    data: { autocomplete: false, expectedVersion: preferences.version },
  });
  expect(changed.status()).toBe(200);
  const project = await createProject(actor, { name: "P71 off", origin: setup.app.url.origin });
  const page = await actor.context.newPage();
  await openSurface(page, { path: `/projects/${project.id}/edit`, selector: ".qe-main .cm-content" });
  await page.locator(".q-source-references summary").click();
  // When: ordinary citation typing and explicit local completion are invoked.
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+Home");
  await page.keyboard.insertText("\\cite{privatequery");
  await page.keyboard.press("Control+Space");
  // Then: the remote action is visibly unavailable and no provider request exists.
  expect(await page.getByLabel("Inline reference provider").isDisabled()).toBe(true);
  expect(setup.requests).toEqual([]);
  await using viewer = await authenticatedContext(setup.browser, setup.app, { email: "alex@quire.local" });
  const viewerPage = await viewer.context.newPage();
  await openSurface(viewerPage, { path: `/projects/${fixtureIds.project}/edit`, selector: ".qe-main .cm-content" });
  await viewerPage.locator(".q-source-references summary").click();
  expect(await viewerPage.getByLabel("Inline reference provider").isDisabled()).toBe(true);
  expect(setup.requests).toEqual([]);
  await Bun.write(`${setup.evidence}/gates.json`, JSON.stringify({ autocompleteOff: true, viewerDisabled: true, requests: setup.requests }, null, 2));
}, 120_000);
