# P29 independent reference and review verification

October 28, 2026. Auditor: `st_01a18224`. Status: FINAL for the two bounded P29 audits below.

## Verdicts

| Delivery | Verdict | Accepted boundary |
| --- | --- | --- |
| Remote bibliography | **PASS** | Mounted Bibliography search, real native retrieval through an owned HTTP Crossref fixture, explicit editable target, persisted Copy/Cite, server provenance, Viewer denial, real unconfigured-provider errors, and stale-result cancellation. |
| Author-aware history and review | **PASS** | Recorded applying actors of consecutive immutable file transitions, scoped participant names, persisted proposal authors, honest replacement previews, comparison/navigation, intermediate retention checks, and authorized filtered decisions. |

These are source-and-retained-evidence verdicts, not new test executions or a current whole-tree runtime/build pass. Both producer files are explicitly FINAL. No producer monitor is identified as pending in those final handoffs. No passing tests, builds, production code, tests, global matrix, or global todo were changed or rerun by this auditor.

Literal source typing interception, full D10 completion, and P31 acceptance are **not accepted by this audit**. The parent decision in `docs/handoffs/p29-history-contract-decision.md` expressly limits history to recorded applying actors, not original ownership of surviving characters. P30 thread/Assistant coordination remains a separately owned delivery and was not independently audited here.

## Prioritized findings and limits

1. **P2 - Preserve the P29/P30 source-hash boundary.** The original remote `source.sha256` matches both production panels, the workflow test and its tsconfig, but not the current capture fixture. Original fixture SHA-256 is `5b34d73052b8e2d1a6fd55c6722d35f3dfdf12607401271ba72e497993160e31`; current fixture is `d82fb2b6a98f199a1ae340d6d4745f96af610311460eb485f6b3175ae885c46f`. This is the disclosed parent P30 Local Library no-alert assertion, not unexplained P29 implementation drift. The original parent command/monitor/completion records were subsequently located and read directly: they prove the scoped compiler, typed deny-warning lint and affected browser selection completed sequentially with exit 0. There is no contemporaneous source-hash manifest for the correction. Current hashes identify the inspected bytes, not independently fingerprinted bytes from that original run. This audit does not turn the P29 original hash into proof of the later correction.
2. **P2 - Full source authorship/tracking remains outside the pass.** `services/core/review/history-changes.ts:43` uses the next snapshot's applying actor; `packages/contracts/src/projects.ts:70` literally declares `recorded-file-transition`. `change-preview.tsx` computes one replacement span. It does not reconstruct per-character ownership or separately attribute unchanged interior text. The UI discloses this limitation. Proposal authors come from `suggestions.author_id`, independently of the accepting actor. A matrix claim of complete literal source tracking would exceed this evidence.
3. **P3 - Keep the historical runtime failure undiagnosed.** The original remote Run 1 cleanup records `TypeError: Cannot read properties of undefined (reading 'reason')` at served `projects.ts:136:34`. It lacks served-module bytes and navigation timestamps. Later clean fixtures do not establish an HMR, cache, circular-import, or source-expression diagnosis. The error remains historical, not a reproduced current defect and not erased by these passes.
4. **P3 - Visual approval is bounded.** All 16 affected final feature screenshots were opened, plus the final author-review `terminal.png`. The eight history/proposal captures and eight original/follow-up reference captures show readable controls without observed overlap. Mobile history/review captures crop part of the existing multi-row footer; some upper controls are outside the scrolled frame. The final author terminal capture shows an in-flight comparison spinner after recovery and is not accepted as a settled recovery-render screenshot. Exact recovered bytes/revision/epoch are supported by the workflow assertions and retained DTOs, not that terminal image.

No blocking production defect was identified in the two bounded P29 implementations during this source/evidence audit. No live public vendor, PostgreSQL, whole-product build, or inherited P25 build success is claimed.

## Remote bibliography audit

