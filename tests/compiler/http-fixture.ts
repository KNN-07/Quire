import { z } from "zod";
import { compilerFixture, fixturePassword } from "./fixtures";

export async function compilerHttp(options: Parameters<typeof compilerFixture>[0] = {}) {
  const runtime = await compilerFixture({ ...options, integrated: true });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: (request) => runtime.routes.fetch(request) });
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("origin", "http://localhost:5173");
    if (typeof init.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(path, server.url), { ...init, headers, signal: AbortSignal.timeout(60000) });
  };
  const login = async (email = "kien@quire.local") => {
    const response = await request("/api/auth/login", { method: "POST",
      body: JSON.stringify({ email, password: fixturePassword }) });
    if (!response.ok) throw new TypeError(`Login failed ${response.status}: ${await response.text()}`);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("No session cookie");
    const me = await request("/api/me", { headers: { cookie } });
    const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
    return { cookie, "x-csrf-token": csrf };
  };
  return { runtime, request, login, url: server.url,
    [Symbol.asyncDispose]: async () => { await server.stop(true); await runtime[Symbol.asyncDispose](); } };
}
