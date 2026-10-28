import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints } from "@quire/contracts";
import { createApplication } from "../../../apps/server/src/composition";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { isolatedData } from "../../fixtures/runtime";
import { fixtureIds } from "../../fixtures/foundation";
import { seed } from "../../../scripts/seed";

test("overview reflects the default governed AI provider configuration without probing it", async () => {
  await using data = await isolatedData();
  let providerRequests = 0;
  const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    providerRequests += 1;
    return Response.json({ data: [{ id: "fixture-model" }] });
  } });
  const resources = new AsyncDisposableStack();
  resources.defer(() => provider.stop(true));
  try {
    const app = await createApplication({
      config: { ...data.config, compilerBackend: "docker" },
      adapters: { http: new SafeHttpClient({ fixtureOrigins: [provider.url.origin] }) },
    });
    resources.defer(() => app.close());
    const password = "overview-ai-configuration-test";
    await seed(app.runtime, password);
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => app.fetch(request) });
    resources.defer(() => server.stop(true));
    const login = await fetch(new URL("/api/auth/login", server.url), {
      method: "POST", headers: { origin: data.config.publicUrl, "content-type": "application/json" },
      body: JSON.stringify({ email: "operator@quire.local", password }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Actual operator session required");
    const read = async () => {
      const response = await fetch(new URL("/api/admin/overview", server.url), { headers: { cookie } });
      expect(response.status).toBe(200);
      return z.object({ data: endpoints.adminOverview.output }).parse(await response.json()).data.capabilities["ai"];
    };
    const ai = app.adapters?.ai.service;
    if (!ai) throw new Error("Default governed AI service required");
    expect(app.runtime.services.has("ai")).toBe(false);
    expect(await read()).toMatchObject({ enabled: false, state: "unconfigured" });
    const configured = await ai.store.services.configuration.put({
      kind: "ai", actorId: fixtureIds.operator, baseUrl: new URL("/v1", provider.url).href,
      model: "fixture-model", secret: "fixture-provider-secret",
      policy: defaultPolicy, expectedVersion: 0,
    });
    expect(await read()).toEqual(await app.runtime.services.get("adapters").get("ai")?.availability());
    expect(await read()).toMatchObject({ enabled: true, state: "ready" });
    // Persisted disabled state must remain distinct from missing configuration.
    await app.runtime.db.run("UPDATE adapter_provider_configs SET enabled=0 WHERE kind='ai'");
    expect(await read()).toMatchObject({ enabled: false, state: "disabled" });
    await ai.store.services.configuration.put({
      kind: "ai", actorId: fixtureIds.operator, baseUrl: new URL("/v1", provider.url).href,
      model: "fixture-model", secret: "", policy: defaultPolicy, expectedVersion: configured.version,
    });
    expect(await read()).toMatchObject({ enabled: false, state: "unconfigured" });
    expect(providerRequests).toBe(0);
  } finally {
    await resources.disposeAsync();
  }
}, 60_000);
