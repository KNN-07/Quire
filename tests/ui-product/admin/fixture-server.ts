import { endpoints, resourceVersionTag, IdentityConfigSchema, ProviderConfigSchema, ReleaseSchema } from "@quire/contracts";
import type { IdentityConfig } from "@quire/contracts";
import { z } from "zod";
import { usersFixture } from "./users-fixture";
import { workersFixture } from "./workers-fixture";
import { backupsFixture } from "./backups-fixture";
import { operationsFixture } from "./operations-fixture";
import { environmentsFixture } from "./environments-fixture";
import { auditFixture } from "./audit-fixture";
import { templatesFixture } from "./templates-fixture";
import { defaultPolicy, fixtureIds } from "../../fixtures/foundation";

const id = "00000000-0000-4000-8000-000000000001";
const initialIdentity = IdentityConfigSchema.parse({
  protocol: "saml", enabled: false, requireSso: false, createOnLogin: false,
  breakGlassUserId: id, domains: [], mappings: [],
  attributes: { email: "email", name: "name", groups: "groups" },
  saml: null, oidc: null, ldap: null, version: 7,
});
export async function startFixture() {
  const handleUsers = usersFixture();
  const handleWorkers = workersFixture();
  const handleBackups = backupsFixture();
  const handleOperations = operationsFixture();
  const handleEnvironments = environmentsFixture();
  const handleAudit = auditFixture();
  const handleTemplates = templatesFixture();
  const build = await Bun.build({
    entrypoints: ["tests/ui-product/admin/fixture.tsx"],
    target: "browser", naming: "[name].[ext]", loader: { ".woff2": "file" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!build.success) throw new AggregateError(build.logs, "Admin fixture bundle failed");
  const assets = new Map(build.outputs.map(output => [`/${output.path.split("/").at(-1)}`, output]));
  const requests: { readonly path: string; readonly method: string; readonly body: unknown; readonly headers: Headers }[] = [];
  let identity: IdentityConfig = initialIdentity;
  let editorPolicy = { closed: false, message: "", version: 12 };
  let providerConfiguration = ProviderConfigSchema.parse({
    id: fixtureIds.operator, kind: "ai", baseUrl: "https://provider.invalid/v1", model: "fixture-model",
    enabled: false, secretPresent: false, capabilities: {
      assistant: { enabled: false, state: "unconfigured", reason: "Protocol fixture; no live provider." },
    }, policy: defaultPolicy, version: 6,
  });
  let releases = [true, false].map((verified, index) => ReleaseSchema.parse({
    id: `00000000-0000-4000-8000-00000000060${index}`, version: `0.1.${index}-fixture`,
    manifestDigest: "b".repeat(64), notes: verified ? "Signed release fixture." : "Unverified manifest fixture.",
    signatureVerified: verified, compatibleSchema: [1], scheduledAt: null,
  }));
  const control = { denied: false, overviewUnavailable: false, workersError: false };
  const api = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const asset = assets.get(url.pathname);
      if (asset) return new Response(asset);
      if (url.pathname === "/") return new Response(Bun.file("tests/ui-product/admin/fixture.html"));
      const body: unknown = request.method === "GET" ? undefined : await request.json();
      if (url.pathname === "/__fixture/control") {
        Object.assign(control, z.strictObject({ denied: z.boolean().optional(), overviewUnavailable: z.boolean().optional(), workersError: z.boolean().optional() }).parse(body));
        return Response.json({ ok: true });
      }
      if (url.pathname === "/__fixture/requests") return Response.json(requests.map(entry => ({ ...entry, headers: Object.fromEntries(entry.headers) })));
      if (url.pathname === "/__fixture/close") { void api.stop(); return Response.json({ ok: true }); }
      requests.push({ path: url.pathname, method: request.method, body, headers: request.headers });
      const fail = (code: string, status: number) => Response.json({ error: { code, message: `Fixture ${code}` }, requestId: id }, { status });
      if (control.denied) return fail("FORBIDDEN", 403);
      if (control.overviewUnavailable && url.pathname === "/api/admin/overview") return fail("NOT_IMPLEMENTED", 501);
      const usersResponse = handleUsers(request, url, body);
      if (usersResponse) return usersResponse;
      if (control.workersError && url.pathname === "/api/admin/workers" && request.method === "GET") return fail("UNAVAILABLE", 503);
      const workersResponse = handleWorkers(request, url, body);
      if (workersResponse) return workersResponse;
      const backupsResponse = handleBackups(request, url, body);
      if (backupsResponse) return backupsResponse;
      const operationResponse = handleOperations(request, url, body);
      if (operationResponse) return operationResponse;
      const environmentResponse = handleEnvironments(request, url, body);
      if (environmentResponse) return environmentResponse;
      const auditResponse = handleAudit(request, url, body);
      if (auditResponse) return auditResponse;
      const templateResponse = handleTemplates(request, url, body);
      if (templateResponse) return templateResponse;
      let data: unknown;
      let etag: string | undefined;
      if (url.pathname === "/api/admin/editor-state" && request.method === "GET") {
        data = editorPolicy; etag = resourceVersionTag(editorPolicy.version);
      } else if (url.pathname === "/api/admin/editor-state") {
        const input = endpoints.adminEditorState.input.parse({ params: {}, query: {}, body });
        if (input.body.expectedVersion !== editorPolicy.version) return fail("STALE_VERSION", 409);
        editorPolicy = { closed: input.body.closed, message: input.body.message, version: editorPolicy.version + 1 };
        data = { ok: true, version: editorPolicy.version };
      } else if (url.pathname === "/api/admin/overview") data = {
        users: 0, projects: 0, storageBytes: 0, queuedJobs: 0, runningJobs: 0,
        capabilities: { ai: { enabled: false, state: "unconfigured", reason: "Fixture has no provider" } },
        topology: [{ role: "database", backend: "SQLite WAL", state: "ready" }, { role: "blobs", backend: "local disk", state: "ready" }, { role: "git", backend: "local repositories", state: "ready" }],
      };
      else if (url.pathname === "/api/admin/providers/ai" && request.method === "GET") {
        data = providerConfiguration;
        etag = resourceVersionTag(providerConfiguration.version);
      } else if (url.pathname === "/api/admin/providers/ai" && request.method === "PUT") {
        const input = endpoints.providerPut.input.parse({ params: { kind: "ai" }, query: {}, body, headers: Object.fromEntries(request.headers) });
        if (input.body.expectedVersion !== providerConfiguration.version || request.headers.get("if-match") !== resourceVersionTag(providerConfiguration.version)) return fail("STALE_VERSION", 409);
        providerConfiguration = { ...providerConfiguration, baseUrl: input.body.baseUrl,
          ...(input.body.model === undefined ? {} : { model: input.body.model }),
          policy: input.body.policy, version: providerConfiguration.version + 1,
          secretPresent: input.body.secret === undefined ? providerConfiguration.secretPresent : input.body.secret.length > 0 };
        data = providerConfiguration;
        etag = resourceVersionTag(providerConfiguration.version);
      } else if (url.pathname === "/api/admin/providers/ai/test") {
        endpoints.providerTest.input.parse({ params: { kind: "ai" }, query: {}, body });
        data = { ok: false, reason: "Protocol fixture; no live provider contacted." };
      } else if (url.pathname === "/api/admin/identity" && request.method === "GET") {
        data = identity;
        etag = resourceVersionTag(identity.version);
      } else if (url.pathname === "/api/admin/identity" && request.method === "PUT") {
        const input = endpoints.identityConfigPut.input.parse({ params: {}, query: {}, body, headers: Object.fromEntries(request.headers) });
        if (input.body.expectedVersion !== identity.version || request.headers.get("if-match") !== resourceVersionTag(identity.version)) return fail("STALE_VERSION", 409);
        const { expectedVersion, oidcSecret, ldapSecret, ...writable } = input.body;
        identity = { ...writable, version: expectedVersion + 1,
          oidc: writable.oidc ? { ...writable.oidc, secretPresent: oidcSecret === undefined ? identity.oidc?.secretPresent ?? false : oidcSecret.length > 0 } : null,
          ldap: writable.ldap ? { ...writable.ldap, secretPresent: ldapSecret === undefined ? identity.ldap?.secretPresent ?? false : ldapSecret.length > 0 } : null };
        data = identity;
        etag = resourceVersionTag(identity.version);
      } else if (url.pathname === "/api/admin/identity/test") {
        endpoints.identityTest.input.parse({ params: {}, query: {}, body, headers: Object.fromEntries(request.headers) });
        data = { id, kind: "identity.handshake", status: "queued", progress: 0, result: null, errorCode: null };
      } else if (url.pathname === "/api/admin/releases") data = { items: releases, nextCursor: null };
      else if (url.pathname === "/api/admin/updates") {
        const input = endpoints.updateCreate.input.parse({ params: {}, query: {}, body });
        const release = releases.find(item => item.id === input.body.releaseId);
        if (!release?.signatureVerified) return fail("UNVERIFIED_RELEASE", 422);
        releases = releases.map(item => item.id === release.id ? { ...item, scheduledAt: input.body.at } : item);
        data = { id: crypto.randomUUID(), kind: "update.fixture-operation", status: "queued", progress: 0, result: null, errorCode: null };
      } else if (["/api/admin/environments", "/api/templates", "/api/admin/audit"].includes(url.pathname)) data = { items: [], nextCursor: null };
      else if (url.pathname === "/api/admin/scim/token") {
        if (!request.headers.get("idempotency-key")) return fail("MISSING_KEY", 400);
        data = { id, secretOnce: "fixture-only-secret" };
      } else if (url.pathname === "/api/admin/identity/metadata.xml") return new Response("<EntityDescriptor entityID=\"fixture-only\"/>", { headers: { "x-request-id": id, "content-type": "application/xml" } });
      else return fail("NOT_IMPLEMENTED", 501);
      return Response.json({ data, requestId: id }, { headers: etag ? { etag } : {} });
    },
  });
  return {
    url: api.url.href,
    requests, control,
    async getRequests() { return requests; },
    async setControl(next: Partial<typeof control>) { Object.assign(control, next); },
    async close() { await api.stop(true); },
  };
}
if (import.meta.main) {
  const fixture = await startFixture();
  console.log(`ADMIN_FIXTURE_URL=${fixture.url}`);
  const close = () => { void fixture.close(); };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}
