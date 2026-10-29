# FINAL P71 independent inline-reference verification

October 29, 2026. Verifier: `st_01a18612`.
Checkpoint: `7d51bfeaf2e8e1d74a66c9c008aed0c9bbabcebc`.
Repository: `/home/norman/Repos/Quire`; local Bun **1.4.4**.

**Overall: FAIL for completed P71 acceptance.** The bounded authenticated
lookup, privacy, provenance and copy/insertion mechanisms have supporting
source and retained native evidence. The new integrated command fails lint,
and independent visual QA identifies changed-region defects and missing
acceptance evidence. Passing fixture behavior does not override either gate.
The parent owns corrections and affected reruns; this report does not certify
any subsequent parent revision.

## Admission, original contract and evidence

Read both FINAL producer handoffs in full:
`p71-reference-lifecycle.md` and `p71-inline-references.md`.
Neither is treated as proof merely because its producer stopped.
Read both independent reports, `p71-visual-qa-a.md` and
`p71-visual-qa-b.md`, including their supplements and per-item verdicts.

Original obligations were checked against `docs/discovery/design.md:168`
(D06), the original `docs/evidence/design/06-editor-tools.png`, and
`docs/discovery/services.md:57` (I45a), together with the separately elected
inline-remote remainder at `p60-remaining-goal.md:209-221`.
D06 requires citation-context completion, remote search and keyboard guidance.
I45a requires enabled autocomplete and zero/sole/explicit-multiple editable
bibliography destinations; provider fields, entitlement and final citation
formatting are separate contracts.

Inspected the actual mounted path through SourcePanel, editor preferences,
remote-completion, InlineReferences, project-index and reference-receipt;
authenticated search/retrieval and catalog citation write paths; the native
workflow, boundaries, privacy and keyboard/session tests; and the backend
lifecycle tests and held HTTP provider. No product or test file was edited.

Retained evidence used below:

- **N:** `docs/evidence/p71-parent-privacy/final-native.log`: actual raw
  output with completed exit **0**, **18 pass / 0 fail / 107 assertions**,
  99.69 seconds. All seven native scenarios plus eleven focused regressions.
  The log was absent in an initial lookup but became readable before the
  audit ended; the final verdict uses the actual complete log.
- **L:** `docs/evidence/p71-reference-lifecycle/results.md`: retained red
  reproduction (1 pass / 4 fail), corrected lifecycle exit **0**
  (8 pass / 21 assertions), existing retrieval exit **0**
  (4 pass / 22 assertions), scoped compiler/lint results and cleanup.
  Earlier failures remain failures in the historical record.
- **A:** `docs/evidence/p71-inline-references/01de63e9-bbad-474c-a443-de152e37c448/`:
  acceptance.json, four populated captures and geometry records.
- **C:** `docs/evidence/p71-parent-privacy/captures.json`: exact seven
  native directories and the before/current/reference capture paths.
- **V:** the two independent visual QA handoffs above. Both return FAIL
  for comprehensive acceptance; neither rejects the bounded passing suite.

No unchanged native/backend test suite was rerun. No fresh UI was launched:
the missing visual proofs are recorded as gaps for the parent-owned follow-up,
not silently inferred from source.

## Fresh command results and input freeze

Full output, exact shell command, before/after SHA-256 records and the
recorder's exit receipt are retained in:

`docs/evidence/p71-inline-verification/integrated.typescript`

The accompanying `results.md` explains the command and boundary comparison.
Session `bash_2` finished with exit **1**. The requested chain was:

```sh
./node_modules/.bin/bun run typecheck &&
./node_modules/.bin/bun run lint &&
./node_modules/.bin/bun run verify:matrix &&
./node_modules/.bin/bun run build
```

| Check | Exit | Verdict |
| --- | ---: | --- |
| Repository-local Bun version | 0 | PASS: 1.4.4 |
| Root typecheck | 0 | PASS: progressed to lint with no diagnostics |
| Root type-aware deny-warning lint | 1 | FAIL: exact diagnostic below |
| verify:matrix | Not run | FAIL acceptance proof: short-circuited by lint |
| build | Not run | FAIL acceptance proof: short-circuited by lint |
| Complete integrated chain | 1 | FAIL |
| `./node_modules/.bin/tsc --noEmit --project tests/ui-editor/inline-references/tsconfig.json` | 0 | PASS: no diagnostics |

