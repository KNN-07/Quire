# P31 source tracking independent verification

Status: **FINAL - PASS, bounded P31 source tracking; original readonly
history finding closed after P39 correction**.
Refresh date: October 28, 2026. Verifier: `st_01a1826a`.

## Current verdict after P39

The narrow correction closes the confirmed P2 below. No additional defect was
found in this correction audit. The original FAIL, both failed verifier runs and
their limitations remain unchanged in the historical audit below; they describe
the pre-correction source, not the current implementation.

I read `docs/handoffs/p39-readonly-history.md`, current `source/editor.ts` and
`source/bindings.ts`, the new `readonly-history.test.ts`/HTML fixture, the installed
Yjs native-input handler and Emacs alias registration, and all five retained P39
run logs. The final `docs/evidence/p39-readonly-history/physical-redo.log` contains
pre-run source/test hashes matching the current files, `P39_STATIC_EXIT=0`,
**3 passing browser cases, 29 assertions, 50.86 seconds, `P39_TEST_EXIT=0`**.
Strict TypeScript and typed deny-warning lint results are accepted from that
parent receipt; they were not independently rerun.

The current standard undo/redo commands check the current editor readonly state,
consume the shortcut when readonly, and otherwise call the same bound
UndoManager. A preceding `beforeinput` handler also consumes readonly
`historyUndo`/`historyRedo`, closing the installed y-codemirror native-input
bypass. Vim history adapters check readonly before acting. Emacs undo adapters
and its four registered redo aliases use the guarded Yjs manager, rather than a
separate CodeMirror history. The private/shared binding and proposal/authority
paths are not changed by this correction.

The final cases cut actual server WebSockets as well as browser networking,
observe readonly state, attempt undo, reconnect and successfully undo, disconnect
with redo available, attempt redo, reconnect and successfully redo, and reload
the same retained draft. Default, Vim and Emacs each preserve text while readonly
and preserve server source bytes. The default/Emacs online redo sends
`Control+Shift+Z` and asserts the emitted key is uppercase `Z`; expected draft,
readonly and shared-source comparisons remain intact. Earlier failed runs are
not counted as acceptance: setup initially missed the WebSocket cut, a later
run exposed the native-input bypass and Emacs history split, and subsequent
lowercase shifted-key runs failed online redo before the physical-key correction.

Current editor/bindings/test SHA-256 values match the final passing receipt:

```text
3c3caa0171e392d518993746cc51c6db8f777c39143399f38768104946e52c9d  source/editor.ts
6eda4850b5c4dad4d00c5bcd5c066f88314f18cf95cc331d208c369f957bbc5a  source/bindings.ts
07d124d45504541f51d65a05d1e905ccf77715c22f74b05c722ed5605a8f0e36  readonly-history.test.ts
```

The previously audited SourcePanel, tracking/use-tracking, tools-client,
Diagnostics, Proposals, source CSS, assembly/chrome/shared contracts, and all four
review mutation/anchor/decision implementation hashes still match the original
audit. I therefore reuse its real two-session authority, source-byte,
proposal/reload/transition and individually opened UI evidence, without
replaying the passing suites or reclassifying preview-only UI as source tracking.
The integration TypeScript exception remains resolved by the original parent's
exit-0 receipt.

All three final runtime roots and `readonly-build` were independently checked
absent. The exact owned ports 40703, 36859 and 32923 each refused a fresh
connection. No verifier test run or monitor is pending. Detailed provenance and
raw metadata checks are in
`docs/evidence/p31-source-tracking-verification/p39-refresh-audit.md`.

Residual limits: the new browser cases cover offline readonly in local Chromium,
not separately replayed revocation/conflict/pending states, every native input
origin, macOS/iOS gestures, or every Emacs alias. Those guards were inspected;
individual alias dispatch was not exhaustively exercised. The tests compare
CodeMirror DOM text and unchanged server text, plus retained draft after reload;
they do not add a new byte-exact CRLF recovery proof. Existing original P31
Unicode/CRLF and recovery evidence remains scoped as before. No new layout was
introduced, so original UI captures are reused. This PASS is not a whole-product
build, live deployment, full D10 visual-parity, entire Review/History/Assistant,
cross-device draft-sync, or surviving-character authorship certification.

Only the verification handoff and verifier evidence were edited in this refresh.
All production correction and regression-test edits are parent-owned.

## Original audit - historical FINAL FAIL before P39

Status: **FINAL - FAIL: readonly tracked drafts still accept undo**.
Date: October 28, 2026.
Verifier: `st_01a1826a`. Producer: `st_01a18218`.

This is a bounded implementation/evidence verdict, not a whole-product,
deployment, original-D10 visual-parity or full surviving-character authorship
certification. Real typing isolation and persisted reviewed proposals are
established; this is not acceptance of preview-only UI.