`RemoteReferencePanel.tsx` sends only the submitted query, provider, fields and project ID; typing invalidates results but does not dispatch. Query/provider changes and Cancel abort and increment a generation; response/error handlers reject aborted or old generations. `BibliographyPanel.tsx` keys the remote panel by project/branch and restricts targets to editable unlinked `.bib` files. Multiple targets require an explicit selection. The inspected boundary test waits for held native responses before asserting latest-only results, provider changes and project unmount/remount; the workflow additionally switches between actual projects.

Copy and Cite call the existing `createToolsActions.citation`. That action flushes and rereads edit access before dispatch. `services/core/catalog/index.ts:48` authenticates, checks path/body scope and `files.write`; `catalog/citations.ts` rechecks authority inside source serialization, validates the target, detects key conflicts, and commits exact BibTeX through the native writer. Cite inserts the parsed returned key through the current source handle and flushes before structural refresh; Copy does not insert source text.

`services/adapters/references/index.ts` authenticates search and returns the Publication DTO, not a fabricated public provenance DTO. `retrieval.ts` checks project read permission before and after retrieval. Its `retain` writes raw response bytes to the native content-addressed blob store and persists provider/provider ID, endpoint, retrieval instant, digest and publication JSON in `reference_provenance`. The provenance is server-retained, not a claim that the UI citation endpoint cryptographically binds arbitrary Publication inputs to that table.

The final parent follow-up workflow packet is `docs/evidence/p29-remote-bibliography/756a6127-6245-4156-8425-0fb89f00a8a2/`. It records project `12fea757-c6bd-462e-b01c-64b0647545a9`, selected target `71428127-8c5e-4a84-b83a-6478550709c1`, untouched target `0c6b06f2-6c07-46f7-a04b-bd71ea389c01`, exact returned BibTeX and source before/after. The test asserts copied target bytes, untouched alternative/source on Copy, a separately retrieved Cite record, insertion at source start, reload persistence, matching native provenance rows, and raw blob DOI/endpoint identity.

The actual retained wire-response digests are:

- `10.1234/copyproof`: `964412883ddf82f031e3990dce3077b3aa6f190f40863d76c27db563e9844097`.
- `10.1234/citeproof`: `0d9d85ffd0e5d673766d9408247e227334ce0fff2407afb2ed329fcd85f52825`.

These are owned loopback fixture responses, not public Crossref success. The destroyed fixture root means the blobs cannot be reread now; the retained test code, successful assertion receipt and `workflow.json` are the authority for that original read.

The final unchanged boundary packet is `9ae45928-959b-401e-a9a9-dd68dce752e2/boundaries.json`: native write denial 403, real unconfigured-provider 503, query cancellation, latest-only results, provider cancellation and project-unmount cancellation. Dimensions is disabled/unimplemented. Credential provisioning, live arXiv/Semantic Scholar/Mendeley success, licensed Dimensions, ReadCube partner search, Zotero bulk workflows and inline completion remain excluded.

## Author-aware history/review audit

The dedicated `historyChanges` endpoint is separate from the unchanged `historyCompare`/`GitHunk` shape (`routes-core.ts:108-109`). It orders source mutations by revision and same-revision checkpoints by recorded history order, checks every intermediate version before reading comparison bytes, skips unchanged file/path checkpoints, and publishes only participating actor IDs and nullable names. Under the accounts transaction lock it rechecks current read authority and the entire version range. Missing/deleted names remain null; emails and member-directory data are not returned.

The native assertions exercise Viewer reads, project/branch/file scoping, stable consecutive transitions, no unchanged-checkpoint author, deleted names, retained labeled endpoints with an inaccessible middle, and a real retention-policy change during delegated blob reading. The final fence rejects that request without source bytes. A persisted Reviewer proposal accepted by an Owner proves that proposal authors and applying actors are different fields.

`history.tsx:246` offers exact line navigation only when the loaded current file's full text equals the transition's after-text. Otherwise it opens the current file; deleted files do not get invented historical live anchors. Labels-only changes the visible timeline, not the latest comparison endpoint. Endpoint copy is file-filtered. The browser test creates/deletes/labels/downloads/recovers a real file and checks a new immutable version, higher revision/epoch, exact bytes, and unchanged unrelated accepted source.

