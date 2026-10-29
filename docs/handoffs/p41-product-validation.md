# P41 current integrated production validation

October 28, 2026. FINAL scoped current-tree static/build receipt, refreshed after
the required onboarding presentation correction.

## Current final receipt

`docs/evidence/p41-product-validation/final-onboarding.log` records the two
changed presentation hashes before execution, then explicit
`P41_FINAL_TYPECHECK_EXIT=0`, `P41_FINAL_LINT_EXIT=0` and
`P41_FINAL_BUILD_EXIT=0`. Monitor `mon_FYXQCVWTBF6TR36P`, session `bash_414`,
completed exit 0. The dialog hash is
`305ae5ee669c2c4475e96dd3268ba3b0ce8f42f9ed56214a6ce012c5bd3ad02a`;
the starting-point hash is
`7d7e211c92cbdb65024eabaf55b985c8cdb28f08cb5b7b98afd4c8f758e1ec67`.

All production entrypoints rebuilt. Vite completed in 5.90 seconds; the main
JavaScript is 1,980.50 kB (589.98 kB gzip). The same unsuppressed chunk-size
warning remains. No functional suites were replayed for the two presentation
lines; their focused 1-case/21-assertion browser regression is in P34.

## Earlier integrated receipt

Subsequent scoped refreshes: P43's standalone verification-command changes
passed whole-tree typecheck and typed lint; they are not application bundle
inputs. P44's mobile-only status CSS change passed its scoped type/lint/browser
checks and rebuilt the web artifact with `P44_WEB_BUILD_EXIT=0`. Server,
repository, compiler and installation entrypoint inputs were unchanged.
Those later receipts, rather than an invented whole-suite replay, establish
the current respective validation scopes.

From the repository root, with the project-local Bun/tools on PATH:

```sh
bun run typecheck
bun run lint
bun run build
```

The actual command used sequential `&&` gates and `pipefail`.
`docs/evidence/p41-product-validation/validation.log` retains explicit
`P41_TYPECHECK_EXIT=0`, `P41_LINT_EXIT=0` and `P41_BUILD_EXIT=0`.
Monitor `mon_QPFZ8PF4W9SE5Y0J`, session `bash_411`, completed exit 0.
Fresh LSP checks on the last corrected source editor and ZIP result consumer
reported no diagnostics before this run.

The build regenerated local Python/spelling assets, the Vite web application,
API server, repository service, compiler worker, installation controller/role,
and SSH entrypoint. Vite transformed 434 modules in 5.32 seconds. Its existing
large-chunk warning remains unsuppressed: the main JavaScript is 1,980.41 kB
(589.94 kB gzip). This is a build warning, not a lint/type failure.

This supersedes P25's stale global build for the current integrated tree.
Scoped functional/native/browser receipts remain separate and were not
blanket-replayed. No commit, deployment, literal-port-5173 acceptance or final
whole-product verdict follows from a green build. Any subsequent source change
must invalidate only the affected validation claims and receive its required
checks.
