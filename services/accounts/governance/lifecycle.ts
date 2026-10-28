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
export async function transitionManaged(context: ModuleContext, principal: Principal, input: ManagedLifecycleCommand): Promise<void> {
  await context.uow.run(async (tx) => {
    await tx.lock("quire:accounts");
    const bound = { ...context, db: tx };

    await authorize(bound, principal, { organizationId: input.organizationId, level: "admin" });
    const value = (await bound.db.get("SELECT * FROM managed_acceptances WHERE organization_id=? AND user_id=?", [input.organizationId, input.userId]));
    if (!value) throw missing();
    const row = managedRow.parse(value);
    conflict(row.version, input.expectedVersion);
    const now = bound.clock.now();
    switch (input.action) {
      case "lapse": {
        if (row.state !== "accepted") throw new ServiceError("INVALID_MANAGED_STATE", 409, "Only accepted management can lapse");
        const lastOperator = await tx.get(`SELECT id FROM users WHERE id=? AND operator=1
          AND NOT EXISTS(SELECT 1 FROM users other WHERE other.id<>? AND other.operator=1
            AND other.suspended=0 AND other.deleted_at IS NULL)`, [input.userId, input.userId]);
        if (lastOperator) throw new ServiceError("LAST_OPERATOR", 409, "Keep an active operator");
        await bound.db.run("UPDATE managed_acceptances SET state='suspended',lapse_at=?,version=version+1 WHERE id=?", [now, row.id]);
        await bound.db.run("UPDATE users SET suspended=1,version=version+1,updated_at=? WHERE id=?", [now, input.userId]);
        await revokeSessions(bound, input.userId);
        break;
      }
      case "recover": {
        if (row.state !== "suspended" && row.state !== "soft_deleted")
          throw new ServiceError("INVALID_MANAGED_STATE", 409, "Only suspended or soft-deleted management can recover");
        await bound.db.run("UPDATE managed_acceptances SET state='accepted',lapse_at=NULL,version=version+1 WHERE id=?", [row.id]);
        await bound.db.run("UPDATE users SET suspended=0,deleted_at=NULL,version=version+1,updated_at=? WHERE id=?", [now, input.userId]);
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
          const recipient = z.object({ user_id: IdSchema }).nullable().parse((await bound.db.get("SELECT user_id FROM members WHERE organization_id=? AND user_id=?", [input.organizationId, input.transferTo])));
          if (!recipient) throw new ServiceError("INVALID_TRANSFER", 409, "Transfer owner must belong to the organization");
          await requireRemovableAccount(bound, input.userId);
          await transferProjects(bound, { from: input.userId, to: input.transferTo });
          await bound.db.run("UPDATE managed_acceptances SET state='deleted',version=version+1 WHERE id=?", [row.id]);
          await bound.db.run("UPDATE users SET managed_by=NULL,suspended=1,deleted_at=?,password_hash=NULL,version=version+1,updated_at=? WHERE id=?", [now, now, input.userId]);
          await bound.db.run("DELETE FROM one_time_tokens WHERE user_id=?", [input.userId]);
          await bound.db.run("UPDATE provider_grants SET state='disabled',encrypted_secret=NULL WHERE owner_id=?", [input.userId]);
          await bound.db.run("DELETE FROM members WHERE user_id=?", [input.userId]);
          await revokeSessions(bound, input.userId);
        } else if (row.state === "suspended") {
          await bound.db.run("UPDATE managed_acceptances SET state='soft_deleted',version=version+1 WHERE id=?", [row.id]);
          await bound.db.run("UPDATE users SET deleted_at=?,version=version+1,updated_at=? WHERE id=?", [now, now, input.userId]);
        } else return;
        break;
      }
      default: assertNever(input);
    }
    await audit(bound, principal, { organizationId: input.organizationId, event: `managed.${input.action}`, targetId: input.userId });
  });
  await context.events.dispatch();
}
export async function reconcileInstitutionEligibility(context: ModuleContext): Promise<number> {
  const result = await context.uow.run(async (tx) => {
    await tx.lock("quire:accounts");
    const bound = { ...context, db: tx };

    const rows = z.array(z.object({ organization_id: IdSchema, user_id: IdSchema, domains_json: z.string(), expires_at: z.string().nullable() }))
      .parse((await bound.db.all("SELECT e.organization_id,e.user_id,o.domains_json,e.expires_at FROM institutional_eligibility e JOIN organizations o ON o.id=e.organization_id WHERE e.basis='verified-domain'", [])));
    let removed = 0;
    for (const row of rows) {
      const domains = z.array(z.string()).parse(JSON.parse(row.domains_json));
      const emails = z.array(z.object({ email: z.string() })).parse((await bound.db.all("SELECT email FROM verified_emails WHERE user_id=?", [row.user_id])));
      if ((row.expires_at !== null && row.expires_at <= bound.clock.now()) ||
        !emails.some((email) => domains.includes(email.email.split("@")[1]?.toLowerCase() ?? ""))) {
        // Only self-enrolled, unlicensed members are removed. Administrative grants and
        // explicitly accepted management are independent of domain eligibility.
        removed += (await bound.db.run("DELETE FROM members WHERE organization_id=? AND user_id=? AND role='member' AND licensed=0 AND NOT EXISTS(SELECT 1 FROM users WHERE id=? AND managed_by=?)", [row.organization_id, row.user_id, row.user_id, row.organization_id])).changes;
        await bound.db.run("DELETE FROM institutional_eligibility WHERE organization_id=? AND user_id=?", [row.organization_id, row.user_id]);
        await publishPolicyChange(bound, { userId: row.user_id, version: 0 });
      }
    }
    return removed;
  });
  await context.events.dispatch();
  return result;
}
