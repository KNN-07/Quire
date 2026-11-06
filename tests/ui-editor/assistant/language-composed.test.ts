import { expect, test } from "bun:test";
import { mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { providerServer } from "../../adapters/ai/provider";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticateApi, startEditorBrowser, projectDocument, assistantSettings, waitForRenderedText } from "../shared";
import { startAssemblyApplication } from "../assembly/application";
import { openSurface } from "../assembly/actual-browser";
import { consent } from "./browser";

test("composed language settings, Unicode selection actions and caret completion produce only reviewed edits", async () => {
  const evidence = resolve("docs/evidence/p73-language-interactions", crypto.randomUUID());
  await mkdir(evidence, { recursive: true });
  const resources = new AsyncDisposableStack();
  let root: string | undefined;
  const requests: unknown[] = [];
  try {
    const provider = resources.use(providerServer());
    const http = new SafeHttpClient({ fixtureOrigins: [provider.origin], maxBytes: 16 * 1024 * 1024, timeoutMs: 60_000 });
    const app = resources.use(await startAssemblyApplication({ http, ai: { http } }));
    root = app.dataDir;
    const owner = await authenticateApi(app);
    const operator = await authenticateApi(app, "operator@quire.local");
    const configured = await operator.http.put("api/admin/providers/ai", { headers: { "if-match": '"0"' }, json: {
      baseUrl: `${provider.origin}/v1`, model: "fixture-model", secret: "fixture-ai-key",
      policy: { ...defaultPolicy, ai: "agent", aiDailyUses: 50 }, expectedVersion: 0,
    } });
    expect(configured.status).toBe(200);
    const runtime = app.application.runtime;
    await runtime.db.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'project',?,?,?)",
      [crypto.randomUUID(), fixtureIds.project, JSON.stringify({ ...defaultPolicy, ai: "agent" }), runtime.clock.now()]);
    await runtime.db.run("UPDATE organizations SET policy_json=? WHERE id IN (SELECT organization_id FROM members WHERE user_id=?)",
      [JSON.stringify({ ...defaultPolicy, ai: "agent" }), owner.user.id]);
    const browser = resources.use(await startEditorBrowser());
    const context = await browser.browser.newContext({ baseURL: app.url.origin, viewport: { width: 1440, height: 900 } });
    resources.defer(() => context.close());
    await context.addCookies([owner.cookie]);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    resources.defer(async () => {
      await page.screenshot({ path: `${evidence}/terminal.png` });
      await Bun.write(`${evidence}/terminal.html`, await page.content());
      await Bun.write(`${evidence}/requests.json`, JSON.stringify(requests, null, 2));
      await Bun.write(`${evidence}/provider.json`, JSON.stringify(provider.received, null, 2));
      await Bun.write(`${evidence}/errors.json`, JSON.stringify(errors, null, 2));
    });
    const source = page.getByRole("textbox", { name: "Source: main.tex", exact: true });
    const scope = { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile };
    const capture = async (name: string) => {
      const cdp = await context.newCDPSession(page);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: width === 390 ? 3 : 1, mobile: width === 390 });
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: width === 390 });
        if (name === "word-menu") {
          const drawers = page.getByRole("dialog");
          while (await drawers.count()) await drawers.last().getByRole("button", { name: "Close dialog", exact: true }).click();
          await page.getByRole("toolbar", { name: "Contextual language actions" }).waitFor({ state: "visible" });
        } else if (name === "settings") await openSettings();
        else if (!await page.locator(".qa-assistant").isVisible()) await page.getByRole("button", { name: "Assistant", exact: true }).last().click();
        for (const theme of ["light", "dark"]) {
          await page.emulateMedia({ colorScheme: theme === "dark" ? "dark" : "light" });
          await page.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
          await page.evaluate(async () => {
            await document.fonts.ready;
            await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
          });
          await page.screenshot({ path: `${evidence}/${name}-${width}-${theme}.png`, animations: "disabled" });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
      }
      await cdp.send("Emulation.clearDeviceMetricsOverride"); await cdp.detach();
      await page.setViewportSize({ width: 1440, height: 900 });
    };
    const openSettings = async () => {
      await source.waitFor({ state: "visible" });
      if (!await page.locator(".qa-assistant").isVisible()) await page.getByRole("button", { name: "Assistant", exact: true }).last().click();
      await page.locator(".qa-assistant__header").waitFor({ state: "visible" });
      await assistantSettings(page, true);
      const details = page.locator(".qa-assistant__settings");
      if (!await details.evaluate(node => node.hasAttribute("open"))) await details.locator("summary").click();
    };
    const save = async () => {
      const pending = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith(endpoints.preferencesPatch.path));
      await page.getByRole("button", { name: "Save AI preferences", exact: true }).click();
      const response = await pending;
      const preferences = editorValue(resultSchema(endpoints.preferencesPatch.output).parse(await response.json()));
      expect(response.status()).toBe(200);
      await waitForRenderedText(page, "AI preferences saved");
      return preferences;
    };
    const send = async () => {
      const gate = provider.gate();
      const finished = Promise.withResolvers<void>();
      const timeout = setTimeout(() => finished.reject(new TypeError("Language run terminal event deadline")), 30_000);
      const unsubscribe = runtime.events.subscribe(event => {
        if (event.topic === "operation.changed" && ["succeeded", "failed", "canceled", "timeout"].includes(event.payload.status)) finished.resolve();
      });
      try {
      const pending = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/ai/runs"));
      await page.getByRole("button", { name: "Send", exact: true }).click();
      const response = await pending;
      requests.push({ status: response.status(), body: response.request().postDataJSON() });
      expect(response.status()).toBe(202);
      const created = editorValue(resultSchema(endpoints.aiRunCreate.output).parse(await response.json()));
      await gate.entered;
      await page.locator(`.qa-assistant__progress[data-run-id="${created.id}"][data-run-status="running"]`).waitFor({ state: "visible" });
      gate.release();
      await finished.promise;
      const result = await context.request.get(`/api/ai/runs/${created.id}`);
      const run = editorValue(resultSchema(endpoints.aiRunGet.output).parse(await result.json()));
      requests.push({ run });
      expect(run.status).toBe("succeeded");
      await page.locator(`.qa-assistant__progress[data-run-id="${created.id}"][data-run-status="succeeded"]`).waitFor({ state: "visible" });
      expect(await page.getByRole("region", { name: "Run progress", exact: true }).getByRole("status").textContent()).toBe("Result ready");
      } finally { gate.release(); clearTimeout(timeout); unsubscribe(); }
    };
    await openSurface(page, { path: `/projects/${scope.projectId}/edit`, selector: ".qa-assistant__composer" });
    await consent(page);
    await openSettings();
    await page.getByLabel("Enable inline completion", { exact: true }).check();
    expect((await save()).inlineCompletion).toBe(true);
    await capture("settings");
    await assistantSettings(page, false);
    // Native source edits and keyboard selection, with no test-only editor handle.
    const original = "naïve word. 第二句。\nThe result is ";
    await source.press("Control+a"); await source.press("Backspace");
    await page.keyboard.insertText(original);
    await source.press("Control+Home");
    for (let index = 0; index < 5; index++) await source.press("Shift+ArrowRight");
    const menu = page.getByRole("toolbar", { name: "Contextual language actions" });
    await menu.waitFor({ state: "visible" });
    expect(await menu.getByRole("button", { name: "Synonyms", exact: true }).count()).toBe(1);
    expect(await menu.getByRole("button", { name: "Join sentences", exact: true }).count()).toBe(0);
    expect(provider.received).toHaveLength(0);
    await capture("word-menu");
    await source.press("Control+Home"); await source.press("Shift+End");
    expect(await menu.getByRole("button", { name: "Join sentences", exact: true }).count()).toBe(1);
    expect(await menu.getByRole("button", { name: "Split sentence", exact: true }).count()).toBe(0);
    expect(await menu.getByRole("button", { name: "Synonyms", exact: true }).count()).toBe(0);
    await source.press("Control+Home");
    for (let index = 0; index < 11; index++) await source.press("Shift+ArrowRight");
    expect(await menu.getByRole("button", { name: "Split sentence", exact: true }).count()).toBe(1);
    expect(await menu.getByRole("button", { name: "Join sentences", exact: true }).count()).toBe(0);
    await source.press("Control+Home");
    for (let index = 0; index < 5; index++) await source.press("Shift+ArrowRight");
    provider.respond(input => ({ text: "Review the proposed replacement.", citations: [], patches: input.files.map(file => ({
      fileId: file.id, path: file.path, from: file.from, to: file.to, before: file.text, after: input.tool === "inline-completion" ? "stable." : "refined",
    })) }));
    await menu.getByRole("button", { name: "Synonyms", exact: true }).click();
    await send();
    expect(provider.contexts.at(-1)?.files[0]).toMatchObject({ from: 0, to: 5, text: "naïve" });
    expect((await projectDocument(context, scope)).text).toBe(original);
    await capture("review");
    await page.getByRole("button", { name: "Accept all", exact: true }).click();
    await waitForRenderedText(page, "Accepted 1 edits");
    expect((await projectDocument(context, scope)).text).toBe(original.replace("naïve", "refined"));
    // Completion at an empty caret uses a zero-length editable range.
    await source.press("Control+End");
    await source.press("Control+Alt+l");
    await menu.getByRole("button", { name: "Inline completion", exact: true }).click();
    const beforeCompletion = (await projectDocument(context, scope)).text;
    await send();
    expect(provider.contexts.at(-1)?.files[0]).toMatchObject({ from: beforeCompletion.length, to: beforeCompletion.length, text: "" });
    expect((await projectDocument(context, scope)).text).toBe(beforeCompletion);
    await page.getByRole("button", { name: "Accept all", exact: true }).click();
    await waitForRenderedText(page, "Accepted 1 edits");
    expect((await projectDocument(context, scope)).text).toBe(`${beforeCompletion}stable.`);
    await openSettings();
    await page.getByLabel("Enable language tools", { exact: true }).uncheck();
    await page.getByLabel("Show contextual language menu", { exact: true }).uncheck();
    const disabled = await save();
    expect(disabled.languageEnabled).toBe(false);
    expect(disabled.languageFloatingMenu).toBe(false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await openSettings();
    expect(await page.getByLabel("Enable language tools", { exact: true }).isChecked()).toBe(false);
    expect(await page.getByLabel("Show contextual language menu", { exact: true }).isChecked()).toBe(false);
    await assistantSettings(page, false);
    await source.press("Control+Home"); await source.press("Shift+ArrowRight");
    await source.press("Control+Alt+l");
    expect(await menu.count()).toBe(0);
    expect(errors).toEqual([]);
    await Bun.write(`${evidence}/receipts.json`, JSON.stringify({ requests, providerContexts: provider.contexts, errors,
      root, runtime: Bun.version, boundary: "Owned HTTP protocol fixture; no live provider inference" }, null, 2));
    console.info("P73_EVIDENCE", evidence);
  } finally {
    await resources.disposeAsync();
    if (root) {
      const removed = await access(root).then(() => false, () => true);
      expect(removed).toBe(true);
      await Bun.write(`${evidence}/cleanup.json`, JSON.stringify({ root, removed }));
    }
  }
}, 240_000);
