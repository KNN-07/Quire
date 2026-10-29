# FINAL: P46 managed lifecycle independent verification

October 28, 2026. Auditor: `st_01a1837e`. Repository:
`/home/norman/Repos/Quire`.

**PASS for the bounded opt-in managed lifecycle deliverable.** The FINAL
producer report exists. Inspected source, retained raw execution receipts,
current SHA-256 checks, and actual desktop/mobile captures support the native
configuration and default-host lifecycle contract. No blocking P46 defect was
found. **FAIL as a claim of current whole-workspace acceptance:** shared core
dependencies changed after the pinned run, and the latest retained integrated
static checks failed outside P46. This report does not promote the earlier
snapshot's passing checks into a current global result.

## Prioritized remaining findings

1. **P2 - Current integrated workspace remains unverified.** At the independent
   hash check (`2026-10-28T17:12:48Z`), both pinned core dependencies differed:
   `services/core/base/projects.ts` changed from `04ca82fc...` to
   `49b0dd49...`; `services/core/base/source-composition.ts` changed from
   `211ce699...` to `c6280358...`. All fifteen other distinct paths in the
   pinned execution manifest match; all eighteen entries in the producer's
   final P46 source/test/runner manifest match. The producer disclosed release
   of these core files for concurrent P49 work. The retained pinned run remains
   valid for its snapshot, not proof of the later integrated workspace.
   Full hashes and comparisons:
   `docs/evidence/p46-managed-lifecycle-verification/hash-audit.md`.
2. **P2 - Latest retained integrated static gates are not green.**
   `root-typecheck-parent-proof.txt` and `integration-typecheck-final.txt`
   record exit 2: missing Dropbox schema exports/implicit-any UI parameters
   and `CoreProjects.prepareCreation`/`creation` contract errors.
   `root-lint-parent-proof.txt` records exit 1 for redundant `any` unions in
   `apps/web/src/features/account/dropbox-folder-project.tsx:16` and `:18`.
   These are retained concurrent-work findings, not independently reproduced
   current diagnostics or attributed P46 regressions. Earlier root type/lint
   passes and the final scoped integration lint pass are real but do not
   supersede these later failures. Their raw paths are under
   `docs/evidence/p46-managed-lifecycle/`.
3. **P3 - Execution coverage is deliberately bounded.** No live PostgreSQL
   execution of migration `014-a-managed-lifecycle`, production bundle build,
   billing-lapse detector, live vendor lifecycle, or secure erasure is
   established here. SQLite application execution and migration-variant
   compatibility evidence are present. These omissions do not invalidate the
   explicitly delivered opt-in SQLite/native/default-host contract.

No implementation, test, or unrelated finding was edited by this auditor.
No unchanged accepted runtime case was replayed.

## Verified contract

