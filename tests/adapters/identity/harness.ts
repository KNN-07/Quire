import { z } from "zod";
import { createRuntime } from "@quire/runtime";
import { InstantSchema, UserSchema } from "@quire/contracts";
import { createAdapterModules, SafeHttpClient, ProviderConfigurations } from "../../../services/adapters/shared";
import { createIdentityModule, identityDefinition } from "../../../services/adapters/identity";
import type { IdentityProfile } from "../../../services/adapters/identity";
import { register, migrations } from "../../../services/accounts/identity";
import { seed } from "../../../scripts/seed";
import { isolatedData } from "../../accounts/fixture";
import { fixtureIds, defaultPolicy } from "../../fixtures/foundation";
import { providerFixture } from "./provider-fixture";

export const password = "identity-fixture-password-2026";
export async function fixture(options: { readonly configured?: boolean } = {}) {
  const provider = await providerFixture();
  const sandbox = await isolatedData();
  const http = new SafeHttpClient({ fixtureOrigins: [provider.origin], timeoutMs: 3000 });
  const profiles: readonly IdentityProfile[] = [
    { id: "google", label: "Google fixture", issuer: provider.origin, protocol: "oidc", pkce: true, scopes: ["openid", "email", "profile"] },
    { id: "github", label: "GitHub fixture", issuer: provider.origin, protocol: "github", pkce: true, scopes: ["read:user", "user:email"] },
    { id: "orcid", label: "ORCID fixture", issuer: provider.origin, protocol: "oidc", pkce: false, scopes: ["openid"] },
  ];
  const shared = createAdapterModules({ http, contributions: profiles.map((profile) => () => identityDefinition(profile)) });
  const runtime = await createRuntime(sandbox.config, {
    clock: { now: () => InstantSchema.parse(new Date(provider.state.now).toISOString()) },
    modules: [{ id: "010-a-identity", lane: "A", order: 10, register, migrations },
      shared.connections, shared.providers, createIdentityModule({ http, profiles })],
  });
  await seed(runtime, password);
  const context = { ...runtime, routes: runtime.routes.forLane("A") };
  const configuration = new ProviderConfigurations(context, http);
  if (options.configured !== false) {
    for (const profile of profiles) await configuration.put({ kind: `identity-${profile.id}`,
      actorId: fixtureIds.operator, baseUrl: provider.origin, policy: defaultPolicy, expectedVersion: 0,
      secret: JSON.stringify({ clientId: `${profile.id}-client`, clientSecret: "fixture-client-secret" }) });
  }
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (incoming) => runtime.routes.fetch(incoming) });
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("origin", new URL(runtime.config.publicUrl).origin);
    if (typeof init.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(path, server.url), { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(5000) });
  }
  async function login(email = "kien@quire.local") {
    const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (!response.ok) throw new TypeError(await response.text());
    const cookie = response.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
    const me = await request("/api/me", { headers: { cookie } });
    const data = z.object({ data: z.object({ user: UserSchema, csrfToken: z.string() }) }).parse(await me.json()).data;
    return { user: data.user, cookie, headers: { cookie, "x-csrf-token": data.csrfToken } };
  }
  async function authorize(response: Response) {
    const location = response.headers.get("location");
    if (!location) throw new TypeError(`Authorization location absent: ${await response.text()}`);
    const accepted = await fetch(location, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    const callback = accepted.headers.get("location");
    if (!callback) throw new TypeError(`Provider rejected authorization: ${await accepted.text()}`);
    const url = new URL(callback);
    return { path: url.pathname + url.search,
      cookie: response.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ") };
  }
  async function begin(id = "google") { return authorize(await request(`/api/auth/${id}/start?returnTo=/projects`)); }
  return { runtime, context, provider, http, configuration, request, login, authorize, begin, path: sandbox.path,
    [Symbol.asyncDispose]: async () => {
      await server.stop(true);
      await shared.close();
      await runtime.close();
      await provider[Symbol.asyncDispose]();
      await sandbox[Symbol.asyncDispose]();
    },
  };
}
