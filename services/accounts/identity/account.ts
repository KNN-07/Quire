import { z } from "zod";
import { endpoints, IdSchema, OperationSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { newId } from "./store";
import type { IdentityDependencies } from "./credentials";

export function registerAccount(context: ModuleContext, dependencies: IdentityDependencies): void {
  const { db, routes, uow, clock } = context;
  const { auth, repository } = dependencies;
  routes.register(endpoints.accountExport, async (_input, request) => {
    const principal = await auth.mutation(request.request);
    auth.fresh(principal);
    return uow.local(() => repository.idempotent({
      actor: principal.user.id, route: "accountExport", key: request.request.headers.get("idempotency-key") ?? "",
      body: {}, schema: OperationSchema,
    }, () => {
      const result = {
        format: "quire-account-v1", exportedAt: clock.now(), user: repository.user(principal.user.id),
        preferences: repository.preferences(principal.user.id),
        emails: db.query("SELECT id,email,verified_at FROM verified_emails WHERE user_id=?").all(principal.user.id),
        consent: db.query("SELECT terms_version,accepted,updated_at FROM identity_ai_consent WHERE user_id=?").get(principal.user.id),
        memberships: db.query("SELECT id,organization_id,role,licensed FROM members WHERE user_id=?").all(principal.user.id),
        projects: db.query("SELECT id,name,owner_id,workspace_id,deleted_at FROM projects WHERE owner_id=? OR id IN (SELECT project_id FROM project_members WHERE user_id=?)")
          .all(principal.user.id, principal.user.id),
        identities: db.query("SELECT issuer,subject,created_at FROM identities WHERE user_id=?").all(principal.user.id),
        notifications: db.query("SELECT id,kind,resource_id,read_at,created_at FROM notifications WHERE user_id=?").all(principal.user.id),
        library: db.query("SELECT * FROM library_entries WHERE owner_id=?").all(principal.user.id),
        note: "Account metadata export. Project source/history exports use the project export service. No password hashes, session secrets, reset tokens, or provider credentials are included.",
      };
      const operation = OperationSchema.parse({ id: newId(), kind: "account-export", status: "succeeded",
        progress: 1, result, errorCode: null });
      db.query("INSERT INTO operations(id,actor_id,kind,status,progress,result_json,idempotency_key,created_at,updated_at) VALUES(?,?,?,'succeeded',1,?,?,?,?)")
        .run(operation.id, principal.user.id, operation.kind, JSON.stringify(result),
          request.request.headers.get("idempotency-key"), clock.now(), clock.now());
      return operation;
    }));
  });
  routes.register(endpoints.accountDelete, async ({ body }, request) => {
    const principal = await auth.mutation(request.request);
    auth.fresh(principal);
    const row = repository.find(principal.user.id);
    if (row.managed_by !== null) throw new ServiceError("MANAGED_ACCOUNT", 403, "Managed account deletion requires organization administration");
    if (body.confirmation !== row.primary_email || !body.password || !row.password_hash ||
        !await Bun.password.verify(body.password, row.password_hash)) {
      throw new ServiceError("CONFIRMATION_REQUIRED", 403, "Confirm your primary email and current password");
    }
    const result = uow.local((tx) => {
      if (repository.find(row.id).operator === 1) {
        const operators = z.object({ total: z.number() }).parse(db.query(
          "SELECT count(*) AS total FROM users WHERE operator=1 AND suspended=0 AND deleted_at IS NULL").get());
        if (operators.total <= 1) throw new ServiceError("LAST_OPERATOR", 409, "Keep an active operator before deleting this account");
      }
      const version = repository.version(row.id, body.expectedVersion);
      const projects = z.array(z.object({ id: IdSchema })).parse(
        db.query("SELECT id FROM projects WHERE owner_id=?").all(row.id));
      for (const project of projects) {
        const target = body.reassignment?.[project.id];
        if (!target || target === row.id) throw new ServiceError("REASSIGNMENT_REQUIRED", 409, "Every owned project needs a new owner");
        const recipient = repository.find(target);
        if (!db.query("SELECT id FROM verified_emails WHERE user_id=? AND email=?").get(target, recipient.primary_email)) {
          throw new ServiceError("REASSIGNMENT_INVALID", 409, "New owner needs a verified account");
        }
        db.query("DELETE FROM project_members WHERE project_id=? AND user_id=?").run(project.id, target);
        const changed = z.object({ version: z.number() }).parse(db.query(
          "UPDATE projects SET owner_id=?,version=version+1,updated_at=? WHERE id=? RETURNING version")
          .get(target, clock.now(), project.id));
        context.events.append(tx, { topic: "access.changed", aggregateId: project.id,
          payload: { resourceId: project.id, version: changed.version } });
      }
      db.query("DELETE FROM sessions WHERE user_id=?").run(row.id);
      context.events.append(tx, { topic: "session.revoked", aggregateId: row.id,
        payload: { userId: row.id, sessionId: null } });
      db.query("DELETE FROM mail_outbox WHERE recipient=? OR recipient IN (SELECT value FROM json_each(?)) OR recipient IN (SELECT json_extract(payload_json,'$.email') FROM one_time_tokens WHERE user_id=?)")
        .run(row.primary_email, JSON.stringify(principal.user.verifiedEmails), row.id);
      db.query("DELETE FROM one_time_tokens WHERE user_id=?").run(row.id);
      db.query("DELETE FROM verified_emails WHERE user_id=?").run(row.id);
      db.query("DELETE FROM identities WHERE user_id=?").run(row.id);
      db.query("DELETE FROM preferences WHERE user_id=?").run(row.id);
      db.query("DELETE FROM git_tokens WHERE user_id=?").run(row.id);
      db.query("DELETE FROM ssh_keys WHERE user_id=?").run(row.id);
      db.query("DELETE FROM project_members WHERE user_id=?").run(row.id);
      db.query("DELETE FROM members WHERE user_id=?").run(row.id);
      db.query("DELETE FROM identity_ai_consent WHERE user_id=?").run(row.id);
      db.query("DELETE FROM identity_requests WHERE actor=?").run(row.id);
      db.query("DELETE FROM idempotency_results WHERE actor_id=?").run(row.id);
      db.query("DELETE FROM notifications WHERE user_id=?").run(row.id);
      db.query("DELETE FROM notification_preferences WHERE user_id=?").run(row.id);
      db.query("DELETE FROM operations WHERE actor_id=? AND kind='account-export'").run(row.id);
      db.query("DELETE FROM library_entries WHERE owner_id=?").run(row.id);
      db.query("UPDATE provider_grants SET state='disabled',encrypted_secret=NULL WHERE owner_id=?").run(row.id);
      db.query("UPDATE users SET name='Deleted account',primary_email=?,password_hash=NULL,latex_name='',affiliation='',orcid=NULL,avatar_blob=NULL,operator=0,suspended=1,deleted_at=?,updated_at=? WHERE id=?")
        .run(`deleted-${row.id}@deleted.invalid`, clock.now(), clock.now(), row.id);
      auth.clear(request);
      return { ok: true as const, version };
    });
    context.events.dispatch();
    return result;
  });
}
