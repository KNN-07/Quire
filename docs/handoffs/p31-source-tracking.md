# P31 source tracking

Status: **FINAL - implemented and verified, including pre-mutation tools guards**.
Date: October 28, 2026.
Lane: `st_01a18218`.

## Delivered behavior

Source now has a real **Track changes** control in embedded and standalone
presentations. Actual typing, replacement, deletion, paste, Unicode composition,
formatting, Find replace and Code Check suppression edit an isolated proposal
draft. They do not update the transport-owned Y.Text before acceptance.

**Submit proposal** is an explicit boundary. Until then the UI says the draft is
local and unsubmitted. Submission uses the existing persisted suggestion endpoint.
Source shows actual persisted proposal authors and insertion/deletion previews;
the existing Review consumer alone provides authorized acceptance and rejection.
The shared-source save status does not claim that local drafts are saved proposals.

Reviewers can propose without gaining direct source-write or decision authority.
Viewer and disabled-policy creation attempts are denied. Images, external
authoring-handle/structural insertion and Visual editing are explicitly unavailable
while tracking. Project insertion tools receive no active authoring handle, so
figure uploads cannot start before a later insertion rejection. The private
handle also rejects external insertion before a caller's direct package edit.
The assembly's guarded tools client rejects project mutation requests before
dispatch, including bibliography copies that do not require an authoring handle.
Code Check suppression now goes through the actual editor transaction rather
than bypassing the binding through `document.replace`.

Drafts survive tracking pause/resume, reload, file and branch navigation, offline
disconnection, authority revocation, remote source edits and epoch replacement.
Recovery identity includes actor/project/branch/file; the retained base also
contains its epoch. A dirty draft whose source or epoch changed is not silently
rebased. Its full text remains available and submission is blocked until explicit
discard and a new draft. Empty drafts follow current source.

A pending submission retains its exact request and idempotency key before the
request is sent. The mounted test loses the response after a genuine native
commit, reloads, retries, and receives the same persisted proposal ID. No
successful API response is mocked.

## Mechanism and settled trade-off

`createSourceEditor` still uses the maintained y-codemirror binding and Yjs undo,
but tracking supplies a private Y.Doc/Y.Text with no shared awareness. Normal
mode keeps the existing transport binding, and its undo manager survives tracking
toggles. Vim and Emacs use the same private history when tracking.

Each explicit submission is one conservative net replacement, with UTF-16
boundaries adjusted to avoid splitting surrogate pairs. Its relative anchor is
created against the unchanged authoritative Y.Text, not against the private
draft's unrelated Yjs items. This deliberately chooses exact-before conflict
detection over automatic rebasing or pretending that broad replacement spans
identify the original authors of interior unchanged text.

Rejected mechanisms:

- Writing typing into shared source and subsequently labeling it a proposal.
- A read-only preview standing in for actual tracked typing.
- Automatic acceptance or a new decision API.
- Granting Reviewer direct-write authority.
- Silently rebasing/discarding local drafts or retrying uncertain submissions
  under new idempotency keys.

Draft selection offsets are not published as committed-source selections to
Review or Assistant. Per-file tracking state gates the visible layout before
Visual can mount, including navigation from an untracked Visual file into a file
whose retained tracking state is on. P27 diagnostic requests and P30 thread
intents remain wired.

Assumptions and visible boundaries:

- Explicit submission, rather than per-keystroke server proposal creation, is the
  elected workflow.
- Browser recovery is tab-scoped sessionStorage plus in-memory retention, not a
  cross-device draft-sync service. Unsubmitted text triggers the unload warning;
  storage failures identify memory-only recovery.
- Offline editing of the tracked draft is paused until reconnection. Existing
  normal-mode offline transport behavior is unchanged.
- Unknown collaborator names are not invented; Source displays the persisted
  author ID when it is not the current authenticated actor.

## External insertion pre-mutation boundary

The follow-up audit found and closed a real gap in the first FINAL:
`LibraryPanel` and `RemoteReferencePanel` call
`createToolsActions.citation`, which creates/copies bibliography source before
its refresh callback invokes `insertCommand`. A late `replaceSelection` rejection
alone cannot protect that copy. File uploads, links and standalone Library
"Copy to project" likewise do not require an authoring handle.

`source/tools-client.ts` now supplies the assembly-owned guard. Only ToolsPanel
receives this client; Source proposal creation and authorized Review decisions
retain the original client. Both `call` and `callWithMetadata` reject non-GET
project requests with `SOURCE_MUTATION_BLOCKED` before delegating to the real
authenticated client. The predicate reads current retained tracking state at
dispatch, including actions captured before a toggle, and blocks a disposed or
changing source context. It does not downgrade workspace effective access or
change EditorDocument authority. Reads and independent personal-Library
management remain available.

