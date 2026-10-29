# FINAL: P61 AI reviewed commit preference

Date: 2026-10-28.

Implemented the remaining `compileBeforeCommit` bypass in reviewed AI accept and undo decisions with explicit `commit: true`.

## Modified paths

- `services/adapters/ai/decisions.ts`
- `tests/adapters/ai/harness.ts`
- `tests/adapters/ai/compile-preference.test.ts`
- `docs/evidence/p61-ai-commit-preference/`
- This report.

No UI, shared contracts, core code, or existing test assertions were changed. No Git commit was created.

## Mechanism

The decision checks its idempotent receipt before sampling the saved user preference. Only explicit accept/undo commits with the saved preference enabled enter the compile gate. Reject decisions, ordinary source acceptance without a commit, and saved-false commits retain their existing behavior.

The first serialized pass prepares the candidate tree without publishing the decision or target source/branch. It retains only the tree, original branch revision/head, and compile settings. Both original and target branch leases are released before calling the existing real `compileStaged` gate.

After successful compilation, a second serialized pass checks for a completed replay, current AI authority, source write authority, AI version, original branch revision/head, and settings. It reapplies the proposal and prepares a fresh source intent rather than reusing the first intent: private compiler workspace hydration advances the project version. The freshly prepared tree must match both the admitted tree and the successful compiler snapshot. The compiler job's recorded settings and the current project settings must also match admission.

Existing AI journal publication and recovery remain the publication mechanism. Compiler failure never stages an AI decision journal or receipt, publishes the target branch, or applies the candidate source.

## Verification

All final checks exited 0.

```sh
node_modules/.bin/bun test \
  tests/adapters/ai/compile-preference.test.ts \
  tests/adapters/ai/review.test.ts \
  tests/adapters/ai/conflicts.test.ts \
  tests/adapters/ai/recovery.test.ts
```

Result: 21 passed, 0 failed, 127 assertions, 88.94 seconds. Raw output: `docs/evidence/p61-ai-commit-preference/verified.log`.

```sh
node_modules/.bin/tsc --noEmit -p tests/adapters/ai/tsconfig.json
node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/adapters/ai/decisions.ts \
  tests/adapters/ai/harness.ts \
  tests/adapters/ai/compile-preference.test.ts
```

Both exited 0 without diagnostic output. Raw output files are `types.log` and `lint.log` in the same evidence directory. The language server returned clean diagnostics for the test and harness; freshness timed out for `decisions.ts`, so the completed scoped TypeScript check is the authoritative type evidence.

The new tests use the real registered compiler worker and native confined TeX compilation, not fabricated compiler outcomes. Coverage includes:

- Successful and failing reviewed accept commits, on the original branch and a new AI branch.
- Exact successful compiler tree equality with the named Git commit tree.
- Original branch/source isolation and absent target workspace on failed new-branch compilation.
- Successful and failing undo commits.
- Replay after preference changes, with exactly one real compile job.
- Saved-false commits and saved-true noncommit acceptance without a compiler service.
- Source, settings, AI authority, and AI version changes after enqueue admission, with real compilation still completing successfully.
- Acquisition of both branch leases and an original serialized source write while the gate is in progress.

The compiler gate subscribes before enqueue and retains its existing bounded event-driven timeout. Tests use the enqueue boundary for deterministic concurrent changes; no sleeps or polling delays were added.

### Concrete run evidence

Successful original-branch acceptance compiled tree `sha1:2ba682ab68f27cdfd5e8949ea6238b454f55afb8` in job `1e194956-5238-4a4e-b3c5-4e1e3ec419de`, and advanced the head from `53dc2e29e8db8d48e9c6499bc7e4cbe574986a7d` to `bc33b008cf645139f902b99749d02a894b424a4f`.

Successful new-branch acceptance compiled the same candidate tree in job `b81371c7-e243-4570-8bcd-dcd232fadc34`, while the original head remained `53dc2e29e8db8d48e9c6499bc7e4cbe574986a7d`.

Failed new-branch compilation used job `a4c4dae6-47f0-4b67-be18-b258f2ba7f32`, tree `sha1:2d98411110514341d50edebf0dcf3a48afd7a195`, and left the original head/source and AI proposal pending.

### Development run history

Earlier unsuccessful runs are retained rather than hidden:

- `focused.log`: PATH resolved Bun 1.3.14; three success scenarios failed because the blank fixture had no printable pages.
- `compiler-diagnosis.log`: pinned Bun 1.4.4 confirmed the actual latexmk error, `No pages of output`, and inability to produce a PDF. Fixtures were corrected to contain printable content.
- `focused-final.log`: an intermediate fixture edit omitted `async` on two callbacks. This was corrected before the final passing run.

These were development fixture errors, not pre-existing repository failures. The final run uses the repository-pinned Bun 1.4.4.

## Cleanup and boundaries

Fixtures stop their real compiler workers, close ephemeral HTTP servers and runtimes, and delete their exact temporary roots through async disposal. `cleanup.log` verifies all 12 roots explicitly recorded in the run logs are absent. `units.log` verifies all 14 explicitly recorded compiler units are inactive. Both cleanup commands exited 0. Owned monitor processes were stopped individually; no global process cleanup was used.

Only ephemeral fixture servers were used. There was no interaction with port 5173, no browser work, no external message, and no Git commit. Other shared-workspace changes were left untouched.

Assumptions follow existing contracts: the saved preference is sampled at admission, not replay; source and AI publication continue to use the existing journal and finalization invariants; private compile workspace retention is unchanged and confined to the fixture-owned data root during tests.

Global checks and browser evidence are intentionally the parent session's independent review work, not claimed here.
