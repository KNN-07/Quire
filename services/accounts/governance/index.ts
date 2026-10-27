import type { Migration, ModuleContext } from "@quire/runtime";
import { registerOrganizations } from "./organizations";
import { registerMembers } from "./members";
import { registerManaged } from "./managed";
import { registerNotifications } from "./notifications";
import { registerBilling } from "./billing";
import { registerReports } from "./reports";
import { registerAdminUsers } from "./admin-users";
import { registerAdminMutations } from "./admin-mutations";

export const migrations: readonly Migration[] = [{
  id: "011-a-governance-local",
  sql: `
CREATE UNIQUE INDEX governance_org_billing ON billing_accounts(organization_id) WHERE organization_id IS NOT NULL;
ALTER TABLE managed_acceptances ADD COLUMN lapse_at TEXT;
CREATE TABLE governance_notification_receipts (
  user_id TEXT NOT NULL REFERENCES users(id), dedupe_key TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(user_id,dedupe_key)
) STRICT;
CREATE TABLE governance_digest_items (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id), resource_id TEXT NOT NULL,
  subject TEXT NOT NULL, body TEXT NOT NULL, due_at TEXT NOT NULL, created_at TEXT NOT NULL, sent_at TEXT
) STRICT;
CREATE TRIGGER governance_tombstone_digest AFTER UPDATE OF deleted_at ON users
WHEN NEW.deleted_at IS NOT NULL
BEGIN
  DELETE FROM governance_digest_items WHERE user_id=NEW.id;
END;
`,
}];
export function register(context: ModuleContext): void {
  context.services.get("identity");
  registerOrganizations(context);
  registerMembers(context);
  registerManaged(context);
  registerNotifications(context);
  registerBilling(context);
  registerReports(context);
  registerAdminUsers(context);
  registerAdminMutations(context);
}
export { enqueueNotification, flushNotificationDigests, notificationPreferences } from "./notifications";
export type { NotificationInput } from "./notifications";
export { applyBillingTransition, recordBillingTransition, billingAccount, ensureBillingAccount } from "./billing";
export type { BillingTransition } from "./billing";
export { transferProjects, revokeSessions } from "./managed";
export { transitionManaged, reconcileInstitutionEligibility } from "./lifecycle";
export type { ManagedLifecycleCommand } from "./lifecycle";
export { editorState, requireEditorOpen } from "./editor-state";