```text
apps/web/src/features/editor/source/InlineReferences.tsx:82:5: error typescript(consistent-return): Function expected no return value.
error: script "lint" exited with code 1
INTEGRATED_EXIT=1
SCOPED_TSC_EXIT=0
VERIFICATION_FINISHED integrated=1 scoped=0
```

This is the new P71 focus-effect cleanup return, not the old P70 baseline.
The parent must fix the effect's return contract without suppressing lint,
then own the affected integration rerun. Matrix/build have no new successful
exit to report. The explicit scoped tsc replaces the unavailable final-input
LSP proof, not lint or build.

The run began `2026-10-29 12:12:53+07:00` and ended
`2026-10-29 12:14:24+07:00`. All **1,655 selected input records** match
before/after. The selection is the recorded tracked/untracked nonignored
apps/services/packages/tests/scripts files, package.json, bun.lock,
tsconfig.json, and the two original inputs; it is not a whole-filesystem
freeze. The normalized record block's SHA-256 is identical on both sides:

```text
95185586314d0f5f9d830ab97a178a83b58ab05aa5428d55255f94af11d9a76d
```

All **19/19** producer `final-source.sha256` entries match the verifier's
before-run boundary. This establishes identity with that post-run snapshot,
not a retroactive producer pre-test manifest. Representative frozen records:

```text
6672b420c4aa5618e9aa9ca48029ea18c5fc4a7142e0006611ac34a047ee7b79  apps/web/src/features/editor/source/InlineReferences.tsx
9c61595b940ecd8293474c4ecbb9a57e7986783354ef55cec9d510b040e78e9b  apps/web/src/features/editor/source/remote-completion.ts
dfbd6010db300ef2409cf18ecadb5b04de3b12f95128775ff1e28440017542a0  apps/web/src/features/editor/source/source.css
da9daaafd1c86d72c666374ecb616064f1149b3421ddb5cb9ed44992a88b0cb1  services/adapters/references/index.ts
8f0054d6f7bce92feb2160cb5029a6333ae0b3b3cc0603d2827bf076b971e9dd  services/adapters/references/retrieval.ts
3c142cd472c611f01305926389edf2a820d982e3463a63c58158522b00da625a  Quire — LaTeX Editor.html
fe5fc30d34a363e05616f633feab19b643399be7acd7f7229c3fcd991506be63  research.zip
```

The parent received exact completion and input-freeze status before taking
source ownership back. No verification command remains reading product inputs.
Later fixes invalidate this snapshot's affected checks and captures.

## Required-behavior verdicts

PASS means the stated bounded behavior is supported, not universal vendor,
device, syntax or whole-product acceptance.

