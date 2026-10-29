import { expect, test } from "bun:test";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page, Request } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import type { Suggestion } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { authenticateApi, projectDocument, startEditorBrowser, waitForRenderedText } from "../shared";
import { startAssemblyApplication } from "../assembly/application";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";

const scope = { projectId: ids.project, branch: "main", fileId: ids.mainFile };
const path = `/projects/${ids.project}`;
const textbox = (page: Page) => page.getByRole("textbox", { name: "Source: main.tex", exact: true });
const hash = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

async function capture(page: Page, evidence: string, name: string) {
  await page.locator(".qe-project-header").getByRole("button", { name: "Source", exact: true }).click();
  const assistant = page.locator(".qe-project-header").getByRole("button", { name: "Assistant", exact: true });
  if (await assistant.getAttribute("aria-pressed") === "true") await assistant.click();
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async value => {
      document.documentElement.dataset["theme"] = value;
      await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    }, theme);
    for (const dialog of await page.locator("dialog[open]").all()) {
      await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
    }
    const geometry = await page.evaluate(() => ({
      width: innerWidth, scroll: document.documentElement.scrollWidth,
      editor: document.querySelector(".q-source-editor")?.getBoundingClientRect().toJSON(),
      tracking: document.querySelector(".q-source-tracking")?.getBoundingClientRect().toJSON(),
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(width);
    expect(geometry.editor?.height).toBeGreaterThan(100);
    expect(geometry.tracking?.height).toBeGreaterThan(20);
    await page.screenshot({ path: `${evidence}/${name}-${width}-${theme}.png` });
    await Bun.write(`${evidence}/${name}-${width}-${theme}.json`, JSON.stringify(geometry));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function submit(page: Page, label = "Submit proposal") {
  const response = page.waitForResponse(item => new URL(item.url()).pathname === `/api/projects/${ids.project}/suggestions`
    && item.request().method() === "POST");
  await page.getByRole("button", { name: label, exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  const suggestion = editorValue(resultSchema(endpoints.suggestionCreate.output).parse(await result.json()));
  await waitForRenderedText(page, "Pending proposals");
  return suggestion;
}

test("real reviewer source typing stays private, persists proposals, and owner Review alone accepts or rejects", async () => {
  const evidence = resolve(`docs/evidence/p31-source-tracking/browser-${crypto.randomUUID()}`);
  await mkdir(evidence, { recursive: true });
  const resources = new AsyncDisposableStack();
  const errors: string[] = [];
  let root = "";
  try {
    const app = resources.use(await startAssemblyApplication({}));
    root = app.dataDir;
    const reviewer = await authenticateApi(app, "sam@quire.local");
    const owner = await authenticateApi(app);
    const viewer = await authenticateApi(app, "alex@quire.local");
    const browser = resources.use(await startEditorBrowser());
    const contexts = await Promise.all([reviewer, owner, viewer].map(async actor => {
      const context = await browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
      resources.defer(() => context.close());
      await context.addCookies([actor.cookie]);
      return context;
    }));
    const authorContext = contexts[0], ownerContext = contexts[1], viewerContext = contexts[2];
    if (!authorContext || !ownerContext || !viewerContext) throw new Error("Missing browser contexts");
    const page = await authorContext.newPage(), other = await ownerContext.newPage(), denied = await viewerContext.newPage();
    for (const current of [page, other, denied]) current.on("pageerror", error => errors.push(error.message));
    resources.defer(async () => {
      await page.screenshot({ path: `${evidence}/terminal.png` });
      await Bun.write(`${evidence}/terminal.html`, await page.content());
      await Bun.write(`${evidence}/errors.json`, JSON.stringify(errors));
    });
    await Promise.all([
      openSurface(page, { path: `${path}/edit`, selector: ".q-source-tracking" }),
      openSurface(other, { path: `${path}/review`, selector: ".quire-suggestion__scope" }),
      openSurface(denied, { path: `${path}/edit`, selector: ".q-source-tracking" }),
    ]);
    expect(await denied.getByRole("button", { name: "Track changes off", exact: true }).isDisabled()).toBe(true);
    expect(await textbox(page).getAttribute("contenteditable")).toBe("false");
    const original = await projectDocument(ownerContext, scope);
    const editable = await surfaceSignal(page, '.cm-content[contenteditable="true"]');
    await page.getByRole("button", { name: "Track changes off", exact: true }).click();
    await editable.observed;
    await textbox(page).click();
    await textbox(page).press("ControlOrMeta+End");
    await page.keyboard.insertText("% typed draft");
    expect(await page.getByLabel("Retained proposal draft").inputValue()).toBe(original.text + "% typed draft");
    await textbox(page).press("ControlOrMeta+z");
    expect(await page.getByLabel("Retained proposal draft").count()).toBe(0);
    await textbox(page).press("ControlOrMeta+y");
    expect(await page.getByLabel("Retained proposal draft").inputValue()).toBe(original.text + "% typed draft");
    await textbox(page).press("Backspace");
    await textbox(page).evaluate(element => {
      const data = new DataTransfer(); data.setData("text/plain", "\n% pasted Tiếng Việt 中文 😀\n");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    const pasted = original.text + "% typed draf\n% pasted Tiếng Việt 中文 😀\n";
    expect(await page.getByLabel("Retained proposal draft").inputValue()).toBe(pasted);
    // Real Chromium composition input, not an API or editor-success mock.
    const cdp = await authorContext.newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "日本語", selectionStart: 3, selectionEnd: 3 });
    await cdp.send("Input.insertText", { text: "日本語" });
    await cdp.detach();
    await textbox(page).press("ControlOrMeta+f");
    await page.getByLabel("Find in current file", { exact: true }).fill("article");
    await page.getByLabel("Replace with", { exact: true }).fill("report");
    await page.getByRole("button", { name: "Replace all", exact: true }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const proposed = await page.getByLabel("Retained proposal draft").inputValue();
    expect(proposed).toBe(pasted.replace("article", "report") + "日本語");
    expect((await projectDocument(ownerContext, scope)).text).toBe(original.text);
    await page.getByRole("button", { name: "Visual", exact: true }).click();
    expect(await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).count()).toBe(1);
    await waitForRenderedText(page, "Turn off Track changes in Source");
    await capture(page, evidence, "draft");
    // Pause/resume and a genuine reload recover the unsubmitted text, not shared source.
    await page.getByRole("button", { name: "Track changes on", exact: true }).click();
    expect(await textbox(page).innerText()).toContain("article");
    expect(await textbox(page).getAttribute("contenteditable")).toBe("false");
    await openSurface(page, { path: `${path}/edit`, selector: ".q-source-tracking" });
    expect(await page.getByLabel("Retained proposal draft").inputValue()).toBe(proposed);
    await page.getByRole("button", { name: "Track changes off", exact: true }).click();
    // Lose only the response after a real native commit; no successful response is fabricated.
    const committed = Promise.withResolvers<Suggestion>();
    const routePattern = `**/api/projects/${ids.project}/suggestions`;
    await page.route(routePattern, async route => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      committed.resolve(editorValue(resultSchema(endpoints.suggestionCreate.output).parse(await response.json())));
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Submit proposal", exact: true }).click();
    const durableBeforeReply = await committed.promise;
    await waitForRenderedText(page, "Retry proposal submission");
    await page.unroute(routePattern);
    expect((await projectDocument(ownerContext, scope)).text).toBe(original.text);
    await openSurface(page, { path: `${path}/edit`, selector: '.q-source-panel[data-tracking-state="draft"]' });
    const suggestion = await submit(page, "Retry proposal submission");
    expect(suggestion.id).toBe(durableBeforeReply.id);
    expect(suggestion.authorId).toBe(reviewer.user.id);
    const observed = await surfaceSignal(other, `[data-proposal-id="${suggestion.edits[0]?.id}"]`);
    await observed.observed;
    expect((await projectDocument(ownerContext, scope)).text).toBe(original.text);
    await capture(page, evidence, "submitted");
    await openSurface(page, { path: `${path}/review`, selector: `[data-proposal-id="${suggestion.edits[0]?.id}"]` });
    expect(await page.getByRole("button", { name: "Accept all", exact: true }).count()).toBe(0);
    const forbiddenDecision = await reviewer.http.post(`api/projects/${ids.project}/suggestions/decide`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      json: { ids: [suggestion.id], decision: "accept", expectedVersion: 0 },
    });
    expect(forbiddenDecision.status).toBe(403);
    const accepted = other.waitForResponse(response => new URL(response.url()).pathname.endsWith("/suggestions/decide"));
    await other.getByRole("button", { name: "Accept all", exact: true }).click();
    expect((await accepted).status()).toBe(200);
    await waitForRenderedText(other, "Recorded proposal; not a live source overlay.");
    expect((await projectDocument(ownerContext, scope)).text).toBe(proposed);
    await openSurface(page, { path: `${path}/edit`, selector: '.cm-content[contenteditable="true"]' });
    expect(await textbox(page).innerText()).toContain("日本語");
    await textbox(page).click(); await textbox(page).press("ControlOrMeta+a"); await textbox(page).press("Backspace");
    const deletion = await submit(page);
    expect(deletion.edits[0]?.after).toBe("");
    const pending = await surfaceSignal(other, `[data-proposal-id="${deletion.edits[0]?.id}"]`);
    await pending.observed;
    const rejected = other.waitForResponse(response => new URL(response.url()).pathname.endsWith("/suggestions/decide"));
    await other.getByRole("button", { name: "Reject all", exact: true }).click();
    expect((await rejected).status()).toBe(200);
    expect((await projectDocument(ownerContext, scope)).text).toBe(proposed);
    // Even an Owner cannot start an image upload/structural insertion through
    // project tools while the active authoring surface is a tracked draft.
    await openSurface(other, { path: `${path}/edit`, selector: '.cm-content[contenteditable="true"]' });
    await other.getByRole("button", { name: "Track changes off", exact: true }).click();
    await other.getByLabel("Editor tool", { exact: true }).selectOption("figure");
    expect(await other.getByRole("button", { name: "Insert figure", exact: true }).isDisabled()).toBe(true);
    expect((await projectDocument(ownerContext, scope)).text).toBe(proposed);
    const library = await owner.http.post(endpoints.libraryCreate.path.slice(1), {
      headers: { "idempotency-key": crypto.randomUUID() },
      json: { bibtex: "@article{P31Blocked,title={Must not copy while tracking}}", origin: "manual" },
    });
    expect(library.status).toBe(200);
    const filesBefore = editorValue(resultSchema(endpoints.filesList.output).parse(await (
      await owner.http.get(`api/projects/${ids.project}/files`, { searchParams: { branch: "main" } })).json()));
    const bib = filesBefore.find(file => file.path === "refs.bib");
    if (!bib) throw new Error("Bibliography missing");
    const bibliographyBefore = await projectDocument(ownerContext, { ...scope, fileId: bib.id });
    const projectMutations: string[] = [];
    const recordProjectMutation = (request: Request) => {
      if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith(`/api/projects/${ids.project}/`)) projectMutations.push(request.url());
    };
    other.on("request", recordProjectMutation);
    await other.getByLabel("Editor tool", { exact: true }).selectOption("bibliography");
    const entry = other.getByRole("region", { name: "Local Library", exact: true }).getByRole("listitem").filter({ hasText: "P31Blocked" });
    const copyDenied = await surfaceSignal(other, '.editor-tools [role="alert"]');
    await entry.getByRole("button", { name: "Copy to project", exact: true }).click();
    await copyDenied.observed;
    expect(await entry.getByRole("button", { name: "Cite in project", exact: true }).isDisabled()).toBe(true);
    await other.getByLabel("Editor tool", { exact: true }).selectOption("files");
    await other.getByText("File actions", { exact: true }).click();
    const uploadDenied = await surfaceSignal(other, '.editor-tools [role="alert"]');
    await other.getByLabel("Upload files", { exact: true }).setInputFiles({
      name: "p31-blocked-upload.tex", mimeType: "text/plain", buffer: Buffer.from("must not be uploaded"),
    });
    await uploadDenied.observed;
    other.off("request", recordProjectMutation);
    expect(projectMutations).toEqual([]);
    expect((await projectDocument(ownerContext, { ...scope, fileId: bib.id })).text).toBe(bibliographyBefore.text);
    expect((await projectDocument(ownerContext, scope)).text).toBe(proposed);
    expect(editorValue(resultSchema(endpoints.filesList.output).parse(await (
      await owner.http.get(`api/projects/${ids.project}/files`, { searchParams: { branch: "main" } })).json()))).toEqual(filesBefore);
    await Bun.write(`${evidence}/prewrite-guard.json`, JSON.stringify({
      projectMutations, filesBefore, mainHash: hash(proposed), bibliographyHash: hash(bibliographyBefore.text),
    }, null, 2));
    const anotherFile = await surfaceSignal(other, '.cm-content[aria-label="Source: sections/intro.tex"]');
    await other.getByRole("treeitem", { name: "sections/intro.tex", exact: true }).click();
    await anotherFile.observed;
    const visual = await surfaceSignal(other, '.qe-authoring[aria-label="Visual workspace"]');
    await other.locator(".qe-project-header").getByRole("button", { name: "Visual", exact: true }).click();
    await visual.observed;
    const trackedMain = await surfaceSignal(other, '.q-source-panel[data-tracking="on"] .cm-content[aria-label="Source: main.tex"]');
    await other.getByRole("treeitem", { name: "main.tex", exact: true }).click();
    await trackedMain.observed;
    expect(await other.getByRole("button", { name: "Track changes on", exact: true }).count()).toBe(1);
    expect((await projectDocument(ownerContext, scope)).text).toBe(proposed);
    expect(errors).toEqual([]);
    await Bun.write(`${evidence}/workflow.json`, JSON.stringify({
      origin: app.url.origin, reviewer: reviewer.user.id, suggestion, deletion,
      beforeHash: hash(original.text), proposedHash: hash(proposed), afterHash: hash((await projectDocument(ownerContext, scope)).text), errors,
    }, null, 2));
    console.info("P31_BROWSER_PASS", evidence);
  } finally {
    await resources.disposeAsync();
    const absent = root ? await access(root).then(() => false, () => true) : true;
    await Bun.write(`${evidence}/cleanup.json`, JSON.stringify({ root, absent }));
    expect(absent).toBe(true);
    console.info("P31_CLEANED", root, evidence);
  }
}, 180_000);
