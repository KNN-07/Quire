import { endpoints, AuditEntrySchema, resourceVersionTag } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";

export function auditFixture() {
  let config = { endpoint: "https://collector.example.test/audit", secretPresent: true, enabled: false, version: 8 };
  const entry = AuditEntrySchema.parse({ id: fixtureIds.team, seq: 7, at: "2026-10-26T12:00:00.000Z",
    actorId: fixtureIds.operator, organizationId: null, event: "admin.user.updated",
    targetId: fixtureIds.kien, ip: "127.0.0.1", details: { suspended: false } });
  return (request: Request, url: URL, body: unknown): Response | null => {
    if (!url.pathname.startsWith("/api/admin/audit")) return null;
    const reply = (data: unknown) => Response.json({ data, requestId: fixtureIds.operator },
      { headers: { etag: resourceVersionTag(config.version) } });
    if (url.pathname === "/api/admin/audit" && request.method === "GET") {
      const input = endpoints.auditList.input.parse({ params: {}, query: Object.fromEntries(url.searchParams) });
      return reply({ items: !input.query.event || input.query.event === entry.event ? [entry] : [], nextCursor: null });
    }
    if (url.pathname.endsWith("/siem") && request.method === "GET") return reply(config);
    if (request.headers.get("x-csrf-token") !== "fixture-csrf") return Response.json({
      requestId: fixtureIds.operator, error: { code: "FORBIDDEN", message: "Missing CSRF" },
    }, { status: 403 });
    if (url.pathname.endsWith("/siem")) {
      const input = endpoints.auditSiem.input.parse({ params: {}, query: {}, body, headers: Object.fromEntries(request.headers) });
      if (input.body.expectedVersion !== config.version || request.headers.get("if-match") !== resourceVersionTag(config.version))
        return Response.json({ requestId: fixtureIds.operator, error: { code: "STALE_VERSION", message: "Refresh configuration" } }, { status: 409 });
      config = { ...config, endpoint: input.body.endpoint, enabled: input.body.enabled, version: config.version + 1,
        secretPresent: input.body.secret === undefined ? config.secretPresent : input.body.secret.length > 0 };
      return reply({ ok: true, version: config.version });
    }
    endpoints.auditExport.input.parse({ params: {}, query: {}, body });
    return reply({ id: fixtureIds.snapshot, kind: "audit-export", status: "succeeded", progress: 1,
      result: { csv: "event,target\nadmin.user.updated,fixture\n" }, errorCode: null });
  };
}
