import { afterAll, expect } from "bun:test";
import { chromium } from "@playwright/test";
import type { Page, Request as BrowserRequest } from "@playwright/test";
import { z } from "zod";

const Identity = z.object({
  client: z.number(), authority: z.number(), shared: z.boolean(), stack: z.string(),
});
type Traffic = {
  readonly page: number;
  readonly document: number;
  readonly path: string;
  readonly method: string;
  readonly started: number;
  status: number | null;
  finished: number | null;
  failure: string | null;
};
const traffic = new Map<BrowserRequest, Traffic>();
const identities: (z.infer<typeof Identity> & { readonly page: number })[] = [];
const snapshots: { reason: string; open: Record<number, number>; serverOpen: number; pending: Traffic[] }[] = [];
const pages = new Map<Page, number>();
const documents = new Map<number, number>();
const serverStreams: { started: number; status: number | null; closed: number | null }[] = [];
const errors: string[] = [];
let contexts = 0;
let closed = false;
const started = performance.now();
const now = () => Math.round(performance.now() - started);
const snapshot = (reason: string) => {
  const open: Record<number, number> = {};
  for (const value of traffic.values()) {
    if (value.document !== documents.get(value.page)) continue;
    if (value.path.startsWith("/api/events") && value.status === 200
      && value.finished === null && value.failure === null) open[value.page] = (open[value.page] ?? 0) + 1;
  }
  snapshots.push({ reason, open, serverOpen: serverStreams.filter(value => value.status === 200 && value.closed === null).length,
    pending: [...traffic.values()].filter(value => value.document === documents.get(value.page)
      && !value.path.startsWith("/api/events") && value.finished === null && value.failure === null).map(value => ({ ...value })) });
};

// Observe the unmodified modules' key accesses through subclasses with unchanged
// Map/WeakMap behavior. No application callback, response or cursor is replaced.
function observeIdentity() {
  console.info("P63_DOCUMENT");
  const NativeMap = Map;
  const NativeWeakMap = WeakMap;
  const clients = new WeakMap<object, number>();
  const scopes = new WeakMap<object, number>();
  const authorities = new Map<unknown, number>();
  let nextClient = 0;
  let nextAuthority = 0;
  class ObservedWeakMap<K extends WeakKey, V> extends NativeWeakMap<K, V> {
    override set(key: K, value: V): this {
      if (key && typeof key === "object" && "url" in key && typeof key.url === "function"
        && "call" in key && typeof key.call === "function" && "callWithMetadata" in key
        && typeof key.callWithMetadata === "function" && value instanceof NativeMap) {
        let id = clients.get(key);
        if (id === undefined) { id = ++nextClient; clients.set(key, id); }
        scopes.set(value, id);
      }
      return super.set(key, value);
    }
  }
  class ObservedMap<K, V> extends NativeMap<K, V> {
    override get(key: K): V | undefined {
      const value = super.get(key);
      const client = scopes.get(this);
      if (client !== undefined) {
        const stack = new Error().stack ?? "";
        if (stack.includes("/shared/events.ts")) {
          let id = authorities.get(key);
          if (id === undefined) { id = ++nextAuthority; authorities.set(key, id); }
          console.info("P63_IDENTITY " + JSON.stringify({ client, authority: id, shared: value !== undefined, stack }));
        }
      }
      return value;
    }
  }
  globalThis.WeakMap = ObservedWeakMap;
  globalThis.Map = ObservedMap;
}

// Count the actual API requests' abort lifetimes as well as browser traffic.
// Navigation can omit requestfinished for an obsolete browser document.
const serve = Bun.serve.bind(Bun);
Object.defineProperty(Bun, "serve", { value(options: Record<string, unknown>) {
  const handler = options["fetch"];
  if (typeof handler !== "function") return Reflect.apply(serve, Bun, [options]);
  return Reflect.apply(serve, Bun, [{ ...options, fetch(this: unknown, request: Request, server: unknown) {
    if (new URL(request.url).pathname !== "/api/events") return Reflect.apply(handler, this, [request, server]);
    const stream = { started: now(), status: null as number | null, closed: null as number | null };
    serverStreams.push(stream);
    request.signal.addEventListener("abort", () => { stream.closed = now(); }, { once: true });
    const response: unknown = Reflect.apply(handler, this, [request, server]);
    return Promise.resolve(response).then(value => {
      if (value instanceof Response) stream.status = value.status;
      return value;
    });
  } }]);
} });

