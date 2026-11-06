# C40a prospective workspace sharing

Date: 2026-11-06. Status: elected workspace-only behavior implemented and verified.

## Elected scope and provenance

The lead elected an explicit migration-time baseline for existing projects.
Historical creation-time organization policy is not reconstructible from
project rows or policy audits, so this implementation does not claim it.
Migration `014-a-project-sharing` records the current workspace contribution
with `provenance='migration'` and its own `captured_at` timestamp. Project
origin dates, update dates, versions, and source history are unchanged.
New insertions record `provenance='creation'`. Restart does not recapture.

Only the workspace contribution to sharing is frozen. The current actor's
organization memberships and organization policies remain live even when
they overlap the workspace organization. Project, global, user, and
federation policy sets remain live. All other Policy fields remain live:
AI, chat, anonymous permissions, and benefit restrictions are not frozen.
Session, user-status, project membership, and share-token checks remain in
the existing authorization path.

## Implementation

`services/accounts/identity/project-sharing-migration.ts` provides paired
SQLite/PostgreSQL backfill and project-insert triggers. This covers ordinary
creation, prepared repository publication, imports, copies, and direct
fixture inserts in the same transaction as the project. Existing core
creation and organization policy mutation paths serialize on
`quire:accounts`. No new public contracts or alternate save path are added.

The baseline intersects the workspace organization's policy and any
organization-scoped policy set, using the existing sharing rank.
Projects without a workspace store a null contribution. `policy.ts`
replaces only the workspace policies' sharing field with that baseline
and continues intersecting all live actor and independent restrictions.

Operator guidance is in `docs/runbooks/creation-and-import.md`.

## Exact proposed policy UI copy for the lead

> Workspace sharing changes apply to future projects. Existing projects keep
> their workspace sharing baseline. Restrictions on organization members
> still apply immediately, including on existing projects. Owners can
> tighten access further. AI, chat, anonymous access, and revoked links
> remain subject to current policy.

For an upgrade explanation:

> Projects that existed before this upgrade use the workspace sharing
> policy recorded at upgrade time. This is not a record of their original
> creation-time policy.

No UI files are changed in this track.

Sharing fixtures now seed the team with a permissive workspace ceiling
before inserting the project, then restore the ordinary live organization
policy. This preserves their existing revocation and permission assertions
without mutating a captured baseline or weakening production defaults.
The core, review, compiler, and shared browser fixture imports opt into this
test-only setup. Production seed behavior is unchanged.

## Evidence

The new SQLite upgrade test passes and proves migration-time provenance,
the intersection with organization policy sets, unchanged project origin
dates and versions, and persistence across restart. New HTTP scenarios pass
for tightening and loosening policy, different old/new project baselines,
live owner and collaborator organization membership changes, independent
project/global/user/federation ceilings, chat and anonymous controls, and
link revocation.

The focused SQLite run covered 38 tests across these eight files:

```sh
./node_modules/.bin/bun test --timeout 30000 \
  ./tests/accounts/prospective-sharing-migration.test.ts \
  ./tests/core/base/prospective-sharing.test.ts \
  ./tests/core/base/access.test.ts \
  ./tests/core/base/share.test.ts \
  ./tests/core/base/effective-access.test.ts \
  ./tests/core/base/benefit-admissions.test.ts \
  ./tests/accounts/organization.test.ts \
  ./tests/accounts/identity/federation-policy.test.ts
```

That run passed 36 tests and exposed two test-authoring errors: an ambiguous
SQLite `INSERT SELECT ... ON CONFLICT` and an incorrect effective-access URL.
After correcting those errors, the two failing scenarios passed in a targeted
rerun (2 passed, 0 failed). No assertions were removed or weakened.

Both new HTTP scenarios also passed on PostgreSQL (2 passed, 0 failed,
49 assertions). `tests/accounts/prospective-sharing-postgres.ts` separately
passed the real upgrade backfill, live policy intersection, immutable origin
dates, and restart checks. Verification used an owned disposable
`postgres:17-alpine` container; all three test databases were dropped and the
container was stopped and removed. Reproduce with an owned server:

```sh
export QUIRE_SHARING_POSTGRES_URL=postgres://USER:PASSWORD@HOST:PORT/postgres
./node_modules/.bin/bun tests/accounts/prospective-sharing-postgres.ts
./node_modules/.bin/bun test --timeout 30000 ./tests/core/base/prospective-sharing.test.ts
```

