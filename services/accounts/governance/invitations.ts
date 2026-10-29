import { z } from "zod";
import { endpoints, IdSchema, InvitationSchema, MemberRoleSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Principal } from "@quire/runtime";
import { audit, authorize, conflict, membership, missing, newId, organization, page, publishPolicyChange, requireTeamOrganization, route } from "./shared";
import type { TransactionContext } from "./shared";

const hashToken = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex");
const secretToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

async function invitation(context: TransactionContext, id: Id) {
  const value = await context.db.get("SELECT * FROM invitations WHERE id=? AND organization_id IS NOT NULL", [id]);
  if (!value) throw missing();
  const row = z.object({
    id: IdSchema, organization_id: IdSchema, email: z.string(), role: MemberRoleSchema,
    token_hash: z.string(), status: InvitationSchema.unwrap().shape.status,
    expires_at: z.string(), version: z.number(),
  }).parse(value);
  return { row, item: InvitationSchema.parse({
    id: row.id, projectId: null, organizationId: row.organization_id, email: row.email,
    role: row.role, status: row.status, expiresAt: row.expires_at, version: row.version,
  }) };
}
async function queue(context: TransactionContext, input: { readonly id: Id; readonly email: string; readonly token: string; readonly version: number }) {
  const url = new URL(`/organization-invitations/${input.id}`, context.config.publicUrl);
  url.searchParams.set("token", input.token);
  await context.db.run("INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,created_at) VALUES(?,?,?,?,?,?)",
    [newId(), input.email, "Organization invitation", url.toString(), `organization-invite:${input.id}:${input.version}`, context.clock.now()]);
}
async function manage(context: TransactionContext, principal: Principal, organizationId: Id, role: z.output<typeof MemberRoleSchema>) {
  return authorize(context, principal, { organizationId, level: role === "member" ? "manager" : "admin" });
}
function recipient(principal: Principal, email: string): void {
  if (!principal.user.verifiedEmails.some(value => value.toLowerCase() === email.toLowerCase()))
    throw new ServiceError("INVITATION_EMAIL", 403, "Invitation requires a matching verified email");
}
function pending(status: string): void {
  if (status !== "pending") throw new ServiceError("INVITATION_CLOSED", 409, "Only pending invitations can be changed");
}