Previously captured normal source handles also reject after editor replacement,
and recheck current tracking before insertion. This stops `insertCommand` before
its subsequent direct `document.replace` package edit. Source image paste is
blocked before `prepareImagePaste`; enabling tracking is disabled during an
already-running source image upload.

No tools-lane edit was required. The existing `tools/actions.ts`,
`tools/insertion.ts`, Library, remote-reference, file and figure consumers were
read and exercised, not modified.

The real-service proof covers captured citation, upload, file-create, linked-file
and metadata-mutation actions, plus a stale normal handle attempting a missing
package insertion. Every project HTTP mutation is denied before dispatch; the
stale package path throws before its direct edit. The owner's real document
remains `readOnly: false`, demonstrating that this is a separate mode guard.
Mounted Library copy and Files upload also show an error with **zero project
mutation requests**, identical main/bibliography bytes and an unchanged file tree.
No successful-response API mocks are used.

## Existing backend contract: no seam crossed

The existing contract was sufficient, so no backend, review consumer, history
schema, route schema or package dependency was changed by this lane.

- `services/core/review/suggestions.ts`: `suggestionCreate` records the
  authenticated actor, checks TrackChanges policy and branch revision, and
  validates exact-before edits and anchors.
- `services/core/review/threads.ts`: `checkAnchor` validates file epoch, resolves
  Yjs relative positions against the persisted document and compares the quote.
- `services/core/review/mutations.ts`: serialized and transactional authorization,
  policy and session checks are repeated; idempotent creation is durable.
- Existing `suggestionDecide`/`decisions.ts` and source application authority own
  acceptance. The Source producer never writes accepted source itself.

Primary APIs inspected: CodeMirror reference
(`https://codemirror.net/docs/ref/`), Yjs relative positions
(`https://docs.yjs.dev/api/relative-positions`), and the installed primary
`y-codemirror.next/src/{index,y-sync,y-undomanager}.js` implementation.
Preserved D10 source/design and P29 contract decisions were read before editing.

## Verification

All commands used the repository-local Bun 1.4.4/toolchain.

| Check | Result |
| --- | --- |
| New scoped targets plus affected source authoring/controls/multiline/browser targets | **23 pass, 0 fail, 244 assertions**, one complete passing run |
| New source-tracking/core-review cases | **5 pass**, included in the combined run |
| Existing affected source cases | **18 pass**, included in the combined run |
| `tsc --noEmit -p tests/ui-editor/source-tracking/tsconfig.production.json` | **Exit 0**, strict owned production graph |
| Scoped `oxlint --type-aware --deny-warnings` | **Exit 0** |
| Scoped `git diff --check` | **Exit 0** |
| Full integration-test dependency graph TypeScript | **Exit 0**; separate parent confirmation in `parent-integration-types.log` |

The mounted workflow uses real authenticated Reviewer, Owner and Viewer sessions,
the real application/router/CodeMirror, native persistence and existing Review
decisions. It proves typing, delete, paste, undo/redo, Find replace and Chromium
IME Japanese/Chinese/Vietnamese/non-BMP text; unchanged server source before
acceptance; persisted author identity and proposal reload; observer delivery;
denied reviewer decisions; owner acceptance and rejection; persisted accepted
source; owner structural insertion disabled; pre-dispatch Library copy and upload
rejection; and Visual-to-tracked-file isolation.

The transition workflow proves actual file/branch changes, an offline network
cut including owned native WebSockets, reconnection, Reviewer-to-Viewer revocation
and restoration, another session's source edit, a genuine native epoch
replacement, and explicit keep/discard recovery. No sleep-based synchronization
is used. Native tests additionally prove restart persistence, idempotent replay,
reviewer raw-WebSocket write denial, Viewer and policy denial, stale revisions,
and code-point-safe exact proposal bytes.

Normal-source regressions cover real collaborative convergence and remote edits
through local undo, Vim/Emacs, source persistence, CRLF/Unicode, preferences,
Find/math/Code Check and genuine compiler diagnostic navigation.

### Historical integration typecheck diagnostic

An earlier integration check reported:

```text
services/accounts/identity/onboarding.ts(44,34): error TS2322:
Type 'unknown' is not assignable to the typed onboarding choices object.
```

