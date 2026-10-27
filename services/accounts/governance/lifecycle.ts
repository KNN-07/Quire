import { z } from "zod";
import { IdSchema, assertNever } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Principal } from "@quire/runtime";
import { authorize, audit, conflict, missing, publishPolicyChange } from "./shared";
import { managedRow, requireRemovableAccount, revokeSessions, transferProjects } from "./managed";

export type ManagedLifecycleCommand = {
  readonly organizationId: Id; readonly userId: Id; readonly expectedVersion: number;
} & (
  | { readonly action: "lapse" | "recover" }
  | { readonly action: "advance"; readonly transferTo: Id; readonly lapseDays?: number; readonly deletionDays?: number }
);
// Explicit scheduler/adapter entry point. Its caller supplies the real principal, never a
// manufactured system operator. The injected clock controls all boundary decisions.
export function transitionManaged(context: ModuleContext, principal: Principal, input: ManagedLifecycleCommand): void {
  context.uow.local(() => {
    authorize(context, principal, { organizationId: input.organizationId, level: "admin" });
    const value = context.db.query("SELECT * FROM managed_acceptances WHERE organization_id=? AND user_id=?")
      .get(input.organizationId, input.userId);
    if (!value) throw missing();
    const row = managedRow.parse(value);
    conflict(row.version, input.expectedVersion);
    const now = context.clock.now();
    switch (input.action) {
      case "lapse": {
        if (row.state !== "accepted") throw new ServiceError("INVALID_MANAGED_STATE", 409, "Only accepted management can lapse");
        context.db.query("UPDATE managed_acceptances SET state='suspended',lapse_at=?,version=version+1 WHERE id=?").run(now, row.id);
        context.db.query("UPDATE users SET suspended=1,version=version+1,updated_at=? WHERE id=?").run(now, input.userId);
        revokeSessions(context, input.userId);
        break;
      }
      case "recover": {
        if (row.state !== "suspended" && row.state !== "soft_deleted")
          throw new ServiceError("INVALID_MANAGED_STATE", 409, "Only suspended or soft-deleted management can recover");
        context.db.query("UPDATE managed_acceptances SET state='accepted',lapse_at=NULL,version=version+1 WHERE id=?").run(row.id);
        context.db.query("UPDATE users SET suspended=0,deleted_at=NULL,version=version+1,updated_at=? WHERE id=?").run(now, input.userId);
        break;
      }
      case "advance": {
        const lapseDays = input.lapseDays ?? 60;
        const deletionDays = input.deletionDays ?? 90;
        if (!Number.isInteger(lapseDays) || !Number.isInteger(deletionDays) || lapseDays < 1 || deletionDays <= lapseDays)
          throw new ServiceError("INVALID_LIFECYCLE", 400, "Deletion must follow the positive lapse interval");
        if ((row.state !== "suspended" && row.state !== "soft_deleted") || row.lapse_at === null)
          throw new ServiceError("INVALID_MANAGED_STATE", 409, "Only lapsed management can advance");
        const days = (Date.parse(now) - Date.parse(row.lapse_at)) / 86_400_000;
        if (days < lapseDays) return;
        if (days >= deletionDays) {
          const recipient = z.object({ user_id: IdSchema }).nullable().parse(context.db.query(
            "SELECT user_id FROM members WHERE organization_id=? AND user_id=?").get(input.organizationId, input.transferTo));
          if (!recipient) throw new ServiceError("INVALID_TRANSFER", 409, "Transfer owner must belong to the organization");
          requireRemovableAccount(context, input.userId);
          transferProjects(context, { from: input.userId, to: input.transferTo });
          context.db.query("UPDATE managed_acceptances SET state='deleted',version=version+1 WHERE id=?").run(row.id);
          context.db.query("UPDATE users SET managed_by=NULL,suspended=1,deleted_at=?,password_hash=NULL,version=version+1,updated_at=? WHERE id=?").run(now, now, input.userId);
          context.db.query("DELETE FROM one_time_tokens WHERE user_id=?").run(input.userId);
          context.db.query("UPDATE provider_grants SET state='disabled',encrypted_secret=NULL WHERE owner_id=?").run(input.userId);
          context.db.query("DELETE FROM members WHERE user_id=?").run(input.userId);
          revokeSessions(context, input.userId);
        } else if (row.state === "suspended") {
          context.db.query("UPDATE managed_acceptances SET state='soft_deleted',version=version+1 WHERE id=?").run(row.id);
          context.db.query("UPDATE users SET deleted_at=?,version=version+1,updated_at=? WHERE id=?").run(now, now, input.userId);
        } else return;
        break;
      }
      default: assertNever(input);
    }
    audit(context, principal, { organizationId: input.organizationId, event: `managed.${input.action}`, targetId: input.userId });
  });
  context.events.dispatch();
}
export function reconcileInstitutionEligibility(context: ModuleContext): number {
  const result = context.uow.local(() => {
    const rows = z.array(z.object({ organization_id: IdSchema, user_id: IdSchema, domains_json: z.string(), expires_at: z.string().nullable() }))
      .parse(context.db.query("SELECT e.organization_id,e.user_id,o.domains_json,e.expires_at FROM institutional_eligibility e JOIN organizations o ON o.id=e.organization_id WHERE e.basis='verified-domain'").all());
    let removed = 0;
    for (const row of rows) {
      const domains = z.array(z.string()).parse(JSON.parse(row.domains_json));
      const emails = z.array(z.object({ email: z.string() })).parse(context.db.query("SELECT email FROM verified_emails WHERE user_id=?").all(row.user_id));
      if ((row.expires_at !== null && row.expires_at <= context.clock.now()) ||
        !emails.some((email) => domains.includes(email.email.split("@")[1]?.toLowerCase() ?? ""))) {
        // Only self-enrolled, unlicensed members are removed. Administrative grants and
        // explicitly accepted management are independent of domain eligibility.
        removed += context.db.query("DELETE FROM members WHERE organization_id=? AND user_id=? AND role='member' AND licensed=0 AND NOT EXISTS(SELECT 1 FROM users WHERE id=? AND managed_by=?)")
          .run(row.organization_id, row.user_id, row.user_id, row.organization_id).changes;
        context.db.query("DELETE FROM institutional_eligibility WHERE organization_id=? AND user_id=?").run(row.organization_id, row.user_id);
        publishPolicyChange(context, { userId: row.user_id, version: 0 });
      }
    }
    return removed;
  });
  context.events.dispatch();
  return result;
}