export function registerInvitations(context: ModuleContext): void {
  route(context, endpoints.organizationInvitationsList, async ({ params, query }, principal, _request, bound) => {
    await authorize(bound, principal, { organizationId: params.o, level: "manager" });
    const rows = z.array(z.object({ id: IdSchema })).parse(await bound.db.all(
      "SELECT id FROM invitations WHERE organization_id=? AND id>? ORDER BY id LIMIT ?", [params.o, query.cursor ?? "", query.limit + 1]));
    return page(await Promise.all(rows.map(async row => (await invitation(bound, row.id)).item)), query.limit);
  });
  route(context, endpoints.organizationInvitationCreate, async ({ params, body }, principal, request, bound) => {
    const org = await manage(bound, principal, params.o, body.role);
    requireTeamOrganization(org);
    conflict(org.version, body.expectedVersion);
    if (await bound.db.get("SELECT m.id FROM members m JOIN verified_emails e ON e.user_id=m.user_id WHERE m.organization_id=? AND lower(e.email)=lower(?)", [org.id, body.email]))
      throw new ServiceError("ALREADY_MEMBER", 409, "Account is already a member");
    if (await bound.db.get("SELECT id FROM invitations WHERE organization_id=? AND lower(email)=lower(?) AND status='pending'", [org.id, body.email]))
      throw new ServiceError("INVITATION_PENDING", 409, "Invitation is already pending");
    const id = newId();
    const token = secretToken();
    const expires = new Date(Date.parse(bound.clock.now()) + 7 * 86400000).toISOString();
    await bound.db.run("INSERT INTO invitations(id,organization_id,email,role,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
      [id, org.id, body.email.toLowerCase(), body.role, hashToken(token), expires, bound.clock.now()]);
    await queue(bound, { id, email: body.email.toLowerCase(), token, version: 0 });
    await bound.db.run("UPDATE organizations SET version=version+1,updated_at=? WHERE id=?", [bound.clock.now(), org.id]);
    await audit(bound, principal, { organizationId: org.id, event: "organization.invitation.created", targetId: id });
    request.responseHeaders.set("etag", '"v0"');
    return (await invitation(bound, id)).item;
  });
  route(context, endpoints.organizationInvitationGet, async ({ params }, principal, request, bound) => {
    const { row, item } = await invitation(bound, params.id);
    recipient(principal, row.email);
    const org = z.object({ name: z.string() }).parse(await bound.db.get("SELECT name FROM organizations WHERE id=?", [row.organization_id]));
    request.responseHeaders.set("cache-control", "private, no-store");
    request.responseHeaders.set("etag", `"v${item.version}"`);
    return { invitation: item, organizationName: org.name };
  });
  route(context, endpoints.organizationInvitationAccept, async ({ params, body }, principal, request, bound) => {
    const { row } = await invitation(bound, params.id);
    recipient(principal, row.email);
    conflict(row.version, body.expectedVersion);
    if (row.status !== "pending" || row.expires_at <= bound.clock.now() || row.token_hash !== hashToken(body.token))
      throw new ServiceError("INVALID_INVITATION", 403, "Invitation is invalid or expired");
    requireTeamOrganization(await organization(bound, row.organization_id));
    if (await bound.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [row.organization_id, principal.user.id]))
      throw new ServiceError("ALREADY_MEMBER", 409, "Account is already a member");
    const id = newId();
    await bound.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,?,0,?)",
      [id, row.organization_id, principal.user.id, row.role, bound.clock.now()]);
    await bound.db.run("UPDATE invitations SET status='accepted',version=version+1 WHERE id=?", [row.id]);
    await bound.db.run("UPDATE organizations SET version=version+1,updated_at=? WHERE id=?", [bound.clock.now(), row.organization_id]);
    await publishPolicyChange(bound, { userId: principal.user.id, version: 0 });
    await audit(bound, principal, { organizationId: row.organization_id, event: "organization.invitation.accepted", targetId: row.id });
    request.responseHeaders.set("etag", '"v0"');
    return membership(await bound.db.get("SELECT * FROM members WHERE id=?", [id]));
  });
  route(context, endpoints.organizationInvitationResend, async ({ params, body }, principal, request, bound) => {
    const { row } = await invitation(bound, params.id);
    if (row.organization_id !== params.o) throw missing();
    await manage(bound, principal, params.o, row.role);
    conflict(row.version, body.expectedVersion);
    pending(row.status);
    const token = secretToken();
    const expires = new Date(Date.parse(bound.clock.now()) + 7 * 86400000).toISOString();
    await bound.db.run("UPDATE invitations SET token_hash=?,expires_at=?,version=version+1 WHERE id=?", [hashToken(token), expires, row.id]);
    await queue(bound, { id: row.id, email: row.email, token, version: row.version + 1 });
    await audit(bound, principal, { organizationId: params.o, event: "organization.invitation.resent", targetId: row.id });
    request.responseHeaders.set("etag", `"v${row.version + 1}"`);
    return (await invitation(bound, row.id)).item;
  });
  route(context, endpoints.organizationInvitationDelete, async ({ params, body }, principal, _request, bound) => {
    const { row } = await invitation(bound, params.id);
    if (row.organization_id !== params.o) throw missing();
    await manage(bound, principal, params.o, row.role);
    conflict(row.version, body.expectedVersion);
    pending(row.status);
    await bound.db.run("UPDATE invitations SET status='revoked',version=version+1 WHERE id=?", [row.id]);
    await audit(bound, principal, { organizationId: params.o, event: "organization.invitation.revoked", targetId: row.id });
    return { ok: true as const, version: row.version + 1 };
  });
}
