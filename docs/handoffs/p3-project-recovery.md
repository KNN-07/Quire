# Privileged deleted-project recovery

Status: native API and mounted administration workflow verified.

Operators can list retained deleted projects through
`GET /api/admin/projects/deleted` and restore a selected project through
`POST /api/admin/projects/:id/restore`. The real administration consumer is in
Users & groups, Manage account, Recover deleted projects.

Restoration requires current operator authority, an active fresh session,
CSRF, exact project-name confirmation and current version. The transaction
holds `quire:accounts`, rechecks authority, requires an active owner, restores
the project tombstone and publishes one audit/access event and replay receipt
atomically. Source, snapshots, assigned memberships and benefit selections
remain retained; revoked links are not enabled. Operators do not gain source
read access merely by recovering metadata.

`bash_194`: five API cases passed with scoped type-aware lint exit 0. They cover
restart persistence, exact source/history/membership retention, actual revoked
link denial, replay deduplication, demoted-operator denial, CSRF/freshness/version/
confirmation checks and rollback under an actual audit-insert failure.

`bash_198`: the mounted browser selected the actual deleted project, confirmed
its name, restored it, displayed the real result and fetched byte-identical
source through the owner's session. One browser case passed; scoped lint exit 0.
All four confirmation captures in `docs/evidence/p3-project-recovery/` were
opened and inspected at 1440x900 and 390x844 in light/dark. These are viewport
captures, not a claim of physical-device testing. Browser/application disposal
was awaited; this test did not emit a root-ID inventory.

Earlier failures remain recorded: initial missing routes; a fixture's disabled
sharing precondition; an incorrect assumption about a session revoked_at column
(actual revocation deletes sessions); and browser selector issues. The last
browser failure exposed a real unstable select name, corrected with an explicit
accessible label. No assertion or authorization rule was weakened.

LSP reported no errors for the new backend and UI files when fresh diagnostics
were available. Full-root TypeScript is not claimed for this increment: its
latest recorded failure belongs to the concurrent updater API/test migration.
Subsequent `bash_201` full-root TypeScript exited 0 after the updater's concurrent
type migration settled; the earlier failure remains historical evidence.
PostgreSQL recovery-route execution remains for the final cross-runtime gate;
the native recovery result is not labeled scale acceptance.