`suggestions.tsx` filters actual persisted authors and edits. Bulk/selected decisions derive edit IDs only from the visible pending set. The current user is `You`; other labels explicitly disclose unavailable names. `anchors.ts` validates file, epoch, Yjs relative positions and exact quote before source context/navigation. Unresolved, deleted and decided proposals are disclosed rather than portrayed as live edits.

UI decision controls require edit capability. Native `suggestions.ts` authorizes `suggestion.decide`, rechecks the live session/permission under the transaction lock and validates selected pending edit IDs. Creation also checks tracking policy. The final browser workflow downgrades the second proposer through the real owner API, observes no Reviewer Accept-all control, accepts only that author's visible proposal as Owner, reloads, and leaves the other proposal pending.

Final author packet: `docs/evidence/p29-author-review/browser-f0fa339e-d134-4caa-b364-b1e5d610867d/`. Its workflow retains owner `00000000-0000-4000-8000-000000000001`, second author `00000000-0000-4000-8000-000000000002`, exact before/after source, pending Owner proposal `3689a5d0-22ba-43d0-9991-587c597a145e`, accepted second-author proposal `c9c6a208-12df-405c-9398-0cfa2d398720`, and recovered file bytes. `errors.json` is empty.

## Original receipts and hash correspondence

All paths below are relative to `docs/evidence/`. Full exact SHA-256 values for 105 audited source/evidence inputs are retained in `p29-reference-review-verification/audit-inputs.sha256`; `integrity-check.log` preserves the successful `sha256sum -c` output and `P29_AUDIT_INPUTS_EXIT=0`. These are audit-time fingerprints, not newly invented original-run fingerprints.

| Original receipt | Observed result |
| --- | --- |
| `p29-remote-bibliography/browser-run-3.log` | Original full run: 2 pass, 0 fail, 61 expectations, explicit exit 0; historical loaded-source evidence. |
| `p29-remote-bibliography/browser-run-4.log` | Exit 1: Copy/Cite capture failed the nested Library no-alert check; separate unchanged boundary selection passed. This is not a full-run pass. |
| `p29-remote-bibliography/browser-run-5.log` | Affected Copy/Cite selection: 1 pass, 55 expectations, explicit exit 0; Library alert still retained separately. |
| `p29-remote-bibliography/types-run-5.log`, `lint-run-5.log` | Explicit scoped exit markers 0 for original P29 sources. |
| `p30-library-cancellation/verification.log` and original parent JSONL records below | Separate affected browser selection: 1 pass, 61 expectations, 51.71 seconds. Exact original command chains scoped compiler, typed deny-warning lint and targeted test with `&&`, through `tee` with `set -o pipefail`; `bash_392`/`mon_VVEMAADGNSFA4VXK` completion exit 0 proves all three checks. Only the contemporaneous source-hash limitation remains in finding 1. |
| `p29-author-review/native-and-static.log` | Projection: 4 pass, 32 assertions; affected regression: 3 pass, 20 assertions; separately recorded exit 0 each. Initial lint failure is preserved. |
| `p29-author-review/browser-runs.log` | Three failed attempts, first complete pass, then final packet: 1 pass, 44 assertions, 66.23 seconds, recorded completion exit 0. No failed attempt is counted as a current pass. |
| `p29-author-review/final-static.log` | Scoped compiler, typed deny-warning lint and diff check chained with `&&`, recorded completion exit 0. Its diff-check command is itself abbreviated in the retained producer file; this audit does not reconstruct missing text. |

All 12 entries in `p29-author-review/final-source-hashes.txt` exactly match current files, including both contracts, backend, UI and tests. Its manifest SHA-256 is `2c44ef0eca17a69fac4b0b86fc5faf14599852798f91123ef1bf8469237c9956`. All entries in the remote evidence manifest verify, including the producer FINAL handoff. The remote source manifest has precisely the disclosed fixture mismatch described above.

