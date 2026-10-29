# P54 / I49b citation reviewer - FINAL

Status: complete for the bounded native workflow. Final native verification and owned cleanup completed on 2026-10-28 at 18:24:22.368 UTC.

## Delivered behavior

The citation reviewer accepts explicit typed claim assessments, not inferred structure extracted from assistant prose. Each finding contains an exact file ID/path, nonempty UTF-16 range and quote, supported/unsupported model assessment, explanation, and retrieved publication references. The server supplies the submitted file revision and epoch. It rejects incorrect quotes, split surrogate pairs, ranges outside the submitted selection, incorrect file identities/paths, malformed fields, provider-supplied versions, and publication IDs absent from this invocation's retrieval.

The provider format is an internal Quire contract. No live-provider support or factual certification is claimed. The native panel labels both supported and unsupported results as model assessments. A provider returning only the old prose/citations format produces no structured highlights.

Findings use the existing source selection handle. Opening a different referenced file is an explicit navigation step; highlighting requires its exact current quote and file version. Source changes during queued/running review cancel the result. Completed findings remain readable as historical assessments after source changes, but `findingsCurrent` is recomputed against the server source and highlighting/insertion is blocked. Local durable synchronization, revision, epoch, file identity, source text, active selection, session cancellation and current authority are checked again at the action boundary. Branch/actor changes retain the existing keyed Assistant session disposal.

The user selects a proven retrieved publication and an existing editable, unlinked `.bib` target. The panel shows the actual BibTeX and its parsed citation key. Copy uses the existing authorized `createToolsActions.citation` writer and leaves main source unchanged. Cite uses the same writer, rechecks review eligibility after the bibliography response, inserts the exact key through `insertCommand` at the current authoring selection, and waits for `document.flush()` before reporting source success. There is no second bibliography backend, invented key, automatic AI edit acceptance, or automatic retry.

Bibliography persistence and source insertion are intentionally separate existing operations. If the copy succeeds but the source selection or eligibility changes, the panel reports the durable copy and unacknowledged insertion rather than claiming complete success. A native test holds the actual persisted-copy response, changes the source selection, then verifies this partial state and unchanged main source before an explicit successful action.

The Assistant receives the existing Track Changes guarded tools client. Tracking disables Copy/Cite and removes the authoring handle; the dispatch guard also rejects structural writes begun before tracking changes. Private tracked drafts are not used as committed source context.

## Contracts and retention

- `packages/contracts/src/work.ts`: strict `AiClaimAssessmentSchema` and `AiClaimFindingSchema`; additive `findings: []` and `findingsCurrent: false` defaults preserve old run fixtures. `findingsCurrent` is derived on read, not a stored authorization certificate.
- `services/adapters/ai/model.ts`, `provider.ts`, `findings.ts`, `context.ts`, `execution.ts`, `service.ts`, `store.ts`: typed output, provenance checks, source fencing, current-source reads and cancellation.
- Migration `069-x-ai-claim-findings` adds `ai_run_metadata.findings_json` with default `[]`, for SQLite and PostgreSQL.
- Private Ask findings live only in the existing process/session lifetime, with persisted `findings_json=[]`. Session clearing, restart and service close discard them. Agent findings persist with the audit run. Explicitly shared Ask findings persist and use the existing clear/expiry redaction path.
- `conversations.ts` clears findings alongside the corresponding message retention. Findings do not add persisted private Ask source payloads.
- `apps/web/src/features/editor/assistant/Claims.tsx` and `claim-context.ts` implement the native assessment and citation actions. `AssistantPanel.tsx`, `types.ts`, `use-assistant.ts`, `assistant.css`, and the required props in `editor/index.tsx` integrate them.

Native reload testing caught and fixed a notification-replay issue: replayed historical policy events must recheck an authorized saved run rather than erase its session receipt. Real policy/access changes still invalidate pending actions and recheck current eligibility.

The design deliberately reuses exact native selection rather than adding persistent editor decorations or rebasing findings after edits. The user must obtain a new assessment after the reviewed source changes. This avoids silently highlighting a different passage.

