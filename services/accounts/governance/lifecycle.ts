import { z } from "zod";
import { endpoints, IdSchema, assertNever } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, Principal } from "@quire/runtime";
import { authorize, audit, conflict, missing, newId, organization, publishPolicyChange, requireTeamOrganization, route } from "./shared";
import type { TransactionContext } from "./shared";
import { isManagedTransferRecipient, managedRow, requireRemovableAccount, revokeSessions, transferProjects } from "./managed";
import { fresh } from "./billing";
import { lifecycleAuthority, lifecyclePolicy, lifecycleSchedule } from "./lifecycle-policy";

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
    await applyManagedTransition(bound, principal.user.id, input);
  });
  await context.events.dispatch();
}
// Called only after interactive authorization or persisted policy verification,
// inside the same accounts transaction. No scheduled Principal is manufactured.
async function applyManagedTransition(bound: TransactionContext, actorId: Id, input: ManagedLifecycleCommand): Promise<void> {
    const tx = bound.db;
    requireTeamOrganization(await organization(bound, input.organizationId));
    if (!await bound.db.get(`SELECT u.id FROM users u JOIN members m ON m.user_id=u.id AND m.organization_id=?
      WHERE u.id=? AND u.managed_by=?`, [input.organizationId, input.userId, input.organizationId]))
      throw new ServiceError("MANAGED_CONFLICT", 409, "Account must still be managed by this team");
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
          if (!await isManagedTransferRecipient(bound, { organizationId: input.organizationId, userId: input.transferTo }))
            throw new ServiceError("INVALID_TRANSFER", 409, "Transfer requires an active member with accepted management by this team");
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
    await bound.db.run("INSERT INTO audit_entries(id,at,actor_id,organization_id,event,target_id,details_json) VALUES(?,?,?,?,?,?,?)",
      [newId(), bound.clock.now(), actorId, input.organizationId, `managed.${input.action}`, input.userId, "{}"]);
}
export function registerManagedLifecycle(context: ModuleContext): void {
  route(context, endpoints.managedLifecycleGet, async ({ params }, principal, request, bound) => {
    requireTeamOrganization(await authorize(bound, principal, { organizationId: params.o, level: "admin" }));
    request.responseHeaders.set("cache-control", "private, no-store");
    return lifecycleSchedule(bound, params.o);
  });
  route(context, endpoints.managedLifecyclePut, async ({ params, body }, principal, _request, bound) => {
    requireTeamOrganization(await authorize(bound, principal, { organizationId: params.o, level: "admin" }));
    await fresh(bound, principal);
    const grant = z.object({ id: IdSchema, version: z.number() }).nullable().parse(await bound.db.get(
      `SELECT m.id,m.version FROM members m JOIN users u ON u.id=m.user_id
       WHERE m.organization_id=? AND m.user_id=? AND m.role='admin' AND u.suspended=0 AND u.deleted_at IS NULL`,
      [params.o, principal.user.id]));
    if (!grant) throw new ServiceError("LIFECYCLE_ADMIN_REQUIRED", 403, "An active organization administrator must authorize this schedule");
    const previous = await lifecyclePolicy(bound, params.o);
    conflict(previous?.version ?? 0, body.expectedVersion);
    const settings = body.settings;
    if (settings.enabled && (!settings.transferTo || !await isManagedTransferRecipient(bound, {
      organizationId: params.o, userId: settings.transferTo,
    }) || !await bound.db.get(`SELECT u.id FROM users u JOIN verified_emails e ON e.user_id=u.id
      AND lower(e.email)=lower(u.primary_email) WHERE u.id=?`, [settings.transferTo])))
      throw new ServiceError("INVALID_TRANSFER", 409, "Choose an active verified member with accepted management");
    await bound.db.run(`INSERT INTO managed_lifecycle_policies(organization_id,enabled,admin_id,membership_id,membership_version,
      transfer_to,soft_delete_days,deletion_days,version,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(organization_id) DO UPDATE SET enabled=excluded.enabled,admin_id=excluded.admin_id,
      membership_id=excluded.membership_id,membership_version=excluded.membership_version,transfer_to=excluded.transfer_to,
      soft_delete_days=excluded.soft_delete_days,deletion_days=excluded.deletion_days,version=excluded.version,updated_at=excluded.updated_at`,
    [params.o, Number(settings.enabled), principal.user.id, grant.id, grant.version, settings.transferTo,
      settings.softDeleteDays, settings.deletionDays, body.expectedVersion + 1, bound.clock.now()]);
    await audit(bound, principal, { organizationId: params.o, event: "managed.schedule.configured", targetId: params.o,
      details: { enabled: settings.enabled, transferTo: settings.transferTo, softDeleteDays: settings.softDeleteDays,
        deletionDays: settings.deletionDays, version: body.expectedVersion + 1 } });
    return lifecycleSchedule(bound, params.o);
  });
  route(context, endpoints.managedLifecycleTransition, async ({ params, body }, principal, _request, bound) => {
    requireTeamOrganization(await authorize(bound, principal, { organizationId: params.o, level: "admin" }));
    await fresh(bound, principal);
    if (body.action === "lapse") {
      const policy = await lifecyclePolicy(bound, params.o);
      if (!policy || policy.enabled !== 1)
        throw new ServiceError("LIFECYCLE_DISABLED", 409, "Enable an explicit lifecycle schedule before starting a lapse");
      if (!await lifecycleAuthority(bound, policy))
        throw new ServiceError("LIFECYCLE_AUTHORITY_REVOKED", 403, "An active organization admin must save the schedule again");
      if (policy.transfer_to === params.u)
        throw new ServiceError("INVALID_TRANSFER", 409, "Choose another transfer recipient before suspending this account");
    }
    await applyManagedTransition(bound, principal.user.id, {
      organizationId: params.o, userId: params.u, ...body,
    });
    return { ok: true as const, version: body.expectedVersion + 1 };
  });
}

