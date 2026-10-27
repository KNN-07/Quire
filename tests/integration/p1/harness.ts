import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { endpoints, UserSchema } from "@quire/contracts";
import type { RealtimeSocketData } from "@quire/runtime";
import { createApplication } from "../../../apps/server/src/composition";
import { seed } from "../../../scripts/seed";

export const password = "p1-integration-password-2026";

export async function applicationFixture() {
  const root = await mkdtemp(join(tmpdir(), "quire-p1-app-"));
  const config = { QUIRE_DATA_DIR: root, QUIRE_PUBLIC_URL: "http://localhost:5173" };
  const { loadConfig } = await import("@quire/runtime");
  let app = await createApplication({ config: loadConfig(config) });
  await seed(app.runtime, password);
  const listen = () => Bun.serve<RealtimeSocketData>({
    hostname: "127.0.0.1", port: 0, fetch: app.handle, websocket: app.websocket,
  });
  let server = listen();
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("origin", config.QUIRE_PUBLIC_URL);
    if (typeof init.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(path, server.url), { ...init, headers, signal: AbortSignal.timeout(120000) });
  }
  async function login(email = "kien@quire.local") {
    const response = await request(endpoints.authLogin.path, {
      method: "POST", body: JSON.stringify({ email, password }),
    });
    const user = z.object({ data: UserSchema }).parse(await response.json()).data;
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Login returned no session cookie");
    const me = await request(endpoints.me.path, { headers: { cookie } });
    const csrfToken = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
    return { user, headers: { cookie, "x-csrf-token": csrfToken } };
  }
  return {
    request, login,
    get app() { return app; },
    get url() { return server.url; },
    async restart() {
      server[Symbol.dispose](); server.unref();
      await app.close();
      app = await createApplication({ config: loadConfig(config) });
      server = listen();
    },
    async [Symbol.asyncDispose]() {
      server[Symbol.dispose](); server.unref();
      await app.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export function mutation(headers: HeadersInit, body: unknown): RequestInit {
  return { method: "POST", headers: { ...Object.fromEntries(new Headers(headers)),
    "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) };
}