| Required behavior | Verdict | Evidence and exact boundary |
| --- | --- | --- |
| Actual async completion in the mounted Source editor | PASS | SourcePanel supplies the remote source to real CodeMirror autocompletion; N and A show typing produces actual HTTP-returned candidates, not a static replacement UI. |
| Deliberate provider enablement, default Off | PASS | InlineReferences initializes empty provider; remote source returns before dispatch without it. Native setup explicitly selects Crossref; controls disclose typed-query transfer. Off withdrawal while blocked remains a usability defect below. |
| Saved autocomplete-off and Viewer gates | PASS | N gates case plus `cb60ffc4-e2c3-4829-8a95-3f94c3f84a0b/gates.json` retain saved false, disabled controls and no provider requests. Viewer citation POST is actually denied 403 in boundaries.json. Direct authenticated read-authorized search is not claimed forbidden for every Viewer. |
| Tracking, readOnly, offline/recovery and unresolved destinations block automatic lookup | PASS, source-backed | Hook derives blocking from document persistence, edit capability, readOnly, tracking and destination state; SourcePanel subscribes to the snapshot. Native evidence does not exercise every dynamic transition. |
| No document disclosure beyond the active query | PASS, bounded syntax | Only project/provider/query/limit are sent; provider URLs in A contain dest0/dest1/dest2, not source. N privacy regressions reject supported comments, literal regions, escaped commands and masked argument content. Lexical handling is not a general TeX macro interpreter. |
| Backend request cancellation and provider deadline | PASS | Request.signal reaches retrieval; caller signal and 30-second deadline compose. L proves actual provider socket disconnect and EGRESS_TIMEOUT/no provenance, including successful transport output released after abort. Subscriptions precede triggers; no fixed sleep. |
| Stale provider/configuration, membership, actor and Mendeley grant handling | PASS | L retains actual authority-change rejection and no provenance; retrieval repeats checks using the transaction executor around retention. Existing endpoint/error contracts remain. |
| Truthful unavailable providers | PASS for truthfulness | Native Semantic Scholar path returns 503/PROVIDER_UNCONFIGURED with no fabricated candidates. ReadCube/Dimensions are visibly unavailable; route rejects unsupported contracts. Reader-facing error guidance fails separately. No live vendor availability is certified. |
| Actual metadata, citation key and provenance | PASS | A matches visible Research dest0, Grace Hopper/Ada Lovelace, 2026, crossref and crossref_6946c927154ce523. Key comes from returned BibTeX. N asserts retained provenance counts; L verifies actual response provenance. |
| Zero editable bibliography destinations | PASS | A/N creates editable unlinked references.bib only on acceptance; before acceptance no .bib exists. Exact returned BibTeX plus newline is read back. |
| One editable bibliography destination | PASS | A/N copies into target0.bib and reads exact bytes; no replacement target invented. |
| Multiple editable bibliography destinations | PASS | Initial choice is empty, hook blocks until selection, N explicitly selects target1.bib, and A records its committed result. No arbitrary first-file choice in the inline flow. |
| Linked-file and occupied-path safety | PASS, mixed evidence | UI/catalog exclude linked/noneditable copy targets; project-index reads their keys through fileContent rather than editable-document API. N proves occupied references.bib protection and Viewer denial. Existing P10 linked-byte/readable-key acceptance remains prior baseline, not a newly rerun P71 linked-file native scenario. |
| No copy before acceptance; Escape closes | PASS | N asserts no bibliography entry/file before acceptance and none after Escape; cancellation.json retains escapeNoCopy/providerStaleDiscarded. |
| Exact observed selection and stale insertion handling | PASS | Generation/document/scope/provider/target/session/caret fences surround copy. N holds an already committed copy response, moves caret, then verifies no inserted key and exact retained bibliography bytes; stale-copy.json and reload disclosure agree. |
| Current write authority and revision on acceptance | PASS, bounded | Acceptance flushes source, refetches access/revision, checks freshness, and calls the server-authorized/revision-fenced catalog write. Native Viewer denial and L late-lookup authority cases pass. No claim of an exhaustive native every-permission-race matrix. |
| Real persistence and keyboard acceptance | PASS | N/A assert exact source and bibliography bytes via native read APIs and source reopening. Separate real Enter scenario crosses CodeMirror's timestamp guard with setFixedTime, without freezing timer scheduling or sleeping. This is persistence, not successful LaTeX compilation. |
| Durable copy receipt and session isolation | PASS | Single tab-local slot uses opaque session fingerprint, not stored CSRF credential. N verifies same-session navigation receipt and same-actor renewed-session hiding after authority readiness; stale-copy test verifies copied entry remains disclosed. |
| Loading reaches a terminal state on cancellation | FAIL | remote-completion invalidation aborts/increments generation but does not clear searching; abort/stale return bypasses status update. V A H2/H3 identifies a permanent Searching notice. Native cancellation does not assert feedback clearance. |
| Empty/error recovery guidance | FAIL | Empty state offers no next action; catch displays raw failure.message, including operator semanticScholar configuration wording. V A H1 and B C2/C6 require readable next steps without fabricated results. |
| Compact interaction and stable geometry | FAIL | Current 390 uses a completion popover; focus synchronously collapses an in-flow disclosure and moves Source. V A J2/G2 retains these defects. Parent owns presentation/interaction correction and fresh proof. |
| Integrated production readiness | FAIL | New lint failure prevents requested matrix/build execution. Scoped tsc and P70 do not substitute for those missing exits. |
| Comprehensive visual/accessibility and exact D06 acceptance | FAIL | Both independent QA reports fail; current evidence is four populated resized-Chromium frames, not a complete state/device/accessibility matrix or exact reference match. Details below. |