## Prioritized findings

### P2: Undo changes retained draft text while offline editing is explicitly paused

`apps/web/src/features/editor/source/editor.ts:122` installs the unguarded
`yUndoManagerKeymap`. Its installed implementation in
`node_modules/y-codemirror.next/src/y-undomanager.js` calls the Yjs undo manager
without checking `state.readOnly`. Setting the readonly/editable facets at
`editor.ts:80` does not guard that direct Y.Text mutation. The binding then
publishes the changed text through `editor.ts:131` and
`SourcePanel.tsx:83`, overwriting the retained recovery draft.

The new native-backed Chromium probe:

1. Authenticates a real Reviewer and enables tracking in the actual application.
2. Types `% INDEPENDENT_RETAINED_DRAFT` after the original source.
3. Cuts browser networking and closes the owned native WebSockets.
4. Observes the offline surface and `contenteditable="false"`.
5. Presses Ctrl+Z on the readonly source.
6. Observes disappearance of the dirty-draft recovery region and reads the exact
   sessionStorage recovery value: it is now the original source without the edit.

This contradicts the elected "reconnect before editing" behavior and readonly
draft preservation boundary. It is a local draft mutation, not evidence of
unapproved server-source persistence or a server authorization bypass.

Evidence: `docs/evidence/p31-source-tracking-verification/readonly-undo.test.ts`,
`readonly-undo-corrected.log`, and the opened `offline-undo.png`. The initial
probe also observed readonly undo, then failed on CodeMirror DOM `innerText`'s
extra newline; that raw failure is preserved in `readonly-undo-initial.log`.
Only that measurement was corrected.

The corrected run subsequently failed waiting for a redo observation; its later
Reviewer-to-Viewer undo portion was **not reached**. Neither is presented as a
passing check or an independently established second defect. Code inspection
shows the same missing guard can apply to conflict/pending/revoked states because
`use-tracking.ts:22` represents them through the same readonly facets; those undo
variants remain unexecuted. Vim/Emacs history actions in `source/bindings.ts`
also invoke the manager directly; readonly variants were not independently run.

The bounded correction is to gate standard and emulated history actions on the
current editable state while retaining their private history. No source-model,
backend or unrelated feature redesign is required. This verification lane made
no production or repository-test edits.

## Source and authority trace

| Route/boundary | Independent assessment |
| --- | --- |
| Typing, delete, replacement, text paste, composition | `createSourceEditor` binds tracking to a private Y.Doc/Y.Text, with null shared awareness. Its `yCollab` target is not `EditorDocument.source`; normal mode still binds the transport-owned text. |
| Formatting, completion, Find replace, Code Check suppression | Editor transactions target the same active binding. Find uses the actual CodeMirror view. Suppression no longer calls `document.replace`. Representative Find/suppression and normal source controls have native-backed receipts. Every formatting command was traced, not individually replayed. |
| Undo/redo | Normal and Vim/Emacs private-binding receipts exist; readonly undo has the confirmed failure above. |
| Images/external insertion | Image paste rejects before upload preparation; tracking toggle is disabled during an existing upload. Current private handles and disposed normal handles reject external insertion before `insertCommand`'s later direct package edit. Tools receive no active authoring handle while tracking. |
| Project tools mutation | Assembly-owned guarded client checks current tracking at dispatch on `call` and `callWithMetadata`, before non-GET project requests. Captured citation, upload, create, link, metadata and stale-package actions have real-service denials. Mounted Library copy and Files upload show zero project-mutation requests and unchanged source/tree. |
| Visual and selection | Current retained per-file state forces Source before Visual mounts; draft offsets are not published as committed-source selections to Review/Assistant. Existing P27 diagnostic and P30 thread wiring remains present, not newly accepted by this audit. |
| Submit | Explicit action creates one conservative net replacement. `proposalBody` checks unchanged base/epoch and constructs anchors against authoritative Y.Text, not private draft items. Boundaries avoid splitting surrogate pairs. |
| Persisted creation | Existing `suggestionCreate` authenticates the author, checks Track Changes policy, expected branch revision, exact-before quote and actual relative positions/epoch. `ReviewMutations` repeats authorization, policy and session checks under serialization/transaction and stores idempotent receipts. |
| Decisions/application | Existing Review owns acceptance/rejection. `suggestionDecide` checks decision authority; source `applyEdits` checks write authority, epoch, exact-before resolved positions and code-point boundaries before commit. Source tracking does not create a new acceptance path. |
| Transport | `PersistentDocument.replace` checks source write authority; its update observer retains unauthorized edits rather than dispatching them. Core proof additionally attempts and denies a real Reviewer raw-WebSocket source write. |

Explicit authorized Review/history/git actions and another session's source
edits remain authoritative-source transitions, not intercepted draft typing.
P31 conservatively retains/conflicts the private base rather than globally
prohibiting independent authorized changes.

