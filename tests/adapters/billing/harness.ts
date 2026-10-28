import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntime, loadConfig } from "@quire/runtime";
import { InstantSchema, BillingAccountSchema } from "@quire/contracts";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register as governance, migrations as governanceMigrations } from "../../../services/accounts/governance";
import { createAdapterModules, SafeHttpClient } from "../../../services/adapters/shared";
import { createBillingModules, stripeBillingContribution } from "../../../services/adapters/billing";
import { seed } from "../../../scripts/seed";
import { fixtureIds } from "../../fixtures/foundation";
import { stripeFixture } from "./provider";
import { data } from "../../accounts/governance/harness";
import { defaultPolicy } from "../../../services/accounts/identity/policy";

export async function billingFixture(configured = true) {
  const provider = stripeFixture();
  const pathRoot = await mkdtemp(join(tmpdir(), "quire-p2x-billing-"));
  const sandbox = { config: loadConfig({ QUIRE_DATA_DIR: pathRoot }),
    [Symbol.asyncDispose]: () => rm(pathRoot, { recursive: true, force: true }) };
  const http = new SafeHttpClient({ fixtureOrigins: [provider.origin] });
  let adapters = createAdapterModules({ http, contributions: [stripeBillingContribution] });
  let now = "2026-10-27T12:00:00.000Z";
  const initialize = () => {
    const billing = createBillingModules({ http });
    return createRuntime(sandbox.config, { clock: { now: () => InstantSchema.parse(now) }, modules: [
      { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
      { id: "011-a-governance", lane: "A", order: 11, register: governance, migrations: governanceMigrations },
      adapters.connections, adapters.providers, billing.merchant, billing.portal,
    ] });
  };
  let runtime = await initialize().catch(async (error: unknown) => {
    await adapters.close(); await sandbox[Symbol.asyncDispose](); await provider[Symbol.asyncDispose](); throw error;
  });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => runtime.routes.fetch(request) });
  try {
  const password = "billing-fixture-password-2026";
  await seed(runtime, password);
  const request = async (path: string, input: RequestInit = {}) => {
    const headers = new Headers(input.headers);
    if (!headers.has("origin")) headers.set("origin", "http://localhost:5173");
    if (typeof input.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
    return fetch(new URL(path, server.url), { ...input, headers, signal: AbortSignal.timeout(10_000) });
  };
  const login = async (email = "kien@quire.local") => {
    const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError(`Login failed: ${await response.text()}`);
    const me = await data(await request("/api/me", { headers: { cookie } }), z.object({ csrfToken: z.string() }));
    const headers = { cookie, "x-csrf-token": me.csrfToken };
    return { headers, get: (path: string) => request(path, { headers }),
      write: (path: string, body: unknown, key: string = crypto.randomUUID()) => request(path, { method: "POST",
        headers: { ...headers, "idempotency-key": key }, body: JSON.stringify(body) }) };
  };
  const admin = await login();
  const org = fixtureIds.team;
  const path = `/api/organizations/${org}/billing`;
  if (configured) {
    const operator = await login("operator@quire.local");
    const secret = { apiKey: "sk_test_fixture", webhookSecrets: ["whsec_fixture"], portalConfiguration: "bpc_fixture",
      prices: [{ id: "price_month", name: "Monthly fixture" }, { id: "price_year", name: "Annual fixture" }] };
    const response = await request("/api/admin/providers/stripe-billing", { method: "PUT", headers: { ...operator.headers, "if-match": '"0"' },
      body: JSON.stringify({ baseUrl: provider.origin, secret: JSON.stringify(secret), policy: defaultPolicy, expectedVersion: 0 }) });
    if (!response.ok) throw new TypeError(`Configuration failed: ${response.status} ${await response.text()}`);
  }
  const account = async () => data(await admin.get(path), BillingAccountSchema);
  return {
    get runtime() { return runtime; }, provider, request, login, admin, org, path, account, setTime: (value: string) => { now = value; },
    async restart() {
      await adapters.close(); await runtime.close();
      adapters = createAdapterModules({ http, contributions: [stripeBillingContribution] });
      runtime = await initialize();
    },
    async webhook(bytes: string, signature = provider.sign(bytes, now)) {
      return request("/api/webhooks/billing/stripe", { method: "POST", body: bytes,
        headers: { "content-type": "application/json", "stripe-signature": signature } });
    },
    async [Symbol.asyncDispose]() {
      await server.stop(true); await adapters.close(); await runtime.close(); await sandbox[Symbol.asyncDispose](); await provider[Symbol.asyncDispose]();
    },
  };
  } catch (error) {
    await server.stop(true); await adapters.close(); await runtime.close(); await sandbox[Symbol.asyncDispose](); await provider[Symbol.asyncDispose]();
    throw error;
  }
}
