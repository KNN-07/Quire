import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ky from "ky";
import { createRuntime, loadConfig } from "@quire/runtime";
import type { RealtimeSocketData } from "@quire/runtime";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register as core, migrations as coreMigrations, CoreProjects } from "../../../services/core/base";
import { register as git, migrations as gitMigrations } from "../../../services/core/git";
import { register as catalog, migrations as catalogMigrations } from "../../../services/core/catalog";
import { register as review, migrations as reviewMigrations, dispose as disposeReview } from "../../../services/core/review";
import { createAiModules } from "../../../services/adapters/ai";
import { createReferencesModules } from "../../../services/adapters/references";
import { createAdapterModules, SafeHttpClient } from "../../../services/adapters/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { seed } from "../../../scripts/seed";
import { startEditorWeb } from "../shared/web-server";
import { providerServer } from "../../adapters/ai/provider";

/** Owned loopback protocol fixture, not a live inference or production-availability claim. */
export async function assistantApplication(options: { readonly termsVersion?: string } = {}) {
  const resources = new AsyncDisposableStack();
  try {
    const provider = providerServer();
    resources.defer(() => provider[Symbol.asyncDispose]());
    const path = await mkdtemp(join(tmpdir(), "quire-assistant-ui-"));
    resources.defer(() => rm(path, { recursive: true, force: true }));
    const ready = Promise.withResolvers<Awaited<ReturnType<typeof createRuntime>>>();
    const api = Bun.serve<RealtimeSocketData>({
      hostname: "127.0.0.1", port: 0,
      async fetch(request, server) {
        const runtime = await ready.promise;
        if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return runtime.services.get("realtime").upgrade(request, server);
        if (new URL(request.url).pathname === endpoints.events.path) server.timeout(request, 0);
        return runtime.routes.fetch(request);
      },
      websocket: {
        async message(socket, message) { await (await ready.promise).services.get("realtime").handlers.message(socket, message); },
        async open(socket) { await (await ready.promise).services.get("realtime").handlers.open?.(socket); },
        async close(socket, code, reason) { await (await ready.promise).services.get("realtime").handlers.close?.(socket, code, reason); },
      },
    });
    resources.defer(() => api.stop(true));
    const web = await startEditorWeb(resolve("tests/ui-editor/assistant"), join(path, "vite"), api.url.origin);
    resources.defer(() => web.close());
    const http = new SafeHttpClient({ fixtureOrigins: [provider.origin], maxBytes: 16 * 1024 * 1024, timeoutMs: 60_000 });
    const references = createReferencesModules();
    const ai = createAiModules({ ...options, http, visionModels: ["fixture-model"], retrieval: () => references.retrieval });
    const shared = createAdapterModules({ http, contributions: [...references.contributions, ...ai.contributions] });
    const runtime = await createRuntime(loadConfig({ QUIRE_DATA_DIR: path, QUIRE_PUBLIC_URL: web.url.origin }), { modules: [
      { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
      { id: "021-k-base", lane: "K", order: 21, register: core, migrations: coreMigrations },
      { id: "022-k-review", lane: "K", order: 22, register: review, migrations: reviewMigrations },
      { id: "023-k-git", lane: "K", order: 23, register: git, migrations: gitMigrations },
      { id: "024-k-catalog", lane: "K", order: 24, register: catalog, migrations: catalogMigrations },
      shared.connections, shared.providers, references.module, ai.module,
    ] });
    resources.defer(async () => {
      await api.stop(true);
      await ai.close(); await references.close(); await shared.close(); await disposeReview(runtime); await runtime.close();
    });
    ready.resolve(runtime);
    const password = `fixture-${crypto.randomUUID()}`;
    await seed(runtime, password);
    const base = ky.create({ prefixUrl: web.url.origin, headers: { origin: web.url.origin }, retry: 0, timeout: 30_000 });
    async function login(email = "kien@quire.local") {
      const response = await base.post("api/auth/login", { json: { email, password } });
      const user = editorValue(resultSchema(endpoints.authLogin.output).parse(await response.json()));
      const cookieHeader = response.headers.get("set-cookie")?.split(";")[0];
      if (!cookieHeader) throw new TypeError("Actual login did not issue a cookie");
      const session = base.extend({ headers: { cookie: cookieHeader } });
      const me = editorValue(resultSchema(endpoints.me.output).parse(await (await session.get("api/me")).json()));
      const cookieAt = cookieHeader.indexOf("=");
      return { user, cookie: { name: cookieHeader.slice(0, cookieAt), value: cookieHeader.slice(cookieAt + 1), url: web.url.origin },
        http: session.extend({ headers: { "x-csrf-token": me.csrfToken } }) };
    }
    const owner = await login();
    const created = await owner.http.post("api/projects", { headers: { "idempotency-key": crypto.randomUUID() },
      json: { name: "Latent Dynamics Note", origin: { kind: "blank" } } });
    const project = editorValue(resultSchema(endpoints.projectCreate.output).parse(await created.json()));
    await runtime.db.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'project',?,?,?)",
      [crypto.randomUUID(), project.id, JSON.stringify({ ...defaultPolicy, ai: "agent" }), runtime.clock.now()]);
    await runtime.db.run("UPDATE organizations SET policy_json=? WHERE id IN (SELECT organization_id FROM members WHERE user_id=?)",
      [JSON.stringify({ ...defaultPolicy, ai: "agent" }), owner.user.id]);
    const projects = runtime.services.get("projects");
    if (!(projects instanceof CoreProjects)) throw new TypeError("Real core projects required");
    const owned = resources.move();
    return { url: web.url, path, provider, runtime, ai, owner, project, core: projects, login,
      async configure(limit = 50) {
        const operator = await login("operator@quire.local");
        await operator.http.put("api/admin/providers/ai", { headers: { "if-match": '"0"' }, json: {
          baseUrl: `${provider.origin}/v1`, model: "fixture-model", secret: "fixture-ai-key",
          policy: { ...defaultPolicy, ai: "agent", aiDailyUses: limit }, expectedVersion: 0,
        } });
      },
      async [Symbol.asyncDispose]() { await owned.disposeAsync(); },
    };
  } finally { await resources.disposeAsync(); }
}
