import { AdminUserSummarySchema, endpoints, resourceVersionTag } from "@quire/contracts";
import type { AdminUserSummary } from "@quire/contracts";
import { defaultPolicy, fixtureIds } from "../../fixtures/foundation";

/** Protocol-faithful UI fixture, not the production administration service. */
export function usersFixture() {
  const organization = { id: fixtureIds.team, slug: "robotics-lab", name: "Robotics Lab",
    kind: "team" as const, domains: [], policy: defaultPolicy, version: 5 };
  let users: readonly AdminUserSummary[] = [
    { id: fixtureIds.kien, name: "Kien Nguyen", primaryEmail: "kien@quire.local", operator: true, version: 7 },
    { id: fixtureIds.mai, name: "Mai Tran", primaryEmail: "mai@quire.local", operator: false, version: 3 },
    { id: fixtureIds.sam, name: "Sam Ortiz", primaryEmail: "sam@quire.local", operator: false, version: 2 },
    { id: fixtureIds.alex, name: "Alex Chen", primaryEmail: "alex@quire.local", operator: false, version: 4 },
  ].map((user, index) => AdminUserSummarySchema.parse({
    ...user, verifiedEmails: [user.primaryEmail], managedBy: null, avatarBlob: null,
    latexName: user.name, affiliation: "", orcid: null, interfaceLanguage: "en",
    suspended: false, deletedAt: null, projectCount: index + 1,
    lastSeenAt: "2026-10-26T12:00:00Z",
    groups: index < 3 ? [{ name: organization.name, membership: {
      id: `00000000-0000-4000-8000-00000000030${index}`, userId: user.id,
      organizationId: organization.id, role: "member", licensed: false, version: index + 2,
    } }] : [],
  }));
  const reply = (data: unknown, version?: number) => Response.json({ data, requestId: fixtureIds.operator },
    { headers: version === undefined ? {} : { etag: resourceVersionTag(version) } });
  const failure = (message: string, status: number) => Response.json({
    error: { code: status === 409 ? "STALE_VERSION" : "DENIED", message }, requestId: fixtureIds.operator,
  }, { status });
  return (request: Request, url: URL, body: unknown): Response | null => {
    if (url.pathname.endsWith("/transfer")) {
      const input = endpoints.adminUserTransfer.input.parse({ params: { u: url.pathname.split("/")[4] }, query: {}, body });
      const source = users.find(user => user.id === input.params.u);
      if (!source || source.version !== input.body.expectedVersion) return failure("Stale source account", 409);
      if (!users.some(user => user.id === input.body.to) || input.body.projectId !== fixtureIds.project) return failure("Invalid transfer selection", 403);
      if (request.headers.get("x-csrf-token") !== "fixture-csrf" || !request.headers.get("idempotency-key")) return failure("Missing request protection", 403);
      users = users.map(user => user.id === source.id ? { ...user, version: user.version + 1 } : user);
      return reply({ ok: true, version: source.version + 1 });
    }
    if (url.pathname === "/api/organizations" && request.method === "GET") {
      return reply({ items: [organization], nextCursor: null });
    }
    if (url.pathname === "/api/admin/users" && request.method === "GET") {
      const { query } = endpoints.adminUsersList.input.parse({ params: {}, query: Object.fromEntries(url.searchParams) });
      const rows = users.filter(user => {
        const matchesText = `${user.name} ${user.primaryEmail}`.toLowerCase().includes((query.q ?? "").toLowerCase());
        const matchesRole = query.role === "all" || (query.role === "operator" ? user.operator
          : query.role === "member" ? !user.operator && user.groups.length > 0 : !user.operator && user.groups.length === 0);
        const matchesState = query.state === "all" || (query.state === "deleted" ? Boolean(user.deletedAt)
          : query.state === "suspended" ? user.suspended && !user.deletedAt : !user.suspended && !user.deletedAt);
        return matchesText && matchesRole && matchesState;
      });
      return reply({ items: rows, nextCursor: null });
    }
    if (url.pathname === "/api/admin/users.csv") {
      endpoints.adminUsersCsv.input.parse({ params: {}, query: Object.fromEntries(url.searchParams) });
      return new Response("name,email\nKien Nguyen,kien@quire.local\n", {
        headers: { "content-type": "text/csv", "x-request-id": fixtureIds.operator },
      });
    }
    if (url.pathname === "/api/admin/users/invite" && request.method === "POST") {
      const input = endpoints.adminUserInvite.input.parse({ params: {}, query: {}, body });
      if (!request.headers.get("idempotency-key") || request.headers.get("x-csrf-token") !== "fixture-csrf") return failure("Missing request protection", 403);
      const created = AdminUserSummarySchema.parse({ ...users[0], id: crypto.randomUUID(),
        name: input.body.name, primaryEmail: input.body.email, verifiedEmails: [],
        operator: false, groups: [], projectCount: 0, lastSeenAt: null, version: 0 });
      users = [...users, created];
      const { operator: _operator, suspended: _suspended, deletedAt: _deletedAt, groups: _groups,
        projectCount: _projectCount, lastSeenAt: _lastSeenAt, version: _version, ...user } = created;
      return reply(user);
    }
    const targetId = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/)?.[1];
    const target = users.find(user => user.id === targetId);
    if (target && request.method === "PATCH") {
      const input = endpoints.adminUserPatch.input.parse({ params: { u: target.id }, query: {}, body });
      if (input.body.expectedVersion !== target.version) return failure("User changed; refresh before saving.", 409);
      if (request.headers.get("x-csrf-token") !== "fixture-csrf") return failure("Missing CSRF", 403);
      const changed = { ...target, name: input.body.name ?? target.name,
        operator: input.body.operator ?? target.operator,
        suspended: input.body.suspended ?? target.suspended, version: target.version + 1 };
      users = users.map(user => user.id === changed.id ? changed : user);
      const { operator: _operator, suspended: _suspended, deletedAt: _deletedAt, groups: _groups,
        projectCount: _projectCount, lastSeenAt: _lastSeenAt, version: _version, ...user } = changed;
      return reply(user, changed.version);
    }
    return null;
  };
}
