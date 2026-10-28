import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id, Transaction, User } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, RequestContext } from "@quire/runtime";
import { authentication } from "../../accounts/identity/authentication";
import { defaultPreferences, newId, store } from "../../accounts/identity/store";
import { identityPolicy } from "../../accounts/identity/reads";

export type ExternalIdentityVerification = {
  readonly issuer: string;
  readonly subject: string;
  readonly name: string;
  readonly verifiedEmail: string | null;
  readonly allowCreate: boolean;
  readonly link?: { readonly userId: Id; readonly sessionId: Id; readonly expectedVersion: number };
  /** SQL only: recheck the provider configuration and apply authorized provisioning. */
  readonly beforeCommit?: (tx: Transaction, userId: Id) => Promise<void>;
};

/** The trusted protocol verifier is bound at assembly, never supplied by HTTP callers. */
export function createExternalIdentityAdmission<Proof>(
  context: ModuleContext,
  verifier: {
    readonly kind: "oauth" | "federation";
    readonly verify: (proof: Proof, request: RequestContext) => Promise<ExternalIdentityVerification>;
  },
): (proof: Proof, request: RequestContext) => Promise<User> {
  const repository = store(context);
  const auth = authentication(context, repository);
  return async (proof, request) => {
    const identity = await verifier.verify(proof, request);
    const principal = identity.link ? await auth.port.require(request.request) : null;
    const prepared = auth.prepareIssue(request);
    const result = await context.uow.run(async (tx) => {
      await tx.lock("quire:accounts");
      if (verifier.kind === "oauth" && (await identityPolicy(context, tx)).requireSso) {
        throw new ServiceError("SSO_REQUIRED", 403, "Use the configured institutional identity provider");
      }
      const existing = await tx.get("SELECT user_id FROM identities WHERE issuer=? AND subject=?", [identity.issuer, identity.subject]);
      const linkedUser = existing ? z.object({ user_id: IdSchema }).parse(existing).user_id : null;
      let userId: Id;
      if (identity.link) {
        const link = identity.link;
        if (principal?.user.id !== link.userId || principal.sessionId !== link.sessionId) {
          throw new ServiceError("IDENTITY_LINK_SESSION_CHANGED", 403, "Identity link requires its initiating session");
        }
        // Session recheck uses this transaction, not the root identity port.
        if (!await tx.get("SELECT id FROM sessions WHERE id=? AND user_id=? AND expires_at>?",
          [link.sessionId, link.userId, context.clock.now()])) {
          throw new ServiceError("UNAUTHENTICATED", 401, "Linking session expired");
        }
        const user = await repository.find(link.userId, tx);
        if (user.managed_by !== null) throw new ServiceError("MANAGED_ACCOUNT", 403, "Managed identity links require federation administration");
        if (linkedUser && linkedUser !== link.userId) throw new ServiceError("IDENTITY_COLLISION", 409, "Identity already belongs to another account");
        await repository.version(tx, link.userId, link.expectedVersion);
        userId = link.userId;
      } else if (linkedUser) {
        userId = linkedUser;
        await repository.find(userId, tx);
      } else {
        if (!identity.allowCreate) throw new ServiceError("IDENTITY_NOT_LINKED", 403, "Link this identity to an existing account first");
        if (!identity.verifiedEmail) throw new ServiceError("VERIFIED_EMAIL_REQUIRED", 403, "Verify a local account email, then link this provider");
        const email = identity.verifiedEmail.toLowerCase();
        if (await tx.get("SELECT id FROM users WHERE lower(primary_email)=lower(?) UNION SELECT user_id FROM verified_emails WHERE lower(email)=lower(?)", [email, email])) {
          throw new ServiceError("IDENTITY_EMAIL_COLLISION", 409, "Sign in to the existing account and explicitly link this provider");
        }
        userId = newId();
        const now = context.clock.now();
        await tx.run("INSERT INTO users(id,name,primary_email,created_at,updated_at) VALUES(?,?,?,?,?)", [userId, identity.name, email, now, now]);
        await tx.run("INSERT INTO preferences(user_id,value_json,updated_at) VALUES(?,?,?)", [userId, JSON.stringify(defaultPreferences), now]);
        await tx.run("INSERT INTO verified_emails(id,user_id,email,verified_at) VALUES(?,?,?,?)", [newId(), userId, email, now]);
      }
      if (!linkedUser) await tx.run("INSERT INTO identities(id,user_id,issuer,subject,created_at) VALUES(?,?,?,?,?)",
        [newId(), userId, identity.issuer, identity.subject, context.clock.now()]);
      await identity.beforeCommit?.(tx, userId);
      await prepared.publish(tx, userId);
      await tx.run("INSERT INTO audit_entries(id,at,actor_id,event,target_id,details_json) VALUES(?,?,?,?,?,?)",
        [newId(), context.clock.now(), userId, identity.link ? "identity.linked" : "identity.login", userId,
          JSON.stringify({ issuer: identity.issuer })]);
      return repository.user(userId, tx);
    });
    await prepared.complete();
    return result;
  };
}
