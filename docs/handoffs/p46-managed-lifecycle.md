# FINAL: P46 managed lifecycle automatic trigger

October 28, 2026. Child task `st_01a18354`. Working directory:
`/home/norman/Repos/Quire`. Initial alternate-runtime verification finished at
`2026-10-28T16:49:13.050Z`; evidence inventory was hashed at
`2026-10-28T16:51:04.036Z`.

**Acceptance status:** the implementation and producer handoff are delivered.
The parent's repository-pinned Bun 1.4.4 lifecycle selection passed 7 cases and
192 assertions, exit 0, with seventeen identical pre/post source/test hashes.
The authoritative supplement is `docs/handoffs/p46-pinned-runtime.md`; its raw
receipt is `docs/evidence/p46-managed-lifecycle/parent-pinned.log`. This closes
the previously pending pinned execution check. The independent lifecycle
verifier's verdict remains a separate gate.

All child lifecycle account, host, and browser successes below ran Bun 1.3.14
and remain successful alternate-runtime evidence, not the basis for pinned
acceptance. The parent also supplied the separate pinned three-case scheduler
receipt. Production and tests remain frozen unless a real finding requires
correction; neither parent run was duplicated by this child.

**Producer handoff finalized:** parent monitor `mon_BB1JJH4D91FP0PVG` /
`bash_435` completed exit 0. The bounded P46 integration lint PASS and earlier
root typecheck PASS remain recorded for their verified snapshots. Later
concurrent P49/Dropbox root type/lint failures are disclosed separately below,
not represented as a current global PASS. The parent released the core-file
hold to P49 after the pinned run; subsequent core changes are outside that
snapshot. No further validation was run to incorporate this supplement.

Exact runnable lifecycle paths for the parent supplement:

```text
tests/accounts/governance/lifecycle-schedule.test.ts
tests/adapters/host/managed-lifecycle.test.ts
tests/ui-product/managed-lifecycle/browser.test.ts
```

The account fixture helper is
`tests/accounts/governance/lifecycle-fixture.ts`, not a runnable test suite.
No `tests/accounts/governance/managed-lifecycle.test.ts` was created.
The earlier migration compatibility command additionally used
`tests/accounts/migrations.test.ts`.

## Pinned runtime acceptance and verifier inputs

The supplement and raw receipt were read in full. From cwd
`/home/norman/Repos/Quire`, the parent placed the repository binary first in
`PATH` and ran:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
bun test tests/accounts/governance/lifecycle-schedule.test.ts \
  tests/adapters/host/managed-lifecycle.test.ts \
  tests/ui-product/managed-lifecycle/browser.test.ts
