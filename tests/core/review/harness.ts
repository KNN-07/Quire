import { z } from "zod";
import { createRuntime, loadConfig } from "@quire/runtime";
import type { RealtimeSocketData, Runtime } from "@quire/runtime";
import { UserSchema, ProjectSchema, InstantSchema, RealtimeServerMessageSchema } from "@quire/contracts";
import type { RealtimeServerMessage, RealtimeClientMessage, Scope, ProposedEdit } from "@quire/contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { register, migrations, dispose } from "../../../services/core/review";
import { register as base, migrations as baseMigrations, CoreProjects } from "../../../services/core/base";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register as governance, migrations as governanceMigrations } from "../../../services/accounts/governance";
import { seed } from "../../../scripts/seed";
import { postgresFixture } from "./postgres-fixture";
import * as Y from "yjs";

export const password = "review-test-password-2026";
export const origin = "http://localhost:5173";
export async function reviewFixture(options: { readonly localOrigin?: boolean } = {}) {
  const path = await mkdtemp(join(tmpdir(), "quire-p1s-review-"));
  const postgresUrl = process.env["QUIRE_REVIEW_POSTGRES_URL"];
  const postgres = postgresUrl ? await postgresFixture(postgresUrl) : null;
  const modules = [
    { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
    { id: "011-a-governance", lane: "A", order: 11, register: governance, migrations: governanceMigrations },
    { id: "021-k-base", lane: "K", order: 21, register: base, migrations: baseMigrations },
    { id: "023-k-review", lane: "K", order: 23, register, migrations },
  ] as const;
  let now = "2026-10-26T12:00:00.000Z";
  const clock = { now: () => InstantSchema.parse(now) };
  let runtime: Runtime;
  const listen = () => Bun.serve<RealtimeSocketData>({
    hostname: "127.0.0.1", port: 0, idleTimeout: 0,
    fetch(incoming, listener) {
      if (incoming.headers.get("upgrade") === "websocket") return runtime.services.get("realtime").upgrade(incoming, listener);
      return runtime.routes.fetch(incoming);
    },
    websocket: {
      open: socket => runtime.services.get("realtime").handlers.open?.(socket),
      message: (socket, message) => runtime.services.get("realtime").handlers.message(socket, message),
      close: (socket, code, reason) => runtime.services.get("realtime").handlers.close?.(socket, code, reason),
    },
  });
  let server = listen();
  const configuration = () => loadConfig({ QUIRE_DATA_DIR: path,
    QUIRE_PUBLIC_URL: options.localOrigin ? server.url.href : origin });
  try {
    runtime = await createRuntime(configuration(), { modules, clock, ...(postgres ? { createAdapters: postgres.createAdapters } : {}) });
    await seed(runtime, password);
  } catch (error) {
    server[Symbol.dispose]();
    server.unref();
    await postgres?.close();
    await rm(path, { recursive: true, force: true });
    throw error;
  }
  async function request(route: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("origin", new URL(runtime.config.publicUrl).origin);
    if (typeof init.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(route, server.url), { ...init, headers, signal: init.signal ?? AbortSignal.timeout(15000) });
  }
  async function login(email = "kien@quire.local") {
    const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    const user = z.object({ data: UserSchema }).parse(await response.json()).data;
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Expected authenticated session");
    const profile = await request("/api/me", { headers: { cookie } });
    const csrfToken = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await profile.json()).data.csrfToken;
    return { user, headers: { cookie, "x-csrf-token": csrfToken } };
  }
  return {
    path, request, login,
    get url() { return server.url; },
    get runtime() { return runtime; },
    get service() {
      const port = runtime.services.get("projects");
      if (!(port instanceof CoreProjects)) throw new TypeError("Native source service missing");
      return port;
    },
    setTime(value: string) { now = value; },
    async create(headers: HeadersInit) {
      const response = await request("/api/projects", { method: "POST",
        headers: { ...Object.fromEntries(new Headers(headers)), "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ name: "Review fixture", origin: { kind: "blank" } }) });
      return z.object({ data: ProjectSchema }).parse(await response.json()).data;
    },
    async replica() {
      const replica = await createRuntime(configuration(), { modules, clock, ...(postgres ? { createAdapters: postgres.createAdapters } : {}) });
      return {
        runtime: replica,
        async request(route: string, init: RequestInit = {}) {
          const headers = new Headers(init.headers);
          headers.set("origin", new URL(replica.config.publicUrl).origin);
          if (typeof init.body === "string") headers.set("content-type", "application/json");
          return replica.routes.fetch(new Request(new URL(route, server.url), { ...init, headers }));
        },
        async [Symbol.asyncDispose]() { await dispose(replica); await replica.close(); },
      };
    },
    async restart() {
      // Bun 1.3.14 leaves pendingWebSockets stale after server-initiated close;
      // its synchronous disposer stops listening without awaiting that broken counter.
      server[Symbol.dispose]();
      server.unref();
      await dispose(runtime);
      await Promise.resolve();
      await runtime.close();
      server = listen();
      runtime = await createRuntime(configuration(), { modules, clock, ...(postgres ? { createAdapters: postgres.createAdapters } : {}) });
    },
    async [Symbol.asyncDispose]() {
      server[Symbol.dispose]();
      server.unref();
      await dispose(runtime);
      await Promise.resolve();
      await runtime.close();
      await postgres?.close();
      await rm(path, { recursive: true, force: true });
      console.info("P1S_REVIEW_ROOT_CLEANED", path);
    },
  };
}
export async function bounded<T>(promise: Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(10000);
  let abort: () => void = () => {};
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally { signal.removeEventListener("abort", abort); }
}
export async function peer(url: URL, scope: Scope, headers: Record<string, string>) {
  const wsUrl = new URL(`/api/projects/${scope.projectId}/realtime?branch=${scope.branch}`, url);
  wsUrl.protocol = "ws:";
  if (headers["x-project-token"]) wsUrl.searchParams.set("share", headers["x-project-token"]);
  // lib.dom hides Bun's options overload. Parse the dynamically constructed native client.
  const socket = z.instanceof(WebSocket).parse(Reflect.construct(WebSocket, [wsUrl, {
    protocols: headers["x-csrf-token"] ? ["quire", `quire.csrf.${headers["x-csrf-token"]}`] : ["quire"],
    headers: { cookie: headers["cookie"] ?? "", origin },
  } satisfies Bun.WebSocketOptions]));
  const messages: RealtimeServerMessage[] = [];
  const listeners = new Set<(message: RealtimeServerMessage) => void>();
  socket.addEventListener("message", event => {
    const message = RealtimeServerMessageSchema.parse(JSON.parse(String(event.data)));
    messages.push(message);
    for (const listener of listeners) listener(message);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new TypeError("WebSocket upgrade failed")), { once: true });
  });
  return {
    socket, messages,
    send(message: RealtimeClientMessage) { socket.send(JSON.stringify(message)); },
    next(predicate: (message: RealtimeServerMessage) => boolean) {
      return new Promise<RealtimeServerMessage>((resolve, reject) => {
        const signal = AbortSignal.timeout(10000);
        const abort = () => { listeners.delete(listener); reject(signal.reason); };
        const listener = (message: RealtimeServerMessage) => {
          if (!predicate(message)) return;
          listeners.delete(listener); signal.removeEventListener("abort", abort); resolve(message);
        };
        signal.addEventListener("abort", abort, { once: true });
        listeners.add(listener);
      });
    },
    async [Symbol.asyncDispose]() {
      if (socket.readyState === WebSocket.CLOSED) return;
      const closed = new Promise<void>(resolve => socket.addEventListener("close", () => resolve(), { once: true }));
      socket.close(); await closed;
    },
  };
}
export function sourceDoc(state: string): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(state, "base64"));
  doc.getText("source");
  return doc;
}
export function proposal(doc: Y.Doc, edit: Pick<ProposedEdit, "fileId" | "before" | "after" | "baseRevision">, epoch = 0) {
  const text = doc.getText("source");
  const index = text.toJSON().indexOf(edit.before);
  if (index < 0) throw new TypeError("Quote absent from fixture");
  return { ...edit, anchor: {
    fileId: edit.fileId, epoch, quote: edit.before,
    startRelative: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, index))).toString("base64"),
    endRelative: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, index + edit.before.length))).toString("base64"),
  } };
}
export const mutation = (headers: Record<string, string>, body: unknown): RequestInit => ({
  method: "POST", headers: { ...headers, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body),
});
