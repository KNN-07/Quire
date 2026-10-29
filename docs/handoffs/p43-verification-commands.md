# P43 functional verification commands

October 28, 2026. FINAL scoped command implementation.

The shipped `verify:matrix` and `ops:restore-drill` commands no longer exit with
P0 placeholders. Matrix verification reads the three discovery inventories and
the feature matrix, checks missing/unexpected/duplicate IDs and dispositions,
and reports declared coverage with `behavioralAcceptance: false`.
Registered Q/T scenarios are not miscounted as product capabilities.

The actual command reports 164/164 entries: 86 core, 55 services and 23 design;
no missing, unexpected, duplicate or undispositioned capability rows. The
declared coverage remains 62 MOUNT, 10 UI, 32 BE, 17 EXT, 35 PART, zero GAP and
8 BOUND. This is mapping completeness, not proof that every feature is accepted.

The restore command dispatches the existing local SQLite/blob/Git drill against
owned temporary fixtures. It restores durable table contents, immutable blob
bytes and hidden/unreachable Git objects, not a live installation. The existing
scale alias dispatches the existing configured scale test command; scale was not
rerun or newly accepted by this work. Unknown commands return exit 2 with usage.

`docs/evidence/p43-verification-commands/scenario-scope-fixed.log` retains
pre-run source hashes, whole-tree typecheck/typed lint exit 0, four unit cases
with eight assertions, the actual matrix command exit 0, and the actual restore
command exit 0 (one selected case, ten assertions, 44.19 seconds).
Monitor `mon_EBG7M3SPGG39RHX8` / `bash_417` completed exit 0. The first log
retains the new parser's initial Q-scenario classification failure; it was
corrected without changing any capability record or hiding a coverage gap.

The exact restore root `/tmp/quire-p2o-backup-mhEisW` was independently checked
absent. No live data was restored or deleted. README explains command scope.
The application bundles are unaffected by this standalone verification entrypoint;
current application build provenance remains in P41.