| Boundary | Verdict | Inspected source and execution evidence |
| --- | --- | --- |
| Explicit opt-in and real administrator grant | PASS | `lifecycle-policy.ts:47` defaults to disabled/null recipient/day 60/day 90. `lifecycle.ts:93` requires team/admin access, recent authentication and an active actual admin membership to save; operator status alone cannot save. `shared.ts:73` requires real identity and mutation/CSRF verification, and locks the account transaction. Account case 1 and native browser case pass in the pinned receipt. |
| Policy CAS and management CAS | PASS | Save compares policy version before upsert inside the common account lock. Transition compares the management acceptance version in `lifecycle.ts:32`, not user/account version. Stale policy save is exercised; serialization and acceptance-version checks are inspected source guarantees, not a separately executed concurrency stress test. |
| Revocation and durable restart authority | PASS | `lifecycle-policy.ts:40` matches saved membership ID, membership version, organization, admin user and role, active/nondeleted user and team kind. `members.ts` increments membership version on edits. `lifecycle.ts:147` re-reads enabled policy and acceptance under `quire:accounts` for each candidate before validating the grant. Host case 1 exercises demotion/re-promotion, restart and revoked-authority failure; account case 3 exercises suspended authorizer and lost management. Removal/recreation resistance follows from exact membership ID matching; no separate executed removal/recreation case is claimed. |
| No fabricated principal | PASS | Scheduled execution calls private `applyManagedTransition` only after persisted-grant verification, using saved `policy.admin_id` for audit. It constructs no principal, operator flag, session or CSRF credential. Interactive `transitionManaged` continues receiving the actual `Principal`. Host assertions verify saved administrator audit attribution. |
| Absolute day 60/day 90 and due boundaries | PASS | `lifecycle.ts:61` computes elapsed days from the persisted `lapse_at` using 86,400,000 ms/day. Soft deletion defaults to day 60; terminal logical deletion defaults to day 90 from the same lapse, not another 90 days after soft deletion. Host case 1 proves just-before/exact day 60 over restart; host case 2 proves direct terminal progression at day 90. Account case 2 proves custom exact boundaries and repeat-tick idempotence. UI explicitly describes defaults, next-tick delay and downtime skipping stages. |
| Disable and recovery | PASS | Candidate transaction rechecks enabled policy; disabled lapse returns `LIFECYCLE_DISABLED`. Recovery clears lapse and restores suspended/soft-deleted retained user state without requiring an enabled policy. Account/host and native browser cases exercise disable, paused-stage display, and recovery while disabled. Disable prevents future transitions but does not undo a committed one. |
| Accepted transfer and account guards | PASS | `managed.ts:32` requires active/nondeleted same-team membership, accepted management and matching `managed_by`. `managed.ts:42` separately requires distinct verified active owner. `lifecycle.ts:74` uses unchanged removable-account and transfer guards before terminal mutation. Host case 2 rejects pending recipient, isolates `LAST_ADMIN`, transfers projects and revokes password/session state; account case 3 rejects last operator/lost ownership. Billing rows and organization survive. This is logical account deletion, not P18 release, and intentionally removes the deleted user's memberships and disables grants. |
| Atomic rollback and failure isolation | PASS | Per-account unit of work in `lifecycle.ts:147`; project transfer, account mutation, session events and final audit share that transaction. Account case 4 injects audit failure, observes retained owner/password/management and visible failure receipt while another account completes, then removes its exact trigger and succeeds on a later tick. Expected denial logs are exercised assertions, not hidden test failures. |
| Host ownership and shutdown | PASS | `services/adapters/index.ts:139` admits an independent fifth task, with per-task active guard and existing 30-second default/configurable interval; `:174` unsubscribes and awaits running work before sibling cleanup. Actual default-host tests use injected ticks and real restart. Separate pinned scheduler receipt covers custom-caller ownership, real TLS SMTP drain and failing-task isolation. No wall-clock timer-accuracy claim is made from injected ticks. |
| Native consumer and dates | PASS | `apps/web/src/features/account/organizations/lifecycle.tsx` exposes schedule, accepted recipient, confirmation, authority, errors, refresh, UTC dates and recovery. Native case exercises save/reload, denial, disable and recovery. All four actual pinned-run panel captures were independently opened, not merely accepted from the producer's description. |
| Migration and previous boundaries | PASS, scoped | Additive SQLite/PostgreSQL variants are registered through governance. Retained migration cases pass; no live PostgreSQL run of the new migration is inferred. `managed.ts` and `shared.ts` match the pre-change hashes, preserving P17/P18 guards. |
| Exact cleanup | PASS | Independently observed all seventeen named producer/pinned fixture roots absent and no listener on all six named ephemeral ports at `2026-10-28T17:14:06Z`, exit 0. The auditor created no runtime resources. |

Source paths abbreviated in the table are under
`services/accounts/governance/` unless otherwise qualified.

## Retained execution evidence accepted, not replayed

The raw files below were read directly. A producer summary alone was not used
as execution evidence.

- `docs/evidence/p46-managed-lifecycle/parent-pinned.log`: literal
  `bun test tests/accounts/governance/lifecycle-schedule.test.ts tests/adapters/host/managed-lifecycle.test.ts tests/ui-product/managed-lifecycle/browser.test.ts`;
  cwd `/home/norman/Repos/Quire`, Bun 1.4.4 (`38afee6c8`),
  `2026-10-28T16:58:03Z` to `16:58:54Z`, **7 pass, 0 fail, 192 assertions**,
  `P46_PINNED_EXIT=0`. Seventeen pre/post path hashes are identical within
  this receipt; fifteen remain current, with the two disclosed core exceptions.
  Current raw-receipt SHA-256:
  `f0d358afe736e8f90fb8e7841ff7a928f0b1d787619a088b66fef4c8b44fa1e2`.
