# P4 owner benefits backend - FINAL

October 27, 2026. Backend implementation is complete and SOURCE_FROZEN.
This receipt covers the authorized backend, contracts and native tests, not the
separate mounted UI/composition acceptance or live external providers.

Reconciliation, October 27, 2026: parent explicitly corrected the later report of
12 failures/new regressions as stale coordination from an earlier IN-PROGRESS
receipt. Parent confirmed there is no additional failing handle or new run.
FINAL is restored on the existing evidence: 376 combined passes, both fixture
timeouts corrected in the 13/13 run, original 28-case classification, final
PostgreSQL receipts and unchanged source freeze. No checks were rerun and no
source was reopened because of that mistaken message. Unrelated updater
typecheck drift remains accurately recorded below, not declared resolved.

Reconciliation update: the original archive now supplies eight distinct earlier
independent failing cases (nine executions), all passing by exact name in the
retained combined run. Together with the two corrected combined-run timeouts,
ten distinct independent cases are accounted for. Their original failures and
individual causes are preserved in
`docs/evidence/p4-benefits-backend/independent-historical-failures.log` and
`acceptance-reconciliation.md`. The same reconciliation maps the new authority
regressions to actual passing combined-run cases. The reported twelve-case
inventory was withdrawn by parent's explicit correction; no missing inventory
or backend acceptance gate remains. Earlier parent-message attempts failed with
the gateway's `unknown_cause` delivery guard; the reconciliation artifacts retain
the recovered failure evidence rather than hiding it.

## Frozen inputs and API

`docs/evidence/p4-benefits-backend/source.sha256` records the 29 production
files. SHA-256 of that manifest, including its trailing newline:
`b1f2bf300b2022eac4740aecd8f2d2fadee39911235674a6dbbbbf3078e67ddb`.
`inputs.sha256` additionally records 24 owned test files; its SHA-256 is
`b0b25a5b03c910518fd42ddefca3688b26d2e3e554b1d97181c4a92669138847`.
These are scoped fingerprints, not a claim that the shared repository is frozen.
No backend source changes followed the final PostgreSQL run; the last changes
were deterministic native fixture corrections.

The complete required DTO and route delta is
`docs/evidence/p4-benefits-backend/contracts.md`. It was published before
schema/handler edits; initial parent-message failures and subsequent successful
delivery are recorded there. In particular:

- `ProjectBenefits` has exactly compileSeconds, writableMembers, historyDays and
  trackChanges, using the existing Policy validators.
- Fresh authenticated operator GET/PUT
  `/api/admin/project-benefits/:kind/:key` use deployment/user/plan scopes.
  PUT requires CSRF and expectedVersion; withdrawal preserves a versioned null
  row. Deployment/local cannot be withdrawn. Referenced users must exist.
- `projectAccess` and `projectJoin` add required effectiveRole, benefits and
  capacityLimited. Assigned role remains unchanged.
- `accessGet.members` adds membership ID, effectiveRole and capacityLimited;
  its owner row has null memberId. Required writableSelection contains memberIds,
  capacity, effectiveCount and selectionRequired.
- Owner PUT `/api/projects/:p/writable-members` takes membership IDs or null and
  expectedVersion, returning existing OkSchema. It changes project version,
  not membership versions.

## Grants, restrictions and effective roles

Identity owns grant resolution. Deployment baseline, optional owner user grant
and explicitly mapped billing-plan grants combine by maximum/OR, with null as
unlimited. A sponsorship contributes only while billing is active and the owner
is an existing licensed member. Scheduled cancellation continues to contribute
until its effective transition. Unmapped plans and personal billing rows do not
silently confer project benefits. Multiple organizations contribute independently.

Current owner grants then meet the existing actor, organization, workspace,
project, federation and global restrictions. Other Policy fields and AI consent
remain unchanged. There is no hidden 180-second restriction when explicit
policy rows are absent. Owner benefits do not transplant owner personal provider
credentials, AI usage allowance or personal integration eligibility to an actor.

Assigned Owner/Editor/Reviewer/Viewer roles remain durable. Capacity only changes
effective authority. Editor and Reviewer consume writable capacity, owner does
not. Automatic selection makes all candidate assignments effective only when
they fit; overfull automatic selection makes none effective, never arbitrarily
chooses winners. Explicit selection is intersected with current membership IDs.
An overfull explicit selection also requires owner recovery, without deleting
the selection. Actor-specific ceilings demote only that actor. Viewer reads,
retained review/history data and assigned membership survive a benefit reduction.

Admissions, promotions, invitation acceptance and editor-link joins reread owner
benefits under the accounts lock. Pending invitations reserve no seats. Existing
writable conversions consume no additional seat, including dormant assignments.
New admitted assignments append the actual returned membership ID in explicit
mode. Removed/recreated memberships do not inherit a stale selected ID.

## Ownership, release and event transitions

Ordinary transfer rechecks current/recipient authority, active membership,
sharing/editor-open policy, managed-project restriction and expected version
inside the accounts transaction. Competing stale transfers lose with conflict.
Recipient ownership recomputes all four benefits; finite selection resets to
empty and unlimited selection resets to automatic. Former owner keeps an Editor
assignment, not guaranteed effective write authority. Source and project content
are retained. Notifications for both owners and project invalidations persist
transactionally. Privileged deletion/terminal transfers reuse that behavior and
retain their existing active/verified-recipient guards.

Managed release clears only the sponsoring organization's license and updates
its member counter. Other sponsorships, user grants, ownership, membership and
recovery access survive. Billing and federation changes fan out persisted
project-scoped invalidations after commit; no billing-account surrogate event
stands in for an affected project. Already-open SSE and WebSocket clients receive
the event, and the next protected action uses current authority.

