import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect } from "bun:test";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { providerServer } from "../../adapters/ai/provider";
import { fixtureIds } from "../../fixtures/foundation";
import { authenticateApi, startEditorBrowser } from "../../ui-editor/shared";
import { startAssemblyApplication } from "../../ui-editor/assembly/application";
import { bounded } from "../../ui-editor/remote-bibliography/fixture";

export const scope = { projectId: fixtureIds.project, branch: "main", fileId: fixtureIds.mainFile };
export const supported = "Water freezes at zero degrees Celsius.";
export const unsupported = "This method always proves every theorem.";
export const source = `\\documentclass{article}
\\begin{document}
${supported}
${unsupported}
\\bibliographystyle{plain}
\\bibliography{review}
\\end{document}
`;
export async function citationFixture() {
  const resources = new AsyncDisposableStack();
  try {
    const evidence = resolve(`docs/evidence/p54-citation-reviewer/${crypto.randomUUID()}`);
    await mkdir(evidence, { recursive: true });
    const provider = resources.use(providerServer());
    provider.respond(context => ({ text: "Two source-bound model assessments.", patches: [],
      citations: [{ provider: "crossref", providerId: "10.1234/verified" }],
      findings: context.files.flatMap(file => [supported, unsupported].map((quote, index) => ({
        fileId: file.id, path: file.path, from: file.from + file.text.indexOf(quote),
        to: file.from + file.text.indexOf(quote) + quote.length, quote,
        assessment: index === 0 ? "supported" : "unsupported",
        explanation: index === 0 ? "The model considers the retrieved study relevant." : "The retrieved study does not establish a universal theorem prover.",
        citations: index === 0 ? [{ provider: "crossref", providerId: "10.1234/verified" }] : [],
      }))) }));
    const http = new SafeHttpClient({ fixtureOrigins: [provider.origin], maxBytes: 16 * 1024 * 1024, timeoutMs: 60_000 });
    const app = resources.use(await startAssemblyApplication({ http, ai: { http } }));
    const requests: { path: string; key: string | null; status: number; response: unknown }[] = [];
    let heldCitation: { entered: ReturnType<typeof Promise.withResolvers<void>>; release: ReturnType<typeof Promise.withResolvers<void>> } | null = null;
    const native = app.application.handle;
    app.application.handle = async (request, server) => {
      const response = await native(request, server);
      const path = new URL(request.url).pathname;
      if (response && request.method === "POST" && (path.endsWith("/ai/runs") || path.endsWith("/citations"))) {
        requests.push({ path, key: request.headers.get("idempotency-key"), status: response.status, response: await response.clone().json() });
        if (path.endsWith("/citations") && heldCitation) {
          const gate = heldCitation; heldCitation = null; gate.entered.resolve(); await gate.release.promise;
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
    expect((await operator.http.put("api/admin/providers/crossref", { headers: { "if-match": '"0"' }, json: {
      baseUrl: provider.origin, policy: defaultPolicy, expectedVersion: 0,
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
      await Bun.write(`${evidence}/provider-requests.json`, JSON.stringify(provider.contexts, null, 2));
      await Bun.write(`${evidence}/requests.json`, JSON.stringify(requests, null, 2));
      await Bun.write(`${evidence}/terminal.html`, await page.content());
      await page.screenshot({ path: `${evidence}/terminal.png` });
    });
    const origins = [app.url.origin, app.apiUrl.origin, provider.origin];
    await Bun.write(`${evidence}/owned.json`, JSON.stringify({ cwd: process.cwd(), utc: new Date().toISOString(),
      root: app.dataDir, origins, runtime: Bun.version }, null, 2));
    console.info("P54_EVIDENCE", evidence, "P54_OWNED", app.dataDir, origins);
    const owned = resources.move();
    return { app, provider, owner, operator, page, context, evidence, errors,
      holdCitation() {
        const gate = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
        heldCitation = gate;
        return { entered: bounded(gate.entered.promise, "native citation persistence"), release: () => gate.release.resolve() };
      },
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
        console.info("P54_CLEANUP", cleanup);
      },
    };
  } finally { await resources.disposeAsync(); }
}