## Original receipts and observable behavior

The producer handoff was already FINAL when read. No creation subscription was
needed for that existing artifact. Both verifier probe monitors have now settled;
no pending run is treated as acceptance.

Original D10 authored source and its screenshot were read/opened. Its tracking
toggle, author markup, review decisions and comment presentation are the design
reference. The P29 contract decision separately forbids attributing original
ownership of surviving characters from recorded applying actors.

The original final command in
`docs/evidence/p31-source-tracking/prewrite-tests.txt` completed with **exit 0,
23 passes, zero failures, 244 assertions**. This verifier read the test bodies,
native fixtures and output rather than replaying unchanged passing workflows.
The code under test matches the current hashes in the final prewrite receipt
and the unchanged-source hash receipt; the independent comparison is retained
in `docs/evidence/p31-source-tracking-verification/audit.md`.

Accepted original browser evidence uses separate real authenticated Reviewer,
Owner and Viewer browser contexts, not two pages sharing one actor. Owner Review
observes Reviewer proposals, denies Reviewer decisions, accepts a replacement
and rejects a deletion. Core proof adds restart persistence, durable idempotent
replay, Viewer/policy denial, stale-revision rejection and raw-WebSocket denial.
These are independent browser sessions in one local Chromium/runtime environment,
not separate machines or a production deployment.

The final mounted source SHA-256 is unchanged before acceptance:
`392c2b10d1f883ac1a73ca0f77efe11c044a71a8e979877ca8df405d8b0f12ab`.
After Owner acceptance and deletion rejection, persisted source matches the
proposed bytes:
`d36330fb3944684ab84dcfc513aa84c53707b46e2002fada84a16129b37db19d`.
Creation DTOs remain honestly marked pending in `workflow.json`; decision
success and final source are established by the executed native-backed assertions,
not by rewriting those DTOs into fabricated decision receipts.

The browser workflow exercises typing/deletion, actual paste, standard undo/redo,
Find replacement, Vietnamese/Chinese/non-BMP text and Chromium Japanese IME.
The standalone workflow exercises actual private binding, default/Vim/Emacs undo,
Code Check suppression, structural/image denials and source equality. The net
replacement cases cover CRLF and surrogate boundaries.

Pause/resume, reload, file and branch navigation, offline disconnection/
reconnection, live Reviewer-to-Viewer revocation/restoration, another session's
source edit and native epoch replacement have original passing transition
receipts. Dirty drafts are retained and conflict instead of silently rebasing.
The real lost-response workflow commits through the native endpoint, aborts only
the reply, reloads and retries the same durable request/key to recover the same
proposal ID. This is not a mocked successful response.

All twelve claimed final desktop/mobile light/dark presentation screenshots,
the two final browser/transition terminal screenshots and original D10 screenshot
were individually opened. They are populated, with real Source controls and no
horizontal page overflow. Desktop shows attributed persisted insertion/deletion;
mobile uses bounded scroll regions and does not show all recovery/proposal text
simultaneously. Mobile bottom status is partially below the captured viewport.
These observations do not claim exact original-D10 inline author-color parity.

## Checks, cleanup and explicit limits

- Original production/integration TypeScript and typed deny-warning lint receipts
  are exit 0. The earlier onboarding TS2322 is resolved by
  `docs/evidence/p31-source-tracking/parent-integration-types.log`, whose current
  onboarding/config hashes match; no outstanding integration exception is
  inherited from the historical failed aggregate.
- The new probe's original and corrected runs both settled with exit 1.
  Their exact failures and the completed offline reproduction are preserved.
  The original probe had clean file diagnostics; fresh diagnostics for its
  corrected version timed out after 3000ms and are not claimed clean.
- Exact producer runtime/build paths were independently checked absent. Both
  verifier roots, `/tmp/quire-assembly-qdiLd6` and
  `/tmp/quire-assembly-8MLhix`, were disposed and independently checked absent.
  Raw output records the owned native/web addresses and fixture closures.
- Recovery is tab-scoped sessionStorage plus memory, not cross-device sync.
  Storage-failure/malformed-recovery handling, readonly pending/conflict undo,
  readonly emulated undo, every formatting/completion variant, and multi-machine
  collaboration were not independently exercised.
- No new whole-product build was run; the parent P25 build is stale and supplies
  no acceptance here. No live deployment, full D10 closure, entire Review/History/
  Assistant acceptance or original surviving-character authorship is claimed.
- Only this handoff and verifier evidence were written. No source fix, commit,
  global feature ledger update, merge, deployment or destructive cleanup occurred.

The bounded implementation therefore remains **FAIL** on the confirmed readonly
undo defect. The original real typing isolation, persisted proposals and server
authority proofs remain valid within the explicit limits above.
