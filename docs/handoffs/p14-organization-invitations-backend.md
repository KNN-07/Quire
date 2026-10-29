# Pending organization invitations: backend FINAL

October 28, 2026. This is native service acceptance, not completed UI delivery.

The existing shared invitations table already contains organization scope,
role, token hash, expiry, status and version in SQLite and PostgreSQL. No
migration or installation schema change was needed.

Six typed governance endpoints now provide paginated invitation listing,
creation, private recipient preview, acceptance, resend and revocation.
Managers can invite ordinary members; administrators and installation
operators can invite privileged roles. Invitation creation queues mail in the
same transaction without creating an account or granting membership.
Resend rotates the token and expiry. The account route in the mail is
`/organization-invitations/:id?token=...`.

Acceptance requires an active signed-in account with the matching verified
email, current version, valid token and unexpired pending invitation.
It cannot overwrite an independently created membership. Acceptance creates
an **unlicensed** membership: seat assignment remains a distinct existing
manager action, not an implicit consequence of the invited role.
The usual governance wrapper supplies transaction locking, mutation
authentication, actor-scoped idempotency and event dispatch. No live email
transport is claimed.

## Observed checks

The first native selection failed both cases with the absent route's 404.
After implementation, the full acceptance/resend/version/idempotency
scenario passed 18 assertions. The expiry scenario initially advanced the
clock beyond both invitation and session expiry and therefore received 401;
the test now signs in again after advancing the clock.

Only that failed case and the newly added manager/new-account/existing-member
case were run next. They passed two cases/15 assertions. Thus the three
current native cases have **33 passing assertions across two selections**,
not a claimed single all-green combined run.

Scoped account strict TypeScript, touched-source type-aware deny-warning
lint and the affected registry dispatch invariant also passed. The latter
was one case/two assertions; unchanged schema cases were filtered.
Terminal receipts: `mon_VB94JJ1RP6GXR2PF` (historical mixed result) and
`mon_R7ZK1VD38V1KN7NE` (corrected/new cases and static/registry gates, exit 0).
LSP caught one widened boolean return during implementation; its literal
type was corrected before these passing gates.

The tests use awaited isolated native governance fixtures with cleanup.
No new dedicated PostgreSQL runtime invitation case or live SMTP delivery
was executed. PostgreSQL compatibility here is existing shared storage and
portable SQL, not a new runtime receipt.

The recipient account route and manager invitation controls require separate
browser acceptance. This handoff does not close the parent invitation task
or broader institution/managed-account requirements.
