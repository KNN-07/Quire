import { z } from "zod";
import { OperationSchema, AdapterGrantSchema, ProviderConfigSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { migrateDatabase } from "@quire/runtime";
import { createDropboxIntegration, migrations } from "../../../services/adapters/dropbox";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { adapterFixture } from "../shared/harness";
import { defaultPolicy, fixtureIds } from "../../fixtures/foundation";
import type { dropboxServer } from "./provider";

export async function dropboxFixture(provider: ReturnType<typeof dropboxServer>) {
  let integration: ReturnType<typeof createDropboxIntegration> | undefined;
  const fixture = await adapterFixture({
    http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }),
    contributions: [services => {
      integration = createDropboxIntegration({ appKey: "quire-app", appFolder: "Apps/Quire",
        endpoints: { rpc: `${provider.origin}/2/`, content: `${provider.origin}/2/`,
          authorization: `${provider.origin}/authorize`, token: `${provider.origin}/token` } });
      return integration.contribution(services);
    }],
  });
  try {
    await migrateDatabase(fixture.runtime.uow, migrations);
    const register = async () => {
      if (!integration) throw new TypeError("Dropbox integration missing");
      await integration.module.register({ ...fixture.runtime, routes: fixture.runtime.routes.forLane("X") });
    };
    await register();
    const operator = await fixture.login("operator@quire.local"), owner = await fixture.login();
    const configured = await fixture.request("/api/admin/providers/dropbox", { method: "PUT",
      headers: { ...operator.headers, "if-match": '"0"' },
      body: JSON.stringify({ baseUrl: provider.origin, secret: "dropbox-client-secret", policy: defaultPolicy, expectedVersion: 0 }) });
    z.object({ data: ProviderConfigSchema }).parse(await configured.json());
    const started = await fixture.request("/api/connections/dropbox/start", { method: "POST", headers: owner.headers,
      body: JSON.stringify({ returnTo: "/settings/connections" }) });
    const url = z.object({ data: z.object({ url: z.url() }) }).parse(await started.json()).data.url;
    const consent = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    const callback = new URL(consent.headers.get("location") ?? "");
    const completed = await fixture.request(callback.pathname + callback.search, { headers: owner.headers });
    if (completed.status !== 303) throw new TypeError(`OAuth callback returned ${completed.status}`);
    const list = await fixture.request("/api/connections", { headers: owner.headers });
    const grant = z.object({ data: z.object({ items: z.array(AdapterGrantSchema) }) }).parse(await list.json()).data.items[0];
    if (!grant) throw new TypeError("Missing Dropbox grant");
    const action = async (name: "initialSync" | "sync" | "disconnect", options: {
      readonly projectId?: Id; readonly key?: string; readonly parameters?: Readonly<Record<string, unknown>>;
      readonly expectedCursor?: string | null;
    } = {}) => {
      const projectId = options.projectId ?? fixtureIds.project;
      const previous = await fixture.runtime.db.get<{ cursor: string | null }>(
        "SELECT cursor FROM adapter_cursors WHERE grant_id=? AND action=? AND project_id=?", [grant.id, name, projectId]);
      const response = await fixture.request(`/api/connections/${grant.id}/actions`, { method: "POST",
        headers: { ...owner.headers, "idempotency-key": options.key ?? crypto.randomUUID() },
        body: JSON.stringify({ action: name, projectId, parameters: options.parameters ?? {},
          expectedCursor: options.expectedCursor === undefined ? previous?.cursor ?? null : options.expectedCursor, expectedVersion: grant.version }) });
      console.info("DROPBOX_SYNC_RECEIPT", JSON.stringify({ root: fixture.path, api: fixture.origin,
        action: name, status: response.status, body: await response.clone().json() }));
      return response;
    };
    return { fixture, owner, grant, action, async restart() { await fixture.restart(); await register(); }, get integration() {
      if (!integration) throw new TypeError("Dropbox integration missing"); return integration;
    },
      async success(name: "initialSync" | "sync" | "disconnect", options: Parameters<typeof action>[1] = {}) {
        const response = await action(name, options);
        const body: unknown = await response.json();
        if (response.status !== 202) throw new TypeError(`Action failed ${response.status}: ${JSON.stringify(body)}`);
        return z.object({ data: OperationSchema }).parse(body).data;
      },
      async [Symbol.asyncDispose]() {
        await fixture[Symbol.asyncDispose]();
        console.info("DROPBOX_CLEANED", JSON.stringify({ root: fixture.path, api: fixture.origin, provider: provider.origin }));
      },
    };
  } catch (error) { await fixture[Symbol.asyncDispose](); throw error; }
}
export const scope = { projectId: fixtureIds.project, branch: "main" };
export const remotePath = (path: string) => `/${fixtureIds.project}/${path}`;
export async function bounded<T>(promise: Promise<T>): Promise<T> {
  const deadline = AbortSignal.timeout(5000);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new TypeError("Fixture signal deadline exceeded"));
    deadline.addEventListener("abort", abort, { once: true });
    void promise.then(value => { deadline.removeEventListener("abort", abort); resolve(value); },
      error => { deadline.removeEventListener("abort", abort); reject(error); });
  });
}
