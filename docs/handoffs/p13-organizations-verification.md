# Organization consumer verification: FINAL

October 28, 2026. Independent reviewer: `st_01a18033`.

**PASS for the bounded native organization consumer delivery. FAIL for full
original organization-requirements parity or whole-product acceptance.** Every
claim below is adjudicated at its stated evidence scope; no checker remains
pending. No producer suite was rerun.

## Accepted evidence

- FINAL consumer handoff: `docs/handoffs/p13-organizations.md`.
- FINAL backend prerequisite: `docs/handoffs/p13-organization-access.md`.
- Original requirements: `docs/discovery/services.md`, particularly A52a-c,
  A53a-b, A55a-c and the permission/security invariants.
- Source and test inspection: organization settings integration and all four
  organization consumer files; native organization/member/report/shared
  governance handlers, identity mutation authentication, operation readers,
  endpoint/client/session contracts, browser tests and their real application
  and disposal setup.
- Actual producer terminal receipts: native workflow exit 0, one case/31
  assertions; changed-authority browser exit 0, one case/21 assertions; original
  and changed scoped strict types/type-aware lint exit 0.
- Parent-owned access-read matrix: seven cases/26 assertions; affected registry
  dispatch invariant: one case/two assertions. These prove the prerequisite,
  not a new organization mutation or browser matrix.
- All eight screenshots independently opened. All screenshot/XML/current
  authority-source hashes independently checked. Four exact temporary roots
  absent and all eight exact web/API ports without listeners.

Bounded evidence is under `docs/evidence/p13-organizations-verification/`:
`source-review.md`, `source-sha256.txt`, `artifact-sha256.txt`,
`visual-review.md`, and `receipts-and-cleanup.md`. The latter records actual
producer transcript receipt locations and exact cleanup identities.

## Scoped claim adjudication

