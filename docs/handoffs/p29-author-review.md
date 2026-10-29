# P29 author-aware history and review

Status: **FINAL - bounded recorded-change projection and proposal presentation**.
Date: October 28, 2026. Lane: `st_01a181fa`.

The parent reviewed the scoped static receipt and visual inspection and requested
no additional producer runs. This settled handoff retains the implementation
evidence below and does not certify P31 or reopen unchanged checks.
P31 owns `source/**`, the source toolbar in `chrome.tsx`, source wiring in
`index.tsx`, and source-only additions to `shared/contracts.ts`; this lane
preserves those files. P30 thread coordination and Library follow-ups remain
separate FINAL parent deliveries. Matrix reconciliation remains parent-owned
and follows the dependent audit.

The delayed reopening request was superseded by the parent's explicit
instruction after the error was identified as the already-retained references
Run1 observation, not a new current-tree failure. No diagnostic probe was
started, no schema code was changed, and the newly drafted but unrun diagnostic
test was removed. Existing implementation evidence below remains the authority.

This supersedes this file's initial shared-contract-boundary report. The parent
decision is retained in **`docs/handoffs/p29-history-contract-decision.md`**.
That decision authorizes recorded applying actors, not original line ownership,
and a separate history endpoint without changing `historyCompare` or `GitHunk`.

**D10 remains partial for literal source tracking.** Source typing interception
into reviewed tracked proposals remains active and unaccepted in parent-owned
P31; this lane's read-only previews are not source tracking.

Thread-to-Assistant coordination is separately FINAL under
**`docs/handoffs/p30-review-ai.md`**, the downstream verifier's authority for that
parent implementation. It records one actual browser case with 21 assertions
in 51.58 seconds, scoped strict types/lint exit 0, four inspected desktop/mobile
light/dark captures, consented transmission of the exact two-comment snapshot,
stale-thread dispatch denial, reset consent on reopening, unchanged source, and
owned root/listener cleanup. This closes coordination only, not source tracking.
The existing optional `ReviewPanelProps.onAskThread` callback and
`threads.tsx` action belong to that accepted parent change and must be preserved.
This lane did not edit those files or rerun P30's checks for this pointer update.

The nested Local Library cancellation alert is separately closed by
**`docs/handoffs/p30-library-cancellation.md` FINAL**. That parent receipt, not
the references producer's earlier scoped pass, establishes the own-abort-only
correction: the affected native browser selection passed 61 assertions in
51.71 seconds, scoped types/lint exited 0, all four inspected captures had empty
Library alert arrays, and owned resources were cleaned. This pointer does not
expand P29 author-review scope or claim broad Library acceptance.

## Delivered behavior

### History

- `HistoryChangesSchema` and `GET /api/projects/:p/history/changes` expose
  consecutive immutable file transitions. Each has stable identity, explicit
  from/to version IDs and revisions, file ID/path and old/new paths, recorded
  actor, reason/time, before/after text where editable, and literal granularity
  `recorded-file-transition`.
- The response contains only participating actor IDs and nullable display
  names. No user object, email, membership, invitation, or directory response is
  returned. Missing/deleted account names remain unknown.
- Every intermediate version is authorized for the requested project/branch
  and checked for retention before any comparison bytes are read. The entire
  projection is rejected if any intermediate version is inaccessible, even
  between labeled retained endpoints. Current access and **every** version's
  retention are checked again under the account transaction fence before
  publication. No inaccessible transitions are bridged.
- Mutating revisions determine chronology; recorded history order distinguishes
  same-revision checkpoints. Unchanged checkpoints produce no file transition
  and introduce no fictitious source author. File filtering also narrows the
  participating actors.
- `historyCompare` keeps its existing `{files,hunks,authors:Id[]}` response, and
  `GitHunkSchema` is unchanged. The new route is separately registered by the
  review module. No source-writer changes or migration are needed.
- The actual History panel now shows recorded-actor filters, stable color
  legends, inline struck deletions/underlined insertions with adjacent context,
  file filters, and explicit provenance language. A preview is one exact
  replacement span, not a per-character ownership reconstruction. Unchanged
  interior text within that span is explicitly not separately attributed.