```

The receipt reports Bun 1.4.4 (`38afee6c8`), UTC
`2026-10-28T16:58:03Z` through `2026-10-28T16:58:54Z`, 7 pass, 0 fail,
192 assertions, and `P46_PINNED_EXIT=0`. Its seventeen identical pre/post hashes
include lifecycle production/contracts/UI, relevant tests and fixture, and the
two temporarily held core files. These are snapshot-bound observations, not a
claim about later P49 source changes.

The parent inspected all four pinned-run panel captures at widths 390 and 1440,
light and dark, under
`docs/evidence/p46-managed-lifecycle/browser-6189a619-b9d0-4468-a0ed-e3ad6719686f/`.
The parent reports visible configuration, recipient, confirmation, dates,
recovery, and refresh controls without overlap or overflow. This is parent
inspection evidence, not a claim that this child reopened those captures.
The supplement also records all seven owned roots absent, closed web/API ports
39413/36333, awaited fixture disposal, and zero remaining host listeners.

The dependent verifier must consume these together:

- `docs/handoffs/p46-pinned-runtime.md`
- `docs/evidence/p46-managed-lifecycle/parent-pinned.log`
- `docs/evidence/p46-managed-lifecycle/parent-schedulers.log`
- This producer handoff, including the authority design and separately disclosed
  concurrent static-check failures.

The pinned lifecycle run proves the affected final account, default-host, and
native-browser selection; the scheduler receipt proves the three affected
existing custom-caller/subscription/shutdown/failure-isolation cases. Neither
receipt alone constitutes the separate independent lifecycle verdict.

## Delivered

A55b now has an actual default-host scheduled trigger and a native organization
administration consumer. It is explicitly opt-in. An administrator saves the
schedule, selects an accepted managed project recipient, and explicitly starts
an account's lapse. The host subsequently advances due lapsed accounts without
an interactive session.

The configured defaults remain soft deletion on day 60 and final logical
account deletion on day 90. Both intervals are measured from the same persisted
`lapse_at`, in 86,400,000-millisecond days. They are not consecutive intervals.
This does not infer a lapse from billing, membership, identity-provider events,
or a guessed subscription state. It does not claim secure erasure.

`services/adapters/index.ts` schedules `reconcileManagedLifecycle` as an
independent admitted task in the existing application adapter host. It uses the
existing default 30-second wake interval and
`QUIRE_ADAPTER_SCHEDULER_INTERVAL_MS` configuration, single-active-pass guard,
subscription disposal, and awaited shutdown. The host now has five subscriptions.
Restart reads persisted policies and lapse timestamps; no in-memory session or
timer state carries deletion authority.

The native consumer is under Settings > Organizations > a team > Automatic
managed lifecycle. It offers enabled/disabled configuration, absolute day
intervals, recipient selection, a confirmation checkbox before suspension,
recovery, current authority status, exact UTC next-stage timestamps, and recorded
per-account failure codes. A disabled or revoked schedule shows a paused stage.
An overdue suspended account correctly shows final deletion as its next stage
when the final threshold has already elapsed.

## Authority and transaction boundaries

Migration `014-a-managed-lifecycle` adds policy and failure-receipt tables, with
SQLite and PostgreSQL variants. Existing accepted migration SQL was not changed.
The policy records the authenticated administrator's user ID, exact membership
ID and membership version, recipient, intervals, enabled flag, and policy CAS
version. Saving requires current organization-admin membership, an active
account, CSRF validation, and a recent sign-in. Installation operator status
alone cannot authorize a schedule.

Every scheduled candidate is re-read under `quire:accounts` in its own
transaction. The transaction rechecks the current enabled policy and the exact
saved admin grant, active authorizing user, team organization, continuing managed
ownership and membership, current acceptance version, and due timestamp before
changing the account. Disabling before that transaction prevents advancement.
Demotion followed by promotion cannot revive an old grant because its membership
version changed; removal/recreation also changes the membership ID. An admin must
explicitly save again. Membership edits, including licensing edits that increment
the membership version, conservatively invalidate this authorization.

No scheduled `Principal`, operator flag, session ID, or CSRF token is
manufactured. Interactive calls continue accepting the actual `Principal`.
The shared private transition implementation receives the real actor ID only
after either interactive authorization or persisted-grant verification, inside
the same account transaction. Scheduled audit entries name the saved admin.

Final deletion reuses the accepted managed-recipient and removable-account
guards. It requires a distinct active verified account with accepted management
by the same team, retains last-operator and last-admin protections, transfers
projects before credential/session revocation, and commits the audit atomically.
Billing records and unrelated organizations are not deleted. Recovery clears
the lapse and restores the retained account even when the schedule is disabled.
Already advanced/deleted records do not advance again.

Each account failure rolls back its own transaction, is logged as
`MANAGED_LIFECYCLE_FAILED`, and records an error code tied to the policy and
acceptance versions. Another due account still runs. A later tick can succeed
after the cause is corrected; no failed attempt is represented as success.
Infrastructure failures that prevent enumeration, receipt persistence, or event
dispatch retain the host's existing failure/shutdown contract rather than
manufacturing a successful pass.

### Added routes

All registration stays inside the authorized governance directory.

- `GET /api/organizations/:o/managed-lifecycle`: configuration, saved actor,
  current authority validity, accounts, due stages, and failures; private/no-store.
- `PUT /api/organizations/:o/managed-lifecycle`: `{ settings: { enabled,
  transferTo, softDeleteDays, deletionDays }, expectedVersion }`. The version is
  the policy version, initially zero. Enabled configuration validates the managed
  recipient. Disabled configuration can retain or clear the recipient.
- `POST /api/organizations/:o/managed/:u/lifecycle`: `{ action: "lapse" |
  "recover", expectedVersion }`. This is the management acceptance version, not
  the account version. Lapse requires an enabled policy with valid saved
  authority, and cannot suspend its selected recipient. Recovery remains
  available while disabled.

The alternative rejected was constructing a synthetic system operator or
deriving an actor from whichever membership happened to exist at tick time.
The chosen policy is durable explicit authorization with revocation checks.

## Commands and raw receipts

All commands below ran from `/home/norman/Repos/Quire`. The receipt runner was
`bun docs/evidence/p46-managed-lifecycle/run.ts LABEL COMMAND...`; it retains
literal child commands, cwd, UTC start/end, stdout, stderr, and
`RAW_EXIT_CODE=N` in `docs/evidence/p46-managed-lifecycle/LABEL.txt`.

The child's executable reported **Bun 1.3.14 (0d9b296a)**. Repository package
metadata requests Bun 1.4.4. The reused parent scheduler receipt reports
**Bun 1.4.4 (38afee6c8)**; these executions are distinguished below.
No child Bun 1.3.14 pass in this table establishes repository-pinned runtime
acceptance.

| Literal child command | Receipt | UTC start -> finish | Result |
| --- | --- | --- | --- |
| `bun test tests/accounts/governance/lifecycle-schedule.test.ts tests/adapters/host/managed-lifecycle.test.ts tests/accounts/migrations.test.ts` | `backend.txt` | 16:36:07.388 -> 16:37:18.671 | Exit 0; 6 pass, 151 assertions |
| `bun test tests/accounts/governance/lifecycle-schedule.test.ts` | `accounts-cleanup.txt` | 16:43:02.681 -> 16:43:08.900 | Exit 0; final 4 pass, 96 assertions |
| `bun test tests/adapters/host/managed-lifecycle.test.ts` | `host-final.txt` | 16:47:27.392 -> 16:48:19.394 | Exit 0; final 2 pass, 67 assertions |
| `bun test tests/ui-product/managed-lifecycle/browser.test.ts` | `browser-corrected.txt` | 16:40:01.465 -> 16:40:58.703 | Exit 0; 1 pass, 29 assertions |
| Parent pinned selection: `bun test tests/accounts/governance/lifecycle-schedule.test.ts tests/adapters/host/managed-lifecycle.test.ts tests/ui-product/managed-lifecycle/browser.test.ts` with repository binary first in `PATH` | `parent-pinned.log` | 16:58:03 -> 16:58:54 | Bun 1.4.4; exit 0; 7 pass, 192 assertions |
| `bun test tests/integration/adapters/schedulers.test.ts` | `scheduler-integration.txt` | 16:55:03.783 -> 16:55:43.298 | Exit 0; 2 pass, 7 assertions; one requested run |
| `bun run typecheck` | `root-typecheck-complete.txt` | 16:47:27.403 -> 16:47:55.248 | Exit 0 |
| `bun run lint` | `root-lint-complete.txt` | 16:47:55.272 -> 16:48:42.742 | Exit 0; type-aware, deny warnings |
| `bun x tsc --noEmit -p tests/accounts/tsconfig.json` | `accounts-typecheck-complete.txt` | 16:48:42.768 -> 16:48:52.539 | Exit 0 |
| `bun x tsc --noEmit -p tests/adapters/host/tsconfig.json` | `host-typecheck-complete.txt` | 16:48:52.563 -> 16:49:02.281 | Exit 0 |
| `bun x tsc --noEmit -p tests/ui-product/managed-lifecycle/tsconfig.json` | `browser-typecheck-complete.txt` | 16:49:02.303 -> 16:49:13.050 | Exit 0 |
| `bun run typecheck` (including the subsequently added P47 test) | `root-typecheck-with-p47.txt` | 16:56:39.664 -> 16:57:03.623 | Exit 0 |
| `bun run lint` (later shared-workspace check) | `root-lint-with-p47.txt` | 16:57:03.647 -> 16:57:49.038 | Exit 1; unrelated Dropbox constant-condition error, detailed below |

The initial combined test count overlaps the later focused runs; these are not
additional distinct tests. There are four lifecycle account cases, two host
cases, two migration cases, one native browser case, and two subsequently
authorized scheduler integration cases. The parent's reused three-case receipt
overlaps those two scheduler cases and adds the custom-caller lifecycle case;
its count is not added as three new cases. The parent's seven pinned lifecycle
cases are the same four account, two host, and one browser cases on Bun 1.4.4,
not seven additional distinct cases.

`diff-check-final.txt` retains exit 0 for:

```sh
git diff --check -- services/accounts/governance services/adapters/index.ts packages/contracts/src/accounts.ts packages/contracts/src/routes-accounts.ts apps/web/src/features/account/organizations tests/accounts tests/adapters/host tests/ui-product/managed-lifecycle
```

The deterministic cases exercise:

- Default disabled state, actual admin versus member/operator denial, CSRF,
  recent authentication, CAS conflicts, invalid intervals and recipients.
- Exact not-due/day-60 boundary and day-90 terminal advancement through actual
  default application host ticks, with real application restarts.
- Configurable day-1/day-2 boundaries, repeated-tick idempotence, recovery,
  disabled progression, and disabled lapse denial.
- Persisted authority loss across demotion/re-promotion and restart, suspended
  authorizing accounts, continuing ownership checks, and overdue-stage reads.
- A pending recipient instead of accepted management, last-admin and
  last-operator denials, retained billing, successful project transfer, and
  credential/session revocation.
- An injected final-audit failure: the target's project transfer and deletion
  roll back, a different due account succeeds, the failure remains visible,
  and a later tick succeeds after removing the owned failure trigger.

Host tests inject clock changes and subscription events, then await
`adapters.close()` to drain the exact started work. No fixed sleeps or polling
are used. Browser tests subscribe to the relevant responses before mutations
and use bounded DOM mutation observation.

The prior P17/P18 accepted recipient/release behavior and P16 institution logic
are reused, not broadly replayed. `managed.ts` and `shared.ts` are byte-identical
to the pre-task snapshot. A subsequent scope expansion authorized exactly
`tests/integration/adapters/schedulers.test.ts`. It was read before considering
edits: the failing-task assertion already expected four surviving subscriptions
from five tasks, and both shutdown assertions already expected zero. No stale
count remained, so no test edit was necessary. The complete file was then run
once; real TLS SMTP draining, admitted-task failure isolation, retained failure,
sibling cleanup, and shutdown assertions all passed unchanged. The separate
application-composition suite was not replayed by this child; the parent's
focused custom-caller scenario is reused below.

### Reused parent scheduler proof

`docs/evidence/p46-managed-lifecycle/parent-schedulers.log` was read in full.
It records cwd `/home/norman/Repos/Quire`, UTC
`2026-10-28T16:41:03Z` through `2026-10-28T16:41:45Z`, 3 passing cases,
4 filtered cases, 12 assertions, and `P46_PARENT_TEST_EXIT=0`.
Parent monitor/session: `mon_V7FBNNWS5GDR2RXM` / `bash431`.
The recorded selection is reproducible as:

```sh
bun test tests/integration/adapters/application.test.ts tests/integration/adapters/schedulers.test.ts --test-name-pattern='leaves explicitly|stops a failing|drains a scheduled'
```

This covers explicit custom-caller start/close ownership, real TLS SMTP draining,
and failing admitted-task isolation with sibling/storage cleanup. The parent
reports changing only two application subscription expectations from 4 to 5
and the failed-task remaining count from 3 to 4, preserving all shutdown and
failure assertions, with both files LSP-clean.

The current files and adapter host were independently hashed at
`2026-10-28T17:00:57.037Z` and exactly match both the pre-run and post-run hashes
in the parent receipt:

```text
e447d1dfcb59bda0390e5baff54c79af250aac5c394053cd6ff9ebf658427248  tests/integration/adapters/application.test.ts
32e7ee14edf5a0c007a070c7e0731467c47e2112ab3ea5e72600a861e3780072  tests/integration/adapters/schedulers.test.ts
da664bc415634904d427d0f757b6956065dadab6748d4743e85fc81dcf76dff2  services/adapters/index.ts
a433723b91d26f08d620bcd9bd12999b5e732b4f7a873978689c25f483c124b1  docs/evidence/p46-managed-lifecycle/parent-schedulers.log
```

`parent-proof-source-hashes.txt` retains this command, UTC, hashes, and exit 0,
plus the existing root and integration-scope tsconfig hashes. The earlier parent
execution timestamp explains why the child already observed the four-survivor
expectation. Neither parent-owned test file was edited by this child, and no
unchanged runtime scenario was replayed to incorporate this receipt.

Final static scope explicitly includes both parent-owned integration test files:
`tests/integration/adapters/tsconfig.json` includes `./**/*.ts`, and the scoped
type-aware lint command names both paths. Root `tsconfig.json` includes `tests`,
including P47's `tests/core/base/admin-recovery-postgres.test.ts` and P48's
`tests/adapters/publisher/lifecycle.test.ts`. File timestamps show both existed
before the final root check began: `2026-10-28T16:36:45.175860125Z` and
`2026-10-28T16:44:47.630704893Z`, respectively.
`p47-p48-static-sources.txt` and `p47-p48-static-times.txt` retain their hashes,
UTC timestamps, commands, and exit 0. The P48 test hash is
`979bc3de1d7bc0fcd4edea7f5cc414002c3f2827536eb412ed5a16c2c56f21d2`.
Both parent runtime proofs are reused, not rerun.

The first final static attempts encountered additional out-of-scope shared
Dropbox errors:

| Command | Receipt | UTC start -> finish | Observed result |
| --- | --- | --- | --- |
| `bun x tsc --noEmit -p tests/integration/adapters/tsconfig.json` | `integration-typecheck-final.txt` | 17:01:06.152 -> 17:01:17.830 | Exit 2 |
| `bun run typecheck` | `root-typecheck-parent-proof.txt` | 17:01:06.161 -> 17:01:32.364 | Exit 2 |
| `bun x oxlint --type-aware --deny-warnings tests/integration/adapters/application.test.ts tests/integration/adapters/schedulers.test.ts` | `integration-lint-final.txt` | 17:03:29.154 -> 17:03:29.924 | Exit 0 |
| `bun run lint` | `root-lint-parent-proof.txt` | 17:03:29.160 -> 17:04:15.240 | Exit 1 |

Both report `services/adapters/dropbox/folders.ts:142:41` using missing
`CoreProjects.prepareCreation` and `:183:38` passing an unsupported `creation`
property. Root additionally reports missing `DropboxFolderImportSchema`,
`DropboxFolderInspectionSchema`, and `DropboxFoldersResultSchema` exports at
`apps/web/src/features/account/dropbox-folder-project.tsx:2`, and implicit-any
parameters at lines 25, 55, and 76. These diagnostics are retained verbatim in the
raw receipts and were reported to the parent. This child did not edit or
investigate those unrelated sources. Since the initial command chains stopped
after TypeScript failed, the scoped/root lint commands were started separately
rather than being falsely reported as executed.

The scoped lint naming both parent-owned tests passed. The root lint reports
`typescript(no-redundant-type-constituents)` at
`apps/web/src/features/account/dropbox-folder-project.tsx:16:42` and `:18:48`
(`'any' overrides all other types in this union type`). These are additional
out-of-scope shared-workspace diagnostics, not suppressed or claimed clean.
Both final typecheck commands included the requested integration paths; root
also included P47/P48 as established above. `parent-proof-evidence-hashes.txt`
hashes the parent receipt, matching source/configuration provenance, all four
final static receipts, and the P47/P48 inclusion evidence. No runtime test was
repeated for these static-only follow-ups.

### Scoped scheduler follow-up

The exact additional command was:

```sh
cd /home/norman/Repos/Quire
bun docs/evidence/p46-managed-lifecycle/run.ts scheduler-integration bun test tests/integration/adapters/schedulers.test.ts
```

`scheduler-integration.txt` retains UTC `2026-10-28T16:55:03.783Z` through
`2026-10-28T16:55:43.298Z`, 2 passing tests, 7 assertions, no failures, and
`RAW_EXIT_CODE=0`. Monitor receipt: `mon_PTZJ4WF4QKZ55JGB`.
`scheduler-source-before.txt` and `scheduler-source-after.txt` retain identical
test and authority-source hashes before and after that run:

```text
32e7ee14edf5a0c007a070c7e0731467c47e2112ab3ea5e72600a861e3780072  tests/integration/adapters/schedulers.test.ts
e88cb3f83549d344b6377612fbe9db180bcf9d827719ff9c21d6cf3f8572d6a2  services/accounts/governance/lifecycle.ts
e340e8f4eeca806152da126f80b67361891c7b144e7b9f093000daef3e56d73b  services/accounts/governance/lifecycle-policy.ts
da664bc415634904d427d0f757b6956065dadab6748d4743e85fc81dcf76dff2  services/adapters/index.ts
```

Thus this follow-up did not alter any test assertion, production authority
check, active-user/admin check, or scheduler implementation. Its fixtures
retained the existing awaited `await using` disposal; this run did not emit
individual root/port names and no such cleanup receipts are invented.

The parent subsequently reclaimed exactly
`tests/integration/adapters/application.test.ts` and
`tests/integration/adapters/schedulers.test.ts`, including any further count
updates and runs. This child did not edit either file and did not repeat the
scheduler test. The historical four-survivor observation and passing receipt
above describe the hashed file at that run, not a claim about later parent edits.

The root configuration was read and already includes `tests` with no exclusion
for the new `tests/core/base/admin-recovery-postgres.test.ts`. A subsequent
`bun run typecheck` therefore included that P47 file and passed at
`2026-10-28T16:57:03.623Z`. The P47 file's observed SHA-256 was
`6a66c90cdcdfe9d56c0461745035f5d43400f7981b60622b7101e1bf0d33fc8d`,
retained with the unchanged root-config hash in `scheduler-source-after.txt`.
P47's browser/native/PostgreSQL scenario was not rerun by this child.

The subsequent root lint run returned exit 1 at
`2026-10-28T16:57:49.038Z` with:

```text
services/adapters/dropbox/api.ts:98:14: error eslint(no-constant-condition): Unexpected constant condition
```

That file is outside the P46 write scope and was neither edited nor investigated.
The parent was informed. This is a later shared-workspace finding, not a clean
root-lint claim and not attributed to P47. P46's preceding root lint receipt at
`2026-10-28T16:48:42.742Z` remains an observed exit 0. No suppression or weakened
assertion was introduced. `scheduler-followup-hashes.txt` retains hashes of all
five additional scheduler/source/root-check receipts.

### Failed and corrected attempts

`browser.txt` retains the first browser attempt's exit 1:
`goto: net::ERR_NETWORK_CHANGED` on the owned loopback origin before the native
page rendered. Its fixture was disposed. The later native run passed without
adding sleeps, polling, retries, or weakening assertions.

Initial root/scoped checks identified a branded `Instant` assertion, a shadowed
test variable, and awaiting Bun's non-thenable assertion result. Those fixture
issues were corrected. `root-typecheck.txt`, `browser-typecheck.txt`, and
`root-lint.txt` retain the failed receipts; the initial P46 final commands passed.
The later out-of-scope root lint failure is recorded separately above.
Expected `MANAGED_LIFECYCLE_FAILED` logs in passing tests are deliberate denial
and rollback cases, not ignored failures.

Final review corrected the read-only overdue next-stage calculation. The final
host test asserts the actual final-deletion stage and timestamp. The native
browser capture of the unchanged future-stage UI was reused; it was not
misrepresented as a second post-correction browser run.

## Inspected native browser evidence

Directory:
`docs/evidence/p46-managed-lifecycle/browser-c0e42f1a-1118-4824-9fd2-d459d47ab030/`.

All four actual native panel captures were opened and visually inspected:

| Capture | SHA-256 |
| --- | --- |
| `schedule-1440-light.png` | `20fc62fdf850fb83b033bb39838554eb5e875ab203ebe11a5493893cb073e71c` |
| `schedule-1440-dark.png` | `920cfddfe9d1f28b16a8598339f2ec110a4ae81b3014f49b8fb4dbe0f5c65dc7` |
| `schedule-390-light.png` | `ab5f699be61c7c804c1b49e47b4701d350c97c39e96efa8e5e84aa3c5a20b607` |
| `schedule-390-dark.png` | `e6b493bc5143f2145bb3751d2f8ce0ca9a817cbef387c7e508d8ed38cb64b0bc` |

The configured day-7/day-12 intervals, selected accepted recipient, enabled
authority, suspended target, recovery control, and UTC next stage are visible.
At mobile width the timestamps wrap within the panel. No blank panel, overlapping
controls, clipped form fields, or horizontal overflow was observed in either
theme. The actual lapse was `2026-10-28T16:40:56.785Z`; the visible next stage was
`2026-11-04T16:40:56.785Z`.

The browser test also proves saving then reloading, default-disabled button and
HTTP denial, unauthorized member/operator writes, a disabled operator save
control, disabling an active schedule, paused-stage display, and recovery while
disabled. No browser `pageerror` occurred in the passing run.

## Source provenance and retained evidence

`pre-change.txt` records the pre-edit source hashes at
`2026-10-28T16:26:49Z`, including dirty-workspace HEAD
`17a8dd43e2f6662dad590de746339d24fe6181d4`.
`source-hashes-final.txt` records all 16 owned source/test/runner files plus the
two unchanged guard files at `2026-10-28T16:48:34.385Z`, with the literal
`sha256sum` command and exit 0.

Key final SHA-256 values:

```text
e88cb3f83549d344b6377612fbe9db180bcf9d827719ff9c21d6cf3f8572d6a2  services/accounts/governance/lifecycle.ts
e340e8f4eeca806152da126f80b67361891c7b144e7b9f093000daef3e56d73b  services/accounts/governance/lifecycle-policy.ts
da664bc415634904d427d0f757b6956065dadab6748d4743e85fc81dcf76dff2  services/adapters/index.ts
700db84c39b00ce7c4f2195421e79a9d6dfbc32feaadc696f927946c983fbf87  services/accounts/governance/managed.ts
cd023e432fd89b731741433d0de6fd95947ea831f56dcbff47b1230f2f6a1f09  services/accounts/governance/shared.ts
```

`screenshot-hashes.txt` retains screenshot hashing and
`evidence-hashes.txt` hashes the initial delivery's retained text receipts and all
four captures; `scheduler-followup-hashes.txt` covers the subsequent receipts.
`parent-proof-evidence-hashes.txt` covers the later parent-proof/static receipts.
The inventory does not recursively hash itself or this subsequently written
handoff. Previous successful and failed receipts remain available rather than
being overwritten.

## Exact owned cleanup

Only isolated fixture data, fixture listeners, browser contexts/processes, and
the deliberately injected fixture audit trigger were cleaned. Host subscriptions
were zero after each drained close; all fixture servers/runtimes were awaited
through their async disposal contracts.

`cleanup.txt` and `cleanup-final-host.txt` independently record these roots as
absent, with raw exit 0:

```text
/tmp/quire-ui-integrations-3gJm47
/tmp/quire-ui-integrations-tuB3P2
/tmp/quire-p2x-integrate-QGn0gW
/tmp/quire-p2x-integrate-rPi07Z
/tmp/quire-p2x-integrate-SXHdXh
/tmp/quire-p2x-integrate-0pcfGe
/tmp/quire-p1s-accounts-HlUZCb
/tmp/quire-p1s-accounts-9Jd1Iy
/tmp/quire-p1s-accounts-MhJW6V
/tmp/quire-p1s-accounts-3u9Zhl
```

The initial browser used loopback ports 38733/38691; the passing browser used
40293/37283. The passing browser explicitly proved both origins refused
connections after disposal. The independent cleanup receipt records no listener
on all four ports at `2026-10-28T16:45:54.924Z`.
Final host roots were independently checked absent at
`2026-10-28T16:49:01.740Z`. The final account tests also assert `ENOENT` for each
emitted root. Earlier account/migration runs reused the existing scoped fixture
disposal but did not emit individual root names; this handoff does not invent
those names or claim independent per-path receipts for them.

No listener or request targeted FastShort's port 5173. Existing backend fixture
Origin headers naming that port are just request metadata; actual requests used
owned ephemeral loopback API ports. No real user account, unrelated service,
supplied input, or unrelated workspace change was removed. No commit was made.

The parent pinned supplement separately records these seven roots absent:

```text
/tmp/quire-ui-integrations-XQa1yI
/tmp/quire-p2x-integrate-GkeNkf
/tmp/quire-p2x-integrate-osBR6j
/tmp/quire-p1s-accounts-55eTIH
/tmp/quire-p1s-accounts-fWRlLZ
/tmp/quire-p1s-accounts-0lRrb0
/tmp/quire-p1s-accounts-Hvj72y
```

The parent verified web/API ports 39413 and 36333 refuse connections.
These parent cleanup observations are reused without another probe.

## Acceptance limits

The native/default-host implementation is delivered and its affected execution
selection passed repository-pinned Bun 1.4.4 under the parent supplement.
The successful Bun 1.3.14 account/host/browser receipts remain alternate-runtime
evidence. The independent lifecycle verdict is still the dependent verifier's
separate gate; the producer does not infer that verdict from passing tests.
Latest root/scoped typechecks and root lint also retain the unrelated Dropbox
failures listed above, while the scoped integration lint passed. This is a
logical managed-account lifecycle after an explicit administrator-started lapse,
not automatic billing-lapse detection, vendor retention parity, or secure erasure.
Custom application compositions that deliberately omit/disable the adapter host
still own scheduling and start/close.

SQLite application execution and both migration-variant contracts were checked.
A live PostgreSQL execution of the new migration, a production bundle build,
and broad unchanged suites were not run in this child task. The parent's
feature matrix, README, and runbook updates remain parent-owned.
