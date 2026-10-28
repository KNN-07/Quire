import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { figureCommand } from "../../../apps/web/src/features/editor/visual/media";
import { authenticatedContext, nextApplicationEvent, projectDocument, startEditorApplication,
  startEditorBrowser, waitForRenderedText } from "../shared";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";
import { createProject, responseAfter } from "../tools/helpers";

test("mounted Library citation and image share exact source through offline recovery", async () => {
  expect(Bun.version).toBe("1.4.4");
  await using resources = new AsyncDisposableStack();
  const app = resources.use(await startEditorApplication());
  const browser = resources.use(await startEditorBrowser());
  const actor = resources.use(await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } }));
  const sockets = new Set<Parameters<typeof app.application.websocket.open>[0]>();
  const open = app.application.websocket.open;
  app.application.websocket.open = socket => { sockets.add(socket); return open(socket); };
  console.info("P10_COMBINED_OWNED", { root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin });
  const project = await createProject(actor, { name: "P10 independent combined", origin: app.url.origin });
  const scope = { projectId: project.id, branch: "main", fileId: project.settings.mainFileId };
  const initial = (await projectDocument(actor.context, scope)).text;
  const raw = "@article{combined2026,title={Independent combined source},year=2026}";
  const recordResponse = await actor.context.request.post("/api/me/library", {
    headers: { origin: app.url.origin, "x-csrf-token": actor.session.csrfToken, "idempotency-key": crypto.randomUUID() },
    data: { bibtex: raw, origin: "manual" },
  });
  expect(recordResponse.status()).toBe(200);
  const page = await actor.context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await openSurface(page, { path: `/projects/${project.id}/edit`, selector: '.qe-main .cm-content[contenteditable="true"]' });
  await (await surfaceSignal(page, ".qe-source-header:has(button:not(:disabled))")).observed;
  await page.locator(".qe-main .cm-line").nth(2).click();
  await waitForRenderedText(page, "Ln 3, Col 1");
  await page.getByLabel("Editor tool", { exact: true }).selectOption("bibliography");
  await (await surfaceSignal(page, 'section[aria-label="Local Library"] li')).observed;
  const citationResponse = await responseAfter(page, { path: `/api/projects/${project.id}/citations`, method: "POST" },
    () => page.getByRole("button", { name: "Cite in project", exact: true }).click());
  const bibliography = editorValue(resultSchema(endpoints.citationCreate.output).parse(await citationResponse.json()));
  await waitForRenderedText(page, "Inserted citation combined2026");
  const cited = (await projectDocument(actor.context, scope)).text;
  const insertion = initial.indexOf("\n\n") + 1;
  expect(cited).toBe(initial.slice(0, insertion) + "\\cite{combined2026}" + initial.slice(insertion));
  expect((await projectDocument(actor.context, { ...scope, fileId: bibliography.id })).text).toBe(raw + "\n");

  const source = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
  await page.locator(".qe-main .cm-line").filter({ hasText: "\\end{document}" }).click();
  await source.press("Home");
  const end = cited.indexOf("\\end{document}");
  await waitForRenderedText(page, `Ln ${cited.slice(0, end).split("\n").length}, Col 1`);
  using inserted = nextApplicationEvent(app, event => event.topic === "document.saved"
    && event.aggregateId === project.id && event.payload.resourceId === scope.fileId);
  const upload = await responseAfter(page, { path: `/api/projects/${project.id}/uploads`, method: "POST" }, () =>
    source.evaluate(async element => {
      const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 8;
      const context = canvas.getContext("2d");
      if (!context) throw new TypeError("Canvas unavailable");
      context.fillStyle = "#214a79"; context.fillRect(0, 0, 8, 8);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        value => value ? resolve(value) : reject(new TypeError("PNG unavailable")), "image/png"));
      const data = new DataTransfer(); data.items.add(new File([blob], "combined.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }));
  expect(upload.status()).toBe(200);
  const image = editorValue(resultSchema(endpoints.filesUpload.output).parse(await upload.json()))[0];
  if (!image) throw new TypeError("Uploaded image missing");
  await waitForRenderedText(page, `\\includegraphics[width=0.8\\linewidth]{${image.path}}`);
  await inserted.promise;
  await (await surfaceSignal(page, '.qe-status [data-save-state="saved"]')).observed;
  const combined = (cited.slice(0, end) + figureCommand(image.path) + cited.slice(end))
    .replace("\\begin{document}", "\\usepackage{graphicx}\n\\begin{document}");
  expect((await projectDocument(actor.context, scope)).text).toBe(combined);
  expect((await projectDocument(actor.context, { ...scope, fileId: bibliography.id })).text).toBe(raw + "\n");
  await page.screenshot({ path: "docs/evidence/p10-native-verification/combined-1440.png" });

  const offline = await surfaceSignal(page, '.qe-status [data-save-state="offline"]');
  await actor.context.setOffline(true);
  for (const socket of sockets) socket.close(1001, "Independent combined network cut");
  await offline.observed;
  const marker = "\n% independent combined offline bytes\n";
  await source.press("ControlOrMeta+End");
  await page.keyboard.insertText(marker);
  expect(await source.getAttribute("contenteditable")).toBe("true");
  expect((await projectDocument(actor.context, scope)).text).toBe(combined);
  const saved = await surfaceSignal(page, '.qe-status [data-save-state="saved"]');
  await actor.context.setOffline(false);
  await saved.observed;
  expect((await projectDocument(actor.context, scope)).text).toBe(combined + marker);
  expect((await projectDocument(actor.context, { ...scope, fileId: bibliography.id })).text).toBe(raw + "\n");
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "docs/evidence/p10-native-verification/combined-390.png" });
  console.info("P10_COMBINED_BYTES", { project: project.id, source: combined + marker, bibliography: raw + "\n", image: image.path });
  await resources.disposeAsync();
  expect(existsSync(app.dataDir)).toBe(false);
  expect([...sockets].every(socket => socket.readyState === WebSocket.CLOSED)).toBe(true);
  expect(browser.browser.isConnected()).toBe(false);
  for (const url of [app.url.origin, app.apiUrl.origin]) {
    expect(await fetch(url, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false)).toBe(false);
  }
  console.info("P10_COMBINED_CLEANUP", { rootAbsent: app.dataDir, listenersClosed: [app.url.origin, app.apiUrl.origin],
    socketsClosed: sockets.size, browserClosed: true });
}, 120_000);
