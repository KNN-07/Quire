import { endpoints, resourceVersionTag } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { authentication } from "../../accounts/identity/authentication";
import { store, newId } from "../../accounts/identity/store";
import { identityPolicy, passwordAllowed } from "../../accounts/identity/reads";

export function registerIdentityUnlink(context: ModuleContext): void {
  const repository = store(context);
  const auth = authentication(context, repository);
  context.routes.register(endpoints.identityUnlink, async ({ params, body }, request) => {
    const principal = await auth.mutation(request.request);
    await auth.fresh(principal);
    const version = await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      const user = await repository.find(principal.user.id, tx);
      if (user.managed_by !== null || (await identityPolicy(context, tx)).requireSso) {
        throw new ServiceError("MANAGED_ACCOUNT", 403, "Release SSO management before unlinking an identity");
      }
      if (!await tx.get("SELECT id FROM sessions WHERE id=? AND user_id=? AND expires_at>?",
        [principal.sessionId, user.id, context.clock.now()])) throw new ServiceError("UNAUTHENTICATED", 401, "Session expired");
      const identity = await tx.get("SELECT id FROM identities WHERE id=? AND user_id=?", [params.id, user.id]);
      if (!identity) throw new ServiceError("NOT_FOUND", 404, "Linked identity not found");
      const passwordUsable = user.password_hash !== null && await passwordAllowed(context, user.id, tx) &&
        await tx.get("SELECT id FROM verified_emails WHERE user_id=? AND lower(email)=lower(?)", [user.id, user.primary_email]);
      const alternative = await tx.get("SELECT id FROM identities WHERE user_id=? AND id<>?", [user.id, params.id]);
      if (!passwordUsable && !alternative) throw new ServiceError("LAST_IDENTITY_REQUIRED", 409, "Keep an alternative verified sign-in method");
      const next = await repository.version(tx, user.id, body.expectedVersion);
      await tx.run("DELETE FROM identities WHERE id=? AND user_id=?", [params.id, user.id]);
      await tx.run("DELETE FROM sessions WHERE user_id=?", [user.id]);
      await context.events.record(tx, { topic: "session.revoked", aggregateId: user.id,
        payload: { userId: user.id, sessionId: null } });
      await tx.run("INSERT INTO audit_entries(id,at,actor_id,event,target_id,details_json) VALUES(?,?,?,?,?,?)",
        [newId(), context.clock.now(), user.id, "identity.unlinked", params.id, "{}"]);
      return next;
    });
    await context.events.dispatch();
    auth.clear(request);
    request.responseHeaders.set("etag", resourceVersionTag(version));
    return { ok: true as const, version };
  });
}
