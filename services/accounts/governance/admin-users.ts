import { z } from "zod";
import { AdminUserSummarySchema, IdSchema, UserSchema, endpoints } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { ModuleContext } from "@quire/runtime";
import { membership, missing, page, route } from "./shared";
import { csv, operator } from "./reports";

export function adminUser(context: ModuleContext, userId: Id) {
  const value = context.db.query("SELECT * FROM users WHERE id=?").get(userId);
  if (!value) throw missing();
  const row = z.object({ id: IdSchema, name: z.string(), primary_email: z.string(), managed_by: IdSchema.nullable(),
    avatar_blob: z.string().nullable(), latex_name: z.string(), affiliation: z.string(), orcid: z.string().nullable(),
    interface_language: z.string(), operator: z.number(), suspended: z.number(), deleted_at: z.string().nullable(), version: z.number() }).parse(value);
  const emails = z.array(z.object({ email: z.string() })).parse(context.db.query("SELECT email FROM verified_emails WHERE user_id=? ORDER BY email").all(userId));
  const user = UserSchema.parse({ id: row.id, name: row.name, primaryEmail: row.primary_email,
    verifiedEmails: emails.map((item) => item.email), managedBy: row.managed_by, avatarBlob: row.avatar_blob,
    latexName: row.latex_name, affiliation: row.affiliation, orcid: row.orcid, interfaceLanguage: row.interface_language });
  const groups = z.array(z.object({ name: z.string(), id: IdSchema })).parse(context.db.query(
    "SELECT o.name,m.id FROM members m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=? ORDER BY o.id").all(userId));
  const totals = z.object({ count: z.number() }).parse(context.db.query("SELECT count(*) AS count FROM projects WHERE owner_id=? AND deleted_at IS NULL").get(userId));
  const session = z.object({ last_seen: z.string().nullable() }).parse(context.db.query("SELECT max(last_seen_at) AS last_seen FROM sessions WHERE user_id=?").get(userId));
  return AdminUserSummarySchema.parse({ ...user, operator: Boolean(row.operator), suspended: Boolean(row.suspended),
    deletedAt: row.deleted_at, version: row.version, projectCount: totals.count, lastSeenAt: session.last_seen,
    groups: groups.map((group) => ({ name: group.name, membership: membership(context.db.query("SELECT * FROM members WHERE id=?").get(group.id)) })) });
}
type UsersFilter = {
  readonly q?: string | undefined; readonly role: "all" | "operator" | "member" | "guest";
  readonly state: "all" | "active" | "suspended" | "deleted"; readonly cursor?: string | undefined; readonly limit?: number;
};
function users(context: ModuleContext, filter: UsersFilter) {
  const rows = z.array(z.object({ id: IdSchema })).parse(context.db.query(`
SELECT u.id FROM users u WHERE u.id>?
AND (? IS NULL OR instr(lower(u.name),lower(?))>0 OR instr(lower(u.primary_email),lower(?))>0)
AND (?='all' OR (?='active' AND u.deleted_at IS NULL AND u.suspended=0)
 OR (?='suspended' AND u.deleted_at IS NULL AND u.suspended=1) OR (?='deleted' AND u.deleted_at IS NOT NULL))
AND (?='all' OR (?='operator' AND u.operator=1)
 OR (?='member' AND u.operator=0 AND EXISTS(SELECT 1 FROM members m WHERE m.user_id=u.id))
 OR (?='guest' AND u.operator=0 AND NOT EXISTS(SELECT 1 FROM members m WHERE m.user_id=u.id)))
ORDER BY u.id LIMIT ?`).all(filter.cursor ?? "", filter.q ?? null, filter.q ?? null, filter.q ?? null,
    filter.state, filter.state, filter.state, filter.state, filter.role, filter.role, filter.role, filter.role, filter.limit ?? -1));
  return rows.map((row) => adminUser(context, row.id));
}
export function registerAdminUsers(context: ModuleContext): void {
  route(context, endpoints.adminUsersList, ({ query }, principal) => {
    operator(principal);
    return page(users(context, { ...query, limit: query.limit + 1 }), query.limit);
  });
  route(context, endpoints.adminUsersCsv, ({ query }, principal, request) => {
    operator(principal);
    request.responseHeaders.set("content-type", "text/csv; charset=utf-8");
    request.responseHeaders.set("content-disposition", 'attachment; filename="users.csv"');
    return csv([["id", "name", "email", "operator", "suspended", "deletedAt", "groups", "projectCount", "lastSeenAt"],
      ...users(context, query).map((user) => [user.id, user.name, user.primaryEmail, String(user.operator),
        String(user.suspended), user.deletedAt ?? "", user.groups.map((group) => group.name).join("; "),
        String(user.projectCount), user.lastSeenAt ?? ""])]);
  });
  route(context, endpoints.adminUserGet, ({ params }, principal, request) => {
    operator(principal);
    const user = adminUser(context, params.u);
    request.responseHeaders.set("etag", `"v${user.version}"`);
    return UserSchema.unwrap().strip().parse(user);
  });
}