/** Each account is isolated; a denied transfer must not starve unrelated due accounts. */
export async function reconcileManagedLifecycle(context: ModuleContext) {
  const candidates = z.array(z.object({ organization_id: IdSchema, user_id: IdSchema })).parse(
    await context.db.all(`SELECT a.organization_id,a.user_id FROM managed_acceptances a
      JOIN managed_lifecycle_policies p ON p.organization_id=a.organization_id AND p.enabled=1
      WHERE a.state IN ('suspended','soft_deleted') AND a.lapse_at IS NOT NULL ORDER BY a.organization_id,a.user_id`));
  const failures: { organizationId: Id; userId: Id; code: string }[] = [];
  for (const candidate of candidates) {
    let attempted: { policyVersion: number; managementVersion: number } | undefined;
    try {
      await context.uow.run(async tx => {
        await tx.lock("quire:accounts");
        const bound = { ...context, db: tx };
        const policy = await lifecyclePolicy(bound, candidate.organization_id);
        if (!policy || policy.enabled !== 1) return;
        const row = managedRow.nullable().parse(await tx.get(
          "SELECT * FROM managed_acceptances WHERE organization_id=? AND user_id=?", [candidate.organization_id, candidate.user_id]));
        if (!row || !row.lapse_at || (row.state !== "suspended" && row.state !== "soft_deleted")) return;
        const days = (Date.parse(bound.clock.now()) - Date.parse(row.lapse_at)) / 86_400_000;
        if (days < (row.state === "suspended" ? policy.soft_delete_days : policy.deletion_days)) return;
        attempted = { policyVersion: policy.version, managementVersion: row.version };
        if (!await lifecycleAuthority(bound, policy))
          throw new ServiceError("LIFECYCLE_AUTHORITY_REVOKED", 403, "Saved administrator authority is no longer valid");
        if (!policy.transfer_to) throw new ServiceError("INVALID_TRANSFER", 409, "Schedule has no transfer recipient");
        await applyManagedTransition(bound, policy.admin_id, { organizationId: candidate.organization_id,
          userId: candidate.user_id, action: "advance", expectedVersion: row.version,
          transferTo: policy.transfer_to, lapseDays: policy.soft_delete_days, deletionDays: policy.deletion_days });
        await tx.run("DELETE FROM managed_lifecycle_results WHERE organization_id=? AND user_id=?",
          [candidate.organization_id, candidate.user_id]);
      });
    } catch (error) {
      const code = error instanceof ServiceError ? error.code : "LIFECYCLE_FAILED";
      failures.push({ organizationId: candidate.organization_id, userId: candidate.user_id, code });
      if (attempted) {
        const receipt = attempted;
        await context.uow.run(async tx => {
          await tx.lock("quire:accounts");
          await tx.run(`INSERT INTO managed_lifecycle_results(organization_id,user_id,policy_version,management_version,checked_at,error_code)
            VALUES(?,?,?,?,?,?) ON CONFLICT(organization_id,user_id) DO UPDATE SET policy_version=excluded.policy_version,
            management_version=excluded.management_version,checked_at=excluded.checked_at,error_code=excluded.error_code`,
          [candidate.organization_id, candidate.user_id, receipt.policyVersion, receipt.managementVersion, context.clock.now(), code]);
        });
      }
      console.error("MANAGED_LIFECYCLE_FAILED", { ...candidate, code, error });
    }
  }
  await context.events.dispatch();
  return failures;
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