Producer handoff fingerprints at audit:

- Remote FINAL: `d83aec62d814c60e62358bc93fe3d48d1e29ed393589b3081e45cacdc4fc04c6`.
- Author FINAL: `4e511b30f7e7f8aec1086d5112c0ad42d0068e07e3c2ca75a311d33ecdd1199a`.
- History contract decision: `18f4add26178317b67db04845cf7823096ff529191431543f1cca2e92a4bde86`.
- P30 Library FINAL: `1f6dec4fdaa496688c6cc4cff0f796fa9697fe617798ae0e99f422748ec41d8d`.

### Located original P30 parent receipt

Read exact bounded lines from
`/home/norman/.omo/agent/sessions/--home-norman-Repos-Quire--/2026-10-26T18-05-13-405Z_01a17963-4d3c-715c-a44c-212374491a0a.jsonl`.
The three original records are retained verbatim, in order, in
`docs/evidence/p29-reference-review-verification/parent-p30-receipts.jsonl`.

| Original line | Message ID and UTC timestamp | SHA-256 of exact JSONL record including newline |
| --- | --- | --- |
| 17533 | `c436cf43`, `2026-10-28T10:30:47.300Z` | `e1befb33a0860ea16904053c348094cfabd50ef726f1b18b00bd8b3d7b78a5fc` |
| 17536 | `e649f328`, `2026-10-28T10:30:47.388Z` | `b227813aa4fd4a9f7ca3ebc1a1ecfdbd7b2b1bd4164d6570ca46d0b2bdcefc04` |
| 17555 | `6f750276`, `2026-10-28T10:31:54.439Z` | `d6900ba9b41f632df97185ecf792564513551d54555ec1255ae5707e3c02957e` |

The command runs `tsc --noEmit -p tests/ui-editor/remote-bibliography/tsconfig.json`,
then `oxlint --type-aware --deny-warnings` on `LibraryPanel.tsx` and the remote
capture `fixture.ts`, then the `native remote search` browser selection.
The original monitor receipt names `mon_VVEMAADGNSFA4VXK` and `bash_392`;
the completion record names the same session and reports exit code 0.
The LSP result is also explicitly clean for LibraryPanel.
This closes the missing-original-static-exit question without a rerun.
It does not close the missing contemporaneous source-hash manifest.
The 105-input audit manifest and its integrity log remain the earlier
audit-time snapshot; they do not purport to include this later-located excerpt.

## Screenshot and cleanup observations

Opened independently: `history-{1440,390}-{light,dark}.png` and `review-{1440,390}-{light,dark}.png` in the final author packet, plus its `terminal.png`; `inspect{1440,390}-{light,dark}.png` in both remote packets `d9bb8ba0-9e54-49d0-8c9e-bf7917093027` and `756a6127-6245-4156-8425-0fb89f00a8a2`. Historical earlier screenshot sets were not used to grant final visual acceptance. The final reference alert arrays are all empty; original Run 5 arrays retain the nested Library cancellation alert.

Every retained P29 cleanup JSON was read. The remote receipts record browser disconnection, absent root, closed web/API/vendor listeners, and errors; final ones are clean. The author cleanup format records only root absence; browser/listener disposal is supported by its fixture disposal stack and original CLOSED log, not equivalent per-resource JSON assertions.

Independent current filesystem checks found all 15 retained browser roots and all six native review roots absent. `ss -ltnp` showed none of the recorded final reference ports 40481/43711/37345, 42085/37891/36751, 41251/40423/36781 or author ports 37645/39437 listening. Unrelated listeners were left untouched. This auditor launched no browser, vendor, application server or monitor.

No new runtime test, static compiler/linter run, public-provider request, PostgreSQL run or build was performed. The shared workspace has unrelated changes. These verdicts accept only the fingerprinted bounded P29 delivery and stated original receipts, not those unrelated changes or future deltas.
