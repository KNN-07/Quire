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
import { authenticateApi, nextApplicationEvent, projectDocument, startEditorBrowser, waitForRenderedText } from "../shared";
import { startAssemblyApplication } from "../assembly/application";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";

export const projectPath = `/projects/${fixtureIds.project}`;
export const scope = { projectId: fixtureIds.project, fileId: fixtureIds.mainFile, branch: "main" };
export const sourceSelector = '.qe-main .cm-content[contenteditable="true"]';
export const command = "\\DiagnosticUndefinedControl";

export async function diagnosticFixture(configured = true) {
  const resources = new AsyncDisposableStack();
  try {
    const evidence = resolve(`docs/evidence/p27-diagnostic-ai/${crypto.randomUUID()}`);
    await mkdir(evidence, { recursive: true });
    const provider = resources.use(providerServer());
    const http = new SafeHttpClient({ fixtureOrigins: [provider.origin], maxBytes: 16 * 1024 * 1024, timeoutMs: 60_000 });
    const app = resources.use(await startAssemblyApplication({ http, ai: { http, visionModels: ["fixture-model"] } }));
    const owner = await authenticateApi(app);
    const preferences = editorValue(resultSchema(endpoints.preferencesGet.output).parse(
      await (await owner.http.get("api/me/preferences")).json()));
    expect((await owner.http.patch("api/me/preferences", {
      json: { errorAssist: true, expectedVersion: preferences.version },
    })).status).toBe(200);
    const operator = await authenticateApi(app, "operator@quire.local");
    if (configured) {
      const response = await operator.http.put("api/admin/providers/ai", { headers: { "if-match": '"0"' }, json: {
        baseUrl: `${provider.origin}/v1`, model: "fixture-model", secret: "fixture-ai-key",
        policy: { ...defaultPolicy, ai: "agent", aiDailyUses: 50 }, expectedVersion: 0,
      } });
      expect(response.status).toBe(200);
    }
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
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    console.info("DIAGNOSTIC_AI_EVIDENCE", evidence, "ROOT", app.dataDir);
    resources.defer(async () => {
      await Bun.write(`${evidence}/browser.json`, JSON.stringify({ errors, consoleErrors, origin: app.url.origin }, null, 2));
      await Bun.write(`${evidence}/terminal.html`, await page.content());
      await page.screenshot({ path: `${evidence}/terminal.png` });
    });
    const owned = resources.move();
    return { app, owner, operator, provider, page, context, evidence, errors,
      async [Symbol.asyncDispose]() {
        await owned.disposeAsync();
        const absent = await access(app.dataDir).then(() => false, () => true);
        await Bun.write(`${evidence}/cleanup.json`, JSON.stringify({ root: app.dataDir, absent, closed: new Date().toISOString() }, null, 2));
        expect(absent).toBe(true);
      },
    };
  } finally { await resources.disposeAsync(); }
}
export type DiagnosticFixture = Awaited<ReturnType<typeof diagnosticFixture>>;

export async function brokenDiagnostic(setup: DiagnosticFixture) {
  const { app, context, page } = setup;
  await openSurface(page, { path: `${projectPath}/edit`, selector: sourceSelector });
  const initial = await projectDocument(context, scope);
  const broken = initial.text.replace("\\end{document}", `${command}\n\\end{document}`);
  using saved = nextApplicationEvent(app, event => event.topic === "document.saved"
    && event.aggregateId === fixtureIds.project && event.payload.resourceId === fixtureIds.mainFile);
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).click();
  await page.getByRole("textbox", { name: "Source: main.tex", exact: true }).press("ControlOrMeta+A");
  await Promise.all([saved.promise, page.keyboard.insertText(broken)]);
  using failed = nextApplicationEvent(app, event => event.topic === "job.changed"
    && event.aggregateId === fixtureIds.project && event.payload.status === "failed", 90_000);
  await page.getByRole("button", { name: "Recompile", exact: true }).click();
  await failed.promise;
  await page.getByRole("tab", { name: "Logs", exact: true }).click();
  const ready = await surfaceSignal(page, ".q-pdf-diagnostics button");
  await ready.observed;
  const response = await context.request.get(`/api/projects/${fixtureIds.project}/compile-preview`, { params: { branch: "main" } });
  const preview = editorValue(resultSchema(endpoints.compilePreview.output).parse(await response.json()));
  const diagnostic = preview.job?.diagnostics.find(item => item.message.includes("Undefined control sequence"));
  const log = preview.job?.artifacts.find(item => item.kind === "log");
  if (!diagnostic || !log || !preview.job) throw new TypeError("Native failed diagnostic/log required");
  const bytes = await (await context.request.get(`/api/artifacts/${log.id}/content`)).body();
  await openSurface(page, { path: `${projectPath}/logs`, selector: ".q-pdf-diagnostics" });
  const loaded = await surfaceSignal(page, ".q-pdf-diagnostics button[title]:not([disabled])");
  await loaded.observed;
  const card = page.locator(".q-pdf-diagnostics li").filter({ hasText: diagnostic.message }).first();
  await card.getByRole("button", { name: "Fix with AI", exact: true }).waitFor({ state: "visible" });
  const excerpt = new TextDecoder().decode(bytes.subarray(diagnostic.rawStart, diagnostic.rawEnd));
  return { broken, diagnostic, excerpt, card, revision: preview.job.snapshot.revision };
}

export async function consent(page: Page) {
  await page.locator(".qa-assistant__settings summary").click();
  await page.getByLabel("I consent to these provider terms").check();
  await page.getByRole("button", { name: "Save consent decision" }).click();
  await waitForRenderedText(page, "Consent accepted");
  await page.locator(".qa-assistant__settings summary").click();
}

export async function captureMatrix(setup: DiagnosticFixture, name: string) {
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await setup.page.setViewportSize({ width, height: 900 });
    await setup.page.evaluate(async value => {
      document.documentElement.dataset["theme"] = value;
      await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    }, theme);
    const target = name === "diagnostic"
      ? setup.page.locator(".q-pdf-diagnostics li").filter({ hasText: "Undefined control sequence." }).first()
      : name === "context" ? setup.page.getByRole("region", { name: "Selected diagnostic" })
        : setup.page.getByRole("region", { name: "Proposed changes", exact: true });
    await target.scrollIntoViewIfNeeded();
    await setup.page.screenshot({ path: `${setup.evidence}/${name}-${width}-${theme}.png` });
    const geometry = await setup.page.evaluate(() => ({
      width: innerWidth, scroll: document.documentElement.scrollWidth,
      body: document.body.getBoundingClientRect().toJSON(),
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(width);
    await Bun.write(`${setup.evidence}/${name}-${width}-${theme}.json`, JSON.stringify(geometry, null, 2));
  }
  await setup.page.setViewportSize({ width: 1440, height: 900 });
}