- Versions are on the right at desktop width, with matching DOM order.
  Labels-only filters the timeline without replacing the actual latest
  comparison endpoint. Unknown names are no longer called former collaborators.
  The panel no longer requests owner-only `accessGet` for names.
- Source navigation opens the current file. It reveals an exact line only when
  the loaded current text equals the transition's full after-text. Deleted or
  divergent source is not navigated using invented live historical anchors.
  Binary/noneditable changes are disclosed without false text attribution.
- Endpoint before/after comparison, file-scoped copy, source ZIP download,
  labels, and restore remain available. Restore creates a new immutable version;
  deleted-file recovery preserves unrelated source.

### Review

- Pending proposals display their **persisted suggestion author**, separately
  from history's applying actor. Without a display-name contract, the current
  user is `You` and other authors have distinct explicitly name-unavailable
  labels. No directory query or fabricated personal name is used.
- Author, file/overview, and status filters operate on actual persisted edits.
  File controls show pending counts. Bulk/selected decisions act only on visible
  pending edits; a filtered-out author's work is not silently accepted.
- Exact Yjs relative anchors and quotes drive read-only source-context previews
  and source navigation. Unresolved anchors, deleted files, and already-decided
  proposals are visibly distinct from live overlays.
- Editors/Owners retain individual/bulk decisions. Reviewer/Viewer controls do
  not offer decisions; native authorization remains authoritative. New proposal
  creation also respects the existing tracking benefit.
- Existing stable event-subscription dependencies are retained. This is not a
  new history engine, a source transport, or a thread/Assistant integration.

## Evidence and reproduction

All commands use project-local Bun 1.4.4 (`38afee6c8`). These are separate scoped
selections, not a whole-product suite total.

| Check | Result | Receipt |
| --- | --- | --- |
| `node_modules/.bin/bun test tests/core/review/author-comparison/changes.test.ts` | 4 pass, 0 fail, 32 assertions, exit 0 | `docs/evidence/p29-author-review/native-and-static.log` |
| `node_modules/.bin/bun test tests/core/review/author-comparison/preview.test.ts tests/core/review/compare.test.ts` | 3 pass, 0 fail, 20 assertions, exit 0 | Same receipt |
| `node_modules/.bin/bun test tests/ui-editor/author-review/workflow.test.ts` | Final 1 pass, 0 fail, 44 assertions, exit 0 | `docs/evidence/p29-author-review/browser-runs.log` |
| Strict `tsc --noEmit -p tests/ui-editor/author-review/tsconfig.json` | Exit 0 | `docs/evidence/p29-author-review/final-static.log` |
| Scoped `oxlint --type-aware --deny-warnings` and `git diff --check` | Exit 0 | Same final-static receipt |
| Eight final screenshots, desktop/mobile, light/dark | Opened and inspected | `docs/evidence/p29-author-review/visual-inspection.md` |

Native proof uses actual authenticated users and persisted edits: two applying
actors, stable exact transitions, unchanged checkpoint exclusion, file/branch/
project scope, deleted-name nullability, Viewer reads, Reviewer decision denial,
retention gaps between labeled endpoints, and a real policy change during blob
reading to test the final fence. A separately persisted Reviewer proposal
accepted by an Owner proves proposer and applying actor are not conflated.
The timing seam delegates to the real blob reader; it is not a successful HTTP
response mock.

Final browser packet:
`docs/evidence/p29-author-review/browser-f0fa339e-d134-4caa-b364-b1e5d610867d/`.
The actual assembled application ran on owned loopback origins. Two real
authenticated browser sessions made different source edits. History displayed
both actors, filtered the actual second transition, and navigated back to live
source. Both sessions created exact anchored proposals. After a real owner API
downgrade, the second proposer had Reviewer authority and no decision control.
The Owner filtered that proposal, followed its source anchor, accepted only
that visible author, and reloaded the persisted result. The other proposal
remained pending and source stayed unchanged until acceptance.

