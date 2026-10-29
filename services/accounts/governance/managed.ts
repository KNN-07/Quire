import type { TransactionContext } from "./shared";
import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { authorize, audit, conflict, denied, missing, newId, organization, route, publishPolicyChange, requireTeamOrganization } from "./shared";
import { enqueueNotification } from "./notifications";
import { fresh } from "./billing";
import { resetWritableSelection } from "../identity/project-benefits";
import { passwordAllowed } from "../identity/reads";
import { releaseIdentityAuthority } from "../identity/managed-release";

export async function recordProjectTransfer(context: TransactionContext, input: {
  readonly projectId: Id; readonly from: Id; readonly to: Id; readonly version: number;
}): Promise<void> {
  await resetWritableSelection(context, input.projectId);
  for (const topic of ["access.changed", "policy.changed"] as const) {
    await context.events.record(context.db, { topic, aggregateId: input.projectId,
      payload: { resourceId: input.projectId, version: input.version } });
  }
  for (const userId of [input.from, input.to]) {
    await enqueueNotification(context, { userId, kind: "project.transferred", projectId: input.projectId,
      resourceId: input.projectId, dedupeKey: `transfer:${input.projectId}:${input.version}`,
      mail: { subject: "Project ownership transferred", body: `Project ${input.projectId} was transferred from ${input.from} to ${input.to}.` } });
  }
}

export const managedRow = z.object({ id: IdSchema, organization_id: IdSchema, user_id: IdSchema,
  state: z.enum(["invited", "accepted", "released", "suspended", "soft_deleted", "deleted"]),
  version: z.number(), lapse_at: z.string().nullable() });
