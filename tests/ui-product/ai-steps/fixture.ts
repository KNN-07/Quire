import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect } from "bun:test";
import type { AiRun, Event } from "@quire/contracts";
import { AiRunSchema, endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { providerServer } from "../../adapters/ai/provider";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticateApi, projectDocument, startEditorBrowser, waitForRenderedText } from "../../ui-editor/shared";
import { startAssemblyApplication } from "../../ui-editor/assembly/application";
import { openSurface, surfaceSignal } from "../../ui-editor/assembly/actual-browser";
import { consent } from "../../ui-editor/diagnostic-ai/fixture";
import { interactionEvidence } from "./interactions";

export const scope = { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile };
export const hash = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const ownedInputs = [
  "apps/web/src/features/editor/assistant/RunProgress.tsx",
  "tests/ui-product/ai-steps/fixture.ts",
  "tests/ui-product/ai-steps/interactions.ts",
  "apps/web/src/features/editor/assistant/AssistantPanel.tsx",
  "apps/web/src/features/editor/assistant/assistant.css",
  "apps/web/src/features/editor/assistant/DESIGN.md",
  "apps/web/src/features/editor/assistant/use-assistant.ts",
  "apps/web/src/features/editor/assistant/events.ts",
  "packages/contracts/src/work.ts",
];