## Compile, history and byte boundaries

Compile enqueue rereads current authority and wall budget after immutable source
preparation, inside accounts then compiler locks. Local and remote claims repeat
admission before cache reuse or attempts/provider work. Forbidden queued work
cancels as POLICY_CHANGED. A running lease keeps its admitted start-time budget;
existing attempt/callback fences remain. Cancel control requires current compile
authority but does not require permission to read historical bytes.

The shared foundation history predicate does not require review registration.
It uses captured history-version created_at when present, otherwise snapshot
time, and labels joined by snapshot_id. Current effective history policy gates
history source, compare, restore admission/finalization, historical compile/diff,
job discovery and stored compiler bytes. Both actual PDF-diff source jobs are
checked, and artifacts must be published in the successful persisted operation.
Byte preparation is outside account locks; final access is checked afterward.

Restore replay checks the durable published receipt before treating an expired
target as a new admission, while still requiring current actor/project
history.restore authority at the final transaction fence. Published recovery
finishes its existing operation; revoked members do not regain write authority.
Tracking reductions retain suggestions and comments; Reviewer behavior remains
the parent's corrected behavior.

New source exports persist exact project/branch/snapshot/revision provenance.
Explicit history is always history-gated. A captured current revision bypasses
checkpoint age only while that exact branch revision is still current. Both
publication and download check current access and history. Anonymous exports
retain origin, sharing and anonymous-read policy. Approved legacy exports without
trustworthy provenance retain IDs and bytes but require current access and
unlimited effective history on every project; otherwise HISTORY_WINDOW requests
a new current export. No archive-time provenance is invented.

## Append-only migration and backup

Migration `012-a-project-benefits` adds account_project_benefits and nullable
projects.writable_member_ids_json. Existing SQL strings/digests and role data are
preserved. Its SQL hashes are:

- SQLite: `3fb99ff1c1fa9fd0ec96dc9298dc3edd6076955d1491f961aa04f04f2eccea0e`
- PostgreSQL: `18928a8f66f1db1293c3d3605d994e09517895a26fad0cb6094d74593037c511`

The sole fresh seed is deployment/local, version 0, timestamp
1970-01-01T00:00:00.000Z, with this exact JSON:

```json
{"compileSeconds":180,"writableMembers":null,"historyDays":null,"trackChanges":true}
```

`migration-seed-contract.md` records the stable tuple. The backup owner
implemented the exact fresh-row whitelist, not a table-wide exemption, rejecting
changed payload/scope/version/timestamp and extra/withdrawn rows. Their 13-case
follow-up receipt used historical global Bun 1.3.14; it is not relabeled as
current-runtime evidence. Parent owns mounted current-runtime restore acceptance.

## Verification and limitations

All commands here use project-local Bun 1.4.4; global Bun was not changed.
Receipts are under `docs/evidence/p4-benefits-backend/`.

- `postgres-final.log`: both standalone real PostgreSQL migration/grant and
  compiler scripts passed; 15 additional export/review/event cases passed with
  83 assertions. Ledger, old role data, tombstone/restart, mapped billing loss,
  running lease budgets, canceled claims and historical byte fences were proven.
  All 17 owned databases and fixture roots were removed.
- `native-rerun.log`: 376 passed, two fixture timeouts, 1,575 assertions across
  378 cases/100 files. `native-fixture-corrections.log`: all 13 transfer/admission
  cases passed, including both corrected timeouts, with 52 assertions. An
  all-green 378-case aggregate was not rerun or claimed.
- `failure-classification.md` enumerates all original 28 failures from the
  337-pass/28-fail/one-error receipt. A concrete leaked fixture reaper was fixed;
  the rerun had zero Admission-is-closing errors. The two remaining deadlocks
  were test assumptions about same-runtime replay serialization, corrected with
  real independently composed runtime replicas and subscribed event barriers.
  This does not claim a universal cause of historical descriptor failures.
- `static.log`: full root typecheck and owned-file type-aware strict lint passed
  before the final three test-only corrections. Corrected fixture strict lint
  independently passed. Latest root typecheck reports only unrelated concurrent
  tests/operations/updates UpdateClient/API drift, retained verbatim in the final
  native receipt and reported to parent. No error was suppressed or out-of-scope
  test modified.

Parent's independently reported assistant 22/22, adapter native/real-scale 13/13,
production build and static checks remain evidence for their recorded inputs,
not newly executed checks against an implicitly unchanged whole workspace.
Unchanged integration/scale suites were not repeated. Live provider credentials,
commercial vendor eligibility and mounted UI acceptance are not fabricated.

The post-write review kept typed transaction/actor boundaries, exhaustive role
handling, existing callbacks and logging conventions, shared authority helpers
and behavioral regression tests. No any/cast/suppression workaround or guessed
compatibility path was added. The existing four-argument governance callbacks
remain intentional. Compiler service/leases and base access/project routes are
in the 200-250 pure-line warning band, none above 250; extract responsibility
before future additive work rather than expanding them. No runtime/composition,
UI, root package or historical migration edit was made. No git commit was made.

## Cleanup receipt

The owned `--rm` PostgreSQL container
`quire-p4-benefits-st-01a17d99` stopped successfully with exit code 0 after all
17 test databases were dropped. No unrelated container/image was removed.
The earlier owned parent-RPC watch was already absent when cancellation was
attempted; no active watch was left by that handle. Native commands and lint
commands have exited. No live provider or production database was contacted.
The parent's later additive operator-undelete work uses separate files/routes
outside this frozen manifest and does not conflict with benefit selection.