Additional recovery, transfer, realtime, and preview checks passed:
34 tests, 0 failures, 209 assertions, exit code 0, across
`source-composition.test.ts`, `owner-transfer.test.ts`,
`source-export-history.test.ts`, review `anonymous.test.ts`, `links.test.ts`,
`session-revocation.test.ts`, and compiler `preview-access.test.ts`.
These preserve live user/session and token revocation, capacity/benefit
boundaries, source publication recovery, and anonymous preview policy.

Final `bun run typecheck` passed with exit code 0. Changed-file type-aware
`oxlint --deny-warnings` passed, including the final PostgreSQL script.
Scoped `git diff --check` passed.

An early run of the separate existing `tests/accounts/migrations.test.ts`
encountered its all-dialects-must-differ assertion for the institution
reconfirmation migration, whose SQLite/PostgreSQL strings were identical.
That unrelated migration/assertion was not changed in this track. Its
accepted-native-data test passed. The new sharing migration has distinct
dialect SQL and was executed successfully on both databases.

No commits were created. No whole-product acceptance, unrelated browser UI,
or historical creation-policy reconstruction is claimed. The exact UI
wording above is a proposal for the lead; this track changes only server
policy, migration registration, test fixtures/tests, and documentation.

## Restore integration correction

The installation continuation invalidated the initial completion claim:
`live-restore-failure.json` recorded `SQLITE_CONSTRAINT_PRIMARYKEY` for
`account_project_sharing.project_id` after a successful real signed backup.
The dependency-ordered importer inserted projects first, firing the creation
trigger, then collided with the authoritative archived sharing rows.

The enhanced native archive round-trip test reproduced that exact error
before the fix: 0 passed, 1 failed, exit code 1. It uses actual application
migrations, signed backup verification, SQL/blob/Git import and isolated
target ownership, with both migration and creation provenance in the archive.

The correction is in `services/operations/backups/restore-target.ts`.
For archives containing `account_project_sharing`, only its creation trigger
is suspended within the import transaction. SQLite retains its exact target
schema DDL and recreates it before commit; PostgreSQL disables/enables the
named trigger. Transaction rollback restores trigger state on failure.
All archived rows retain strict INSERT semantics. No migration bytes,
uniqueness/foreign-key constraints, archive fields, or baseline values change.

`restore-target.test.ts` now verifies exact baseline/provenance/timestamp
preservation despite changed current organization policy, subsequent real
project creation, and rollback of trigger suspension on injected insertion
failure. `restore-target-postgres.test.ts` checks the same preservation and
subsequent creation across native-to-PostgreSQL and PostgreSQL-to-PostgreSQL
signed restoration with actual S3 and remote repository services.

Verification commands:

```sh
./node_modules/.bin/bun test --timeout 300000 \
  ./tests/operations/backups/restore-target.test.ts \
  ./tests/operations/backups/restore-target-postgres.test.ts
./node_modules/.bin/bun test --timeout 120000 \
  ./tests/operations/backups/restore-target.test.ts \
  -t 'imports into an explicit native target'
./node_modules/.bin/bun run typecheck
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/operations/backups/restore-target.ts \
  tests/operations/backups/restore-target.test.ts \
  tests/operations/backups/restore-target-postgres.test.ts
```

The combined run passed PostgreSQL restoration, native rollback, and target
authority rejection. Its native full-table equality assertion exposed an
outbox race introduced by the extra fixture project creation, after import
itself succeeded. The fixture now awaits `source.events.dispatch()` before
taking its comparison image. No equality assertion or table was removed.
The native-only rerun then passed: 1 passed, 0 failed, 22 assertions, exit 0.
All four selected scenarios passed across these runs. Typecheck and scoped
type-aware lint exited 0; scoped diff whitespace checking passed.

The final native receipt covers 118 tables:
backup `b55e6e06-3e7f-4ee5-a9c2-0155f39e3df1`,
digest `033e12d48fad702d6d2733af08f990ac2691338ad7a9a0da80da05de88985f58`.
The PostgreSQL receipt covers 118 tables:
backup `106f8b57-f63e-4c69-96b6-29df86d26c1a`,
digest `deaaf40075deed872d205bfeb3fc70f93e4c708b447d080af04b8cb192415e2a`.
Fixture cleanup confirmed owned native roots removed and PostgreSQL, Redis,
S3 containers and the S3 volume absent. No archives containing secrets were
retained as public evidence.

Exact correction scope: `restore-target.ts`, the two restore-target test
files, this handoff, and `docs/runbooks/recovery.md`. Installation child
`st_01a1b160` received the cause, file ownership, fix, passing receipts, and
cleanup result. No installation lifecycle scenario was rerun by this track;
the child is ready for the lead's affected selection. No commits were made.