| Delivered claim | Result | Observed evidence and scope |
|---|---|---|
| Real account settings integration and preserved navigation | PASS | Settings imports and tab routing use the actual consumer. Native browser navigates through Organizations, Notifications and Profile; no page errors. Other unchanged settings tabs are inspected integration, not individually rerun workflows. |
| Organization list, selection, creation and empty/loading/error states | PASS | Native creation/selection runs through real HTTP and renders created organization. Cursor append, abort, empty/loading/error and reload paths are source-verified; multi-page/empty/error runtime cases were not induced. |
| Independent organization role and installation operator authority | PASS | Strict native access endpoint returns nullable role and independent boolean. Consumer explicitly reads it, independently labels both values, and derives admin from admin role OR operator. It no longer infers authority from membership-directory contents. |
| Operator with ordinary/manager membership retains administrative UI | PASS | Focused final browser proves operator+member can actually save policy, has all role options, then retains admin controls after promotion to manager. Final images show Manager and operator Yes simultaneously. |
| Ordinary member avoids directory probes and sees read-only policy | PASS | Focused native access response is `{ role: "member", operator: false }`; browser records no member-directory requests, no policy-save button, and operator No. Original browser checks disabled policy and no admission controls. |
| Manager without operator manages ordinary members only | PASS | Original browser checks hidden privileged-membership controls, no policy-save button and a successful ordinary-member licensing write. Source also checks old/requested privileged roles server-side. |
| Existing verified-account admission, not pending invitation | PASS | Native unknown-account request returns 409 ACCOUNT_REQUIRED; existing accounts are immediately added with selected role/licensed state. Consumer explicitly discloses immediate membership. No fabricated account or invitation success. |
| Member editing/removal and sole-admin protection | PASS | Real licensing write and LAST_ADMIN 409 are observed. Successful ordinary removal is source-verified, not runtime-induced. Backend checks managed-member release and protects last admin independently of operator status. |
| Native seat limits stay server-authoritative | PASS | Consumer sends licensed flag separately from role. Backend serializes billing-seat check; consumer displays native service failures. Paid-seat exhaustion was not induced in these browser cases. |
| Current organization policy and every current schema field | PASS | Consumer exposes numeric limits, booleans, AI and sharing fields and states that policy is not effective-project-benefit prediction. Native save persists AI change. |
| Correct resource versions and visible stale conflict | PASS | Member creation uses organization version; member patch/delete use membership version; policy uses organization version. Native concurrent policy update causes VERSION_CONFLICT 409, visible error, refresh and authoritative new value. |
| CSRF/origin and idempotency boundaries | PASS, source scope | Governance wrapper authenticates, verifies all non-GET mutations, and binds idempotency receipt to actor/route/digest. Identity rejects wrong origin/cross-site and missing/incorrect CSRF. Client supplies session CSRF and creation/export keys. Existing identity negative tests are inspected; these browser receipts are not new negative-CSRF runtime proof. |
| Member CSV download | PASS | Native authenticated CSV request succeeds and contains actual scoped membership. Backend requires manager access and scopes the query; the consumer uses that endpoint directly. Unauthorized CSV runtime denial was not newly exercised. |
| Interval metrics | PASS | Real endpoint response is consumed and displayed. Source counts persisted interval activity and labels storage as retained files created within the interval, not total current storage. |
| Audit read/pagination and export result | PASS | Native audit and 202 export produce actual entries and succeeded CSV link. Source scopes organization/admin access, uses monotonic sequence cursors, redacts sensitive keys and safely quotes CSV. Multi-page browser behavior is source-verified, not a newly exercised runtime case. |
| Operation ownership and download boundary | PASS, source scope | Export persists requesting actor; operation reader rejects other actors and lists by actor. Consumer exposes CSV only for succeeded status and string result. Existing actor-scoped operation HTTP test is inspected, not newly run. Inline downloaded copies are not recallable and export is not a backup. |
| Real application test setup | PASS | Actual composition, native seeded services, real signed-in Chromium contexts and real HTTP; no successful-response mocks. Subscriptions precede mutation triggers; bounded DOM observation replaces fixed sleeps. |
| Desktop/mobile light/dark appearance | PASS | All eight images opened: earlier workflow at 1440/390 in both themes; corrected operator+manager packet at both widths/themes. No observed blank, overlapping or horizontally clipped surface. Chromium viewport coverage only, not touch/DPR or other-browser acceptance. |
| Artifact and cleanup identity | PASS, bounded provenance | All 16 recorded final artifact/source hashes match. Terminal receipts bind each successful UUID to exact fixture root and ports. Four exact roots absent and eight ports not listening. No historical whole-tree build fingerprint was supplied; none is claimed. |
| Completed checks rather than pending admission | PASS | Both required handoffs are FINAL, actual browser/static receipts completed exit 0, screenshots and XMLs exist and were inspected. Earlier locator/lint failures are resolved and are not counted as passing runs. |

## Original requirements that remain outside delivery

| Broader claim | Result | Required preserved limitation |
|---|---|---|
| A52a pending organization invitations with recipient acceptance | FAIL | Existing-account admission is immediate. Pending organization invitation list/resend/accept lifecycle is not supplied by these membership contracts. Parent-owned project invitations are separate. |
| A52a audit ZIP containing paginated CSV files | FAIL | Backend produces one inline CSV in a succeeded operation. This consumer honestly exposes CSV; it does not implement ZIP packaging or 100-entry CSV pages. |
| A55 managed-account lifecycle consumer | FAIL | Managed backend invite/accept/release/delete contracts exist, but this UI does not expose them. Membership/seat assignment is not management acceptance, offboarding or project reassignment. |
| Full billing, institutional enrollment, SSO and all organization controls | FAIL | These broader original requirements are not established by this consumer packet. No commercial, external-service or managed lifecycle parity is inferred. |
| Exhaustive runtime negative-boundary/security acceptance | FAIL | New organization-specific missing-CSRF, forged-origin, unauthorized-download and cross-actor export retrieval cases are not in these browser receipts. Source enforcement and existing test definitions were reviewed; no new comprehensive runtime-security claim is accepted. |
| Whole-product acceptance | FAIL | This scoped consumer plus backend prerequisite does not certify the product, all browsers, all governance lifecycle states, deployment or external integrations. |

The original full workflow ran before the access-read migration. Its stale
label locators were updated, but that unchanged body was not rerun. The focused
final run covers the changed authority boundary; its four screenshots are the
current authority presentation. Earlier four captures are retained only as
the pre-migration workflow packet. Two runs are not described as a newly
passing combined suite.

No production, test or parent documentation was edited by this reviewer.
Only this report and its bounded evidence were written. No commit or push.