That unrelated onboarding diagnostic is no longer reported in the final full
integration check, which exits 0. This lane did not edit onboarding, weaken
compiler options or suppress the error. The earlier diagnostic/nonzero receipt
remains in `final-validation.txt` as history; `prewrite-checks.txt` is the current
clean production/integration TypeScript and typed-lint receipt.

The parent separately reran only the previously failed integration TypeScript
check. `parent-integration-types.log` records the onboarding implementation and
integration-config SHA-256 hashes and `P31_INTEGRATION_TSC_EXIT=0`. The parent
reports `mon_TFACHX6K7Q8NH8CQ` / `bash_397` completed with exit 0. This separate
receipt supersedes the earlier integration exception without replacing the
producer's implementation/workflow evidence. No tracking tests were replayed
for that parent check or this handoff reconciliation. The producer is concluded;
the dependent verifier can audit the implementation against both sets of receipts.

## Evidence and captures

All paths below are under `docs/evidence/p31-source-tracking/`.

- `prewrite-tests.txt`: complete final combined run, raw exit and 244 assertions.
- `prewrite-checks.txt`: current clean production/integration TypeScript and
  typed deny-warning lint exits.
- `parent-integration-types.log`: independent parent integration-only rerun,
  relevant source/config hashes and exit 0; no tracking-workflow replay.
- `prewrite-hashes-cleanup.txt`: final changed source/test hashes, diff check and
  exact owned runtime/build absence checks.
- `source-hashes.txt`: initial source hashes, including inspected unchanged
  review mutation/anchor/decision implementations.
- `scoped-tests.txt`, `normal-source-tests.txt`, `final-validation.txt` and
  `owned-cleanup.txt`: retained earlier verification receipts.
- `browser-5456fa1d-a49b-4348-883b-30fe545db02e/`: real collaboration receipts,
  source hashes, zero page errors, cleanup, and `draft-*`/`submitted-*` captures
  at **1440 and 390**, each **light and dark**. `prewrite-guard.json` records the
  empty mounted project-mutation request list and actual file/source evidence.
- `transitions-52e33c2c-721a-43eb-b01a-9dd7b584741e/`: actual retained draft,
  new-epoch server text, empty unintended-proposal list and cleanup.
- `standalone-bebc986a-6adc-4fd9-ab93-d3d2f12b9ad2/`: styled real standalone
  controls at **1440/390 light/dark**, explicit cleanup, and
  `prewrite-guard.json` with native helper denials, unchanged source/tree
  assertions, zero mutation requests and the unchanged owner write-authority flag.

Desktop/mobile captures were visually inspected for the actual tracking control,
private editor, author-attributed deletion/insertion presentation, blank output,
overlap and horizontal overflow. The proposal/recovery regions have their own
bounded scroll areas. Early failed/unstyled/covered captures are retained as
diagnostic history, not accepted visual evidence; the directories above identify
the accepted runs.

The mounted source hash remained
`392c2b10d1f883ac1a73ca0f77efe11c044a71a8e979877ca8df405d8b0f12ab`
until authorized acceptance. Accepted and final persisted source hashes both are
`d36330fb3944684ab84dcfc513aa84c53707b46e2002fada84a16129b37db19d`.
The workflow's suggestion/deletion DTOs are their actual creation receipts;
later acceptance/rejection is exercised through Review and verified against
persisted source, not fabricated by rewriting those receipts.

## Ownership and cleanup

Changed application paths are confined to `source/**`, source-specific chrome and
assembly wiring, and two Source contract additions (`readOnly` tools state and
the tracking-change callback). New tests are confined to the assigned
`tests/ui-editor/source-tracking/**` and `tests/core/review/source-tracking/**`.
Documentation/evidence is confined to the assigned handoff/evidence paths and the
Source README.

The final browser/core roots
`/tmp/quire-assembly-V5SFL1`, `/tmp/quire-assembly-u1V2Xh`,
`/tmp/quire-p1s-review-gcU5Fl` and `/tmp/quire-ui-editor-FiZBFv`
are absent. The standalone `tests/ui-editor/source-tracking/build` output is
removed. Owned browser contexts, browsers, native listeners, Vite subprocesses
and application runtimes were closed through their fixtures' awaited disposal.
All test/check command subscriptions have completed; no persistent watcher or
server was left running.

Existing affected source tests emitted their established ignored
`tests/ui-editor/source/evidence` artifacts. Those shared fixture artifacts were
not removed or reverted. Other lanes' edits, originals, the global feature matrix,
dependencies, P29 review/history work and P27/P30 wiring were preserved. No commit,
deployment, merge or destructive cleanup was performed.
