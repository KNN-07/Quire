# P1 governance

Owner: A governance successor. Date: October 26, 2026. Native runtime:
Bun 1.3.14 (`0d9b296a`). This lane made no commit, push, package change,
shared-contract edit, baseline migration edit, or application-composition edit.

The owned implementation supplies 40 real handlers. Acceptance commands, results,
retained failures, source-size review and cleanup receipts are recorded in
`docs/evidence/p1-governance/checks.md`. Tests use real identity, SQLite and
ephemeral loopback HTTP servers. The role/seat separation test additionally
installs the real core base module and checks an unauthorized project read.
There are no identity/policy mocks.

Latest completed assigned command: **43 tests passed, zero failed, 130
assertions**, seven files in **16.74 seconds**. Owned strict compilation and
type-aware lint both exited 0.

## Composition and exports

Import from `services/accounts/governance/index.ts`:

```ts
import { register, migrations } from "../../services/accounts/governance";

{ id: "011-a-governance", lane: "A", order: 11, register, migrations }
```

Install after `010-a-identity`. `register(context: ModuleContext): void` consumes
the existing identity service. It never provides another identity or policy port.
The sole identity policy service reads the actual persisted
`organizations.policy_json` rows changed by this module. Its existing
`policy_sets` user/project/global intersections remain authoritative.

Migration `011-a-governance-local` adds a unique organization-billing-account
index, `managed_acceptances.lapse_at`, notification dedupe receipts, deferred
digest records, and a user-tombstone trigger that deletes deferred private
notification content in the same account-deletion transaction. Existing
installations must resolve any duplicate organization billing rows before the
unique index can apply; no records are silently discarded.

| Export | Contract |
| --- | --- |
| `register`, `migrations` | Module registration and lane-prefixed migration. |
| `enqueueNotification(context,input)` | Synchronous producer hook. Call inside the producer's existing local unit of work; dispatch events only after its outer commit. Produces preference-filtered in-app notifications, local mail or deferred digest items with one durable recipient/event dedupe key. |
| `NotificationInput` | Readonly recipient, event kind, resource/project IDs, producer dedupe key and mail content, optionally `mail.digestAt`. Producers must authorize recipients and content before calling. |
| `flushNotificationDigests(context)` | Owns one transaction; delivers due items using the injected clock, current preferences, current account state and current project ACL. Returns the actual number of local mails created. Repeated flushes do not redeliver. |
| `notificationPreferences(context,userId)` | Reads persisted event/channel/project settings and their independent version; defaults to in-app/email delivery with no event overrides. |
| `billingAccount(context,organizationId)` | Reads an existing persisted billing account, or returns a typed 404. |
| `ensureBillingAccount(context,organizationId,email)` | Synchronous transaction-owned creation/read of the local manual, unbilled account. No fabricated subscription or paid plan. |
| `applyBillingTransition(context,principal,input)` | Operator-authorized local manual billing administration; owns its transaction and rejects capacity below allocated seats. |
| `recordBillingTransition(context,input)` | Trusted adapter seam, called inside a signature-verified webhook/receipt transaction. Requires an initialized billing account and expected version. `actorId:null` represents a verified provider event, not an invented operator session. |
| `BillingTransition` | Readonly organization/version, plan, period, seats, status, renewal instant and optional manual/configured provider. |
| `transferProjects(context,{from,to,projectId?})` | Transaction-owned ownership transfer to a distinct active verified account, including retained/deleted projects when transferring an entire account. Preserves source/history, removes duplicate recipient project ACLs, increments project versions and records project-scoped access events. Caller owns authorization and its transaction. |
| `revokeSessions(context,userId)` | Transaction-owned session deletion plus the existing durable `session.revoked` event. Caller dispatches after commit. |
| `transitionManaged(context,principal,command)` | Organization-admin-authorized, transaction-owning lapse/recovery/advancement. Uses the injected clock; defaults are soft deletion after 60 days and terminal deletion/reassignment after 90 days from lapse. Custom positive ordered intervals are supported. |
| `ManagedLifecycleCommand` | Exhaustive `lapse`, `recover`, or `advance` command, with organization/user/acceptance-version and a valid transfer recipient for advancement. |
| `reconcileInstitutionEligibility(context)` | Rechecks verified-domain self-enrollment and expiry. Removes only eligible ordinary unlicensed self-enrollments, not administrative/managed grants or project ACLs. Dispatches committed project policy-refresh events. |
| `editorState(context)` | Actual persisted `{closed,message,version}`, default open. |
| `requireEditorOpen(context)` | Throws `EDITOR_CLOSED` when the actual persisted editor closure is active. Core write authorization must consume this guard or the same stored setting. |