## Final evidence

Final evidence root:

`docs/evidence/p54-citation-reviewer/9c6612f5-4256-4ee1-afae-eb80b8411fa5/`

The native fixture uses the complete application, authenticated browser session, real source transport, actual bibliography writer, owned loopback model/retrieval servers, and real compiler. It does not mock successful application responses. The held citation response is released only after the native writer has actually persisted its result.

Key artifacts:

- `workflow.json`: original/pre/post source hashes and text, complete run/findings/publication, provider receipts, independent retrieval provenance, compile job and all artifact IDs/hashes.
- `requests.json`: exact request IDs, idempotency keys, statuses, run responses and persisted bibliography responses.
- `provider-requests.json`: submitted source context and independently retrieved publications delivered to the owned model fixture.
- `retrieved-19204700374b4936958cd27a29647c61201bffd47ea5ddc4ec43764ea67b3349.json`: retained raw retrieval response.
- `source-highlight.png`: actual unsupported source selection; the browser asserted its selected text equals the exact source quote.
- `review-{1440,390}-{light,dark}.png` and `publication-{1440,390}-{light,dark}.png`: native responsive captures. All four review layouts were inspected; publication captures were inspected at both widths/themes during verification. No horizontal overflow or overlapping claim controls was observed. Post-insertion captures truthfully show the prior assessments as stale.
- `artifact-<id>-<kind>`: actual compiler bytes, including PDF, BibTeX `.bbl`/`.blg`, final LaTeX log and combined build log.
- `owned.json`, `cleanup.json`, `terminal.html`, `terminal.png`: exact owned origins, runtime, final surface and cleanup.

Final identifiers:

| Resource | ID |
| --- | --- |
| Project / branch | `00000000-0000-4000-8000-000000000020` / `main` |
| Source file | `00000000-0000-4000-8000-000000000101` |
| Selected `review.bib` | `050a8668-ef5e-4939-b9e7-bc26670863b1` |
| First review run | `0f4c5ec7-a1f3-47c7-b7df-b65ff0c6620b` |
| Explicit regenerated run | `41945591-f85e-467f-aeb2-66df24bc3d51` |
| Model request receipts | `chatcmpl-1`, `chatcmpl-2` |
| First review HTTP request | `f27f34f6-0133-4276-93c4-72adab2ffffb` |
| Copy HTTP request | `842c3442-c8da-4749-a08c-9e1490303066` |
| Regenerate HTTP request | `343b848f-9a9b-48d6-8c49-c1e623cd4f5c` |
| Partial-copy HTTP request | `cee571b0-6168-4a64-9cb2-43df8f5d9260` |
| Successful Cite HTTP request | `b16efacb-5ea1-4e4c-a4b1-3924604b8741` |
| Retrieved provider / ID | `crossref` / `10.1234/verified` |
| Exact returned BibTeX key | `crossref_6421e247aad7af53` |
| Compile job | `b038aede-2677-4376-ae46-b554c8ed466c` |
| PDF artifact | `5f6a9d16-5064-4ca6-a66a-4e112a828cf6` |
| BibTeX `.bbl` artifact | `c59b4182-d137-4245-9997-859f2e0cb976` |
| BibTeX `.blg` artifact | `d13b8b8b-76e0-43b0-980b-bf5f88aae7fc` |

No edit proposal was generated: `proposals=[]`. There is no fabricated proposal ID.

SHA-256 before explicit citation:
`e9caac0e6a9d9e2969a4afd1d968e59d3f9452e0e5938dbcceb4951de3e90e29`

SHA-256 after durable citation and reload:
`ffb16f13c61de02e86440e4565f211cc179975b072866d40f0aa2a31f84802bd`

The exact source delta is `\cite{crossref_6421e247aad7af53}` immediately after the selected claim. Copy and the deliberately canceled insertion leave the pre-citation source unchanged.

