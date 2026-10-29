import { expect, test } from "bun:test";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import * as Y from "yjs";
import { endpoints, resultSchema } from "@quire/contracts";
import { CoreProjects } from "../../../services/core/base";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { authenticateApi, nextApplicationEvent, projectDocument, startEditorBrowser } from "../shared";
import { startAssemblyApplication } from "../assembly/application";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";

test("file branch offline revocation remote and epoch transitions retain drafts without overwriting source", async () => {
  const evidence = resolve(`docs/evidence/p31-source-tracking/transitions-${crypto.randomUUID()}`);
  await mkdir(evidence, { recursive: true });
  const resources = new AsyncDisposableStack();
  let root = "";
  try {
    const app = resources.use(await startAssemblyApplication({}));
    root = app.dataDir;
    const sockets = new Set<Parameters<typeof app.application.websocket.open>[0]>();
    const openSocket = app.application.websocket.open;
    app.application.websocket.open = socket => { sockets.add(socket); return openSocket(socket); };
    const owner = await authenticateApi(app);
    const reviewer = await authenticateApi(app, "sam@quire.local");
    const browser = resources.use(await startEditorBrowser());
    const author = await browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
    resources.defer(() => author.close());
    const observer = await browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
    resources.defer(() => observer.close());
    await author.addCookies([reviewer.cookie]); await observer.addCookies([owner.cookie]);
    const page = await author.newPage(), other = await observer.newPage();
    const errors: string[] = [];
    for (const current of [page, other]) current.on("pageerror", error => errors.push(error.message));
    resources.defer(async () => {
      await page.screenshot({ path: `${evidence}/terminal.png` });
      await Bun.write(`${evidence}/terminal.html`, await page.content());
      await Bun.write(`${evidence}/errors.json`, JSON.stringify(errors));
    });
    const path = `/projects/${ids.project}/edit`;
    const scope = { projectId: ids.project, branch: "main", fileId: ids.mainFile };
    await Promise.all([
      openSurface(page, { path, selector: '.q-source-panel[data-tracking-state="ready"]' }),
      openSurface(other, { path, selector: '.cm-content[contenteditable="true"]' }),
    ]);
    const original = await projectDocument(observer, scope);
    await page.getByRole("button", { name: "Track changes off", exact: true }).click();
    const source = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
    await source.click(); await source.press("ControlOrMeta+End"); await page.keyboard.insertText("% retained proposal 😀");
    const draft = await page.getByLabel("Retained proposal draft").inputValue();
    expect(draft).toBe(original.text + "% retained proposal 😀");
    const secondFile = "tracking-second.tex";
    const fileResponse = await owner.http.post(`api/projects/${ids.project}/files`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      json: { scope: { projectId: ids.project, branch: "main" }, path: secondFile, kind: "file", text: "second source", expectedVersion: 0 },
    });
    expect(fileResponse.status).toBe(200);
    const listed = await surfaceSignal(page, `.editor-tools [role="treeitem"][title="${secondFile}"]`);
    await listed.observed;
    const secondOpened = await surfaceSignal(page, `.cm-content[aria-label="Source: ${secondFile}"]`);
    await page.getByRole("treeitem", { name: secondFile, exact: true }).click(); await secondOpened.observed;
    expect(await page.getByLabel("Retained proposal draft").count()).toBe(0);
    expect(await page.getByRole("button", { name: "Track changes off", exact: true }).count()).toBe(1);
    const restored = await surfaceSignal(page, '.cm-content[aria-label="Source: main.tex"][contenteditable="true"]');
    await page.getByRole("treeitem", { name: "main.tex", exact: true }).click(); await restored.observed;
    expect(await page.getByLabel("Retained proposal draft").inputValue()).toBe(draft);
    const branched = await owner.http.post(`api/projects/${ids.project}/git/branches`, {
      headers: { "idempotency-key": crypto.randomUUID() }, json: { name: "tracking-other", from: "main", expectedVersion: 1 },
    });
    expect(branched.status).toBe(200);
    await openSurface(page, { path: `${path}?branch=tracking-other`, selector: '.q-source-panel[data-tracking-state="ready"]' });
    expect(await page.getByLabel("Retained proposal draft").count()).toBe(0);
    await openSurface(page, { path, selector: '.q-source-panel[data-tracking-state="draft"]' });
    expect(await page.getByLabel("Retained proposal draft").inputValue()).toBe(draft);
    const offline = await surfaceSignal(page, '.q-source-panel[data-tracking-state="offline"]');
    await author.setOffline(true);
    // Chromium leaves established WebSockets open; sever the owned native sockets too.
    for (const socket of sockets) socket.close(1001, "P31 offline network cut");
    await offline.observed;
    expect(await page.getByRole("button", { name: "Submit proposal", exact: true }).isDisabled()).toBe(true);
    expect(await page.getByLabel("Retained proposal draft").inputValue()).toBe(draft);
    const reconnected = await surfaceSignal(page, '.q-source-panel[data-tracking-state="draft"]');
    await author.setOffline(false); await reconnected.observed;
    const revoked = await surfaceSignal(page, '.q-source-panel[data-tracking-permission="denied"]');
    expect((await owner.http.patch(`api/projects/${ids.project}/members/${reviewer.user.id}`, {
      json: { role: "viewer", expectedVersion: 0 },
    })).status).toBe(200);
    await revoked.observed;
    expect(await page.getByRole("button", { name: "Submit proposal", exact: true }).isDisabled()).toBe(true);
    expect(await page.getByLabel("Retained proposal draft").inputValue()).toBe(draft);
    const reauthorized = await surfaceSignal(page, '.q-source-panel[data-tracking-permission="allowed"]');
    expect((await owner.http.patch(`api/projects/${ids.project}/members/${reviewer.user.id}`, {
      json: { role: "reviewer", expectedVersion: 1 },
    })).status).toBe(200);
    await reauthorized.observed;
    const conflict = await surfaceSignal(page, '.q-source-panel[data-tracking-state="conflict"]');
    using remote = nextApplicationEvent(app, event => event.topic === "document.saved"
      && event.aggregateId === ids.project && event.payload.resourceId === ids.mainFile);
    await other.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+End");
    await other.keyboard.insertText("% remote owner");
    await remote.promise; await conflict.observed;
    expect(await page.getByLabel("Retained proposal draft").inputValue()).toBe(draft);
    expect(await page.getByRole("button", { name: "Submit proposal", exact: true }).isDisabled()).toBe(true);
    expect((await projectDocument(observer, scope)).text).toBe(original.text + "% remote owner");
    const projects = app.application.runtime.services.get("projects");
    if (!(projects instanceof CoreProjects)) throw new Error("Native projects required");
    const epochDoc = new Y.Doc();
    const epochText = "\\documentclass{article}\n\\begin{document}\nNEW EPOCH\n\\end{document}\n";
    epochDoc.getText("source").insert(0, epochText);
    try {
      await projects.serialized({ projectId: ids.project, branch: "main" }, async lease => {
        const revision = (await projects.getBranch(scope)).revision;
        await projects.commitSource({ lease, actorId: owner.user.id,
          scope: { projectId: ids.project, branch: "main" }, expectedRevision: revision,
          inputs: (await projects.listFiles(scope)).map(file => file.id === ids.mainFile
            ? { file: { ...file, version: { ...file.version, epoch: file.version.epoch + 1 } }, document: epochDoc } : { file }),
        });
      });
    } finally { epochDoc.destroy(); }
    await openSurface(page, { path, selector: '.q-source-panel[data-tracking-state="conflict"]' });
    expect(await page.getByLabel("Retained proposal draft").inputValue()).toBe(draft);
    expect((await projectDocument(observer, scope)).text).toBe(epochText);
    // Explicit discard is the only operation that removes the recovery copy.
    await page.getByRole("button", { name: "Discard local draft…", exact: true }).click();
    await page.getByRole("button", { name: "Keep draft", exact: true }).click();
    expect(await page.getByLabel("Retained proposal draft").inputValue()).toBe(draft);
    await page.getByRole("button", { name: "Discard local draft…", exact: true }).click();
    await page.getByRole("button", { name: "Discard draft", exact: true }).click();
    const restarted = await surfaceSignal(page, '.q-source-panel[data-tracking-state="ready"]');
    await restarted.observed;
    expect(await page.getByLabel("Retained proposal draft").count()).toBe(0);
    expect(await source.innerText()).toContain("NEW EPOCH");
    const proposalsResponse = await owner.http.get(`api/projects/${ids.project}/suggestions`, { searchParams: { branch: "main" } });
    const proposals = editorValue(resultSchema(endpoints.suggestionsList.output).parse(await proposalsResponse.json()));
    expect(proposals.items).toEqual([]);
    expect(errors).toEqual([]);
    await Bun.write(`${evidence}/workflow.json`, JSON.stringify({ draft, server: epochText, proposals, errors }, null, 2));
    console.info("P31_TRANSITIONS_PASS", evidence);
  } finally {
    await resources.disposeAsync();
    const absent = root ? await access(root).then(() => false, () => true) : true;
    await Bun.write(`${evidence}/cleanup.json`, JSON.stringify({ root, absent }));
    expect(absent).toBe(true);
    console.info("P31_TRANSITIONS_CLEANED", root);
  }
}, 180_000);
