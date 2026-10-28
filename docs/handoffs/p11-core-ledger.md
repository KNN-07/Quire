# Core project workflow reconciliation

Status: FINAL for the core implementation task, not whole-product acceptance.

The parent reconciled the broad "Implement persistent projects files
collaboration and Git" task against retained, disjoint evidence. No passing
suite was repeated to update the task ledger.

- `p1-core-base.md` documents durable source publication, file operations,
  import/export, snapshots and transactional replay receipts.
- `p1s-verification.md` independently accepts portable storage: 400 native
  tests and three real PostgreSQL/S3/Redis/repository integration cases. Its
  actual process-kill, lease-takeover and restart proofs supersede the original
  native-baseline crash-window reservation in `p1-acceptance.md`.
- `p2u-transport.md` establishes real multi-session source convergence,
  acknowledged saves, restart persistence, lost-ack replay and Viewer wire
  denial. Its historical five-minute default is superseded by the validated
  ten-minute configuration and boundary evidence in `p10-offline.md`.
- `p2u-git.md` establishes actual branch ancestry, staged commits, structured
  conflict resolution, CLI transport and mounted Git UI behavior. Its backend
  run passed 38 cases/182 assertions and its four browser cases passed.
- `p4-git-status-read.md` supplies the later unchanged-source status correction:
  36 cases/165 assertions, types and lint, without advancing project authority
  merely to read Git status.
- `p11-editor-acceptance.md` supplies recovered mounted project persistence,
  independent collaboration, actual valid/invalid compilation, diagnostics,
  search, review/history and Viewer checks. Creation/import/export retain
  their separate original evidence rather than being counted again.
- `p10-native-verification.md` independently accepts the later combined
  citation/media/offline source-preservation boundary; its separate generated
  figure finding does not invalidate the core persistence result.

This closes that implementation task only. External-provider availability,
all-role installed execution, the generated-output figure gap, final global
checks and owned-resource cleanup remain separately tracked. Historical
evidence retains its original runtime and input revision; it is not relabeled
as a new whole-repository run. The occupied literal `localhost:5173` origin
remains an unresolved final acceptance constraint.