The trusted synchronous helpers are service-to-service operations, not public
authorization bypass endpoints. External provider parsing, signature checks and
webhook replay receipts belong to X before it calls the adapter seam.

## Registered endpoints

Public reads are `billingCatalog` and `institutionGet`. All other reads require
the real identity service; mutations additionally use its Origin/CSRF checks.
Idempotent mutations store their response in the same transaction as their
business changes and reject changed input under the same key.

| Contract | Method and path |
| --- | --- |
| `organizationsList` | GET `/api/organizations` |
| `organizationGet` | GET `/api/organizations/:o` |
| `organizationCreate` | POST `/api/organizations` |
| `organizationPatch` | PATCH `/api/organizations/:o` |
| `organizationDelete` | DELETE `/api/organizations/:o` |
| `membersList` | GET `/api/organizations/:o/members` |
| `memberCreate` | POST `/api/organizations/:o/members` |
| `memberPatch` | PATCH `/api/organizations/:o/members/:id` |
| `memberDelete` | DELETE `/api/organizations/:o/members/:id` |
| `membersCsv` | GET `/api/organizations/:o/members.csv` |
| `organizationPolicy` | GET `/api/organizations/:o/policy` |
| `organizationPolicyPatch` | PATCH `/api/organizations/:o/policy` |
| `organizationMetrics` | GET `/api/organizations/:o/metrics` |
| `organizationAudit` | GET `/api/organizations/:o/audit` |
| `organizationAuditExport` | POST `/api/organizations/:o/audit/export` |
| `institutionGet` | GET `/api/institutions/:slug` |
| `institutionEnroll` | POST `/api/institutions/:slug/enroll` |
| `managedInvite` | POST `/api/organizations/:o/managed/invite` |
| `managedAccept` | POST `/api/managed/:id/accept` |
| `managedRelease` | POST `/api/organizations/:o/managed/:u/release` |
| `managedDelete` | POST `/api/organizations/:o/managed/:u/delete` |
| `notificationsList` | GET `/api/notifications` |
| `notificationRead` | POST `/api/notifications/:id/read` |
| `notificationPreferencesGet` | GET `/api/me/notification-preferences` |
| `notificationPreferences` | PATCH `/api/me/notification-preferences` |
| `billingCatalog` | GET `/api/billing/catalog` |
| `billingGet` | GET `/api/organizations/:o/billing` |
| `billingDetails` | PATCH `/api/organizations/:o/billing/details` |
| `billingInvoices` | GET `/api/organizations/:o/billing/invoices` |
| `adminUsersList` | GET `/api/admin/users` |
| `adminUsersCsv` | GET `/api/admin/users.csv` |
| `adminUserGet` | GET `/api/admin/users/:u` |
| `adminUserPatch` | PATCH `/api/admin/users/:u` |
| `adminUserInvite` | POST `/api/admin/users/invite` |
| `adminUserTransfer` | POST `/api/admin/users/:u/transfer` |
| `adminUserRevoke` | POST `/api/admin/users/:u/revoke-sessions` |
| `adminUserRestore` | POST `/api/admin/users/:u/restore` |
| `adminEditorState` | POST `/api/admin/editor-state` |
| `auditList` | GET `/api/admin/audit` |
| `auditExport` | POST `/api/admin/audit/export` |

## Domain decisions and counters

Organization membership, licensed seats and project roles are independent.
Creating an organization makes its creator an unlicensed organization admin,
not an owner of unrelated projects. Managers administer ordinary members and
metrics, but cannot administer other managers/admins, billing or policy.
The final administrator cannot be removed/demoted. Local unbilled accounts do
not introduce commercial feature gates; an active manual/configured account
enforces its explicitly configured seat capacity in serialized transactions.

`memberCreate` and `managedInvite` compare the organization counter.
Member patch/delete compare the membership counter. Organization and policy
mutations compare the organization counter. Billing details compare billing's
own counter; notification settings and notifications have their own counters.
User administration compares the account counter, exposed by admin user ETag
and `AdminUserSummary.version`; admin transfer increments that account counter.

