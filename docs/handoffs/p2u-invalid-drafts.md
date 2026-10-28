# Invalid draft persistence - VERIFIED

Parent follow-up, October 27, 2026. Existing selected main files can now retain
temporarily invalid LaTeX, survive reload, become immutable snapshots and pass
through Git tree materialization. Real TeX reports their syntax errors.

Before this change, removing one character from `\documentclass` caused source
commit/checkpoint to throw `INVALID_MAIN`; the native build also rejected that
syntax before generating compiler diagnostics. `bash_121` captured both failing
regressions, exit 1.

The correction keeps editable/unlinked `.tex` main-file checks, and retains
document-class checks during project creation and explicit main selection.
It removes syntax validation from ordinary existing-source persistence and
Git hydration. The native compiler receives the actual draft instead of a
preflight syntax rejection. No permissions, source limits, epochs, version
checks or sandbox boundary were relaxed.

`bash_122` exited 0: 11 tests passed across core source, composed publication
and the actual compiler error case, followed by touched-file type-aware lint.
Evidence includes restart/readback equality, a real hidden Git checkpoint and
tree, Unicode/conflict guards, atomic publication recovery and a genuine
undefined-control-sequence diagnostic linked to main-file line 1.

Changed implementation: `services/core/base/source.ts`,
`services/core/git/trees.ts`, `workers/compiler/build.ts`.
Regressions: `tests/core/base/source.test.ts`,
`tests/compiler/invalid-source.test.ts`.