The same final run created/deleted a real file, labeled its history, selected
Labels only, downloaded source ZIP, and recovered the file into a different
history ID with a higher revision/epoch and exact bytes. Unrelated accepted
source stayed unchanged. `workflow.json` retains actual DTOs and source bytes;
`errors.json` is empty; `cleanup.json` confirms the owned root is absent.

The final packet contains `history-1440-light/dark.png`,
`history-390-light/dark.png`, `review-1440-light/dark.png`, and
`review-390-light/dark.png`, plus geometry JSON for each. Text labels and
underlining/strikethrough supplement color. No new control is blank or
overlapping. The existing mobile shell's multi-row status footer is partly
below the 900-pixel capture; no whole-shell visual approval is claimed.

## Retained failures and limits

Three browser attempts remain retained, not relabeled as passes: an invalid
extra `fileId` in the fixture's strict Scope, keyboard input before actual
editable source readiness, and missing exact accessible names on the two
filter selects. The first two were fixture corrections; the third was corrected
in the actual UI. The earlier 33-assertion pass remains separate from the final
44-assertion recovery-inclusive pass. An initial typed lint string-spread finding
was corrected. Their exact packets/exits are in `browser-runs.log` and
`native-and-static.log`.

Fresh LSP diagnostics timed out on a later pass; strict project-local TypeScript
and typed warning-denying lint supplied the passing final check. No warnings or
errors were suppressed. Existing tests were not weakened, rewritten, or skipped.

No PostgreSQL, cross-browser, screen-reader, production deployment, whole-suite,
or complete original-screen pixel parity is claimed. Existing source/review/
restore receipts remain intact. This lane does not newly certify complete
project restoration, every comment/reanchor permutation, or original text
authorship. Original character ownership cannot be recovered from the stored
cumulative Yjs states, which identify the applying actor of a recorded commit.
The bounded replacement span is intentional, not a minimal multi-hunk blame
algorithm.

The references lane's historical Run1 error remains unexplained:
`TypeError: Cannot read properties of undefined (reading 'reason')` at
`http://127.0.0.1:42041/@fs/home/norman/Repos/Quire/packages/contracts/src/projects.ts:136:34`.
Its exact receipt is
`docs/evidence/p29-remote-bibliography/a4849da4-97b3-4bb0-947c-b513d4c063ae/cleanup.json`.
That collector did not timestamp the navigation phase or retain the served
module bytes, so this handoff does not infer circular dependency, HMR, cache,
or a specific expression version as its cause. The references lane's
`verification-history.md` records later fresh successful/clean-runtime checks,
and the parent's separate `docs/handoffs/p30-library-cancellation.md` records its
passing follow-up. Those receipts and this lane's passing mounted run stand;
the historical error is neither erased nor relabeled a reproduced current bug.

## Owned files and cleanup

Application changes:

- `packages/contracts/src/projects.ts` and `routes-core.ts`: history-only
  additions; no index edit needed because projects are already re-exported.
- `services/core/review/history-changes.ts` and the registration in `history.ts`.
- `apps/web/src/features/editor/review/history.tsx`, `suggestions.tsx`,
  `change-preview.tsx`, `review.css`, and `DESIGN.md`.

New tests: `tests/core/review/author-comparison/{changes,preview}.test.ts` and
`tests/ui-editor/author-review/{workflow.test.ts,tsconfig.json}`.
Evidence is confined to `docs/evidence/p29-author-review/`; this is the owned
handoff. `final-source-hashes.txt` records final fingerprints. The earlier
`contract-source-hashes.txt` remains pre-implementation evidence.

All owned browser contexts, Chromium instances, API/web listeners, and temporary
application roots were closed through the fixture disposal stack. Final root
`/tmp/quire-assembly-sygw92` is absent. Earlier roots `nXKDg5`, `fkHMpl`,
`sINope`, and `nkNFqU` also have retained cleanup receipts under their packets.
Native fixture roots were removed before their cleanup markers. No monitor or
server remains pending for this lane. No package installation or commit ran.
Unrelated shared-workspace changes, the global matrix, original inputs,
source/core-base writer, editor assembly/shared contracts, Assistant, and
`review/threads.tsx` were not modified by this lane.
