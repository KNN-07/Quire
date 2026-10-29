# P57 self-deletion ownership and administration boundaries

October 28, 2026. FINAL bounded native acceptance. All exercised accounts and
billing records were disposable fixtures; no actual user account was deleted.

## Contract and corrections

Self-deletion now uses the shared account-removal guard. It cannot remove the
last active installation operator or the last active administrator of an
organization. A suspended/deleted co-administrator does not satisfy that
requirement. The guard remains inside the serialized account transaction and
is shared with managed deletion/lifecycle and SCIM removal.

Only owned projects whose `deleted_at` is null require reassignment. Active,
archived and trashed projects still need transfer or explicit project deletion.
Already-deleted content no longer permanently blocks account deletion; it is
not revived, automatically reassigned or physically erased.

The settings page and confirmation dialog state those prerequisites.
Organization subscriptions are independent of a person's account: deleting
the account does not cancel organization billing. Another active admin must
remain to manage that organization. This is Quire's organization-billing
contract, not a personal-subscription cancellation workflow.

Existing password/email confirmation, recent authentication, managed-account
restrictions, account version checks, anonymization, session/grant revocation
and explicit project reassignment remain.

## Evidence

`docs/evidence/p57-self-deletion/red.log` records the three failures before
the fix: deletion succeeded for the sole active admin in both no-co-admin and
suspended-co-admin cases; an already-deleted project blocked its owner's
otherwise valid account deletion. Raw exit 1 is retained.

`regressions.log` records **12 pass, 0 fail, 139 assertions** and
`P57_REGRESSION_EXIT=0` on pinned Bun 1.4.4. It includes the three new cases,
existing identity/operator deletion cases and the affected scheduled lifecycle
cases using the same removal guard.

The original successful reassignment test now provisions a second active
administrator before deletion. Its reassignment, anonymization and session
revocation assertions remain unchanged. The earlier failure against that
now-invalid last-admin fixture remains in `accounts.log`; the test was not
deleted or weakened.

`native.log` records the actual settings dialog denying the last admin, then
explicit organization membership and project transfer through real HTTP
routes, followed by successful native self-deletion. The successor retains
source access and the organization's existing active manual-fixture billing
row byte-for-byte. Deleted project metadata remains deleted and the old
session is rejected.

Native result: **1 pass, 18 assertions**, `P57_NATIVE_EXIT=0`, UTC
18:37:20Z through 18:38:12Z, four identical before/after source/test hashes.
Monitor `mon_ANRTT3MHCSG11V05` / `bash_451`. Actual target:
`bun test tests/ui-product/account/self-deletion/browser.test.ts`.

All four dialog captures were opened and inspected under
`docs/evidence/p57-self-deletion/browser-02615a84-d1d0-4f3b-bcd7-c7dfbfdc9fff/`.
At 1440/390 widths in both themes, confirmation fields, the actionable
last-admin error, Cancel and the explicit deletion button are readable and
unclipped. Password text is masked.

`static.log` records `P57_STATIC_EXIT=0` for the accounts and new native
TypeScript projects plus type-aware deny-warning lint on the changed files.
Monitor `mon_NNR8X4GCTEMHFWRA` / `bash_452`.
The native fixture initially had clean LSP diagnostics; a separate shared-file
LSP freshness request timed out. Scoped compiler results are the final type
evidence, not an invented later LSP pass.

## Cleanup and limits

The native fixture awaited all browser/application teardown. Parent verified
`/tmp/quire-ui-integrations-gQ9LDT` absent and web/API ports 43893/34247
refusing connections. Backend cases use awaited `baseFixture`/`identityFixture`
disposal; those successful tests do not emit individual root IDs, so no
per-root historical receipt is fabricated.

No project content was cascaded away, no organization subscription was canceled
and no secure-erasure guarantee is added. This increment does not claim live
merchant/mail delivery, comprehensive session-race coverage or PostgreSQL
execution of the deletion route. The next integrated gate must include these
source changes; P53 predates them.