export async function isManagedTransferRecipient(context: TransactionContext, input: {
  readonly organizationId: Id; readonly userId: Id;
}): Promise<boolean> {
  return Boolean(await context.db.get(`SELECT u.id FROM users u
    JOIN members m ON m.user_id=u.id AND m.organization_id=?
    JOIN organizations o ON o.id=m.organization_id AND o.kind='team'
    JOIN managed_acceptances a ON a.user_id=u.id AND a.organization_id=m.organization_id AND a.state='accepted'
    WHERE u.id=? AND u.managed_by=m.organization_id AND u.suspended=0 AND u.deleted_at IS NULL`,
  [input.organizationId, input.userId]));
}
export async function transferProjects(context: TransactionContext, input: {
  readonly from: Id; readonly to: Id; readonly projectId?: Id;
}): Promise<void> {
  await context.db.lock("quire:accounts");
  if (input.from === input.to || !(await context.db.get("SELECT u.id FROM users u JOIN verified_emails e ON e.user_id=u.id AND lower(e.email)=lower(u.primary_email) WHERE u.id=? AND u.suspended=0 AND u.deleted_at IS NULL", [input.to])))
    throw new ServiceError("INVALID_TRANSFER", 409, "Transfer requires a distinct active verified owner");
  const projects = z.array(z.object({ id: IdSchema, version: z.number() })).parse((await context.db.all("SELECT id,version FROM projects WHERE owner_id=? AND (CAST(? AS TEXT) IS NULL OR id=?)", [input.from, input.projectId ?? null, input.projectId ?? null])));
  if (input.projectId && projects.length !== 1) throw missing();
  for (const project of projects) {
    await context.db.run("DELETE FROM project_members WHERE project_id=? AND user_id=?", [project.id, input.to]);
    await context.db.run("UPDATE projects SET owner_id=?,version=version+1,updated_at=? WHERE id=?", [input.to, context.clock.now(), project.id]);
    await recordProjectTransfer(context, { projectId: project.id, from: input.from, to: input.to, version: project.version + 1 });
  }
}
export async function revokeSessions(context: TransactionContext, userId: Id): Promise<void> {
  await context.db.lock("quire:accounts");
  await context.db.run("DELETE FROM sessions WHERE user_id=?", [userId]);
  await context.events.record(context.db, { topic: "session.revoked", aggregateId: userId, payload: { userId, sessionId: null } });
}
export async function requireRemovableAccount(context: TransactionContext, userId: Id): Promise<void> {
  await context.db.lock("quire:accounts");
  if ((await context.db.get(`SELECT u.id FROM users u WHERE u.id=? AND u.operator=1 AND
    NOT EXISTS(SELECT 1 FROM users other WHERE other.id<>u.id AND other.operator=1 AND other.suspended=0 AND other.deleted_at IS NULL)`, [userId])))
    throw new ServiceError("LAST_OPERATOR", 409, "Keep an active operator");
  if ((await context.db.get(`SELECT m.id FROM members m WHERE m.user_id=? AND m.role='admin' AND
    NOT EXISTS(SELECT 1 FROM members other JOIN users u ON u.id=other.user_id
      WHERE other.organization_id=m.organization_id AND other.user_id<>m.user_id AND other.role='admin'
      AND u.suspended=0 AND u.deleted_at IS NULL)`, [userId])))
    throw new ServiceError("LAST_ADMIN", 409, "Reassign organization administration before account deletion");
}
async function account(context: TransactionContext, input: { readonly organizationId: Id; readonly userId: Id; readonly expectedVersion: number }) {
  await context.db.lock("quire:accounts");
  const value = (await context.db.get("SELECT version FROM users WHERE id=? AND managed_by=? AND deleted_at IS NULL", [input.userId, input.organizationId]));
  if (!value) throw missing();
  conflict(z.object({ version: z.number() }).parse(value).version, input.expectedVersion);
  return managedRow.parse((await context.db.get("SELECT * FROM managed_acceptances WHERE user_id=? AND organization_id=?", [input.userId, input.organizationId])));
}
export function registerManaged(context: ModuleContext): void {
  const { clock } = context;
  route(context, endpoints.managedInvite, async ({ params, body }, principal, _request, bound) => {
    const org = (await authorize(bound, principal, { organizationId: params.o, level: "admin" }));
    requireTeamOrganization(org);
    await fresh(bound, principal);
    conflict(org.version, body.expectedVersion);
    if (!(await bound.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [org.id, body.userId]))) throw denied();
    if (!(await bound.db.get("SELECT id FROM users WHERE id=? AND managed_by IS NULL AND suspended=0 AND deleted_at IS NULL", [body.userId])))
      throw new ServiceError("MANAGED_CONFLICT", 409, "Account is unavailable or already managed");
    const existing = (await bound.db.get("SELECT state,version FROM managed_acceptances WHERE organization_id=? AND user_id=?", [org.id, body.userId]));
    if (existing && z.object({ state: z.string() }).parse(existing).state !== "released")
      throw new ServiceError("MANAGED_CONFLICT", 409, "A management invitation already exists");
    const id = newId();
    await bound.db.run("INSERT INTO managed_acceptances(id,organization_id,user_id,state,created_at) VALUES(?,?,?,'invited',?) ON CONFLICT(organization_id,user_id) DO UPDATE SET id=excluded.id,state='invited',version=0,accepted_at=NULL,released_at=NULL,lapse_at=NULL,created_at=excluded.created_at", [id, org.id, body.userId, clock.now()]);
    await enqueueNotification(bound, { userId: body.userId, kind: "managed.invited", resourceId: id,
      dedupeKey: `managed:${id}`, mail: { subject: "Account management invitation",
        body: `${org.name} requests explicit management of your account. Accept in account settings. Invitation: ${id}` } });
    await audit(bound, principal, { organizationId: org.id, event: "managed.invited", targetId: body.userId, details: { invitationId: id } });
    return { ok: true as const, version: 0 };
  });
  route(context, endpoints.managedAccept, async ({ params, body }, principal, _request, bound) => {
    await fresh(bound, principal);
    const value = (await bound.db.get("SELECT * FROM managed_acceptances WHERE id=? AND user_id=?", [params.id, principal.user.id]));
    if (!value) throw missing();
    const row = managedRow.parse(value);
    conflict(row.version, body.expectedVersion);
    if (row.state !== "invited") throw new ServiceError("INVALID_MANAGED_STATE", 409, "Only an invitation can be accepted");
    requireTeamOrganization(await organization(bound, row.organization_id));
    if (!(await bound.db.get("SELECT id FROM members WHERE organization_id=? AND user_id=?", [row.organization_id, principal.user.id]))) throw denied();
    if ((await bound.db.run("UPDATE users SET managed_by=?,version=version+1,updated_at=? WHERE id=? AND managed_by IS NULL", [row.organization_id, clock.now(), principal.user.id])).changes !== 1) throw new ServiceError("MANAGED_CONFLICT", 409, "Already managed");
    await bound.db.run("UPDATE managed_acceptances SET state='accepted',accepted_at=?,version=version+1 WHERE id=?", [clock.now(), row.id]);
    await audit(bound, principal, { organizationId: row.organization_id, event: "managed.accepted", targetId: principal.user.id });
    return { ok: true as const, version: row.version + 1 };
  });
  route(context, endpoints.managedRelease, async ({ params, body }, principal, _request, bound) => {
    await authorize(bound, principal, { organizationId: params.o, level: "admin" });
    await fresh(bound, principal);
    const row = await account(bound, { organizationId: params.o, userId: params.u, expectedVersion: body.expectedVersion });
    if (row.state === "invited" || row.state === "released" || row.state === "deleted")
      throw new ServiceError("INVALID_MANAGED_STATE", 409, "Account has not accepted management");
    if (await bound.db.get(`SELECT id FROM members WHERE organization_id=? AND user_id=? AND role='admin'
      AND NOT EXISTS(SELECT 1 FROM members other WHERE other.organization_id=? AND other.user_id<>? AND other.role='admin')`,
    [params.o, params.u, params.o, params.u]))
      throw new ServiceError("LAST_ADMIN", 409, "Reassign organization administration before release");
    const recovery = await bound.db.get(`SELECT u.id FROM users u WHERE u.id=? AND u.password_hash IS NOT NULL
      AND EXISTS(SELECT 1 FROM verified_emails e WHERE e.user_id=u.id AND lower(e.email)=lower(u.primary_email))`, [params.u]);
    if (!recovery) throw new ServiceError("RECOVERY_REQUIRED", 409, "Set an independent password and verify the primary email before release");
    if (!await passwordAllowed(bound, params.u, bound.db))
      throw new ServiceError("SSO_REQUIRED", 409, "Deployment policy does not permit independent password login");
    if (await bound.db.get("SELECT id FROM identities WHERE user_id=? AND authority_kind='legacy'", [params.u]))
      throw new ServiceError("IDENTITY_PROVENANCE_REQUIRED", 409, "Resolve legacy identity ownership before release");
    await releaseIdentityAuthority(bound, bound.db, { userId: params.u, organizationId: params.o });
    await revokeSessions(bound, params.u);
    await bound.db.run("DELETE FROM one_time_tokens WHERE user_id=?", [params.u]);
    await bound.db.run("UPDATE users SET managed_by=NULL,suspended=0,version=version+1,updated_at=? WHERE id=?", [clock.now(), params.u]);
    await bound.db.run("UPDATE managed_acceptances SET state='released',released_at=?,lapse_at=NULL,version=version+1 WHERE id=?", [clock.now(), row.id]);
    await bound.db.run("DELETE FROM members WHERE organization_id=? AND user_id=?", [params.o, params.u]);
    await publishPolicyChange(bound, { userId: params.u, version: body.expectedVersion + 1 });
    await audit(bound, principal, { organizationId: params.o, event: "managed.released", targetId: params.u });
    return { ok: true as const, version: body.expectedVersion + 1 };
  });
  route(context, endpoints.managedDelete, async ({ params, body }, principal, _request, bound) => {
    await authorize(bound, principal, { organizationId: params.o, level: "admin" });
    await fresh(bound, principal);
    const row = await account(bound, { organizationId: params.o, userId: params.u, expectedVersion: body.expectedVersion });
    if (row.state === "invited" || row.state === "released" || row.state === "deleted")
      throw new ServiceError("INVALID_MANAGED_STATE", 409, "Account has not accepted management");
    if (!await isManagedTransferRecipient(bound, { organizationId: params.o, userId: body.transferTo }))
      throw new ServiceError("INVALID_TRANSFER", 409, "Transfer requires an active member with accepted management by this team");
    await requireRemovableAccount(bound, params.u);
    await transferProjects(bound, { from: params.u, to: body.transferTo });
    await revokeSessions(bound, params.u);
    await bound.db.run("DELETE FROM one_time_tokens WHERE user_id=?", [params.u]);
    await bound.db.run("UPDATE provider_grants SET state='disabled',encrypted_secret=NULL WHERE owner_id=?", [params.u]);
    await bound.db.run("DELETE FROM members WHERE user_id=?", [params.u]);
    await bound.db.run("UPDATE users SET managed_by=NULL,suspended=1,deleted_at=?,password_hash=NULL,version=version+1,updated_at=? WHERE id=?", [clock.now(), clock.now(), params.u]);
    await bound.db.run("UPDATE managed_acceptances SET state='deleted',version=version+1 WHERE id=?", [row.id]);
    await audit(bound, principal, { organizationId: params.o, event: "managed.deleted", targetId: params.u, details: { transferTo: body.transferTo } });
    return { ok: true as const, version: body.expectedVersion + 1 };
  });
}
