import { expect, test } from "bun:test";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { authenticateApi, nextApplicationEvent, projectDocument, startEditorBrowser, waitForRenderedText } from "../shared";
import { startAssemblyApplication } from "../assembly/application";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";

const scope = { projectId: ids.project, branch: "main", fileId: ids.mainFile };
const path = `/projects/${ids.project}`;
const sourceSelector = '.qe-main .cm-content[contenteditable="true"]';

async function capture(page: Page, evidence: string, name: string, selector: string) {
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async value => {
      document.documentElement.dataset["theme"] = value;
      await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    }, theme);
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/${name}-${width}-${theme}.png` });
    const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(width);
    await Bun.write(`${evidence}/${name}-${width}-${theme}.json`, JSON.stringify(geometry));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("two actual authors compare recorded transitions, filter and navigate, then review exact persisted proposals", async () => {
  const evidence = resolve(`docs/evidence/p29-author-review/browser-${crypto.randomUUID()}`);
  await mkdir(evidence, { recursive: true });
  const resources = new AsyncDisposableStack();
  let root = "";
  const errors: string[] = [];
  try {
    const app = resources.use(await startAssemblyApplication({}));
    root = app.dataDir;
    const owner = await authenticateApi(app);
    const editor = await authenticateApi(app, "mai@quire.local");
    const browser = resources.use(await startEditorBrowser());
    const ownerContext = await browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
    resources.defer(() => ownerContext.close());
    const editorContext = await browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
    resources.defer(() => editorContext.close());
    await ownerContext.addCookies([owner.cookie]);
    await editorContext.addCookies([editor.cookie]);
    const page = await ownerContext.newPage();
    const other = await editorContext.newPage();
    for (const current of [page, other]) current.on("pageerror", error => errors.push(error.message));
    resources.defer(async () => {
      await page.screenshot({ path: `${evidence}/terminal.png` });
      await Bun.write(`${evidence}/terminal.html`, await page.content());
      await Bun.write(`${evidence}/errors.json`, JSON.stringify(errors));
    });
    const projects = app.application.runtime.services.get("projects");
    const from = await projects.snapshot(owner.user.id, { projectId: scope.projectId, branch: scope.branch }, 0);
    await Promise.all([
      openSurface(page, { path: `${path}/edit`, selector: sourceSelector }),
      openSurface(other, { path: `${path}/edit`, selector: sourceSelector }),
    ]);
    const original = await projectDocument(ownerContext, scope);
    const first = original.text.replace("\\end{document}", "% Owner recorded change\n\\end{document}");
    using firstHistory = nextApplicationEvent(app, event => event.topic === "history.created"
      && event.aggregateId === ids.project && event.payload.version === 1);
    await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).click();
    await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+A");
    await page.keyboard.insertText(first);
    await firstHistory.promise;
    await waitForRenderedText(other, "Owner recorded change");
    const second = first.replace("\\end{document}", "% Editor recorded change\n\\end{document}");
    using secondHistory = nextApplicationEvent(app, event => event.topic === "history.created"
      && event.aggregateId === ids.project && event.payload.version === 2);
    await other.getByRole("textbox", { name: "Source: main.tex", exact: true }).click();
    await other.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+A");
    await other.keyboard.insertText(second);
    await secondHistory.promise;
    expect((await projectDocument(ownerContext, scope)).text).toBe(second);
    await openSurface(page, { path: `${path}/history`, selector: `[data-history-id="${from.id}"]` });
    const rendered = await surfaceSignal(page, `.quire-change[data-actor-id="${owner.user.id}"]`);
    await page.locator(`[data-history-id="${from.id}"]`).click();
    await rendered.observed;
    expect(await page.locator(".quire-change").count()).toBe(2);
    expect(await page.getByLabel("Recorded actor legend").innerText()).toContain(owner.user.name);
    expect(await page.getByLabel("Recorded actor legend").innerText()).toContain(editor.user.name);
    await page.getByLabel("Recorded actor", { exact: true }).selectOption(editor.user.id);
    expect(await page.locator(".quire-change").count()).toBe(1);
    expect(await page.locator(".quire-change ins").innerText()).toBe("% Editor recorded change\n");
    await capture(page, evidence, "history", ".quire-change");
    const sourceOpened = await surfaceSignal(page, sourceSelector);
    await page.getByRole("button", { name: "Open current source", exact: true }).click();
    await sourceOpened.observed;
    expect(new URL(page.url()).pathname).toBe(`${path}/edit`);
    expect((await projectDocument(ownerContext, scope)).text).toBe(second);
    console.info("P29_BROWSER", "two-source-authors-history-filter-navigation", evidence);

    await Promise.all([
      openSurface(page, { path: `${path}/review`, selector: ".quire-suggestion__scope" }),
      openSurface(other, { path: `${path}/review`, selector: ".quire-suggestion__scope" }),
    ]);
    const propose = async (current: Page, replacement: string) => {
      const ready = await surfaceSignal(current, sourceSelector);
      await ready.observed;
      await current.getByRole("textbox", { name: "Source: main.tex", exact: true }).click();
      const source = current.getByRole("textbox", { name: "Source: main.tex", exact: true });
      await source.press("ControlOrMeta+Home");
      for (let index = 0; index < second.indexOf("article"); index++) await source.press("ArrowRight");
      for (let index = 0; index < "article".length; index++) await source.press("Shift+ArrowRight");
      await current.getByLabel("Replacement text", { exact: true }).fill(replacement);
      const created = current.waitForResponse(response => new URL(response.url()).pathname
        === `/api/projects/${ids.project}/suggestions` && response.request().method() === "POST");
      await current.getByRole("button", { name: "Propose replacement", exact: true }).click();
      const response = await created;
      expect(response.status()).toBe(200);
      return editorValue(resultSchema(endpoints.suggestionCreate.output).parse(await response.json()));
    };
    const ownerProposal = await propose(page, "book");
    const reviewerProposal = await propose(other, "report");
    const both = await surfaceSignal(page, `[data-author-id="${editor.user.id}"]`);
    await both.observed;
    expect(await page.locator(".quire-suggestion").count()).toBe(2);
    // Downgrade the second proposer through actual owner authority before decisions.
    expect((await owner.http.patch(`api/projects/${ids.project}/members/${editor.user.id}`, {
      json: { role: "reviewer", expectedVersion: 0 },
    })).status).toBe(200);
    await openSurface(other, { path: `${path}/review`, selector: `[data-author-id="${editor.user.id}"]` });
    expect(await other.getByRole("button", { name: "Accept all", exact: true }).count()).toBe(0);
    expect((await projectDocument(ownerContext, scope)).text).toBe(second);
    await page.getByLabel("Proposal author", { exact: true }).selectOption(editor.user.id);
    expect(await page.locator(".quire-suggestion").count()).toBe(1);
    expect(await page.getByLabel("Anchored proposal preview").innerText()).toContain("report");
    await capture(page, evidence, "review", ".quire-suggestion");
    await page.getByRole("button", { name: "Go to proposal source", exact: true }).click();
    expect(new URL(page.url()).pathname).toBe(`${path}/review`);
    expect(await page.locator(sourceSelector).innerText()).toContain("article");
    const reviewed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/suggestions/decide")
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Accept all", exact: true }).click();
    expect((await reviewed).status()).toBe(200);
    await waitForRenderedText(page, "Recorded proposal; not a live source overlay.");
    const final = await projectDocument(ownerContext, scope);
    expect(final.text).toBe(second.replace("article", "report"));
    const proposals = editorValue(resultSchema(endpoints.suggestionsList.output).parse(await (await owner.http.get(
      `api/projects/${ids.project}/suggestions`, { searchParams: { branch: "main" } },
    )).json())).items;
    expect(proposals.find(item => item.id === ownerProposal.id)?.edits[0]?.status).toBe("pending");
    expect(proposals.find(item => item.id === reviewerProposal.id)?.edits[0]?.status).toBe("accepted");
    expect(proposals.find(item => item.id === reviewerProposal.id)?.authorId).toBe(editor.user.id);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForRenderedText(page, "Recorded proposal; not a live source overlay.");
    // The changed history presentation must preserve labeled download and new-version file recovery.
    using createdHistory = nextApplicationEvent(app, event => event.topic === "history.created"
      && event.aggregateId === ids.project && event.payload.version === final.file.version.revision + 1);
    const createdResponse = await owner.http.post(`api/projects/${ids.project}/files`, {
      headers: { "idempotency-key": crypto.randomUUID() }, json: {
        scope: { projectId: ids.project, branch: "main" }, path: "retained.tex",
        kind: "file", text: "recover exact source\n", expectedVersion: final.file.version.revision,
      },
    });
    const file = editorValue(resultSchema(endpoints.fileCreate.output).parse(await createdResponse.json()));
    const historical = await createdHistory.promise;
    if (historical.topic !== "history.created") throw new TypeError("Expected created file history");
    using deletedHistory = nextApplicationEvent(app, event => event.topic === "history.created"
      && event.aggregateId === ids.project && event.payload.version === file.version.revision + 1);
    expect((await owner.http.delete(`api/projects/${ids.project}/files/${file.id}`, {
      json: { scope: { projectId: ids.project, branch: "main" }, expectedVersion: file.version.revision },
    })).status).toBe(200);
    await deletedHistory.promise;
    await openSurface(page, { path: `${path}/history`, selector: `[data-history-id="${historical.payload.resourceId}"]` });
    await page.locator(`[data-history-id="${historical.payload.resourceId}"]`).click();
    await waitForRenderedText(page, "Deleted now");
    await page.getByLabel("New label").fill("P29 retained file");
    const labeled = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/labels")
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Add label", exact: true }).click();
    expect((await labeled).status()).toBe(200);
    await waitForRenderedText(page, "P29 retained file");
    await page.getByRole("button", { name: "Labels only", exact: true }).click();
    expect(await page.locator("[data-history-id]").count()).toBe(1);
    expect(await page.getByRole("button", { name: "Recover deleted file", exact: true }).count()).toBe(1);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download source ZIP", exact: true }).click();
    expect((await download).suggestedFilename()).toContain(String(file.version.revision));
    await page.getByRole("button", { name: "Recover deleted file", exact: true }).click();
    const restored = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/restore")
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Recover file", exact: true }).click();
    const restoredResponse = await restored;
    expect(restoredResponse.status()).toBe(200);
    const restoredVersion = editorValue(resultSchema(endpoints.historyRestore.output).parse(await restoredResponse.json()));
    expect(restoredVersion.id).not.toBe(historical.payload.resourceId);
    expect(restoredVersion.snapshot.revision).toBe(file.version.revision + 2);
    const recovered = await projectDocument(ownerContext, { ...scope, fileId: file.id });
    expect(recovered.text).toBe("recover exact source\n");
    expect(recovered.file.version.epoch).toBeGreaterThan(file.version.epoch);
    expect((await projectDocument(ownerContext, scope)).text).toBe(final.text);
    expect(errors).toEqual([]);
    await Bun.write(`${evidence}/workflow.json`, JSON.stringify({
      origin: app.url.origin, from, owner: owner.user.id, editor: editor.user.id,
      first, second, final: final.text, proposals, restoredVersion, recovered, errors,
    }, null, 2));
    console.info("P29_BROWSER", "reviewer-denied-owner-filtered-acceptance-reload", evidence);
  } finally {
    await resources.disposeAsync();
    const absent = root ? await access(root).then(() => false, () => true) : true;
    await Bun.write(`${evidence}/cleanup.json`, JSON.stringify({ root, absent }));
    expect(absent).toBe(true);
    console.info("P29_CLEANED", root, evidence);
  }
}, 180_000);