Managed invitations do not confer account control. The invited account must
explicitly accept the acceptance ID carried by `managed.invited` notification
`resourceId`; invitation version starts at zero. `managedAccept` compares that
acceptance counter. Lifecycle helper commands also compare acceptance counters.
Release/delete endpoints compare the managed **account** counter from `/me` or
admin-user ETag. These are deliberately distinct aggregates.

Release preserves account credentials, memberships, projects and ownership,
clears management/suspension, and requires an independent password recovery path.
SSO-only release returns `RECOVERY_REQUIRED` until that path exists; it does not
strand an account or manufacture federation recovery. Terminal managed deletion
first transfers all owned project records, then revokes sessions/grants and
retains a suspended user tombstone for existing history/audit foreign keys.
It refuses ownerless content, the last operator, and a sole organization admin.
Soft deletion is recoverable; terminal deletion is not restored by the admin
restore endpoint.

Institution self-enrollment requires an exact verified-email domain match and
does not grant a seat, managed ownership or project access. Domain/expiry
reconciliation preserves unrelated project ACLs and administrative grants.

Audit list pagination uses monotonically increasing sequence cursors rather
than UUID order. Filters apply before pagination. CSV quotes commas, quotes and
CR/LF, uses CRLF records and neutralizes spreadsheet formula prefixes.
Credential-shaped detail keys are redacted in both audit reads and exports.
Exports are completed private `audit-export` Operations with actual CSV in
`result.csv`, MIME, filename and row count. They are not backups and expose no
password/session/provider-credential columns. Audit IP remains null because the
request context supplies no trusted peer-IP contract.

Operator user reads expose persisted groups, project counts, session activity
and lifecycle versions. Search is case-insensitive; membership and operator
filters use real persisted records. Operator invitation emits actual verification
and password-setup tokens through the local mailbox, with 24-hour verification
and 30-minute setup expiry. Suspension/revocation immediately invalidates all
affected HTTP sessions and records the existing realtime revocation event.

## Integration dependencies and concrete deltas

1. Lead composition must install this exported module. No shared composition
   file was edited by this lane.
2. K review/chat producers must call `enqueueNotification` inside their existing
   producer transaction, supplying authorized recipients and durable event keys.
   A generic `review.changed` event contains no recipient/content contract and
   cannot retroactively provide atomic business/mail writes. The suite verifies
   the real domain helper with identity/DB/HTTP, not yet integrated K mention
   parsing. Project invitation/access-request races remain K's producer scope.
3. The scheduler/operator must invoke digest flushing, eligibility reconciliation,
   and managed lifecycle commands. No polling timer or undeclared background
   service is started by governance.
4. K must consume `requireEditorOpen` or the same
   `operator_settings['editor-state']` value in HTTP/Git/realtime write
   authorization. Governance persists state and emits project-scoped
   `policy.changed`; the test verifies the domain guard/event, not a completed
   browser-wide maintenance overlay.
5. X owns checkout, preview, cancellation, invoice-download/provider handling,
   billing portal/webhooks and federation. Governance does not register those
   routes or fabricate URLs, payments, invoices or identity-provider success.
   Several frozen provider billing endpoints still carry lane `A`; lead must
   either transfer their contract lane to `X` or compose an explicitly authorized
   A-lane adapter registration module. `billingPortal` already carries `X`.
6. `recordBillingTransition` is ready for verified provider events with a null
   provider actor and caller-owned replay receipt transaction. Provider invoice
   ingestion and artifact delivery remain adapter work. Local catalog is
   deliberately `{configured:false,plans:[]}` until an operator/provider
   commercial catalog is integrated.
7. The admin invitation reuses the canonical pure `defaultPreferences` constant
   from `identity/store.ts`; identity's public barrel currently does not export
   it. Recommended public export delta: export that existing constant from
   `identity/index.ts`, then replace this one internal import. No alternative
   preference DTO/default set or identity service was invented.
8. Product UI/browser composition is not owned here. Managed invitation actions
   must use the notification's acceptance ID and distinguish account versus
   acceptance counters. Audit Operations already contain downloadable CSV data;
   the shared operation-read owner must preserve actor privacy.
9. Account export, ordinary account deletion, optional analytics consent and
   backup behavior remain their existing identity/operations owners. The new
   tombstone trigger is exercised through real identity account deletion to
   prevent governance's deferred content surviving that workflow.

No external credential was needed for the owned local workflows. Full T14/T15
product acceptance additionally depends on the listed cross-lane consumers;
these isolated domain/HTTP results do not claim those consumers are composed.
