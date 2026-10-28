import { createRuntime } from "@quire/runtime";
import type { Clock } from "@quire/contracts";
import { z } from "zod";
import { isolatedData } from "../fixture";
import { register, migrations } from "../../../services/accounts/identity";
import { seed } from "../../../scripts/seed";
import { UserSchema, PreferencesSchema } from "@quire/contracts";

export const password = "identity-test-password-2026";
export async function identityFixture(options: {
  readonly seed?: boolean; readonly clock?: Clock; readonly publicUrl?: string;
} = {}) {
  const sandbox = await isolatedData();
  const runtime = await createRuntime({ ...sandbox.config, publicUrl: options.publicUrl ?? sandbox.config.publicUrl }, {
    ...(options.clock ? { clock: options.clock } : {}),
    modules: [{ id: "010-a-identity", lane: "A", order: 10, register, migrations }],
  });
  if (options.seed) await seed(runtime, password);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (incoming) => runtime.routes.fetch(incoming) });
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("origin")) headers.set("origin", new URL(runtime.config.publicUrl).origin);
    if (init.body && typeof init.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(path, server.url), { ...init, headers, signal: AbortSignal.timeout(10_000) });
  }
  async function login(email = "kien@quire.local", credential = password) {
    const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: credential }) });
    if (!response.ok) throw new TypeError(`Login failed: ${response.status} ${await response.text()}`);
    const value = z.object({ data: UserSchema }).parse(await response.json());
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Login did not issue a cookie");
    const me = await request("/api/me", { headers: { cookie } });
    const profile = meEnvelope.parse(await me.json()).data;
    return { cookie, csrf: profile.csrfToken, user: value.data, response,
      headers: { cookie, "x-csrf-token": profile.csrfToken } };
  }
  return {
    runtime, request, login, path: sandbox.path,
    [Symbol.asyncDispose]: async () => {
      await server.stop(true);
      await runtime.close();
      await sandbox[Symbol.asyncDispose]();
    },
  };
}
export const meEnvelope = z.object({
  data: z.object({ user: UserSchema, preferences: PreferencesSchema, csrfToken: z.string() }),
});
export const okEnvelope = z.object({ data: z.object({ ok: z.literal(true), version: z.number() }) });
export const errorEnvelope = z.object({ error: z.object({ code: z.string() }) });
