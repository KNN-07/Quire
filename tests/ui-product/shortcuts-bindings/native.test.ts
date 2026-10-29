import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticateApi, nextApplicationEvent, projectDocument, startEditorApplication, startEditorBrowser } from "../../ui-editor/shared";
import type { EditorApplication, EditorBrowser } from "../../ui-editor/shared";
import { openSurface, surfaceSignal } from "../../ui-editor/assembly/actual-browser";

const evidence = resolve("docs/evidence/p56-shortcuts-bindings", crypto.randomUUID());
const source = '.qe-main .cm-content[contenteditable="true"]';
const path = `/projects/${fixtureIds.project}/edit`;
const inputs = [
  "apps/web/src/features/editor/index.tsx",
  "apps/web/src/features/editor/session-controller.ts",
  "apps/web/src/features/editor/source/Settings.tsx",
  "apps/web/src/features/editor/source/preferences.ts",
  "apps/web/src/features/editor/source/editor.ts",
  "apps/web/src/features/editor/source/bindings.ts",
  "apps/web/src/features/editor/pdf/panel.tsx",
  "services/compiler/index.ts",
  "packages/contracts/src/routes-accounts.ts",
  "tests/ui-editor/shared/application.ts",
  "tests/ui-editor/shared/web-server.mjs",
  "tests/ui-editor/assembly/actual-browser.ts",
  "tests/ui-product/shortcuts-bindings/native.test.ts",
  "tests/ui-product/shortcuts-bindings/tsconfig.json",
];
const receipts: unknown[] = [];
function record(kind: string, data: unknown) {
  const entry = { utc: new Date().toISOString(), kind, data };
  receipts.push(entry);
  console.info("P56_RECEIPT", JSON.stringify(entry));
}
async function fingerprints(phase: string) {
  for (const name of inputs) record("input", { phase, path: name,
    sha256: new Bun.CryptoHasher("sha256").update(await Bun.file(name).arrayBuffer()).digest("hex") });
}
async function preferences(context: BrowserContext) {
  const response = await context.request.get(endpoints.preferencesGet.path);
  const body: unknown = await response.json();
  record("preferences-read", { status: response.status(), body });
  expect(response.status()).toBe(200);
  return editorValue(resultSchema(endpoints.preferencesGet.output).parse(body));
}
async function openPreferences(page: Page) {
  await page.locator('.qe-source-header summary[aria-label="Source actions"]').click();
  const opened = await surfaceSignal(page, '.q-source-tools[aria-label="Preferences"]');
  await page.getByRole("button", { name: "Source preferences", exact: true }).click();
  await opened.observed;
}
async function mode(page: Page, binding: "vim" | "emacs") {
  const ready = await surfaceSignal(page, `.q-source-panel .cm-${binding}Mode`);
  await ready.observed;
  expect(await page.locator(`.q-source-panel .cm-${binding === "vim" ? "emacs" : "vim"}Mode`).count()).toBe(0);
  record("editor-mode", { binding, classes: await page.locator(".q-source-panel .cm-scroller").getAttribute("class") });
}

