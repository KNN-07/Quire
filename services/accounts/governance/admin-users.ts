import { z } from "zod";
import { AdminUserSummarySchema, IdSchema, UserSchema, endpoints } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { membership, missing, page, route } from "./shared";
import { csv, operator } from "./reports";

export async function adminUser(context: ModuleContext, userId: Id) {
  const value = (await context.db.get("SELECT * FROM users WHERE id=?", [userId]));
  if (!value) throw missing();
  const row = z.object({ id: IdSchema, name: z.string(), primary_email: z.string(), managed_by: IdSchema.nullable(),
    avatar_blob: z.string().nullable(), latex_name: z.string(), affiliation: z.string(), orcid: z.string().nullable(),
    interface_language: z.string(), operator: z.number(), suspended: z.number(), deleted_at: z.string().nullable(), version: z.number() }).parse(value);
  const emails = z.array(z.object({ email: z.string() })).parse((await context.db.all("SELECT email FROM verified_emails WHERE user_id=? ORDER BY email", [userId])));
  const user = UserSchema.parse({ id: row.id, name: row.name, primaryEmail: row.primary_email,
    verifiedEmails: emails.map((item) => item.email), managedBy: row.managed_by, avatarBlob: row.avatar_blob,
    latexName: row.latex_name, affiliation: row.affiliation, orcid: row.orcid, interfaceLanguage: row.interface_language });
  const groups = z.array(z.object({ name: z.string(), id: IdSchema })).parse((await context.db.all("SELECT o.name,m.id FROM members m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=? ORDER BY o.id", [userId])));
  const totals = z.object({ count: z.number() }).parse((await context.db.get("SELECT count(*) AS count FROM projects WHERE owner_id=? AND deleted_at IS NULL", [userId])));
  const session = z.object({ last_seen: z.string().nullable() }).parse((await context.db.get("SELECT max(last_seen_at) AS last_seen FROM sessions WHERE user_id=?", [userId])));
  return AdminUserSummarySchema.parse({ ...user, operator: Boolean(row.operator), suspended: Boolean(row.suspended),
    deletedAt: row.deleted_at, version: row.version, projectCount: totals.count, lastSeenAt: session.last_seen,
    groups: (await Promise.all(groups.map(async (group) => ({ name: group.name, membership: membership((await context.db.get("SELECT * FROM members WHERE id=?", [group.id]))) })))) });
}
type UsersFilter = {
  readonly q?: string | undefined; readonly role: "all" | "operator" | "member" | "guest";
  readonly state: "all" | "active" | "suspended" | "deleted"; readonly cursor?: string | undefined; readonly limit?: number;
};
async function users(context: ModuleContext, filter: UsersFilter) {
  const rows = z.array(z.object({ id: IdSchema })).parse((await context.db.all(`
SELECT u.id FROM users u WHERE u.id>?
AND (CAST(? AS TEXT) IS NULL OR lower(u.name) LIKE lower(?) ESCAPE '!' OR lower(u.primary_email) LIKE lower(?) ESCAPE '!')
AND (?='all' OR (?='active' AND u.deleted_at IS NULL AND u.suspended=0)
 OR (?='suspended' AND u.deleted_at IS NULL AND u.suspended=1) OR (?='deleted' AND u.deleted_at IS NOT NULL))
AND (?='all' OR (?='operator' AND u.operator=1)
 OR (?='member' AND u.operator=0 AND EXISTS(SELECT 1 FROM members m WHERE m.user_id=u.id))
 OR (?='guest' AND u.operator=0 AND NOT EXISTS(SELECT 1 FROM members m WHERE m.user_id=u.id)))
ORDER BY u.id LIMIT ?`, [filter.cursor ?? "", filter.q ?? null, filter.q === undefined ? null : `%${filter.q.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`, filter.q === undefined ? null : `%${filter.q.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`, filter.state, filter.state, filter.state, filter.state, filter.role, filter.role, filter.role, filter.role, filter.limit ?? 2147483647])));
  return (await Promise.all(rows.map(async (row) => (await adminUser(context, row.id)))));
}
export function registerAdminUsers(context: ModuleContext): void {
  route(context, endpoints.adminUsersList, async ({ query }, principal, _request, bound) => {
    operator(principal);
    return page((await users(bound, { ...query, limit: query.limit + 1 })), query.limit);
  });
  route(context, endpoints.adminUsersCsv, async ({ query }, principal, request, bound) => {
    operator(principal);
    request.responseHeaders.set("content-type", "text/csv; charset=utf-8");
    request.responseHeaders.set("content-disposition", 'attachment; filename="users.csv"');
    return csv([["id", "name", "email", "operator", "suspended", "deletedAt", "groups", "projectCount", "lastSeenAt"],
      ...(await users(bound, query)).map((user) => [user.id, user.name, user.primaryEmail, String(user.operator),
        String(user.suspended), user.deletedAt ?? "", user.groups.map((group) => group.name).join("; "),
        String(user.projectCount), user.lastSeenAt ?? ""])]);
  });
  route(context, endpoints.adminUserGet, async ({ params }, principal, request, bound) => {
    operator(principal);
    const user = (await adminUser(bound, params.u));
    request.responseHeaders.set("etag", `"v${user.version}"`);
    return UserSchema.unwrap().strip().parse(user);
  });
}
