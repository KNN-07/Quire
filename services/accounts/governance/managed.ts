import { z } from "zod";
import { endpoints, IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { authorize, audit, conflict, denied, missing, newId, route } from "./shared";
import { enqueueNotification } from "./notifications";
import { fresh } from "./billing";

export const managedRow = z.object({ id: IdSchema, organization_id: IdSchema, user_id: IdSchema,
  state: z.enum(["invited", "accepted", "released", "suspended", "soft_deleted", "deleted"]),
  version: z.number(), lapse_at: z.string().nullable() });
export function transferProjects(context: ModuleContext, input: {
  readonly from: Id; readonly to: Id; readonly projectId?: Id;
}): void {
  if (input.from === input.to || !context.db.query(
    "SELECT u.id FROM users u JOIN verified_emails e ON e.user_id=u.id AND e.email=u.primary_email COLLATE NOCASE WHERE u.id=? AND u.suspended=0 AND u.deleted_at IS NULL").get(input.to))
    throw new ServiceError("INVALID_TRANSFER", 409, "Transfer requires a distinct active verified owner");
  const projects = z.array(z.object({ id: IdSchema, version: z.number() })).parse(context.db.query(
    "SELECT id,version FROM projects WHERE owner_id=? AND (? IS NULL OR id=?)")
    .all(input.from, input.projectId ?? null, input.projectId ?? null));
  if (input.projectId && projects.length !== 1) throw missing();
  for (const project of projects) {
    context.db.query("DELETE FROM project_members WHERE project_id=? AND user_id=?").run(project.id, input.to);
    context.db.query("UPDATE projects SET owner_id=?,version=version+1,updated_at=? WHERE id=?")
      .run(input.to, context.clock.now(), project.id);
    context.events.append(context.db, { topic: "access.changed", aggregateId: project.id,
      payload: { resourceId: project.id, version: project.version + 1 } });
  }
}
export function revokeSessions(context: ModuleContext, userId: Id): void {
  context.db.query("DELETE FROM sessions WHERE user_id=?").run(userId);
  context.events.append(context.db, { topic: "session.revoked", aggregateId: userId, payload: { userId, sessionId: null } });
}
export function requireRemovableAccount(context: ModuleContext, userId: Id): void {
  if (context.db.query(`SELECT u.id FROM users u WHERE u.id=? AND u.operator=1 AND
    NOT EXISTS(SELECT 1 FROM users other WHERE other.id<>u.id AND other.operator=1 AND other.suspended=0 AND other.deleted_at IS NULL)`).get(userId))
    throw new ServiceError("LAST_OPERATOR", 409, "Keep an active operator");
  if (context.db.query(`SELECT m.id FROM members m WHERE m.user_id=? AND m.role='admin' AND
    NOT EXISTS(SELECT 1 FROM members other WHERE other.organization_id=m.organization_id AND other.user_id<>m.user_id AND other.role='admin')`).get(userId))
    throw new ServiceError("LAST_ADMIN", 409, "Reassign organization administration before account deletion");
}
function account(context: ModuleContext, input: { readonly organizationId: Id; readonly userId: Id; readonly expectedVersion: number }) {
  const value = context.db.query("SELECT version FROM users WHERE id=? AND managed_by=? AND deleted_at IS NULL")
    .get(input.userId, input.organizationId);
  if (!value) throw missing();
  conflict(z.object({ version: z.number() }).parse(value).version, input.expectedVersion);
  return managedRow.parse(context.db.query("SELECT * FROM managed_acceptances WHERE user_id=? AND organization_id=?").get(input.userId, input.organizationId));
}
export function registerManaged(context: ModuleContext): void {
  const { db, clock } = context;
  route(context, endpoints.managedInvite, ({ params, body }, principal) => {
    const org = authorize(context, principal, { organizationId: params.o, level: "admin" });
    fresh(context, principal);
    conflict(org.version, body.expectedVersion);
    if (!db.query("SELECT id FROM members WHERE organization_id=? AND user_id=?").get(org.id, body.userId)) throw denied();
    if (!db.query("SELECT id FROM users WHERE id=? AND managed_by IS NULL AND suspended=0 AND deleted_at IS NULL").get(body.userId))
      throw new ServiceError("MANAGED_CONFLICT", 409, "Account is unavailable or already managed");
    const existing = db.query("SELECT state,version FROM managed_acceptances WHERE organization_id=? AND user_id=?").get(org.id, body.userId);
    if (existing && z.object({ state: z.string() }).parse(existing).state !== "released")
      throw new ServiceError("MANAGED_CONFLICT", 409, "A management invitation already exists");
    const id = newId();
    db.query("INSERT INTO managed_acceptances(id,organization_id,user_id,state,created_at) VALUES(?,?,?,'invited',?) ON CONFLICT(organization_id,user_id) DO UPDATE SET id=excluded.id,state='invited',version=0,accepted_at=NULL,released_at=NULL,lapse_at=NULL,created_at=excluded.created_at")
      .run(id, org.id, body.userId, clock.now());
    enqueueNotification(context, { userId: body.userId, kind: "managed.invited", resourceId: id,
      dedupeKey: `managed:${id}`, mail: { subject: "Account management invitation",
        body: `${org.name} requests explicit management of your account. Accept in account settings. Invitation: ${id}` } });
    audit(context, principal, { organizationId: org.id, event: "managed.invited", targetId: body.userId, details: { invitationId: id } });
    return { ok: true as const, version: 0 };
  });
  route(context, endpoints.managedAccept, ({ params, body }, principal) => {
    fresh(context, principal);
    const value = db.query("SELECT * FROM managed_acceptances WHERE id=? AND user_id=?").get(params.id, principal.user.id);
    if (!value) throw missing();
    const row = managedRow.parse(value);
    conflict(row.version, body.expectedVersion);
    if (row.state !== "invited") throw new ServiceError("INVALID_MANAGED_STATE", 409, "Only an invitation can be accepted");
    if (!db.query("SELECT id FROM members WHERE organization_id=? AND user_id=?").get(row.organization_id, principal.user.id)) throw denied();
    if (db.query("UPDATE users SET managed_by=?,version=version+1,updated_at=? WHERE id=? AND managed_by IS NULL")
      .run(row.organization_id, clock.now(), principal.user.id).changes !== 1) throw new ServiceError("MANAGED_CONFLICT", 409, "Already managed");
    db.query("UPDATE managed_acceptances SET state='accepted',accepted_at=?,version=version+1 WHERE id=?").run(clock.now(), row.id);
    audit(context, principal, { organizationId: row.organization_id, event: "managed.accepted", targetId: principal.user.id });
    return { ok: true as const, version: row.version + 1 };
  });
  route(context, endpoints.managedRelease, ({ params, body }, principal) => {
    authorize(context, principal, { organizationId: params.o, level: "admin" });
    fresh(context, principal);
    const row = account(context, { organizationId: params.o, userId: params.u, expectedVersion: body.expectedVersion });
    if (row.state === "invited" || row.state === "released" || row.state === "deleted")
      throw new ServiceError("INVALID_MANAGED_STATE", 409, "Account has not accepted management");
    // A password or a surviving non-organization identity is required before release:
    // never strand an SSO-only account without an independent recovery path.
    const recovery = db.query("SELECT id FROM users WHERE id=? AND password_hash IS NOT NULL").get(params.u);
    if (!recovery) throw new ServiceError("RECOVERY_REQUIRED", 409, "Set an independent account password before release");
    db.query("UPDATE users SET managed_by=NULL,suspended=0,version=version+1,updated_at=? WHERE id=?").run(clock.now(), params.u);
    db.query("UPDATE managed_acceptances SET state='released',released_at=?,lapse_at=NULL,version=version+1 WHERE id=?").run(clock.now(), row.id);
    audit(context, principal, { organizationId: params.o, event: "managed.released", targetId: params.u });
    return { ok: true as const, version: body.expectedVersion + 1 };
  });
  route(context, endpoints.managedDelete, ({ params, body }, principal) => {
    authorize(context, principal, { organizationId: params.o, level: "admin" });
    fresh(context, principal);
    const row = account(context, { organizationId: params.o, userId: params.u, expectedVersion: body.expectedVersion });
    if (row.state === "invited" || row.state === "released" || row.state === "deleted")
      throw new ServiceError("INVALID_MANAGED_STATE", 409, "Account has not accepted management");
    if (!db.query("SELECT id FROM members WHERE organization_id=? AND user_id=?").get(params.o, body.transferTo)) throw denied();
    requireRemovableAccount(context, params.u);
    transferProjects(context, { from: params.u, to: body.transferTo });
    revokeSessions(context, params.u);
    db.query("DELETE FROM one_time_tokens WHERE user_id=?").run(params.u);
    db.query("UPDATE provider_grants SET state='disabled',encrypted_secret=NULL WHERE owner_id=?").run(params.u);
    db.query("DELETE FROM members WHERE user_id=?").run(params.u);
    db.query("UPDATE users SET managed_by=NULL,suspended=1,deleted_at=?,password_hash=NULL,version=version+1,updated_at=? WHERE id=?")
      .run(clock.now(), clock.now(), params.u);
    db.query("UPDATE managed_acceptances SET state='deleted',version=version+1 WHERE id=?").run(row.id);
    audit(context, principal, { organizationId: params.o, event: "managed.deleted", targetId: params.u, details: { transferTo: body.transferTo } });
    return { ok: true as const, version: body.expectedVersion + 1 };
  });
}