describe("native compile shortcuts and account binding isolation", () => {
  const resources = new AsyncDisposableStack();
  let app: EditorApplication;
  let browser: EditorBrowser;
  beforeAll(async () => {
    try {
      await mkdir(evidence, { recursive: true });
      record("run", { cwd: process.cwd(), evidence, runtime: Bun.version, executable: process.execPath,
        host: process.platform, command: "./node_modules/.bin/bun test tests/ui-product/shortcuts-bindings/native.test.ts" });
      await fingerprints("before");
      app = resources.use(await startEditorApplication());
      record("owned", { root: app.dataDir, web: app.url.origin, api: app.apiUrl.origin });
      browser = resources.use(await startEditorBrowser());
      const unsubscribe = app.application.runtime.events.subscribe(event => {
        if (event.topic === "job.changed" && event.aggregateId === fixtureIds.project) record("job.changed", event);
      });
      resources.defer(unsubscribe);
    } catch (cause) { await resources.disposeAsync(); throw cause; }
  }, 120_000);
  afterAll(async () => {
    await resources.disposeAsync();
    let removed = false;
    try { await access(app.dataDir); } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") removed = true;
      else throw cause;
    }
    record("cleanup", { root: app.dataDir, removed, web: app.url.origin, api: app.apiUrl.origin, browserConnected: browser.browser.isConnected() });
    expect(removed).toBe(true);
    expect(browser.browser.isConnected()).toBe(false);
    await fingerprints("after");
    await Bun.write(`${evidence}/receipts.json`, JSON.stringify(receipts, null, 2));
  }, 90_000);

  for (const mapping of [
    { key: "Control+Enter", platform: null, label: "linux-control" },
    { key: "Meta+Enter", platform: "MacIntel", label: "synthetic-mac-meta" },
  ]) test(`invokes real compile with ${mapping.label}`, async () => {
    const identity = await authenticateApi(app);
    const context = await browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
    try {
      await context.addCookies([identity.cookie]);
      if (mapping.platform) await context.addInitScript(platform => {
        Object.defineProperty(navigator, "platform", { get: () => platform });
      }, mapping.platform);
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.addEventListener("keydown", event => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) console.info("P56_KEY", JSON.stringify({
            key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, trusted: event.isTrusted,
            platform: navigator.platform, target: event.target instanceof Element ? event.target.getAttribute("aria-label") : null,
          }));
        }, true);
      });
      await openSurface(page, { path, selector: source });
      const connected = await surfaceSignal(page, '.qe-status [data-environment-state="ready"]');
      await connected.observed;
      const before = await projectDocument(context, { projectId: fixtureIds.project, fileId: fixtureIds.mainFile, branch: "main" });
      expect(before.text).toContain("\\begin{document}");
      expect(before.text).toContain("\\end{document}");
      record("compile-input", { mapping, actor: identity.user.id, revision: before.file.version.revision,
        sha256: new Bun.CryptoHasher("sha256").update(before.text).digest("hex") });
      using queued = nextApplicationEvent(app, event => event.topic === "job.changed"
        && event.aggregateId === fixtureIds.project && event.payload.status === "queued", 90_000);
      using succeeded = nextApplicationEvent(app, event => event.topic === "job.changed"
        && event.aggregateId === fixtureIds.project && event.payload.status === "succeeded", 90_000);
      const responseSignal = page.waitForResponse(response => response.request().method() === "POST"
        && new URL(response.url()).pathname === endpoints.compileCreate.path.replace(":p", fixtureIds.project), { timeout: 90_000 });
      const keySignal = page.waitForEvent("console", { predicate: message => message.text().startsWith("P56_KEY "), timeout: 30_000 });
      await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press(mapping.key);
      const [response, queuedEvent, succeededEvent, keyEvent] = await Promise.all([responseSignal, queued.promise, succeeded.promise, keySignal]);
      const body: unknown = await response.json();
      const job = editorValue(resultSchema(endpoints.compileCreate.output).parse(body));
      record("compile-action", { mapping, key: keyEvent.text(), method: response.request().method(),
        url: response.url(), request: response.request().postData(), status: response.status(), body, queuedEvent, succeededEvent });
      expect(response.ok()).toBe(true);
      if (queuedEvent.topic !== "job.changed" || succeededEvent.topic !== "job.changed") throw new TypeError("Unexpected compile event");
      expect(queuedEvent.payload.resourceId).toBe(job.id);
      expect(succeededEvent.payload.resourceId).toBe(job.id);
      const previewResponse = await context.request.get(`/api/projects/${fixtureIds.project}/compile-preview`, { params: { branch: "main" } });
      const previewBody: unknown = await previewResponse.json();
      const preview = editorValue(resultSchema(endpoints.compilePreview.output).parse(previewBody));
      expect(preview.job?.id).toBe(job.id);
      expect(preview.job?.status).toBe("succeeded");
      if (!preview.preview) throw new TypeError("Real compile did not publish a PDF");
      const artifact = await context.request.get(`/api/artifacts/${preview.preview.artifact.id}/content`);
      const bytes = await artifact.body();
      expect(artifact.status()).toBe(200);
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      const rendered = await surfaceSignal(page, `[data-artifact-id="${preview.preview.artifact.id}"] canvas[data-rendered="true"]`, 90_000);
      await rendered.observed;
      await Bun.write(`${evidence}/${mapping.label}.pdf`, bytes);
      await page.screenshot({ path: `${evidence}/${mapping.label}.png` });
      record("pdf", { mapping, status: previewResponse.status(), body: previewBody,
        artifactStatus: artifact.status(), bytes: bytes.length, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") });
      expect((await projectDocument(context, { projectId: fixtureIds.project, fileId: fixtureIds.mainFile, branch: "main" })).text).toBe(before.text);
    } finally { await context.close(); }
  }, 150_000);

  test("persists distinct native binding choices for two independent authenticated actors", async () => {
    const actors = [];
    try {
      for (const [email, binding, width] of [
        ["kien@quire.local", "vim", 1440],
        ["mai@quire.local", "emacs", 390],
      ] as const) {
        const identity = await authenticateApi(app, email);
        const context = await browser.browser.newContext({ baseURL: app.url.origin,
          viewport: { width, height: width === 390 ? 844 : 900 } });
        actors.push({ identity, context, page: await context.newPage(), binding, width });
        await context.addCookies([identity.cookie]);
      }
      const first = actors[0];
      const second = actors[1];
      if (!first || !second) throw new TypeError("Two actors are required");
      expect(first.identity.user.id).not.toBe(second.identity.user.id);
      const initial = await preferences(second.context);
      for (const actor of actors) {
        await openSurface(actor.page, { path, selector: source });
        await openPreferences(actor.page);
        await actor.page.getByLabel("Key bindings", { exact: true }).selectOption(actor.binding);
        const saved = actor.page.waitForResponse(response => response.request().method() === "PATCH"
          && new URL(response.url()).pathname === endpoints.preferencesPatch.path, { timeout: 30_000 });
        await actor.page.getByRole("button", { name: "Save preferences", exact: true }).click();
        const response = await saved;
        const body: unknown = await response.json();
        const value = editorValue(resultSchema(endpoints.preferencesPatch.output).parse(body));
        expect(response.status()).toBe(200);
        expect(value.bindings).toBe(actor.binding);
        record("preferences-action", { actor: actor.identity.user.id, email: actor.identity.user.primaryEmail, binding: actor.binding,
          method: response.request().method(), url: response.url(), request: response.request().postData(), status: response.status(), body });
        await mode(actor.page, actor.binding);
        const enabled = await surfaceSignal(actor.page, '.q-source-tools fieldset:not([disabled])');
        await enabled.observed;
        await actor.page.screenshot({ path: `${evidence}/preferences-${actor.width}.png` });
        if (actor === first) expect(await preferences(second.context)).toEqual(initial);
        else expect((await preferences(first.context)).bindings).toBe(first.binding);
      }
      for (const actor of actors) {
        const accountResponse = await actor.context.request.get(endpoints.me.path);
        const account = editorValue(resultSchema(endpoints.me.output).parse(await accountResponse.json()));
        expect(account.user.id).toBe(actor.identity.user.id);
        expect(account.preferences.bindings).toBe(actor.binding);
        record("account-identity", { actor: account.user.id, email: account.user.primaryEmail, preferences: account.preferences });
        const restored = actor.page.waitForResponse(response => response.request().method() === "GET"
          && new URL(response.url()).pathname === endpoints.me.path, { timeout: 30_000 });
        await actor.page.reload({ waitUntil: "domcontentloaded" });
        await restored;
        await mode(actor.page, actor.binding);
        await openPreferences(actor.page);
        expect(await actor.page.getByLabel("Key bindings", { exact: true }).inputValue()).toBe(actor.binding);
        expect((await preferences(actor.context)).bindings).toBe(actor.binding);
        await actor.page.screenshot({ path: `${evidence}/preferences-reloaded-${actor.width}.png` });
        const geometry = await actor.page.getByLabel("Key bindings", { exact: true }).evaluate(node => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x, right: rect.right, width: rect.width, viewport: innerWidth };
        });
        expect(geometry.width).toBeGreaterThan(0);
        expect(geometry.x).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
        record("reopened-control", { actor: actor.identity.user.id, binding: actor.binding, width: actor.width, geometry });
      }
    } finally { for (const actor of actors) await actor.context.close(); }
  }, 120_000);
});