The actual TeX Live 2025 compilation produced a one-page, 27,314-byte PDF. BibTeX read `review.bib` and emitted the exact key in `output.bbl`; its `.blg` reports one entry and zero `warning$` calls. The final LaTeX log reads `output.bbl` and reports the completed PDF without unresolved-reference warnings. The existing combined-log diagnostics retain five earlier-pass undefined-reference/rerun warnings. That compiler diagnostic aggregation is outside this task and was left unchanged.

## Commands and outcomes

All commands ran from `/home/norman/Repos/Quire` with repository-local Bun 1.4.4 and `node_modules/.bin` first in `PATH`.

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
bun test tests/adapters/ai/claims.test.ts tests/adapters/ai/tools.test.ts tests/adapters/ai/conversations.test.ts
bun test tests/adapters/ai/claims.test.ts tests/adapters/ai/events.test.ts
bun test tests/adapters/ai/claims.test.ts tests/ui-product/citation-reviewer/claims.test.ts
bun x tsc --noEmit -p tests/adapters/ai/tsconfig.json
bun x tsc --noEmit -p tests/ui-product/citation-reviewer/tsconfig.json
bun x oxlint --type-aware --deny-warnings services/adapters/ai packages/contracts/src/work.ts apps/web/src/features/editor/assistant apps/web/src/features/editor/index.tsx tests/adapters/ai/claims.test.ts tests/adapters/ai/provider.ts tests/ui-product/citation-reviewer
bun test tests/ui-product/citation-reviewer/workflow.test.ts
```

The initial related AI suite passed 27 tests. After expanded target and cancellation coverage, the claims/events run passed 20 tests. The final claims plus source-eligibility run passed 20 tests with 79 assertions. These cover exact UTF-16 anchoring, malformed findings, incorrect quote/range/file/provider identity, stale revisions and epochs, consent/confidential/actor/operator changes, private Ask session/clear/restart semantics, Agent/shared retention, explicit selected target persistence, untouched source, and linked/binary/invalid/stale/Viewer denials.

Both scoped TypeScript projects and scoped lint exited 0. Initial new-test typing/lint errors were corrected; there are no suppressed diagnostics or weakened tests.

The final native test passed once, with 31 assertions, in 50.50 seconds. Its chained UI type check and changed-component lint also exited 0:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
bun test tests/ui-product/citation-reviewer/workflow.test.ts &&
bun x tsc --noEmit -p tests/ui-product/citation-reviewer/tsconfig.json &&
bun x oxlint --type-aware --deny-warnings apps/web/src/features/editor/assistant/Claims.tsx
```

Exact commands, recorded UTC timestamps and raw exits are retained in:

- `docs/evidence/p54-citation-reviewer/backend-validation.log`
- `docs/evidence/p54-citation-reviewer/scoped-checks.log`
- `docs/evidence/p54-citation-reviewer/native-replay-regression.log`
- `docs/evidence/p54-citation-reviewer/native-final.log`
- `docs/evidence/p54-citation-reviewer/native-postcopy-final.log`

Earlier native attempts exposed an incorrect test access URL, an editable-source readiness assumption, a responsive capture toggle, and the real policy-event replay receipt bug. The tests now subscribe to actual application/DOM transitions; they use no fixed sleeps or timing-luck assertions. Earlier failure artifacts remain available with their own cleanup records.

## Cleanup and scope

Final owned root `/tmp/quire-assembly-Ve9jie` is absent. Owned listeners `http://127.0.0.1:43917`, `http://127.0.0.1:46817`, and `http://127.0.0.1:36287` are closed; the browser is disconnected; browser errors are empty. `cleanup.json` records these actual checks at `2026-10-28T18:24:22.368Z`. Earlier owned native attempts also completed their recorded disposable cleanup.

No commits, live AI/retrieval accounts, external writes, original-input edits, README/matrix/runbook edits, or changes to frozen core/reference/shared routes were made. Port 5173 was not used. Existing unrelated workspace changes were preserved.

Verification is scoped to the owned fixtures and native application, not a claim about every live model/provider. No additional implementation is deferred within I49b's bounded claim-highlight and selected-publication workflow.
