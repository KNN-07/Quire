import { expect, test } from "bun:test";
import { fixtureIds } from "../../fixtures/foundation";
import { startEditorApplication } from "./application";
import { startEditorBrowser, authenticatedContext } from "./browser";

test("browser upgrades authenticated realtime directly and through the editor proxy", async () => {
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await using actor = await authenticatedContext(browser, app);
  const observations: { path: string; status: number | "upgrade" }[] = [];
  const handle = app.application.handle;
  app.application.handle = async (request, server) => {
    const response = await handle(request, server);
    if (request.headers.get("upgrade") === "websocket") observations.push({
      path: new URL(request.url).pathname, status: response?.status ?? "upgrade",
    });
    return response;
  };
  const page = await actor.context.newPage();
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  const hmrConnected = page.waitForEvent("console", {
    predicate: message => message.text() === "[vite] connected.", timeout: 10000,
  });
  await page.goto(app.url.origin, { waitUntil: "domcontentloaded" });
  await hmrConnected;
  const results = [];
  for (const origin of [app.apiUrl.origin, app.url.origin]) {
    const url = new URL(`/api/projects/${fixtureIds.project}/realtime?branch=main`, origin);
    url.protocol = "ws:";
    results.push(await page.evaluate(({ url: socketUrl, csrf }) => new Promise<{ opened: boolean; code?: number; reason?: string }>(resolve => {
      const socket = new WebSocket(socketUrl, ["quire", `quire.csrf.${csrf}`]);
      const timeout = setTimeout(() => { socket.close(); resolve({ opened: false, reason: "Upgrade deadline" }); }, 10000);
      socket.addEventListener("open", () => { clearTimeout(timeout); socket.close(); resolve({ opened: true }); }, { once: true });
      socket.addEventListener("close", event => {
        clearTimeout(timeout); resolve({ opened: false, code: event.code, reason: event.reason });
      }, { once: true });
    }), { url: url.toString(), csrf: actor.session.csrfToken }));
  }
  console.info("EDITOR_WEBSOCKET_PROBE", { results, observations });
  expect(results).toEqual([{ opened: true }, { opened: true }]);
  expect(errors).toEqual([]);
}, 120000);
