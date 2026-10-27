import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import type { Id, Membership } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Principal } from "@quire/runtime";
import { authorize, audit, conflict, denied, membership, missing, newId, page, publishPolicyChange, route } from "./shared";
import { csv } from "./reports";

export function checkSeat(context: ModuleContext, organizationId: Id): void {
  const billing = z.object({ seats: z.number(), status: z.string() }).nullable().parse(context.db.query(
    "SELECT seats,status FROM billing_accounts WHERE organization_id=?").get(organizationId));
  if (!billing || billing.status === "unbilled") return;
  const count = z.object({ count: z.number() }).parse(context.db.query(
    "SELECT count(*) AS count FROM members WHERE organization_id=? AND licensed=1").get(organizationId)).count;
  if (billing.status !== "active" || count >= billing.seats) throw new ServiceError("SEAT_LIMIT", 409, "No licensed seat is available");
}
function protectAdmin(context: ModuleContext, previous: Membership, role: Membership["role"] | null): void {
  if (previous.role !== "admin" || role === "admin") return;
  const row = z.object({ count: z.number() }).parse(context.db.query(
    "SELECT count(*) AS count FROM members WHERE organization_id=? AND role='admin'").get(previous.organizationId));
  if (row.count <= 1) throw new ServiceError("LAST_ADMIN", 409, "Keep at least one organization administrator");
}
function managerRole(context: ModuleContext, principal: Principal, input: {
  readonly organizationId: Id; readonly role: Membership["role"];
}): void {
  if (input.role !== "member") authorize(context, principal, { organizationId: input.organizationId, level: "admin" });
}
export function registerMembers(context: ModuleContext): void {
  const { db, clock } = context;
  route(context, endpoints.membersList, ({ params, query }, principal) => {
    authorize(context, principal, { organizationId: params.o, level: "manager" });
    return page(db.query("SELECT * FROM members WHERE organization_id=? AND id>? ORDER BY id LIMIT ?")
      .all(params.o, query.cursor ?? "", query.limit + 1).map(membership), query.limit);
  });
  route(context, endpoints.memberCreate, ({ params, body }, principal) => {
    const org = authorize(context, principal, { organizationId: params.o, level: "manager" });
    conflict(org.version, body.expectedVersion);
    managerRole(context, principal, { organizationId: org.id, role: body.role });
    if (Boolean(body.userId) === Boolean(body.email)) throw new ServiceError("INVALID_MEMBER", 400, "Specify exactly one account ID or verified email");
    const found = body.userId
      ? db.query("SELECT id FROM users WHERE id=? AND suspended=0 AND deleted_at IS NULL").get(body.userId)
      : db.query("SELECT u.id FROM users u JOIN verified_emails e ON e.user_id=u.id WHERE e.email=? COLLATE NOCASE AND u.suspended=0 AND u.deleted_at IS NULL").get(body.email ?? "");
    if (!found) throw new ServiceError("ACCOUNT_REQUIRED", 409, "An active verified account is required");
    const userId = z.object({ id: IdSchema }).parse(found).id;
    if (db.query("SELECT id FROM members WHERE organization_id=? AND user_id=?").get(org.id, userId))
      throw new ServiceError("ALREADY_MEMBER", 409, "Account is already a member");
    if (body.licensed) checkSeat(context, org.id);
    const id = newId();
    db.query("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,?,?,?)")
      .run(id, org.id, userId, body.role, Number(body.licensed), clock.now());
    db.query("UPDATE organizations SET version=version+1,updated_at=? WHERE id=?").run(clock.now(), org.id);
    publishPolicyChange(context, { userId, version: org.version + 1 });
    audit(context, principal, { organizationId: org.id, event: "member.created", targetId: id });
    return membership(db.query("SELECT * FROM members WHERE id=?").get(id));
  });
  route(context, endpoints.memberPatch, ({ params, body }, principal) => {
    authorize(context, principal, { organizationId: params.o, level: "manager" });
    const value = db.query("SELECT * FROM members WHERE id=? AND organization_id=?").get(params.id, params.o);
    if (!value) throw missing();
    const member = membership(value);
    managerRole(context, principal, { organizationId: params.o, role: member.role });
    managerRole(context, principal, { organizationId: params.o, role: body.role ?? member.role });
    conflict(member.version, body.expectedVersion);
    protectAdmin(context, member, body.role ?? member.role);
    if (body.licensed && !member.licensed) checkSeat(context, params.o);
    db.query("UPDATE members SET role=?,licensed=?,version=version+1 WHERE id=?")
      .run(body.role ?? member.role, Number(body.licensed ?? member.licensed), member.id);
    audit(context, principal, { organizationId: params.o, event: "member.updated", targetId: member.id });
    publishPolicyChange(context, { userId: member.userId, version: member.version + 1 });
    return membership(db.query("SELECT * FROM members WHERE id=?").get(member.id));
  });
  route(context, endpoints.memberDelete, ({ params, body }, principal) => {
    authorize(context, principal, { organizationId: params.o, level: "manager" });
    const value = db.query("SELECT * FROM members WHERE id=? AND organization_id=?").get(params.id, params.o);
    if (!value) throw missing();
    const member = membership(value);
    managerRole(context, principal, { organizationId: params.o, role: member.role });
    conflict(member.version, body.expectedVersion);
    protectAdmin(context, member, null);
    if (db.query("SELECT id FROM users WHERE id=? AND managed_by=?").get(member.userId, params.o))
      throw new ServiceError("MANAGED_MEMBER", 409, "Release the managed account before removing membership");
    db.query("DELETE FROM members WHERE id=?").run(member.id);
    publishPolicyChange(context, { userId: member.userId, version: member.version + 1 });
    audit(context, principal, { organizationId: params.o, event: "member.deleted", targetId: member.id });
    return { ok: true as const, version: member.version + 1 };
  });
  route(context, endpoints.membersCsv, ({ params }, principal, request) => {
    authorize(context, principal, { organizationId: params.o, level: "manager" });
    const rows = db.query("SELECT * FROM members WHERE organization_id=? ORDER BY id").all(params.o).map(membership);
    request.responseHeaders.set("content-type", "text/csv; charset=utf-8");
    request.responseHeaders.set("content-disposition", 'attachment; filename="members.csv"');
    return csv([["id", "userId", "role", "licensed"], ...rows.map((row) => [row.id, row.userId, row.role, String(row.licensed)])]);
  });
  route(context, endpoints.institutionEnroll, ({ params }, principal) => {
    const value = db.query("SELECT id,domains_json FROM organizations WHERE slug=? AND kind='institution'").get(params.slug);
    if (!value) throw missing();
    const org = z.object({ id: IdSchema, domains_json: z.string() }).parse(value);
    const allowed = z.array(z.string()).parse(JSON.parse(org.domains_json));
    if (!principal.user.verifiedEmails.some((email) => allowed.includes(email.split("@")[1]?.toLowerCase() ?? ""))) throw denied();
    const existing = db.query("SELECT * FROM members WHERE organization_id=? AND user_id=?").get(org.id, principal.user.id);
    if (existing) return membership(existing);
    const id = newId();
    db.query("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',0,?)")
      .run(id, org.id, principal.user.id, clock.now());
    db.query("INSERT INTO institutional_eligibility(id,organization_id,user_id,basis,checked_at) VALUES(?,?,?,'verified-domain',?) ON CONFLICT(organization_id,user_id) DO UPDATE SET checked_at=excluded.checked_at")
      .run(newId(), org.id, principal.user.id, clock.now());
    audit(context, principal, { organizationId: org.id, event: "institution.enrolled", targetId: principal.user.id });
    publishPolicyChange(context, { userId: principal.user.id, version: 0 });
    return membership(db.query("SELECT * FROM members WHERE id=?").get(id));
  });
}
