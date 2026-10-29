import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect } from "bun:test";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { authenticateApi, startEditorBrowser } from "../shared";
import { startAssemblyApplication } from "../assembly/application";

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
    const evidence = resolve(`docs/evidence/p71-inline-references/${crypto.randomUUID()}`);
    await mkdir(evidence, { recursive: true });
    const requests: string[] = [];
    const holds = new Map<string, { started: ReturnType<typeof Promise.withResolvers<void>>; release: ReturnType<typeof Promise.withResolvers<void>> }>();
    const responses = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
    let copyHold: { readonly started: ReturnType<typeof Promise.withResolvers<void>>; readonly release: ReturnType<typeof Promise.withResolvers<void>> } | null = null;
    const vendor = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const query = url.searchParams.get("query.bibliographic") ?? "";
        requests.push(url.href);
        const held = holds.get(query);
        if (held) { held.started.resolve(); await held.release.promise; }
        if (url.pathname !== "/works") return new Response(null, { status: 404 });
        const publication = {
          DOI: `10.1234/${query}`, title: [`Research ${query}`],
          author: [{ given: "Grace", family: "Hopper" }, { given: "Ada", family: "Lovelace" }],
          issued: { "date-parts": [[2026, 10, 28]] }, URL: `https://doi.org/10.1234/${query}`,
        };
        const items = query === "no-results" ? [] : query === "long-results"
          ? Array.from({ length: 8 }, (_, index) => ({ ...publication,
            DOI: `10.1234/long-results-${index}`,
            title: [`研究方法と引用文献の検証 ${index + 1}: A deliberately long publication title for checking readable wrapping and preserved reference metadata`],
          })) : [publication];
        return Response.json({ message: { items, "total-results": items.length } });
      },
    });
    resources.defer(async () => { copyHold?.release.resolve(); for (const hold of holds.values()) hold.release.resolve(); await vendor.stop(true); });
    const http = new SafeHttpClient({ fixtureOrigins: [vendor.url.origin], timeoutMs: 60_000 });
    const app = resources.use(await startAssemblyApplication({ http }));
    // Observe completion without replacing the native handler or any response.
    const handle = app.application.handle;
    app.application.handle = async (request, server) => {
      const response = await handle(request, server);
      const url = new URL(request.url);
      if (url.pathname === "/api/references/search") responses.get(url.searchParams.get("query") ?? "")?.resolve();
      if (url.pathname.endsWith("/citations") && response?.status === 200 && copyHold) {
        copyHold.started.resolve();
        await copyHold.release.promise;
      }
      return response;
    };
    const owner = await authenticateApi(app);
    const operator = await authenticateApi(app, "operator@quire.local");
    const configured = await operator.http.put("api/admin/providers/crossref", { headers: { "if-match": '"0"' },
      json: { baseUrl: vendor.url.origin, policy: defaultPolicy, expectedVersion: 0 } });
    expect(configured.status).toBe(200);
    const browser = resources.use(await startEditorBrowser());
    const errors: string[] = [];
    console.info("P71_EVIDENCE", evidence, "P71_OWNED", { root: app.dataDir, vendor: vendor.url.origin,
      api: app.apiUrl.origin, web: app.url.origin });
    const owned = resources.move();
    return { evidence, app, browser, owner, requests, errors,
      holdCopy() {
        const value = { started: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
        copyHold = value;
        return { started: bounded(value.started.promise, "committed bibliography copy"), release: () => value.release.resolve() };
      },
      hold(query: string) {
        const value = { started: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
        holds.set(query, value);
        const completed = Promise.withResolvers<void>(); responses.set(query, completed);
        return { started: bounded(value.started.promise, `vendor ${query}`), release: () => value.release.resolve(),
          completed: bounded(completed.promise, `native response ${query}`) };
      },
      async [Symbol.asyncDispose]() {
        copyHold?.release.resolve();
        for (const hold of holds.values()) hold.release.resolve();
        await owned.disposeAsync();
        const absent = await access(app.dataDir).then(() => false, () => true);
        const listeners = await Promise.all([app.url.origin, app.apiUrl.origin, vendor.url.origin].map(async origin => ({
          origin, closed: await fetch(origin, { signal: AbortSignal.timeout(2000) }).then(() => false, () => true),
        })));
        const cleanup = { root: app.dataDir, absent, browserClosed: !browser.browser.isConnected(), listeners, errors };
        await Bun.write(`${evidence}/cleanup.json`, JSON.stringify(cleanup, null, 2));
        expect(absent).toBe(true); expect(cleanup.browserClosed).toBe(true);
        expect(listeners.every(item => item.closed)).toBe(true);
        console.info("P71_CLEANUP", cleanup);
      },
    };
  } finally { await resources.disposeAsync(); }
}
export type RemoteFixture = Awaited<ReturnType<typeof remoteFixture>>;
