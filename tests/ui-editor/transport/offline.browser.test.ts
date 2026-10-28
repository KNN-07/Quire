import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticatedContext, projectDocument, startEditorApplication, startEditorBrowser } from "../shared";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";

test("native browser locks the current offline file at ten minutes and reconnects retained source", async () => {
  await using resources = new AsyncDisposableStack();
  const app = resources.use(await startEditorApplication());
  const browser = resources.use(await startEditorBrowser());
  const user = resources.use(await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } }));
  const sockets = new Set<Parameters<typeof app.application.websocket.open>[0]>();
  const open = app.application.websocket.open;
  app.application.websocket.open = socket => { sockets.add(socket); return open(socket); };
  const page = await user.context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const evidence = resolve("docs/evidence/p10-offline");
  await mkdir(evidence, { recursive: true });
  await openSurface(page, { path: `/projects/${fixtureIds.project}/edit`,
    selector: '.qe-main .cm-content[contenteditable="true"]' });
  await page.clock.install({ time: new Date("2026-10-27T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-27T12:00:01Z"));
  const offline = await surfaceSignal(page, '.qe-status [data-save-state="offline"]');
  await user.context.setOffline(true);
  // Chromium's offline flag leaves established WebSockets open. Cut the actual
  // owned server socket as well; reconnects still use the native application.
  for (const socket of sockets) socket.close(1001, "Offline network cut");
  await offline.observed;
  const marker = "\n% retained native offline source\n";
  const source = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
  await source.press("ControlOrMeta+End");
  await page.keyboard.insertText(marker);
  const reconnectFailed = page.waitForEvent("requestfailed", {
    predicate: request => new URL(request.url()).pathname === `/api/projects/${fixtureIds.project}/effective-access`,
    timeout: 10_000,
  });
  await page.clock.fastForward(599_999);
  await reconnectFailed;
  // Drain the failed fetch's promise continuation before advancing its retry timer.
  await page.evaluate(() => Promise.resolve());
  expect(await source.getAttribute("contenteditable")).toBe("true");
  const expired = await surfaceSignal(page, '.qe-main .cm-content[contenteditable="false"]');
  await page.clock.runFor(1);
  await expired.observed;
  expect(await source.textContent()).toContain(marker.trim());
  expect((await projectDocument(user.context, {
    projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile,
  })).text).not.toContain(marker);
  await page.screenshot({ path: `${evidence}/expired-1440.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("dialog", { name: "Assistant", exact: true })
    .getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("dialog", { name: "Project tools", exact: true })
    .getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.screenshot({ path: `${evidence}/expired-390.png` });
  const saved = await surfaceSignal(page, '.qe-status [data-save-state="saved"]');
  await user.context.setOffline(false);
  await page.clock.runFor(1000);
  await saved.observed;
  expect(await source.getAttribute("contenteditable")).toBe("true");
  expect((await projectDocument(user.context, {
    projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile,
  })).text).toContain(marker);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: `${evidence}/reconnected-390.png` });
  await resources.disposeAsync();
  expect([...sockets].every(socket => socket.readyState === WebSocket.CLOSED)).toBe(true);
  expect(existsSync(app.dataDir)).toBe(false);
  console.info("P10_OFFLINE_RESOURCES_CLOSED", { root: app.dataDir, web: app.url.origin,
    api: app.apiUrl.origin, sockets: sockets.size });
}, 120_000);
