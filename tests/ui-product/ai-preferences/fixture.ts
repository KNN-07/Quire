import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect } from "bun:test";
import type { Page } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { providerServer } from "../../adapters/ai/provider";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticateApi, startEditorBrowser, waitForRenderedText } from "../../ui-editor/shared";
import { startAssemblyApplication } from "../../ui-editor/assembly/application";
import { openSurface } from "../../ui-editor/assembly/actual-browser";

export const scope = { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile };
export const editorPath = `/projects/${scope.projectId}/edit`;
export const sourceSelector = '.qe-main .cm-content[contenteditable="true"]';
export const hash = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

export async function preferencesFixture() {
  const resources = new AsyncDisposableStack();
  try {
    const evidence = resolve(`docs/evidence/p61-ai-preferences/${crypto.randomUUID()}`);
    await mkdir(evidence, { recursive: true });
    const provider = resources.use(providerServer());
    const http = new SafeHttpClient({ fixtureOrigins: [provider.origin], maxBytes: 16 * 1024 * 1024, timeoutMs: 60_000 });
    const app = resources.use(await startAssemblyApplication({ http, ai: { http } }));
    const receipts: { method: string; path: string; key: string | null; body: unknown; status: number; response: unknown }[] = [];
    const native = app.application.handle;
    app.application.handle = async (request, server) => {
      const path = new URL(request.url).pathname;
      const retain = path.includes("/ai/") || path === endpoints.preferencesPatch.path || path.includes("/git/branches");
      const body: unknown = retain && !["GET", "HEAD"].includes(request.method) ? await request.clone().json() : null;
      const response = await native(request, server);
      if (response && retain) receipts.push({ method: request.method, path, key: request.headers.get("idempotency-key"),
        body, status: response.status, response: await response.clone().json() });
      return response;
    };
    const owner = await authenticateApi(app);
    const operator = await authenticateApi(app, "operator@quire.local");
    expect((await operator.http.put("api/admin/providers/ai", { headers: { "if-match": '"0"' }, json: {
      baseUrl: `${provider.origin}/v1`, model: "fixture-model", secret: "fixture-ai-key",
      policy: { ...defaultPolicy, ai: "agent", aiDailyUses: 50 }, expectedVersion: 0,
    } })).status).toBe(200);
    const runtime = app.application.runtime;
    await runtime.db.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'project',?,?,?)",
      [crypto.randomUUID(), scope.projectId, JSON.stringify({ ...defaultPolicy, ai: "agent" }), runtime.clock.now()]);
    await runtime.db.run("UPDATE organizations SET policy_json=? WHERE id IN (SELECT organization_id FROM members WHERE user_id=?)",
      [JSON.stringify({ ...defaultPolicy, ai: "agent" }), owner.user.id]);
    const browser = resources.use(await startEditorBrowser());
    const context = await browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
    resources.defer(() => context.close());
    await context.addCookies([owner.cookie]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    resources.defer(async () => {
      await Bun.write(`${evidence}/requests.json`, JSON.stringify(receipts, null, 2));
      await Bun.write(`${evidence}/provider-requests.json`, JSON.stringify(provider.received, null, 2));
      await Bun.write(`${evidence}/terminal.html`, await page.content());
      await page.screenshot({ path: `${evidence}/terminal.png` });
    });
    const origins = [app.url.origin, app.apiUrl.origin, provider.origin];
    await Bun.write(`${evidence}/owned.json`, JSON.stringify({ cwd: process.cwd(), utc: new Date().toISOString(),
      root: app.dataDir, origins, runtime: Bun.version, argv: process.argv }, null, 2));
    console.info("P61_EVIDENCE", evidence, "P61_OWNED", app.dataDir, origins);
    const owned = resources.move();
    return { app, owner, operator, provider, browser, page, context, evidence, errors, receipts,
      async [Symbol.asyncDispose]() {
        await owned.disposeAsync();
        const absent = await access(app.dataDir).then(() => false, () => true);
        const listeners = await Promise.all(origins.map(async origin => ({ origin,
          closed: await fetch(origin, { signal: AbortSignal.timeout(2000) }).then(() => false, () => true) })));
        const cleanup = { root: app.dataDir, absent, listeners, browserClosed: !browser.browser.isConnected(), errors,
          utc: new Date().toISOString() };
        await Bun.write(`${evidence}/cleanup.json`, JSON.stringify(cleanup, null, 2));
        expect(absent).toBe(true); expect(cleanup.browserClosed).toBe(true);
        expect(listeners.every(item => item.closed)).toBe(true);
        console.info("P61_CLEANUP", cleanup);
      },
    };
  } finally { await resources.disposeAsync(); }
}
export type PreferencesFixture = Awaited<ReturnType<typeof preferencesFixture>>;

export async function openAssistant(page: Page, path = editorPath) {
  await openSurface(page, { path, selector: '.qa-assistant__composer' });
}
export async function savePreferences(page: Page, values: { branch?: boolean; shared?: boolean; error?: boolean }) {
  const settings = page.locator(".qa-assistant__settings");
  if (!await settings.evaluate(node => node.hasAttribute("open"))) await settings.locator("summary").click();
  for (const [name, checked] of Object.entries(values)) {
    await settings.locator(`input[name="${name}"]`).setChecked(checked);
  }
  const saved = page.waitForResponse(response => response.url().endsWith(endpoints.preferencesPatch.path)
    && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save AI preferences", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(200);
  const preferences = editorValue(resultSchema(endpoints.preferencesPatch.output).parse(await response.json()));
  await waitForRenderedText(page, "AI preferences saved");
  await settings.locator("summary").click();
  return preferences;
}
export async function matrix(setup: PreferencesFixture, name: string, selector: string) {
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await setup.page.setViewportSize({ width, height: 900 });
    await setup.page.evaluate(async value => {
      document.documentElement.dataset["theme"] = value;
      await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    }, theme);
    if (selector.startsWith(".qa-assistant") && !await setup.page.getByRole("region", { name: "Assistant", exact: true }).isVisible()) {
      await setup.page.getByRole("button", { name: "Assistant", exact: true }).last().click();
    }
    await setup.page.locator(selector).first().scrollIntoViewIfNeeded();
    const geometry = await setup.page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(width);
    await setup.page.screenshot({ path: `${setup.evidence}/${name}-${width}-${theme}.png` });
    await Bun.write(`${setup.evidence}/${name}-${width}-${theme}.json`, JSON.stringify(geometry));
  }
  await setup.page.setViewportSize({ width: 1440, height: 900 });
}
