import { z } from "zod";
import { InstantSchema, UserSchema } from "@quire/contracts";
import { createRuntime } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register, migrations } from "../../../services/accounts/governance";
import { register as core, migrations as coreMigrations } from "../../../services/core/base";
import { isolatedData } from "../../fixtures/runtime";
import { seed } from "../../../scripts/seed";

export async function governanceFixture(options: { readonly core?: boolean } = {}) {
  const sandbox = await isolatedData();
  let now = "2026-10-26T12:00:00.000Z";
  const runtime = await createRuntime(sandbox.config, {
    clock: { now: () => InstantSchema.parse(now) },
    modules: [
      { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
      { id: "011-a-governance", lane: "A", order: 11, register, migrations },
      ...(options.core ? [{ id: "020-k-core-base", lane: "K" as const, order: 20, register: core, migrations: coreMigrations }] : []),
    ],
  });
  const password = "governance-test-password-2026";
  await seed(runtime, password);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (incoming) => runtime.routes.fetch(incoming) });
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("origin", "http://localhost:5173");
    if (init.body) headers.set("content-type", "application/json");
    return fetch(new URL(path, server.url), { ...init, headers, signal: AbortSignal.timeout(10_000) });
  }
  async function login(email = "kien@quire.local") {
    const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (!response.ok) throw new TypeError(`Login failed: ${response.status} ${await response.text()}`);
    const user = z.object({ data: UserSchema }).parse(await response.json()).data;
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Session cookie missing");
    const me = await request("/api/me", { headers: { cookie } });
    const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
    const headers = { cookie, "x-csrf-token": csrf };
    const principal = await runtime.services.get("identity").require(new Request(server.url, { headers }));
    return {
      user, headers, principal,
      get: (path: string) => request(path, { headers }),
      write: (path: string, body: unknown = {}, writeOptions: { readonly method?: string; readonly key?: string } = {}) =>
        request(path, { method: writeOptions.method ?? "POST", headers: { ...headers, "idempotency-key": writeOptions.key ?? crypto.randomUUID() },
          body: JSON.stringify(body) }),
    };
  }
  const context: ModuleContext = { ...runtime, routes: runtime.routes.forLane("A") };
  return { runtime, context, request, login, setTime: (value: string) => { now = value; },
    [Symbol.asyncDispose]: async () => { await server.stop(true); runtime.close(); await sandbox[Symbol.asyncDispose](); } };
}
export async function data<T extends z.ZodType>(response: Response, schema: T): Promise<z.output<T>> {
  if (!response.ok) throw new TypeError(`HTTP ${response.status}: ${await response.text()}`);
  const envelope = z.object({ data: z.unknown() }).parse(await response.json());
  return schema.parse(envelope.data);
}
export type GovernanceFixture = Awaited<ReturnType<typeof governanceFixture>>;
