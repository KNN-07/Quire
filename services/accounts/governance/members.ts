import type { TransactionContext } from "./shared";
import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import type { Id, Membership } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Principal } from "@quire/runtime";
import { authorize, audit, conflict, denied, membership, missing, newId, page, publishPolicyChange, route } from "./shared";
import { csv } from "./reports";

export async function checkSeat(context: TransactionContext, organizationId: Id): Promise<void> {
  await context.db.lock("quire:accounts");
  const billing = z.object({ seats: z.number(), status: z.string() }).nullable().parse((await context.db.get("SELECT seats,status FROM billing_accounts WHERE organization_id=?", [organizationId])));
  if (!billing || billing.status === "unbilled") return;
  const count = z.object({ count: z.number() }).parse((await context.db.get("SELECT count(*) AS count FROM members WHERE organization_id=? AND licensed=1", [organizationId]))).count;
  if (billing.status !== "active" || count >= billing.seats) throw new ServiceError("SEAT_LIMIT", 409, "No licensed seat is available");
}
async function protectAdmin(context: TransactionContext, previous: Membership, role: Membership["role"] | null): Promise<void> {
  await context.db.lock("quire:accounts");
  if (previous.role !== "admin" || role === "admin") return;
  const row = z.object({ count: z.number() }).parse((await context.db.get("SELECT count(*) AS count FROM members WHERE organization_id=? AND role='admin'", [previous.organizationId])));
  if (row.count <= 1) throw new ServiceError("LAST_ADMIN", 409, "Keep at least one organization administrator");
}
async function managerRole(context: TransactionContext, principal: Principal, input: {
  readonly organizationId: Id; readonly role: Membership["role"];
}): Promise<void> {
  await context.db.lock("quire:accounts");
  if (input.role !== "member") await authorize(context, principal, { organizationId: input.organizationId, level: "admin" });
}
export function registerMembers(context: ModuleContext): void {
  const { clock } = context;
  route(context, endpoints.membersList, async ({ params, query }, principal, _request, bound) => {
    await authorize(bound, principal, { organizationId: params.o, level: "manager" });
    return page((await bound.db.all("SELECT * FROM members WHERE organization_id=? AND id>? ORDER BY id LIMIT ?", [params.o, query.cursor ?? "", query.limit + 1])).map(membership), query.limit);
  });
  route(context, endpoints.memberCreate, async ({ params, body }, principal, _request, bound) => {
    const org = (await authorize(bound, principal, { organizationId: params.o, level: "manager" }));
    conflict(org.version, body.expectedVersion);
    await managerRole(bound, principal, { organizationId: org.id, role: body.role });
    if (Boolean(body.userId) === Boolean(body.email)) throw new ServiceError("INVALID_MEMBER", 400, "Specify exactly one account ID or verified email");
    const found = body.userId
      ? (await bound.db.get("SELECT id FROM users WHERE id=? AND suspended=0 AND deleted_at IS NULL", [body.userId]))
      : (await bound.db.get("SELECT u.id FROM users u JOIN verified_emails e ON e.user_id=u.id WHERE lower(e.email)=lower(?) AND u.suspended=0 AND u.deleted_at IS NULL", [body.email ?? ""]));
    if (!found) throw new ServiceError("ACCOUNT_REQUIRED", 409, "An active verified account is required");
    const userId = z.object({ id: IdSchema }).parse(found).id;
    if ((await bound.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [org.id, userId])))
      throw new ServiceError("ALREADY_MEMBER", 409, "Account is already a member");
    if (body.licensed) await checkSeat(bound, org.id);
    const id = newId();
    await bound.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,?,?,?)", [id, org.id, userId, body.role, Number(body.licensed), clock.now()]);
    await bound.db.run("UPDATE organizations SET version=version+1,updated_at=? WHERE id=?", [clock.now(), org.id]);
    await publishPolicyChange(bound, { userId, version: org.version + 1 });
    await audit(bound, principal, { organizationId: org.id, event: "member.created", targetId: id });
    return membership((await bound.db.get("SELECT * FROM members WHERE id=?", [id])));
  });
  route(context, endpoints.memberPatch, async ({ params, body }, principal, _request, bound) => {
    await authorize(bound, principal, { organizationId: params.o, level: "manager" });
    const value = (await bound.db.get("SELECT * FROM members WHERE id=? AND organization_id=?", [params.id, params.o]));
    if (!value) throw missing();
    const member = membership(value);
    await managerRole(bound, principal, { organizationId: params.o, role: member.role });
    await managerRole(bound, principal, { organizationId: params.o, role: body.role ?? member.role });
    conflict(member.version, body.expectedVersion);
    await protectAdmin(bound, member, body.role ?? member.role);
    if (body.licensed && !member.licensed) await checkSeat(bound, params.o);
    await bound.db.run("UPDATE members SET role=?,licensed=?,version=version+1 WHERE id=?", [body.role ?? member.role, Number(body.licensed ?? member.licensed), member.id]);
    await audit(bound, principal, { organizationId: params.o, event: "member.updated", targetId: member.id });
    await publishPolicyChange(bound, { userId: member.userId, version: member.version + 1 });
    return membership((await bound.db.get("SELECT * FROM members WHERE id=?", [member.id])));
  });
  route(context, endpoints.memberDelete, async ({ params, body }, principal, _request, bound) => {
    await authorize(bound, principal, { organizationId: params.o, level: "manager" });
    const value = (await bound.db.get("SELECT * FROM members WHERE id=? AND organization_id=?", [params.id, params.o]));
    if (!value) throw missing();
    const member = membership(value);
    await managerRole(bound, principal, { organizationId: params.o, role: member.role });
    conflict(member.version, body.expectedVersion);
    await protectAdmin(bound, member, null);
    if ((await bound.db.get("SELECT id FROM users WHERE id=? AND managed_by=?", [member.userId, params.o])))
      throw new ServiceError("MANAGED_MEMBER", 409, "Release the managed account before removing membership");
    await bound.db.run("DELETE FROM members WHERE id=?", [member.id]);
    await publishPolicyChange(bound, { userId: member.userId, version: member.version + 1 });
    await audit(bound, principal, { organizationId: params.o, event: "member.deleted", targetId: member.id });
    return { ok: true as const, version: member.version + 1 };
  });
  route(context, endpoints.membersCsv, async ({ params }, principal, request, bound) => {
    await authorize(bound, principal, { organizationId: params.o, level: "manager" });
    const rows = (await bound.db.all("SELECT * FROM members WHERE organization_id=? ORDER BY id", [params.o])).map(membership);
    request.responseHeaders.set("content-type", "text/csv; charset=utf-8");
    request.responseHeaders.set("content-disposition", 'attachment; filename="members.csv"');
    return csv([["id", "userId", "role", "licensed"], ...rows.map((row) => [row.id, row.userId, row.role, String(row.licensed)])]);
  });
  route(context, endpoints.institutionEnroll, async ({ params }, principal, _request, bound) => {
    const value = (await bound.db.get("SELECT id,domains_json FROM organizations WHERE slug=? AND kind='institution'", [params.slug]));
    if (!value) throw missing();
    const org = z.object({ id: IdSchema, domains_json: z.string() }).parse(value);
    const allowed = z.array(z.string()).parse(JSON.parse(org.domains_json));
    if (!principal.user.verifiedEmails.some((email) => allowed.includes(email.split("@")[1]?.toLowerCase() ?? ""))) throw denied();
    const existing = (await bound.db.get("SELECT * FROM members WHERE organization_id=? AND user_id=?", [org.id, principal.user.id]));
    if (existing) return membership(existing);
    const id = newId();
    await bound.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',0,?)", [id, org.id, principal.user.id, clock.now()]);
    await bound.db.run("INSERT INTO institutional_eligibility(id,organization_id,user_id,basis,checked_at) VALUES(?,?,?,'verified-domain',?) ON CONFLICT(organization_id,user_id) DO UPDATE SET checked_at=excluded.checked_at", [newId(), org.id, principal.user.id, clock.now()]);
    await audit(bound, principal, { organizationId: org.id, event: "institution.enrolled", targetId: principal.user.id });
    await publishPolicyChange(bound, { userId: principal.user.id, version: 0 });
    return membership((await bound.db.get("SELECT * FROM members WHERE id=?", [id])));
  });
}
