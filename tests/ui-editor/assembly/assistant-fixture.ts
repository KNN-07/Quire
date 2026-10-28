import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect } from "bun:test";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { providerServer } from "../../adapters/ai/provider";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticateApi, startEditorBrowser } from "../shared";
import { startAssemblyApplication } from "./application";

export async function assemblyAssistant() {
  const resources = new AsyncDisposableStack();
  try {
    const provider = resources.use(providerServer());
    const http = new SafeHttpClient({ fixtureOrigins: [provider.origin], maxBytes: 16 * 1024 * 1024, timeoutMs: 60_000 });
    const app = resources.use(await startAssemblyApplication({ http, ai: { http, visionModels: ["fixture-model"] } }));
    const owner = await authenticateApi(app);
    const operator = await authenticateApi(app, "operator@quire.local");
    const configured = await operator.http.put("api/admin/providers/ai", {
      headers: { "if-match": '"0"' }, json: {
        baseUrl: `${provider.origin}/v1`, model: "fixture-model", secret: "fixture-ai-key",
        policy: { ...defaultPolicy, ai: "agent", aiDailyUses: 50 }, expectedVersion: 0,
      },
    });
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
    const errors: string[] = [];
    const failedRequests: { readonly url: string; readonly error: string | null }[] = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", cause => errors.push(cause.stack ?? cause.message));
    page.on("requestfailed", request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? null }));
    const evidence = resolve(`tests/ui-editor/assembly/evidence/assistant/${crypto.randomUUID()}`);
    await mkdir(evidence, { recursive: true });
    console.info("ASSEMBLY_ASSISTANT_EVIDENCE", evidence);
    resources.defer(async () => {
      await Bun.write(`${evidence}/raw-errors.json`, JSON.stringify(errors, null, 2));
      await Bun.write(`${evidence}/failed-requests.json`, JSON.stringify(failedRequests, null, 2));
      await Bun.write(`${evidence}/terminal-dom.html`, await page.content());
      await page.screenshot({ path: `${evidence}/terminal-page.png` });
    });
    const owned = resources.move();
    return { app, provider, owner, context, page, evidence, errors,
      async [Symbol.asyncDispose]() { await owned.disposeAsync(); },
    };
  } finally { await resources.disposeAsync(); }
}