const launch = chromium.launch.bind(chromium);
chromium.launch = async options => {
  const browser = await launch(options);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async settings => {
    contexts++;
    const context = await newContext(settings);
    await context.addInitScript(observeIdentity);
    context.on("page", page => {
      const id = pages.size + 1;
      pages.set(page, id);
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => {
        const text = message.text();
        if (text === "P63_DOCUMENT") documents.set(id, (documents.get(id) ?? 0) + 1);
        if (text.startsWith("P63_IDENTITY ")) identities.push({ page: id, ...Identity.parse(JSON.parse(text.slice(13))) });
        if (text.startsWith("ASSEMBLY_NAV_") && !text.endsWith(":timeout")) snapshot(`page-${id}-mounted`);
      });
      const close = page.close.bind(page);
      page.close = async closeOptions => {
        snapshot(`page-${id}-before-close`);
        await close(closeOptions);
      };
    });
    context.on("request", request => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) return;
      const page = pages.get(request.frame().page());
      if (page === undefined) throw new Error("Unobserved native page");
      traffic.set(request, { page, document: documents.get(page) ?? 0, path: url.pathname + url.search, method: request.method(),
        started: now(), status: null, finished: null, failure: null });
    });
    context.on("response", response => {
      const value = traffic.get(response.request());
      if (value) value.status = response.status();
    });
    context.on("requestfinished", request => {
      const value = traffic.get(request);
      if (value) value.finished = now();
    });
    context.on("requestfailed", request => {
      const value = traffic.get(request);
      if (value) { value.finished = now(); value.failure = request.failure()?.errorText ?? "Unknown request failure"; }
    });
    const close = context.close.bind(context);
    context.close = async closeOptions => {
      snapshot("context-before-close");
      await close(closeOptions);
      closed = true;
    };
    return context;
  };
  return browser;
};

afterAll(async () => {
  const evidence = { utc: new Date().toISOString(), contexts, pages: pages.size, closed, errors,
    identities, snapshots, serverStreams, traffic: [...traffic.values()] };
  await Bun.write("docs/evidence/p63-editor-events/native-observer.json", JSON.stringify(evidence, null, 2));
  console.info("P63_NATIVE_OBSERVER", JSON.stringify({ contexts, pages: pages.size, closed, errors, snapshots }));
  expect(contexts).toBe(1);
  expect(pages.size).toBe(2);
  expect(closed).toBe(true);
  expect(errors).toEqual([]);
  for (const page of [1, 2]) {
    const initial = ["assistant/events.ts", "pdf/events.ts", "review/events.ts", "transport/connection.ts"]
      .map(path => identities.find(value => value.page === page && value.stack.includes(path)));
    expect(initial.every(value => value !== undefined)).toBe(true);
    expect(new Set(initial.map(value => `${value?.client}:${value?.authority}`)).size).toBe(1);
    expect(new Set(identities.filter(value => value.page === page).map(value => `${value.client}:${value.authority}`)).size).toBe(1);
  }
  const mounted = snapshots.find(value => value.reason === "page-2-before-close");
  expect(mounted).toBeDefined();
  expect(mounted?.open).toEqual({ 1: 1, 2: 1 });
  expect(mounted?.serverOpen).toBe(2);
  expect(mounted?.pending).toEqual([]);
  const recovered = ["/api/me", "/compile-preview", "/suggestions", "/document"];
  for (const path of recovered) expect([...traffic.values()].some(value => value.page === 2
    && value.path.split("?")[0]?.endsWith(path) && value.status === 200 && value.finished !== null && value.failure === null)).toBe(true);
});
