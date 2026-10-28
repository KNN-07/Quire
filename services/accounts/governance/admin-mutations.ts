import { z } from "zod";
import { UserSchema, endpoints } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { defaultPreferences } from "../identity";
import { adminUser } from "./admin-users";
import { audit, conflict, newId, publishPolicyChange, route } from "./shared";
import { operator } from "./reports";
import { fresh } from "./billing";
import { revokeSessions, transferProjects } from "./managed";
import { editorState } from "./editor-state";

export function registerAdminMutations(context: ModuleContext): void {
  const { clock } = context;
  route(context, endpoints.adminEditorStateGet, async (_input, principal, request, bound) => {
    operator(principal);
    const state = (await editorState(bound));
    request.responseHeaders.set("etag", `"v${state.version}"`);
    return state;
  });
  route(context, endpoints.adminUserPatch, async ({ params, body }, principal, request, bound) => {
    operator(principal);
    await fresh(bound, principal);
    const user = (await adminUser(bound, params.u));
    conflict(user.version, body.expectedVersion);
    if (body.name !== undefined && !body.name.trim()) throw new ServiceError("INVALID_NAME", 400, "Name is required");
    if (user.operator && (body.operator === false || body.suspended === true)) {
      const count = z.object({ total: z.number() }).parse((await bound.db.get("SELECT count(*) AS total FROM users WHERE operator=1 AND suspended=0 AND deleted_at IS NULL", []))).total;
      if (count <= 1) throw new ServiceError("LAST_OPERATOR", 409, "Keep an active operator");
    }
    if (user.deletedAt !== null) throw new ServiceError("ACCOUNT_DELETED", 409, "Restore the account before editing");
    await bound.db.run("UPDATE users SET name=?,suspended=?,operator=?,version=version+1,updated_at=? WHERE id=?", [body.name?.trim() ?? user.name, Number(body.suspended ?? user.suspended), Number(body.operator ?? user.operator), clock.now(), user.id]);
    if (body.suspended) await revokeSessions(bound, user.id);
    await audit(bound, principal, { organizationId: user.managedBy, event: "admin.user.updated", targetId: user.id });
    request.responseHeaders.set("etag", `"v${user.version + 1}"`);
    return UserSchema.unwrap().strip().parse((await adminUser(bound, user.id)));
  });
  route(context, endpoints.adminUserInvite, async ({ body }, principal, _request, bound) => {
    operator(principal);
    await fresh(bound, principal);
    const email = body.email.toLowerCase();
    if ((await bound.db.get("SELECT id FROM users WHERE lower(primary_email)=lower(?) UNION SELECT user_id FROM verified_emails WHERE lower(email)=lower(?)", [email, email])))
      throw new ServiceError("EMAIL_UNAVAILABLE", 409, "Account already exists");
    if (!body.name.trim()) throw new ServiceError("INVALID_NAME", 400, "Name is required");
    const id = newId();
    await bound.db.run("INSERT INTO users(id,name,primary_email,created_at,updated_at) VALUES(?,?,?,?,?)", [id, body.name.trim(), email, clock.now(), clock.now()]);
    await bound.db.run("INSERT INTO preferences(user_id,value_json,updated_at) VALUES(?,?,?)", [id, JSON.stringify(defaultPreferences), clock.now()]);
    const links = (await Promise.all((["verify", "reset"] as const).map(async (purpose) => {
      const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
      const url = new URL(purpose === "verify" ? "/verify-email" : "/reset-password", bound.config.publicUrl);
      url.searchParams.set("token", token);
      const expires = new Date(Date.parse(clock.now()) + (purpose === "verify" ? 86_400_000 : 1_800_000)).toISOString();
      await bound.db.run("INSERT INTO one_time_tokens(id,user_id,token_hash,purpose,payload_json,expires_at,created_at) VALUES(?,?,?,?,?,?,?)", [newId(), id, new Bun.CryptoHasher("sha256").update(token).digest("hex"), purpose, JSON.stringify({ email }), expires, clock.now()]);
      return url.href;
    })));
    await bound.db.run("INSERT INTO mail_outbox(id,recipient,subject,body,dedupe_key,status,created_at) VALUES(?,?,'Quire account invitation',?,?,'local',?)", [newId(), email, `Verify your email:\n${links[0]}\nSet your password:\n${links[1]}`, `admin-invite:${id}`, clock.now()]);
    await audit(bound, principal, { organizationId: null, event: "admin.user.invited", targetId: id });
    return UserSchema.unwrap().strip().parse((await adminUser(bound, id)));
  });
  route(context, endpoints.adminUserTransfer, async ({ params, body }, principal, _request, bound) => {
    operator(principal);
    await fresh(bound, principal);
    const user = (await adminUser(bound, params.u));
    conflict(user.version, body.expectedVersion);
    await transferProjects(bound, { from: user.id, to: body.to, projectId: body.projectId });
    await bound.db.run("UPDATE users SET version=version+1,updated_at=? WHERE id=?", [clock.now(), user.id]);
    await audit(bound, principal, { organizationId: user.managedBy, event: "admin.project.transferred", targetId: body.projectId,
      details: { from: user.id, to: body.to } });
    return { ok: true as const, version: user.version + 1 };
  });
  route(context, endpoints.adminUserRevoke, async ({ params, body }, principal, _request, bound) => {
    operator(principal);
    await fresh(bound, principal);
    const user = (await adminUser(bound, params.u));
    conflict(user.version, body.expectedVersion);
    await revokeSessions(bound, user.id);
    await bound.db.run("UPDATE users SET version=version+1,updated_at=? WHERE id=?", [clock.now(), user.id]);
    await audit(bound, principal, { organizationId: user.managedBy, event: "admin.sessions.revoked", targetId: user.id });
    return { ok: true as const, version: user.version + 1 };
  });
  route(context, endpoints.adminUserRestore, async ({ params, body }, principal, request, bound) => {
    operator(principal);
    await fresh(bound, principal);
    const user = (await adminUser(bound, params.u));
    conflict(user.version, body.expectedVersion);
    const managed = (await bound.db.get("SELECT state FROM managed_acceptances WHERE user_id=? AND state IN ('suspended','soft_deleted')", [user.id]));
    if (!managed || !user.managedBy) throw new ServiceError("RESTORE_UNAVAILABLE", 409, "Only retained managed accounts can be restored");
    await bound.db.run("UPDATE users SET suspended=0,deleted_at=NULL,version=version+1,updated_at=? WHERE id=?", [clock.now(), user.id]);
    await bound.db.run("UPDATE managed_acceptances SET state='accepted',lapse_at=NULL,version=version+1 WHERE user_id=? AND organization_id=?", [user.id, user.managedBy]);
    await audit(bound, principal, { organizationId: user.managedBy, event: "admin.user.restored", targetId: user.id });
    request.responseHeaders.set("etag", `"v${user.version + 1}"`);
    return UserSchema.unwrap().strip().parse((await adminUser(bound, user.id)));
  });
  route(context, endpoints.adminEditorState, async ({ body }, principal, _request, bound) => {
    operator(principal);
    const current = z.object({ version: z.number() }).nullable().parse((await bound.db.get("SELECT version FROM operator_settings WHERE key='editor-state'", [])));
    conflict(current?.version ?? 0, body.expectedVersion);
    await bound.db.run("INSERT INTO operator_settings(key,value_json,version,updated_at) VALUES('editor-state',?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,version=excluded.version,updated_at=excluded.updated_at", [JSON.stringify({ closed: body.closed, message: body.message }), body.expectedVersion + 1, clock.now()]);
    await publishPolicyChange(bound, { version: body.expectedVersion + 1 });
    await audit(bound, principal, { organizationId: null, event: "admin.editor.state", targetId: principal.user.id, details: { closed: body.closed } });
    return { ok: true as const, version: body.expectedVersion + 1 };
  });
}
