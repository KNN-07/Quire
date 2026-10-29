import { z } from "zod";
import { endpoints, IdSchema, OperationSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { newId } from "./store";
import type { IdentityDependencies } from "./credentials";
import { requireRemovableAccount } from "../governance/managed";

export function registerAccount(context: ModuleContext, dependencies: IdentityDependencies): void {
  const { routes, uow, clock } = context;
  const { auth, repository } = dependencies;
  routes.register(endpoints.accountExport, async (_input, request) => {
    const principal = await auth.mutation(request.request);
    await auth.fresh(principal);
    return await uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      return await repository.idempotent(tx, {
        actor: principal.user.id, route: "accountExport", key: request.request.headers.get("idempotency-key") ?? "",
        body: {}, schema: OperationSchema,
      }, async () => {
        const result = {
          format: "quire-account-v1", exportedAt: clock.now(), user: await repository.user(principal.user.id, tx),
          preferences: await repository.preferences(principal.user.id, tx),
          emails: (await tx.all("SELECT id,email,verified_at FROM verified_emails WHERE user_id=?", [principal.user.id])),
          consent: (await tx.get("SELECT terms_version,accepted,updated_at FROM identity_ai_consent WHERE user_id=?", [principal.user.id])),
          memberships: (await tx.all("SELECT id,organization_id,role,licensed FROM members WHERE user_id=?", [principal.user.id])),
          projects: (await tx.all("SELECT id,name,owner_id,workspace_id,deleted_at FROM projects WHERE owner_id=? OR id IN (SELECT project_id FROM project_members WHERE user_id=?)", [principal.user.id, principal.user.id])),
          identities: (await tx.all("SELECT issuer,subject,created_at FROM identities WHERE user_id=?", [principal.user.id])),
          notifications: (await tx.all("SELECT id,kind,resource_id,read_at,created_at FROM notifications WHERE user_id=?", [principal.user.id])),
          library: (await tx.all("SELECT * FROM library_entries WHERE owner_id=?", [principal.user.id])),
          note: "Account metadata export. Project source/history exports use the project export service. No password hashes, session secrets, reset tokens, or provider credentials are included.",
        };
        const operation = OperationSchema.parse({ id: newId(), kind: "account-export", status: "succeeded",
          progress: 1, result, errorCode: null });
        await tx.run("INSERT INTO operations(id,actor_id,kind,status,progress,result_json,idempotency_key,created_at,updated_at) VALUES(?,?,?,'succeeded',1,?,?,?,?)", [operation.id, principal.user.id, operation.kind, JSON.stringify(result), request.request.headers.get("idempotency-key"), clock.now(), clock.now()]);
        return operation;
      });
    });
  });
  routes.register(endpoints.accountDelete, async ({ body }, request) => {
    const principal = await auth.mutation(request.request);
    await auth.fresh(principal);
    const row = (await repository.find(principal.user.id));
    if (row.managed_by !== null) throw new ServiceError("MANAGED_ACCOUNT", 403, "Managed account deletion requires organization administration");
    if (body.confirmation !== row.primary_email || !body.password || !row.password_hash ||
        !await Bun.password.verify(body.password, row.password_hash)) {
      throw new ServiceError("CONFIRMATION_REQUIRED", 403, "Confirm your primary email and current password");
    }
    const result = await uow.run(async (tx) => {
      await tx.lock("quire:accounts");

      await repository.find(row.id, tx);
      await requireRemovableAccount({ ...context, db: tx }, row.id);
      const version = await repository.version(tx, row.id, body.expectedVersion);
      const projects = z.array(z.object({ id: IdSchema })).parse(
        (await tx.all("SELECT id FROM projects WHERE owner_id=? AND deleted_at IS NULL", [row.id])));
      for (const project of projects) {
        const target = body.reassignment?.[project.id];
        if (!target || target === row.id) throw new ServiceError("REASSIGNMENT_REQUIRED", 409, "Transfer or delete each remaining owned project before deleting your account");
        const recipient = await repository.find(target, tx);
        if (!(await tx.get("SELECT id FROM verified_emails WHERE user_id=? AND lower(email)=lower(?)", [target, recipient.primary_email]))) {
          throw new ServiceError("REASSIGNMENT_INVALID", 409, "New owner needs a verified account");
        }
        await tx.run("DELETE FROM project_members WHERE project_id=? AND user_id=?", [project.id, target]);
        const changed = z.object({ version: z.number() }).parse((await tx.get("UPDATE projects SET owner_id=?,version=version+1,updated_at=? WHERE id=? RETURNING version", [target, clock.now(), project.id])));
        await context.events.record(tx, { topic: "access.changed", aggregateId: project.id,
          payload: { resourceId: project.id, version: changed.version } });
      }
      await tx.run("DELETE FROM sessions WHERE user_id=?", [row.id]);
      await context.events.record(tx, { topic: "session.revoked", aggregateId: row.id,
        payload: { userId: row.id, sessionId: null } });
      await tx.run(tx.dialect === "postgres" ? "DELETE FROM mail_outbox WHERE lower(recipient)=lower(?) OR lower(recipient) IN (SELECT lower(email) FROM verified_emails WHERE user_id=?) OR lower(recipient) IN (SELECT lower(payload_json::jsonb->>'email') FROM one_time_tokens WHERE user_id=?)" : "DELETE FROM mail_outbox WHERE lower(recipient)=lower(?) OR lower(recipient) IN (SELECT lower(email) FROM verified_emails WHERE user_id=?) OR lower(recipient) IN (SELECT lower(json_extract(payload_json,'$.email')) FROM one_time_tokens WHERE user_id=?)", [row.primary_email, row.id, row.id]);
      await tx.run("DELETE FROM one_time_tokens WHERE user_id=?", [row.id]);
      await tx.run("DELETE FROM verified_emails WHERE user_id=?", [row.id]);
      await tx.run("DELETE FROM identities WHERE user_id=?", [row.id]);
      await tx.run("DELETE FROM preferences WHERE user_id=?", [row.id]);
      await tx.run("DELETE FROM git_tokens WHERE user_id=?", [row.id]);
      await tx.run("DELETE FROM ssh_keys WHERE user_id=?", [row.id]);
      await tx.run("DELETE FROM project_members WHERE user_id=?", [row.id]);
      await tx.run("DELETE FROM members WHERE user_id=?", [row.id]);
      await tx.run("DELETE FROM identity_ai_consent WHERE user_id=?", [row.id]);
      await tx.run("DELETE FROM identity_requests WHERE actor=?", [row.id]);
      await tx.run("DELETE FROM idempotency_results WHERE actor_id=?", [row.id]);
      await tx.run("DELETE FROM notifications WHERE user_id=?", [row.id]);
      await tx.run("DELETE FROM notification_preferences WHERE user_id=?", [row.id]);
      await tx.run("DELETE FROM operations WHERE actor_id=? AND kind='account-export'", [row.id]);
      await tx.run("DELETE FROM library_entries WHERE owner_id=?", [row.id]);
      await tx.run("UPDATE provider_grants SET state='disabled',encrypted_secret=NULL WHERE owner_id=?", [row.id]);
      await tx.run("UPDATE users SET name='Deleted account',primary_email=?,password_hash=NULL,latex_name='',affiliation='',orcid=NULL,avatar_blob=NULL,operator=0,suspended=1,deleted_at=?,updated_at=? WHERE id=?", [`deleted-${row.id}@deleted.invalid`, clock.now(), clock.now(), row.id]);
      auth.clear(request);
      return { ok: true as const, version };
    });
    await context.events.dispatch();
    return result;
  });
}
