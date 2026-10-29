import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect } from "bun:test";
import type { Page } from "@playwright/test";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { authenticateApi, startEditorBrowser, waitForRenderedText } from "../shared";
import { startAssemblyApplication } from "../assembly/application";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";
import { responseAfter } from "../tools/helpers";

export function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((fulfill, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 30_000);
    void promise.then(value => { clearTimeout(deadline); fulfill(value); }, error => { clearTimeout(deadline); reject(error); });
  });
}

/** Owned HTTP vendor, real native service, browser and storage; no API response mocks. */
export async function remoteFixture() {
  const resources = new AsyncDisposableStack();
  try {
    const evidence = resolve(`docs/evidence/p29-remote-bibliography/${crypto.randomUUID()}`);
    await mkdir(evidence, { recursive: true });
    const requests: string[] = [];
    const holds = new Map<string, { started: ReturnType<typeof Promise.withResolvers<void>>; release: ReturnType<typeof Promise.withResolvers<void>> }>();
    const responses = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
    const vendor = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const query = url.searchParams.get("query.bibliographic") ?? "";
        requests.push(url.href);
        const held = holds.get(query);
        if (held) { held.started.resolve(); await held.release.promise; }
        if (url.pathname !== "/works") return new Response(null, { status: 404 });
        return Response.json({ message: { items: [{
          DOI: `10.1234/${query}`, title: [`Research ${query}`],
          author: [{ given: "Grace", family: "Hopper" }, { given: "Ada", family: "Lovelace" }],
          issued: { "date-parts": [[2026, 10, 28]] }, URL: `https://doi.org/10.1234/${query}`,
        }], "total-results": 1 } });
      },
    });
    resources.defer(async () => { for (const hold of holds.values()) hold.release.resolve(); await vendor.stop(true); });
    const http = new SafeHttpClient({ fixtureOrigins: [vendor.url.origin], timeoutMs: 60_000 });
    const app = resources.use(await startAssemblyApplication({ http }));
    // Observe completion without replacing the native handler or any response.
    const handle = app.application.handle;
    app.application.handle = async (request, server) => {
      const response = await handle(request, server);
      const url = new URL(request.url);
      if (url.pathname === "/api/references/search") responses.get(url.searchParams.get("query") ?? "")?.resolve();
      return response;
    };
    const owner = await authenticateApi(app);
    const operator = await authenticateApi(app, "operator@quire.local");
    const configured = await operator.http.put("api/admin/providers/crossref", { headers: { "if-match": '"0"' },
      json: { baseUrl: vendor.url.origin, policy: defaultPolicy, expectedVersion: 0 } });
    expect(configured.status).toBe(200);
    const browser = resources.use(await startEditorBrowser());
    const errors: string[] = [];
    console.info("P29_EVIDENCE", evidence, "P29_OWNED", { root: app.dataDir, vendor: vendor.url.origin,
      api: app.apiUrl.origin, web: app.url.origin });
    const owned = resources.move();
    return { evidence, app, browser, owner, requests, errors,
      hold(query: string) {
        const value = { started: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
        holds.set(query, value);
        const completed = Promise.withResolvers<void>(); responses.set(query, completed);
        return { started: bounded(value.started.promise, `vendor ${query}`), release: () => value.release.resolve(),
          completed: bounded(completed.promise, `native response ${query}`) };
      },
      async [Symbol.asyncDispose]() {
        await owned.disposeAsync();
        const absent = await access(app.dataDir).then(() => false, () => true);
        const listeners = await Promise.all([app.url.origin, app.apiUrl.origin, vendor.url.origin].map(async origin => ({
          origin, closed: await fetch(origin, { signal: AbortSignal.timeout(2000) }).then(() => false, () => true),
        })));
        const cleanup = { root: app.dataDir, absent, browserClosed: !browser.browser.isConnected(), listeners, errors };
        await Bun.write(`${evidence}/cleanup.json`, JSON.stringify(cleanup, null, 2));
        expect(absent).toBe(true); expect(cleanup.browserClosed).toBe(true);
        expect(listeners.every(item => item.closed)).toBe(true);
        console.info("P29_CLEANUP", cleanup);
      },
    };
  } finally { await resources.disposeAsync(); }
}
export type RemoteFixture = Awaited<ReturnType<typeof remoteFixture>>;

export async function bibliography(page: Page, project: string) {
  await openSurface(page, { path: `/projects/${project}/edit`, selector: ".qe-main .cm-content" });
  if (!await page.getByLabel("Editor tool", { exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Files", exact: true }).last().click();
  }
  const ready = await surfaceSignal(page, 'section[aria-label="Remote references"]');
  await page.getByLabel("Editor tool", { exact: true }).selectOption("bibliography");
  await ready.observed;
}

export async function capture(setup: RemoteFixture, page: Page, input: {
  readonly query: string; readonly title: string; readonly target: string;
}) {
  for (const width of [1440, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    const assistant = page.getByRole("dialog", { name: "Assistant", exact: true });
    if (await assistant.isVisible()) await assistant.getByRole("button", { name: "Close dialog", exact: true }).click();
    if (!await page.getByLabel("Editor tool", { exact: true }).isVisible()) {
      await page.getByRole("button", { name: "Files", exact: true }).last().click();
    }
    // Responsive chrome moves tools into a real modal and remounts its producer.
    if (!await page.getByLabel("Remote reference query", { exact: true }).inputValue()) {
      await page.getByLabel("Remote reference query", { exact: true }).fill(input.query);
      const searched = await responseAfter(page, { path: "/api/references/search", method: "GET" }, () =>
        page.getByRole("button", { name: "Search provider", exact: true }).click());
      expect(searched.status()).toBe(200);
      await waitForRenderedText(page, input.title);
    }
    await page.getByLabel("Bibliography target", { exact: true }).selectOption(input.target);
    await page.getByRole("radio", { name: input.title, exact: true }).check();
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.getByRole("heading", { name: "Remote references", exact: true }).evaluate(node => node.scrollIntoView({ block: "start" }));
      await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => done())));
      const alerts = await page.getByRole("region", { name: "Bibliography", exact: true }).getByRole("alert").evaluateAll(nodes =>
        nodes.map(node => ({ text: node.textContent, section: node.closest("section")?.getAttribute("aria-label") })));
      await Bun.write(`${setup.evidence}/alerts-${width}-${theme}.json`, JSON.stringify(alerts, null, 2));
      // Parent also verifies the separate Library loader's cancellation correction.
      expect(await page.locator('section[aria-label="Bibliography"] > [role="alert"]').count()).toBe(0);
      expect(await page.getByRole("region", { name: "Remote references", exact: true }).getByRole("alert").count()).toBe(0);
      expect(await page.getByRole("region", { name: "Local Library", exact: true }).getByRole("alert").count()).toBe(0);
      await page.screenshot({ path: `${setup.evidence}/inspect${width}-${theme}.png`, fullPage: true });
      const geometry = await page.evaluate(() => ({
        width: innerWidth, scroll: document.documentElement.scrollWidth,
        remote: document.querySelector('[aria-label="Remote references"]')?.getBoundingClientRect().toJSON(),
      }));
      expect(geometry.scroll).toBeLessThanOrEqual(width);
      await Bun.write(`${setup.evidence}/inspect${width}-${theme}.json`, JSON.stringify(geometry, null, 2));
    }
  }
}