export async function stepsFixture(phase: "before" | "after") {
  const resources = new AsyncDisposableStack();
  try {
    expect(Bun.version).toBe("1.4.4");
    const evidence = resolve(`docs/evidence/p68-ai-steps-frontend/${phase}-${crypto.randomUUID()}`);
    await mkdir(evidence, { recursive: true });
    const inputs = Object.fromEntries(await Promise.all(ownedInputs.map(async path => [path, hash(await Bun.file(path).text())])));
    const provider = resources.use(providerServer());
    const http = new SafeHttpClient({ fixtureOrigins: [provider.origin], maxBytes: 16 * 1024 * 1024, timeoutMs: 60_000 });
    const app = resources.use(await startAssemblyApplication({ http, ai: { http } }));
    const receipts: { method: string; path: string; key: string | null; body: unknown; status: number; response: unknown; utc: string }[] = [];
    const events: Event[] = [];
    const runObservers = new Set<(run: AiRun) => void>();
    const unsubscribe = app.application.runtime.events.subscribe(event => {
      if (event.topic === "operation.changed") events.push(event);
    });
    resources.defer(unsubscribe);
    const native = app.application.handle;
    app.application.handle = async (request, server) => {
      const path = new URL(request.url).pathname;
      const retain = path.includes("/ai/") && !path.includes("/admin/");
      const body: unknown = retain && !["GET", "HEAD"].includes(request.method) ? await request.clone().json() : null;
      const response = await native(request, server);
      if (response && retain) {
        const json: unknown = await response.clone().json();
        receipts.push({ method: request.method, path, key: request.headers.get("idempotency-key"),
          body, status: response.status, response: json, utc: new Date().toISOString() });
        if (request.method === "GET" && response.status === 200 && /^\/api\/ai\/runs\/[^/]+$/u.test(path)) {
          const run = editorValue(resultSchema(endpoints.aiRunGet.output).parse(json));
          for (const observer of runObservers) observer(run);
        }
      }
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
    const consoleErrors: string[] = [];
    const browserEvents: { url: string; status: number }[] = [];
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("response", response => {
      if (new URL(response.url()).pathname === "/api/events") browserEvents.push({ url: response.url(), status: response.status() });
    });
    resources.defer(async () => {
      await Bun.write(`${evidence}/requests.json`, JSON.stringify(receipts, null, 2));
      await Bun.write(`${evidence}/events.json`, JSON.stringify(events, null, 2));
      await Bun.write(`${evidence}/provider-requests.json`, JSON.stringify(provider.received, null, 2));
      await Bun.write(`${evidence}/browser.json`, JSON.stringify({ errors, consoleErrors, browserEvents }, null, 2));
    });
    const origins = [app.url.origin, app.apiUrl.origin, provider.origin];
    await Bun.write(`${evidence}/owned.json`, JSON.stringify({ utc: new Date().toISOString(), phase,
      root: app.dataDir, origins, runtime: Bun.version, argv: process.argv, inputs }, null, 2));
    console.info("P68_FRONTEND_EVIDENCE", evidence);
    const owned = resources.move();
    return { app, owner, provider, page, context, evidence, phase, errors, consoleErrors, receipts, events,
      observeRun(status: AiRun["status"]) {
        const result = Promise.withResolvers<AiRun>();
        void result.promise.catch(() => undefined);
        const observe = (run: AiRun) => {
          if (run.status !== status) return;
          clearTimeout(deadline); runObservers.delete(observe); result.resolve(run);
        };
        const deadline = setTimeout(() => {
          runObservers.delete(observe); result.reject(new Error(`Authorized run GET not observed: ${status}`));
        }, 30_000);
        runObservers.add(observe);
        return { promise: result.promise, [Symbol.dispose]() { clearTimeout(deadline); runObservers.delete(observe); } };
      },
      async [Symbol.asyncDispose]() {
        await owned.disposeAsync();
        const absent = await access(app.dataDir).then(() => false, () => true);
        const listeners = await Promise.all(origins.map(async origin => ({ origin,
          closed: await fetch(origin, { signal: AbortSignal.timeout(2000) }).then(() => false, () => true) })));
        const cleanup = { root: app.dataDir, absent, listeners, browserClosed: !browser.browser.isConnected(),
          utc: new Date().toISOString() };
        await Bun.write(`${evidence}/cleanup.json`, JSON.stringify(cleanup, null, 2));
        expect(absent).toBe(true); expect(cleanup.browserClosed).toBe(true);
        expect(listeners.every(item => item.closed)).toBe(true);
        console.info("P68_FRONTEND_CLEANUP", cleanup);
      },
    };
  } finally { await resources.disposeAsync(); }
}
export type StepsFixture = Awaited<ReturnType<typeof stepsFixture>>;

export async function rendered(setup: StepsFixture, run: AiRun) {
  if (setup.phase === "before") {
    await waitForRenderedText(setup.page, run.id);
    await waitForRenderedText(setup.page, `Agent run · ${run.status}`);
  } else {
    const signal = await surfaceSignal(setup.page,
      `[data-run-id="${run.id}"][data-run-status="${run.status}"][data-run-version="${run.version}"]`);
    await signal.observed;
    const rows = await setup.page.locator("[data-step-kind]").evaluateAll(nodes => nodes.map(node => ({
      kind: node.getAttribute("data-step-kind"), status: node.getAttribute("data-step-status"),
      startedAt: node.getAttribute("data-started-at"), finishedAt: node.getAttribute("data-finished-at") || null,
    })));
    expect(rows).toEqual([...run.steps]);
    expect(await setup.page.locator("[data-result-ready]").getAttribute("data-result-ready"))
      .toBe(String(run.status === "succeeded"));
    expect(await setup.page.locator(".qa-assistant__step-times time").evaluateAll(nodes =>
      nodes.map(node => node.getAttribute("datetime"))))
      .toEqual(run.steps.flatMap(step => step.finishedAt ? [step.startedAt, step.finishedAt] : [step.startedAt]));
  }
}

export async function matrix(setup: StepsFixture, name: string) {
  for (const width of [1440, 390]) for (const theme of ["light", "dark"] as const) {
    await setup.page.setViewportSize({ width, height: 900 });
    await setup.page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await setup.page.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
    if (!await setup.page.getByRole("region", { name: "Assistant", exact: true }).isVisible()) {
      await setup.page.getByRole("button", { name: "Assistant", exact: true }).last().click();
    }
    const body = setup.page.locator(".qa-assistant__body");
    await body.evaluate(node => { node.scrollTop = 0; });
    const geometry = await setup.page.evaluate(() => ({
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      scrollers: [...document.querySelectorAll("*")].filter(node =>
        /auto|scroll/u.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight)
        .map(node => ({ tag: node.tagName, className: node.className })),
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(width);
    await setup.page.screenshot({ path: `${setup.evidence}/${name}-${width}-${theme}-${setup.phase}.png` });
    await body.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await setup.page.screenshot({ path: `${setup.evidence}/${name}-end-${width}-${theme}-${setup.phase}.png` });
    await Bun.write(`${setup.evidence}/${name}-${width}-${theme}.json`, JSON.stringify(geometry, null, 2));
  }
  await setup.page.setViewportSize({ width: 1440, height: 900 });
}

async function entered(gate: ReturnType<ReturnType<typeof providerServer>["gate"]>) {
  const signal = AbortSignal.timeout(10_000);
  const aborted = Promise.withResolvers<never>();
  const abort = () => aborted.reject(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try { await Promise.race([gate.entered, aborted.promise]); }
  finally { signal.removeEventListener("abort", abort); }
}

export async function exercise(phase: "before" | "after") {
  await using setup = await stepsFixture(phase);
  const { page, provider, context, evidence } = setup;
  await openSurface(page, { path: `/projects/${scope.projectId}/edit`, selector: ".qa-assistant__composer" });
  await consent(page);
  const original = await projectDocument(context, scope);
  await matrix(setup, "empty");
  provider.respond(request => {
    const file = request.files[0];
    if (!file) throw new TypeError("Selected source required");
    return { text: "Review this proposed comment.", patches: [{
      fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% explicit review required\n",
    }], citations: [] };
  });
  const runs: AiRun[] = [];
  for (const outcome of ["succeeded", "failed", "canceled"] as const) {
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    const contextPicker = page.locator(".qa-assistant__context");
    if (!await contextPicker.evaluate(node => node.hasAttribute("open"))) await contextPicker.locator("summary").click();
    await page.getByRole("checkbox", { name: "main.tex", exact: true }).check();
    await contextPicker.locator("summary").click();
    provider.status(outcome === "failed" ? 500 : 200);
    const gate = provider.gate();
    try {
      using runningResponse = setup.observeRun("running");
      await page.getByLabel("Message the assistant").fill(`Controlled ${outcome} progress fixture.`);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await entered(gate);
      const running = await runningResponse.promise;
      expect(running.steps.map(step => [step.kind, step.status])).toEqual([["context", "succeeded"], ["provider", "running"]]);
      await rendered(setup, running);
      if (outcome === "succeeded") await matrix(setup, "provider-running");
      using terminalResponse = setup.observeRun(outcome);
      if (outcome === "canceled") await page.getByRole("button", { name: "Cancel run", exact: true }).click();
      else gate.release();
      const terminal = await terminalResponse.promise;
      await rendered(setup, terminal);
      expect(terminal.steps.map(step => step.kind)).toEqual(outcome === "succeeded"
        ? ["context", "provider", "validation", "publication"] : ["context", "provider"]);
      expect(terminal.steps.at(-1)?.status).toBe(outcome);
      expect(terminal.steps.every(step => step.finishedAt !== null)).toBe(true);
      expect(terminal.version).toBeGreaterThan(running.version);
      expect(setup.events.some(event => event.topic === "operation.changed"
        && event.aggregateId === terminal.id && event.payload.status === outcome)).toBe(true);
      expect((await projectDocument(context, scope)).text).toBe(original.text);
      runs.push(terminal);
      if (phase === "after") {
        const summary = page.locator(".qa-assistant__step-times summary");
        await summary.focus();
        await summary.press("Enter");
        expect(await page.locator(".qa-assistant__step-times").evaluate(node => node.hasAttribute("open"))).toBe(true);
        await summary.press("Enter");
      }
      await matrix(setup, outcome);
      if (phase === "after" && outcome === "failed") {
        await interactionEvidence(setup);
        await page.setViewportSize({ width: 1440, height: 900 });
        if (!await page.getByRole("region", { name: "Assistant", exact: true }).isVisible()) {
          await page.getByRole("button", { name: "Assistant", exact: true }).last().click();
        }
        provider.status(200);
        await page.getByRole("button", { name: "Agent", exact: true }).click();
        const retryContext = page.locator(".qa-assistant__context");
        if (!await retryContext.evaluate(node => node.hasAttribute("open"))) await retryContext.locator("summary").click();
        await page.getByRole("checkbox", { name: "main.tex", exact: true }).check();
        await retryContext.locator("summary").click();
        await page.getByLabel("Message the assistant").fill("Controlled recovered progress fixture.");
        using recoveredResult = setup.observeRun("succeeded");
        const response = page.waitForResponse(entry => entry.request().method() === "POST"
          && new URL(entry.url()).pathname === `/api/projects/${scope.projectId}/ai/runs`);
        const [submitted] = await Promise.all([response,
          page.getByRole("button", { name: "Regenerate (new use)", exact: true }).click()]);
        expect(submitted.status()).toBe(202);
        const admitted = editorValue(resultSchema(AiRunSchema).parse(await submitted.json()));
        const recovered = await recoveredResult.promise;
        expect(recovered.id).toBe(admitted.id);
        expect(recovered.id).not.toBe(terminal.id);
        await rendered(setup, recovered); runs.push(recovered);
        expect((await projectDocument(context, scope)).text).toBe(original.text);
        await page.screenshot({ path: `${evidence}/regenerated-result.png` });
        const decision = page.waitForResponse(entry => entry.request().method() === "POST"
          && new URL(entry.url()).pathname === `/api/ai/runs/${recovered.id}/decide`);
        await page.getByRole("button", { name: "Reject all", exact: true }).click();
        expect((await decision).status()).toBe(200);
      }
      if (outcome === "succeeded") {
        expect(terminal.proposals.flatMap(proposal => proposal.edits).map(edit => edit.status)).toEqual(["pending"]);
        const decision = page.waitForResponse(response => response.request().method() === "POST"
          && new URL(response.url()).pathname === `/api/ai/runs/${terminal.id}/decide`);
        await page.getByRole("button", { name: "Reject all", exact: true }).click();
        expect((await decision).status()).toBe(200);
      }
    } finally { gate.release(); }
  }
  expect(provider.received).toHaveLength(phase === "after" ? 4 : 3);
  expect(setup.errors).toEqual([]);
  expect(setup.consoleErrors).toEqual([]);
  await Bun.write(`${evidence}/workflow.json`, JSON.stringify({ runs, beforeHash: hash(original.text),
    afterHash: hash((await projectDocument(context, scope)).text), eventDriven: true,
    manualRefreshActions: 0, provider: "owned loopback deterministic HTTP fixture; no live inference" }, null, 2));
}