## Direct screenshot inspection and residuals

Independently opened all four current A PNGs at 1440x900 and 390x900,
light/dark, and the original D06 image. Current candidates are live-looking
CodeMirror rows consistent with inspected DOM code, show actual fixture
metadata, fit the supplied widths and retain readable source context.
There is one completion popup and no competing raw-BibTeX tooltip.
Both compact themes show wrapped metadata and the large inherited shell/header;
the popup still covers following source lines. This does not establish a
physical-mobile or touch-keyboard result.

The original D06 has a search/sidebar composition, multi-candidate rounded
card and integrated scope/footer treatment; the current assembled file/editor/
Assistant shell and single native candidate do not reproduce it exactly.
Preserve actual metadata rather than replacing it with fictional D06 records.
Inherited shell differences are not a reason to broaden this verifier into
a redesign, nor a reason to mark exact fidelity green.

Parent-owned changed-region corrections, ordered by immediate gate impact:

1. Fix `InlineReferences.tsx:82:5` consistent-return; rerun affected integrated
   checks. Matrix/build are still unverified on P71.
2. Clear request-owned loading on cancel/invalidation without deleting a
   durable copy receipt or a newer request's feedback. Add bounded
   event-driven proof for the previously uncovered terminal feedback.
3. Give empty results and known errors actionable, human-readable guidance;
   humanize provider display names instead of exposing semanticScholar casing.
4. Resolve compact completion presentation and focus-driven geometry movement;
   prove pointer/caret and keyboard behavior on the corrected surface.
5. Preserve Off availability when tracking/offline/readOnly blocks requests;
   current disabled selector can prevent withdrawing an existing selection.
6. Resolve QA B's changed-control/text defects: mobile reference text below
   required size, 40px select targets versus 44px requirement, control edges
   below 3:1 (light 1.43:1; dark 2.72:1), unbounded disclosure prose measure,
   and missing selected glyph under the strict checklist.

Evidence residuals remain distinct from proven product defects: final expanded,
off/loading/empty/error/copy/success/stale-receipt and long/multiple-result
captures; 1920, CJK, zoom, motion/first-paint, focus/accessibility-tree and
device/keyboard coverage; identified scroll owners under real overflow;
visible destination/status priority and useful-text selection proof.
The current probe's absent .cm-scroller and unexplained sibling/empty selectors
do not prove a broken editor scroller, but fail the required owner evidence.
V contains the complete A1-J2 item ledger; no failed item is upgraded here.
Round 1 remains FAIL, not a self-certified or taste-only approval.

## Cleanup, preserved baseline and scope

Inspected all seven C cleanup.json files. They retain seven distinct absent
roots: `/tmp/quire-assembly-bd5UwU`, `-Kaq7PN`, `-kKpfwh`, `-dstA8J`,
`-3kZgiz`, `-O37CMM`, and `-KM23rI`; each has browserClosed=true,
all three fixture listeners closed and errors=[].
These are producer cleanup receipts, not new probes by this verifier.
Backend L records awaited provider/socket/runtime disposal and restored spies.

This verifier started no browser, application/provider listener or fixture.
Its recorder/command process exited 1; the one completion watch was only for
that command's terminal sentinel, not a standing service. No port 5173 use,
live provider, secret, production mutation, source/test change, commit or push
occurred. Original inputs and other agents' edits, including unrelated `1`,
were preserved. Only the allowed verification report/evidence paths were written.
The handoff was written last with apply_patch.

P70's passing type/lint/matrix/build receipts remain the prior integrated
baseline; they are not rerun or promoted to current P71 success.
P68's broader **95 pass / 2 fail, exit 1** remains non-green and outside this
repair scope. Inherited shell/platform/spinner visual limitations remain
unaccepted, not fixed by passing targeted native behavior.

The independent verification task is complete: the requested chain has a
retained failure exit, scoped tsc has a retained success exit, every P71
boundary above has an evidence-backed verdict, and this FINAL handoff exists.
P71 itself remains incomplete pending the parent-owned corrections and proofs.
