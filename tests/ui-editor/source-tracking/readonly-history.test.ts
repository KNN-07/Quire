import { afterAll, beforeAll, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { resourceVersionTag } from "@quire/contracts";
import { surfaceSignal } from "../assembly/actual-browser";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticatedContext, projectDocument, startEditorApplication, startEditorBrowser } from "../shared";
import type * as Harness from "./standalone";

const buildRoot = resolve("tests/ui-editor/source-tracking/readonly-build");
const entry = `/@fs${resolve(buildRoot, "standalone.js")}`;
const html = `/@fs${resolve("tests/ui-editor/source-tracking/readonly-history.html")}`;
beforeAll(async () => {
  const result = await Bun.build({
    entrypoints: [resolve("tests/ui-editor/source-tracking/standalone.tsx")],
    outdir: buildRoot, target: "browser", minify: true,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success) throw new AggregateError(result.logs, "Readonly history fixture build failed");
});
afterAll(() => rm(buildRoot, { recursive: true, force: true }));

test.each(["default", "vim", "emacs"] as const)("readonly %s undo and redo preserve retained tracking text", async mode => {
  await using app = await startEditorApplication();
  const sockets = new Set<Parameters<typeof app.application.websocket.open>[0]>();
  const openSocket = app.application.websocket.open;
  const closeSocket = app.application.websocket.close;
  app.application.websocket.open = socket => { sockets.add(socket); return openSocket(socket); };
  app.application.websocket.close = (socket, code, reason) => {
    sockets.delete(socket); return closeSocket(socket, code, reason);
  };
  await using browser = await startEditorBrowser();
  await using owner = await authenticatedContext(browser, app);
  const version = owner.session.preferences.version;
  const preferences = await owner.context.request.patch("/api/me/preferences", {
    headers: { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken, "if-match": resourceVersionTag(version) },
    data: { bindings: mode, expectedVersion: version },
  });
  expect(preferences.status()).toBe(200);
  const page = await owner.context.newPage();
  try {
    await page.goto(`${html}?project=${fixtureIds.project}`);
    await page.evaluate(async path => { const module: typeof Harness = await import(path); await module.ready; }, entry);
    await page.evaluate(() => document.addEventListener("keydown", event => {
      if (event.code === "KeyZ" && event.ctrlKey && event.shiftKey) console.info(`P39_REDO_KEY=${event.key}`);
    }));
    const scope = { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile };
    const original = await projectDocument(owner.context, scope);
    await page.getByRole("button", { name: "Track changes off", exact: true }).click();
    await page.getByRole("button", { name: "Track changes on", exact: true }).waitFor();
    const content = page.locator(".q-source-editor .cm-content");
    await content.click();
    if (mode === "vim") { await page.keyboard.press("Escape"); await page.keyboard.press("A"); }
    else await page.keyboard.press("Control+End");
    const marker = `READONLY_${mode}_PRESERVE`;
    await page.keyboard.insertText(marker);
    if (mode === "vim") await page.keyboard.press("Escape");
    const draft = await content.textContent();
    expect(draft).toContain(marker);
    const paused = await surfaceSignal(page, '.q-source-editor .cm-content[contenteditable="false"]');
    await owner.context.setOffline(true);
    for (const socket of sockets) socket.close(1001, "Readonly history network cut");
    await paused.observed;
    await content.press(mode === "vim" ? "u" : mode === "emacs" ? "Control+/" : "Control+z");
    expect(await content.textContent()).toBe(draft);
    expect((await projectDocument(owner.context, scope)).text).toBe(original.text);
    const resumed = await surfaceSignal(page, '.q-source-editor .cm-content[contenteditable="true"]');
    await owner.context.setOffline(false);
    await resumed.observed;
    await content.press(mode === "vim" ? "u" : mode === "emacs" ? "Control+/" : "Control+z");
    const undone = await content.textContent();
    expect(undone).not.toContain(marker);
    const pausedAgain = await surfaceSignal(page, '.q-source-editor .cm-content[contenteditable="false"]');
    await owner.context.setOffline(true);
    for (const socket of sockets) socket.close(1001, "Readonly history redo network cut");
    await pausedAgain.observed;
    await content.press(mode === "vim" ? "Control+r" : "Control+Shift+Z");
    expect(await content.textContent()).toBe(undone);
    const resumedAgain = await surfaceSignal(page, '.q-source-editor .cm-content[contenteditable="true"]');
    await owner.context.setOffline(false);
    await resumedAgain.observed;
    const redoKey = mode === "vim" ? null : page.waitForEvent("console", {
      predicate: message => message.text().startsWith("P39_REDO_KEY="), timeout: 10_000,
    });
    await content.press(mode === "vim" ? "Control+r" : "Control+Shift+Z");
    if (redoKey) expect((await redoKey).text()).toBe("P39_REDO_KEY=Z");
    expect(await content.textContent()).toBe(draft);
    expect((await projectDocument(owner.context, scope)).text).toBe(original.text);
    await page.reload();
    await page.evaluate(async path => { const module: typeof Harness = await import(path); await module.ready; }, entry);
    expect(await page.locator(".q-source-editor .cm-content").textContent()).toBe(draft);
    console.info("READONLY_HISTORY_VERIFIED", { mode, root: app.dataDir, origin: app.url.origin });
  } finally {
    await owner.context.setOffline(false);
    await page.evaluate(async path => { const module: typeof Harness = await import(path); await module.close(); }, entry);
    await page.close();
  }
}, 120_000);