- `docs/evidence/p46-managed-lifecycle/parent-schedulers.log`: literal
  `bun test tests/integration/adapters/application.test.ts tests/integration/adapters/schedulers.test.ts --test-name-pattern='leaves explicitly|stops a failing|drains a scheduled'`;
  Bun 1.4.4, `16:41:03Z` to `16:41:45Z`, **3 pass, 0 fail, 12 assertions**,
  `P46_PARENT_TEST_EXIT=0`. All three distinct source/test paths still match
  both retained hash sets. Current raw-receipt SHA-256:
  `a433723b91d26f08d620bcd9bd12999b5e732b4f7a873978689c25f483c124b1`.
- `backend.txt`: Bun 1.3.14, exit 0, 6 cases/151 assertions including two
  migration cases; this is alternate-runtime evidence and overlaps later
  focused cases. It is not counted as six additional pinned cases.
- `root-typecheck-complete.txt`, `root-lint-complete.txt`: observed earlier
  exit-0 checks. `integration-lint-final.txt`: final scoped integration lint
  exit 0. Later retained failures are listed above rather than omitted.

The independent hash audit checks final source/test/runner entries (18/18),
scheduler source entries (6/6 including receipt/configuration), original
screenshot entries (4/4), initial evidence entries (33/33), scheduler follow-up
entries (5/5), and parent-proof evidence entries (8/8). Before/after duplicate
rows are retained explicitly in the comparison output. The four pinned-run
captures, producer FINAL report and runtime supplement were additionally
hashed. SHA-256 equality establishes identity to these retained artifacts,
not a separate execution of them.

## Actual visual inspection

Opened all four PNGs under:
`docs/evidence/p46-managed-lifecycle/browser-6189a619-b9d0-4468-a0ed-e3ad6719686f/`.

| Capture | Independent current SHA-256 |
| --- | --- |
| `schedule-1440-light.png` | `8f4e922f8090229aa226be2faa5908fa28dfd414eadabedeee9d74a09974c894` |
| `schedule-1440-dark.png` | `7e23e36569a349d8a339a52864e0c5f313e8f97bec9380ecbb7366a70cef02ed` |
| `schedule-390-light.png` | `e37aeb668df1a2b85cffe0f402de02a7728d81233c1c99ad6ac64fc7b2345efc` |
| `schedule-390-dark.png` | `5fd0bf56877eadfde656068a730a1ecb9896db0b854e44c34bcd5061f3579863` |

Both desktop and mobile panels show enabled saved authority, day 7/day 12
configuration, Kien as recipient, the recipient's disabled lapse button,
Mai suspended, recovery and refresh controls. Visible lapse is
`2026-10-28T16:58:44.824Z`; next soft deletion is
`2026-11-04T16:58:44.824Z`. Mobile dates wrap within the panel. No blank
panel, overlapping controls or clipped fields was observed in either theme.
These are panel captures at 1440/390 viewport widths, not full-page or
whole-product acceptance. Browser source additionally asserts document
horizontal overflow is absent and no page errors occurred.

## P17/P18 acceptance retained

Read `docs/handoffs/p17-managed-transfer-recipients.md`,
`docs/handoffs/p18-managed-release.md`, and
`docs/handoffs/p18-managed-release-verification.md`.

P17's accepted managed-recipient boundary is reused unchanged, not replayed
or expanded into vendor parity. P18 remains a gated native release PASS,
not unrestricted historic/passwordless release or global-SSO bypass.
Legacy provenance, independent-password/verified-email requirements,
owning-adapter availability, durable release fences and scoped federation
coverage retain their prior limitations. This audit does not accept legacy
remediation, automatic re-enrollment or delivered recovery mail. The prior
unrelated federation policy expectation failure is not reopened or claimed
fixed. Scheduled final deletion is not represented as independent release.

## Independent commands and scope

Only read-only source/evidence inspection, SHA-256 commands and exact
resource-existence/listener checks were required. Literal commands, UTC,
cwd, raw output and exit 0 are retained in:

- `docs/evidence/p46-managed-lifecycle-verification/hash-audit.md`
- `docs/evidence/p46-managed-lifecycle-verification/cleanup-audit.md`

No implementation edit, commit, user-data mutation, broad cleanup, port 5173
operation, runtime test replay, browser launch or service launch occurred.
Only this report and its owned evidence directory were written. All remaining
findings and coverage limits are stated above; no owned probe resource remains.
