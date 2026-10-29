import { z } from "zod";
import { IdSchema, ManagedLifecycleScheduleSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { Migration, ModuleContext } from "@quire/runtime";
import { managedRow } from "./managed";

const tables = `
CREATE TABLE managed_lifecycle_policies (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  admin_id TEXT NOT NULL REFERENCES users(id),
  membership_id TEXT NOT NULL, membership_version INTEGER NOT NULL,
  transfer_to TEXT REFERENCES users(id),
  soft_delete_days INTEGER NOT NULL CHECK(soft_delete_days>=1 AND soft_delete_days<=36500),
  deletion_days INTEGER NOT NULL CHECK(deletion_days>soft_delete_days AND deletion_days<=36501),
  version INTEGER NOT NULL, updated_at TEXT NOT NULL,
  CHECK(enabled=0 OR transfer_to IS NOT NULL)
);
CREATE TABLE managed_lifecycle_results (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id), policy_version INTEGER NOT NULL,
  management_version INTEGER NOT NULL, checked_at TEXT NOT NULL, error_code TEXT,
  PRIMARY KEY(organization_id,user_id)
);
`;
export const lifecycleMigration: Migration = {
  id: "014-a-managed-lifecycle", sql: tables.replaceAll("\n);", "\n) STRICT;"), postgres: tables,
};
export const lifecyclePolicyRow = z.object({
  organization_id: IdSchema, enabled: z.number(), admin_id: IdSchema,
  membership_id: IdSchema, membership_version: z.number(), transfer_to: IdSchema.nullable(),
  soft_delete_days: z.number(), deletion_days: z.number(), version: z.number(),
});
export async function lifecyclePolicy(context: ModuleContext, organizationId: Id) {
  return lifecyclePolicyRow.nullable().parse(await context.db.get(
    "SELECT * FROM managed_lifecycle_policies WHERE organization_id=?", [organizationId]));
}
// The grant is the exact membership saved by an authenticated admin, not operator
// status, a guessed membership, or an invented session. A changed grant needs a new save.
export async function lifecycleAuthority(context: ModuleContext, policy: z.infer<typeof lifecyclePolicyRow>): Promise<boolean> {
  return Boolean(await context.db.get(`SELECT m.id FROM members m
    JOIN users u ON u.id=m.user_id JOIN organizations o ON o.id=m.organization_id
    WHERE m.id=? AND m.version=? AND m.organization_id=? AND m.user_id=? AND m.role='admin'
      AND u.suspended=0 AND u.deleted_at IS NULL AND o.kind='team'`,
  [policy.membership_id, policy.membership_version, policy.organization_id, policy.admin_id]));
}
export async function lifecycleSchedule(context: ModuleContext, organizationId: Id) {
  const policy = await lifecyclePolicy(context, organizationId);
  const settings = policy ? { enabled: policy.enabled === 1, transferTo: policy.transfer_to,
    softDeleteDays: policy.soft_delete_days, deletionDays: policy.deletion_days }
    : { enabled: false, transferTo: null, softDeleteDays: 60, deletionDays: 90 };
  const authorityValid = policy !== null && await lifecycleAuthority(context, policy);
  const rows = await context.db.all(`SELECT a.*,u.primary_email,r.error_code
    FROM managed_acceptances a JOIN users u ON u.id=a.user_id
    LEFT JOIN managed_lifecycle_results r ON r.organization_id=a.organization_id AND r.user_id=a.user_id
      AND r.policy_version=? AND r.management_version=a.version
    WHERE a.organization_id=? AND a.state IN ('accepted','suspended','soft_deleted') ORDER BY a.user_id`,
  [policy?.version ?? 0, organizationId]);
  return ManagedLifecycleScheduleSchema.parse({
    settings, version: policy?.version ?? 0, authorizedBy: policy?.admin_id ?? null, authorityValid,
    accounts: rows.map(value => {
      const row = managedRow.extend({ primary_email: z.email(), error_code: z.string().nullable() }).parse(value);
      const finalDue = row.lapse_at !== null
        && Date.parse(context.clock.now()) >= Date.parse(row.lapse_at) + settings.deletionDays * 86_400_000;
      const nextStage = row.state === "suspended" ? (finalDue ? "deleted" : "soft_deleted")
        : row.state === "soft_deleted" ? "deleted" : null;
      return { userId: row.user_id, email: row.primary_email, state: row.state, version: row.version,
        lapseAt: row.lapse_at, nextStage,
        nextAt: row.lapse_at && nextStage ? new Date(Date.parse(row.lapse_at)
          + (nextStage === "soft_deleted" ? settings.softDeleteDays : settings.deletionDays) * 86_400_000).toISOString() : null,
        errorCode: row.error_code };
    }),
  });
}
