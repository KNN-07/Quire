# Core-functionality checkpoint

The user requested a completion number, verified main workflows, commit/push,
and then a stop without more feature work.

## Completion number

**74% conservatively: 64 of 86 core inventory entries have implementation
evidence.** The exact current breakdown is 30 MOUNT, 8 UI, 26 BE, 5 PART,
10 EXT and 7 BOUND. UI/backend evidence is not automatically full composed
browser acceptance. External-service and explicit-boundary entries are not
silently counted as complete. This is the authoring/project/compiler core
inventory, not the 164-entry whole-product mapping or the task ledger.

## Main workflows checked now

`tests/ui-editor/acceptance/native-editor.browser.test.ts` passes both native
browser scenarios, covering blank/template creation, ZIP import/source export,
persistent source, independent collaborator editing, real valid PDF compilation,
invalid-source diagnostics/last-good PDF, project search, bibliography/settings
entry, comments, history restore, Git workspace, Viewer read-only source and
an actual forbidden Git write returning HTTP 403.

The former immediate count of a Viewer notice raced with Git refreshes.
The test now observes the rendered notice, checks disabled branch creation,
and verifies actual HTTP denial. Its screenshot and effective-access response
confirm Alex is a Viewer with edit/compile/review false. Existing role
enforcement was not weakened to satisfy a text assertion.

The complete AI suite passes **119 tests, 0 failures** after the two P72
search fixes and the terminal citation-status correction. Inline bibliography
completion retains its 21-test native result and final independent visual
acceptance. Scoped diagnostics, root TypeScript, deny-warning lint, capability
mapping and all production builds pass. Vite still reports its existing
large-chunk warning.

Final local evidence: `docs/evidence/p73-core-checkpoint/`.
`validation.log` retains the initial scoped acceptance-type failure as well
as passing root checks; `acceptance-types-corrected.log` is its successful
targeted correction. `core-passing.log` is the final 2/2 browser run.
Before/after manifests have 1,712 records; only the acceptance test and its
type configuration changed during validation. Application/service/build inputs
were unchanged. Historical failures remain retained rather than relabeled.

## Checkpoint boundary and stop

Original HTML and research.zip remain unchanged. Generated evidence/assets
remain locally retained under existing ignore rules. The unrelated empty
untracked file `1` remains untouched and excluded.

Owned browser fixtures close their browsers/services and remove temporary
roots. The earlier orphaned P72 web process/root was separately cleaned up.
FastShort on port 5173 was not stopped: exact-origin acceptance remains open,
and these native checks used isolated loopback ports.

This is a verified development checkpoint, not a claim that all remaining
enterprise, institutional, accessibility, billing and live-integration scope
is complete. Further feature work stops at the user's request after push.
