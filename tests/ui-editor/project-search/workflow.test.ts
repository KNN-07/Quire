import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticateApi, projectDocument, startEditorBrowser, waitForRenderedText } from "../shared";
import { startAssemblyApplication } from "../assembly/application";
import { openSurface } from "../assembly/actual-browser";
import { consent } from "../diagnostic-ai/fixture";

const envelope = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() })),
  tools: z.array(z.unknown()).optional(),
});

test("native Assistant sends project search only with explicit consent and retains original source", async () => {
  const resources = new AsyncDisposableStack();
  const evidence = resolve(`docs/evidence/p72-project-search-ui/${crypto.randomUUID()}`);
  await mkdir(evidence, { recursive: true });
  const received: z.infer<typeof envelope>[] = [];
  const errors: string[] = [];
  let root: string | undefined;
  try {
    const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      if (request.headers.get("authorization") !== "Bearer fixture-ai-key") return new Response(null, { status: 401 });
      if (new URL(request.url).pathname === "/v1/models") return Response.json({ data: [{ id: "fixture-model" }] });
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 });
      const body = envelope.parse(await request.json());
      received.push(body);
      const searched = body.messages.some(message => message.role === "tool");
      const wantsSearch = !searched && Boolean(body.tools?.length);
      return Response.json({ id: `chatcmpl-${received.length}`, choices: [{
        finish_reason: wantsSearch ? "tool_calls" : "stop",
        message: wantsSearch
          ? { role: "assistant", content: null, tool_calls: [{ id: "project-query", type: "function",
            function: { name: "project_search", arguments: JSON.stringify({ query: "document" }) } }] }
          : { role: "assistant", content: JSON.stringify({
            text: searched ? "Project search completed." : "Selected context only.", patches: [], citations: [], findings: [],
          }) },
      }] });
    } });
    resources.defer(() => provider.stop(true));
    const http = new SafeHttpClient({ fixtureOrigins: [provider.url.origin], maxBytes: 16 * 1024 * 1024, timeoutMs: 60_000 });
    const app = resources.use(await startAssemblyApplication({ http, ai: { http, visionModels: ["fixture-model"] } }));
    root = app.dataDir;
    const owner = await authenticateApi(app);
    const operator = await authenticateApi(app, "operator@quire.local");
    expect((await operator.http.put("api/admin/providers/ai", { headers: { "if-match": '"0"' }, json: {
      baseUrl: `${provider.url.origin}/v1`, model: "fixture-model", secret: "fixture-ai-key",
      policy: { ...defaultPolicy, ai: "agent", aiDailyUses: 50 }, expectedVersion: 0,
    } })).status).toBe(200);
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
    resources.defer(async () => {
      await page.screenshot({ path: `${evidence}/terminal.png` });
      await Bun.write(`${evidence}/terminal.aria.yml`, await page.locator("body").ariaSnapshot());
    });
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    const scope = { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile };
    await openSurface(page, { path: `/projects/${fixtureIds.project}/edit`, selector: ".cm-content" });
    const original = await projectDocument(context, scope);
    const assistant = page.locator(".qe-project-header").getByRole("button", { name: "Assistant", exact: true });
    if (await assistant.getAttribute("aria-pressed") !== "true") await assistant.click();
    await consent(page);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const search = page.getByRole("checkbox", { name: "Allow the assistant to search this project for this request", exact: true });
    expect(await search.isChecked()).toBe(false);
    await page.getByLabel("Message the assistant").fill("Explain the document structure.");
    async function send() {
      const [created] = await Promise.all([
        page.waitForResponse(item => item.url().endsWith("/ai/runs") && item.request().method() === "POST"),
        page.getByRole("button", { name: "Send", exact: true }).click(),
      ]);
      expect(created.status()).toBe(202);
      return editorValue(resultSchema(endpoints.aiRunCreate.output).parse(await created.json()));
    }
    await send();
    await waitForRenderedText(page, "Selected context only.");
    expect(received).toHaveLength(1);
    expect(received[0]?.tools?.length ?? 0).toBe(0);
    await search.check();
    for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
      await search.check();
      await search.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidence}/consent-${width}-${theme}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    // The native sidebar/drawer boundary remounts the composer; consent is not persisted.
    await search.check();
    await page.getByLabel("Message the assistant").fill("Explain the document structure using project search.");
    const run = await send();
    await waitForRenderedText(page, "Project search completed.");
    expect(received).toHaveLength(3);
    const result = received[2]?.messages.find(message => message.role === "tool");
    expect(result).toBeDefined();
    expect(JSON.stringify(result?.content)).toContain(fixtureIds.mainFile);
    expect(JSON.stringify(result?.content)).toContain("document");
    expect((await projectDocument(context, scope)).text).toBe(original.text);
    const final = editorValue(resultSchema(endpoints.aiRunGet.output).parse(
      await (await context.request.get(`/api/ai/runs/${run.id}`)).json()));
    expect(final.status).toBe("succeeded");
    expect(final.proposals).toEqual([]);
    await page.getByLabel("Tool", { exact: true }).selectOption("grammar");
    expect(await search.count()).toBe(0);
    await page.getByLabel("Tool", { exact: true }).selectOption("texgpt");
    expect(await search.isChecked()).toBe(false);
    await page.reload();
    await page.getByLabel("Message the assistant").waitFor();
    expect(await search.isChecked()).toBe(false);
    expect((await projectDocument(context, scope)).text).toBe(original.text);
    expect(errors).toEqual([]);
    await Bun.write(`${evidence}/workflow.json`, JSON.stringify({ received, run: final, errors }, null, 2));
  } finally {
    await resources.disposeAsync();
    const absent = root ? await access(root).then(() => false, () => true) : true;
    await Bun.write(`${evidence}/cleanup.json`, JSON.stringify({ root, absent, errors }, null, 2));
    console.info("P72_UI_EVIDENCE", evidence);
    expect(absent).toBe(true);
  }
}, 180_000);
