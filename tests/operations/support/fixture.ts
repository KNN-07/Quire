import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createRuntime, loadConfig } from "@quire/runtime";
import type { Runtime } from "@quire/runtime";
import { InstantSchema } from "@quire/contracts";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register as base, migrations as baseMigrations } from "../../../services/core/base";
import { register, migrations } from "../../../services/operations/support";
import type { InquiryOutbox } from "../../../services/operations/support";
import { seed } from "../../../scripts/seed";

export async function supportFixture(options: { readonly outbox?: InquiryOutbox } = {}) {
  const path = await mkdtemp(join(tmpdir(), "quire-p2o-support-"));
  let runtime: Runtime;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => runtime.routes.fetch(request) });
  const port = Number(server.url.port);
  const config = loadConfig({ QUIRE_DATA_DIR: path, QUIRE_PORT: String(port) });
  let now = Date.parse("2026-10-27T12:00:00.000Z");
  const open = () => createRuntime(config, {
    clock: { now: () => InstantSchema.parse(new Date(now).toISOString()) },
    modules: [
      { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
      { id: "021-k-base", lane: "K", order: 21, register: base, migrations: baseMigrations },
      { id: "085-o-support", lane: "O", order: 85,
        register: context => register(context, options.outbox ? { inquiries: options.outbox } : {}), migrations },
    ],
  });
  try { runtime = await open(); }
  catch (error) {
    await server.stop(true);
    await rm(path, { recursive: true, force: true });
    throw error;
  }
  const password = "support-test-only-password-2026";
  try { await seed(runtime, password); }
  catch (error) {
    await server.stop(true);
    await runtime.close();
    await rm(path, { recursive: true, force: true });
    throw error;
  }
  const request = (route: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("origin", config.publicUrl);
    if (init.body) headers.set("content-type", "application/json");
    return fetch(new URL(route, server.url), { ...init, headers, signal: AbortSignal.timeout(90000) });
  };
  const login = async (email = "operator@quire.local") => {
    const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    const cookie = z.string().parse(response.headers.get("set-cookie")?.split(";")[0]);
    const me = await request("/api/me", { headers: { cookie } });
    const principal = z.object({ data: z.object({ csrfToken: z.string(), user: z.object({ id: z.string() }) }) })
      .parse(await me.json()).data;
    return { cookie, "x-csrf-token": principal.csrfToken, id: principal.user.id };
  };
  return {
    path, get runtime() { return runtime; }, request, login,
    get context() { return { ...runtime, routes: runtime.routes.forLane("O") }; },
    reopen: async () => { await runtime.close(); runtime = await open(); },
    advance: (ms: number) => { now += ms; },
    [Symbol.asyncDispose]: async () => {
      await server.stop(true);
      await runtime.close();
      await rm(path, { recursive: true, force: true });
      console.info("support.cleanup", { path, port, closed: true });
    },
  };
}
