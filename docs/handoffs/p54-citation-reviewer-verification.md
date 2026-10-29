# P54 citation reviewer verification - FINAL

Date: 2026-10-28 UTC.

Verdict: **PASS, bounded to the inspected implementation and retained owned-fixture native workflow.** No blocking P54 implementation defect was identified. This is not a live-provider compatibility result or objective certification of either claim's truth.

Producer handoff inspected: `docs/handoffs/p54-citation-reviewer.md`, marked FINAL. Final native evidence inspected: `docs/evidence/p54-citation-reviewer/9c6612f5-4256-4ee1-afae-eb80b8411fa5/` (called E below). Independent current revision/source/artifact hashes and raw artifact/cleanup observations are retained in `docs/evidence/p54-citation-reviewer-verification/observations.md`.

## Prioritized findings

### P3 - Historical test evidence is not cryptographically pinned to implementation bytes

The producer's raw logs record commands, cwd, Bun version, UTC and exit outcomes, but do not contain a contemporaneous implementation/test hash manifest. E's hashes pin document text, retrieval bytes and compiler artifacts, not the entire tested worktree. HEAD is `17a8dd43e2f6662dad590de746339d24fe6181d4`, with extensive existing uncommitted changes. HEAD alone cannot identify the tested source.

The independent audit now pins the inspected P54 source/test files and compiler artifacts. Observed mtimes for `Claims.tsx` (18:23:21 UTC), backend claims test (18:14:04), workflow test (18:12:21), and native fixture (18:10:36) precede the final passing native run. This supports reuse but does not prove historical byte identity. The bounded PASS therefore relies on inspected current code plus retained passing evidence, not a reproducible clean-commit certification. A contemporaneous tested-source manifest would remove this limitation.

The dirty worktree includes core/reference/contracts paths outside P54. Without a producer-start baseline, those changes cannot be attributed to P54; this audit does not certify the handoff's change-ownership assertion. No additional source disclosure boundary was found in the inspected P54 flow.

### P3 - Native compile UI retains earlier-pass warnings after final resolution

E's `workflow.json` records five earlier-pass undefined-citation/reference/rerun diagnostics; the screenshots visibly show "5 diagnostics". The final `output.log` reads `output.bbl` and completes without unresolved-reference warnings; `output.bbl` contains the exact citation key, and `output.blg` reports one entry and zero `warning$` calls. Independent PDF extraction shows citation `[1]` and the expected bibliography entry.

This corroborates the producer's disclosed compiler-diagnostic aggregation limitation. It is not evidence of an unresolved final citation and is outside P54; no compiler changes were made by this audit.

## Observed implementation and supported behavior

| Boundary | Evidence and conclusion |
| --- | --- |
| Typed findings, not prose extraction | `packages/contracts/src/work.ts:56` defines strict source identity, UTF-16 offsets, nonempty quote, supported/unsupported assessment, explanation and publication references. `services/adapters/ai/model.ts:15` accepts those typed findings with an empty legacy default. Provider-supplied revision/epoch or extra fields are rejected. `provider.ts:49` sends explicit selected ranges and requests the internal JSON contract. There is no conversion of assistant prose into source highlights. |
| Exact span and version provenance | `services/adapters/ai/findings.ts:9` binds ID **and** path to a submitted file, restricts offsets to its submitted range, rejects empty/split-surrogate/mismatched quotes and attaches server revision/epoch. `currentClaimContext` checks full current text and identity/version before dispatch and publication. `context.ts:25` validates explicit file selection and exact selected text; `provider.ts` sends only `text.slice(from,to)`, not the full backing file for a range selection. |
| Retrieved-ID binding | `findings.ts:18` rejects finding references absent from this invocation's retrieval. `execution.ts:78` also binds top-level citations and chooses returned source metadata/BibTeX from the actual retrieved objects, not model-generated publication metadata. It stores retrieval provenance independently. E contains the raw retrieval response, model contexts, provider receipts and independent reference-provenance row. The raw retrieval SHA-256 independently matches its digest filename. |
| Queued/running stale guards | `service.ts:49` rechecks active runs on policy/access/session/source/tree events. `execution.ts:49` and `execution.ts:85` check authority, source and cancellation under the existing account lock before dispatch/result publication. Source/revision/epoch changes discard late results. Completed findings may remain historical; `service.ts:112` derives `findingsCurrent` from current server source rather than trusting a stored permission certificate. |
| Native highlight | `assistant/claim-context.ts:4` requires identical ID/path, saved persistence, exact revision/epoch and quote. `assistant/Claims.tsx:35` re-fetches run eligibility and checks authority epoch, document/run/authoring identity and tracking before selecting the exact range. The source-highlight capture shows the unsupported quote selected, and the native test asserts browser-selected text equals the quote. This is native selection, not durable decorations or automatic rebasing. |
| Ask retention | `conversations.ts:49` keeps private Ask findings in the process/session map; `execution.ts:101` persists `[]` for private Ask findings. Session clear removes them; service close clears the maps. Agent findings persist. Explicit shared Ask findings persist and `conversations.ts:113` clears them through the shared clear/expiry redaction path. The retained backend tests cover private session access, clear/restart, Agent persistence and shared clear; expiry is supported by inspected code rather than a separate P54 expiry test. Existing request metadata/selected-input retention is not newly certified by this finding-storage check. |
| Permission, confidential and consent fencing | `store.ts:18` checks current project access, active session, accepted terms, confidential flag/tag policy, operator retrieval policy, provider configuration and effective AI mode. `store.ts:80` rechecks original run authority/configuration. Retrieval checks provider-specific consent before outbound calls; result publication and run reads recheck eligibility. Native Copy/Cite additionally require edit access and current review state. The existing citation backend separately authorizes `files.write`. |
| Track Changes | `editor/index.tsx:58` constructs the existing `sourceToolsClient`; `index.tsx:208` passes it to Assistant, removes the authoring handle and supplies the tracking flag. `source/tools-client.ts:8` rejects project structural writes at dispatch, including actions begun before tracking changes. `Claims.tsx` disables Copy/Cite and guards in-flight actions; `committedSelection` excludes private tracked selection. The native workflow toggles tracking and asserts disabled actions and unchanged committed source. |
| Real selected-publication writer | `Claims.tsx:93` invokes `createToolsActions(...).citation(selected,targetId)`, not a replacement backend. `tools/actions.ts:111` flushes and obtains the branch revision before the existing citation endpoint. `services/core/catalog/index.ts:48` authenticates, authorizes and replays the actual writer. `catalog/citations.ts:14` parses one BibTeX record, requires an editable unlinked `.bib` target, rejects conflicting keys and commits source with expected branch revision. The native UI shows the selected publication's actual BibTeX and parsed key. |
| Durable source and partial success | `Claims.tsx:96` treats the bibliography response as already durable, then rechecks review eligibility and selection before `insertCommand`, and awaits `document.flush()` before reporting source success. The catch explicitly discloses durable copy with unacknowledged insertion/refresh. The fixture holds the response **after** the real application handler persisted the citation; the native test changes selection, verifies the partial-result notice and unchanged main source, then performs a separate explicit successful Cite. No atomic cross-operation guarantee is claimed. |

## Native evidence and exact actions

I inspected the workflow test and fixture, all eight retained review/publication screenshots at 1440/390 widths and light/dark themes, and `source-highlight.png`. Controls and text are readable without observed overlap or horizontal overflow in these captures. The mobile view is the native Assistant drawer. Post-insertion captures correctly show stale historical assessments and disabled highlights/actions. These static captures do not prove every scroll position or every viewport.

The fixture uses authenticated full application routes, real source transport, native bibliography persistence and a real compiler. Its owned loopback model and Crossref-shaped retrieval responses are deliberate fixtures, not live results or mocked successful application writes. The held citation response is delayed after persistence, not replaced with a fabricated success.

E's `requests.json` contains the queued run responses, unique idempotency keys, real bibliography response file IDs/blob digests and request IDs. E's `provider-requests.json` contains two submitted `main.tex` contexts and the actual retrieved publication. The selected unsupported finding has no linked publication references; the UI says so rather than inventing supporting provenance.

- Initial run: `0f4c5ec7-a1f3-47c7-b7df-b65ff0c6620b`; explicit regeneration: `41945591-f85e-467f-aeb2-66df24bc3d51`; fixture receipts: `chatcmpl-1`, `chatcmpl-2`.
- Selected bibliography: `050a8668-ef5e-4939-b9e7-bc26670863b1`, `review.bib`. All three bibliography responses return its same 178-byte blob `94046d32e50254c8d8923753e65f766c8acc5ecf2410f7018cf30191afc4e3ac`.
- Retrieved publication: `crossref:10.1234/verified`; exact BibTeX/key: `crossref_6421e247aad7af53`.
- Copy request: `842c3442-c8da-4749-a08c-9e1490303066`; persisted partial-copy request: `cee571b0-6168-4a64-9cb2-43df8f5d9260`; successful Cite request: `b16efacb-5ea1-4e4c-a4b1-3924604b8741`.
- Main source before: `e9caac0e6a9d9e2969a4afd1d968e59d3f9452e0e5938dbcceb4951de3e90e29`; after citation and reload: `ffb16f13c61de02e86440e4565f211cc179975b072866d40f0aa2a31f84802bd`.
- The exact recorded source delta is `\cite{crossref_6421e247aad7af53}` after `This method always proves every theorem.` Copy and the deliberately canceled insertion leave main source unchanged. `proposals=[]`; there is no invented proposal.

Compile job `b038aede-2677-4376-ae46-b554c8ed466c` succeeded on source snapshot revision 6. I independently hashed all nine retained artifacts and compared their digests with E's artifact manifest. The PDF is one page, 27,314 bytes, SHA-256 `01a55bf8ce7180602f677777c6ee435802a13e5f7f2c115dcf726502b2b8557a`. `pdfinfo` identifies pdfTeX; `pdftotext` shows the cited claim and `Ada Example. Retrieved paper, 2025.` The `.bbl` SHA-256 is `b3d9fc41c13e24026e0b0e4688ea734bdea1625deeefb46e27e46b01ca6dcf05`.

## Validation reused and independent probes

No passing suite was rerun. The retained commands are scoped and relevant; I read their assertions and the changed implementation. The final native fixture/workflow and backend test mtimes precede their retained passing executions, subject to the pinning limitation above.

| Raw producer evidence | Recorded result |
| --- | --- |
| `docs/evidence/p54-citation-reviewer/backend-validation.log` | Claims plus native source-eligibility tests: 20 pass, 0 fail, 79 assertions. The chained command exits 2 on an initial TS2367 in the citation route comparison; it is not a clean combined check. |
| `docs/evidence/p54-citation-reviewer/scoped-checks.log` | Subsequent backend/UI scoped TypeScript projects and type-aware lint: exit 0. Current code compares endpoint method/path rather than the incompatible endpoint object comparison. |
| `docs/evidence/p54-citation-reviewer/native-replay-regression.log` | Earlier native failure retained; not counted as passing evidence. |
| `docs/evidence/p54-citation-reviewer/native-postcopy-final.log` | Final native workflow: 1 pass, 0 fail, 31 assertions, 50.50 seconds; chained scoped UI TypeScript and changed-component lint: exit 0. |

The backend tests exercise exact UTF-16 binding, malformed fields and out-of-range/incorrect quote/file/publication rejection; private/shared/Agent retention; late source, epoch, consent, confidential, actor and operator changes; native selected target persistence; untouched other bibliography/main source; linked/binary/invalid/stale/Viewer denials. The native workflow subscribes to application events or DOM/network transitions, including a deliberate persisted-response gate, rather than using fixed sleeps.

Independent narrow probes were read-only: current hashes/mtimes, retained artifact SHA-256, PDF metadata/text extraction, raw retrieval digest and owned-listener/root absence. Their raw outputs and command description are retained in `docs/evidence/p54-citation-reviewer-verification/observations.md`. No new browser, application, compiler run or test fixture was started.

## External gates, inference and cleanup

Observed: the fixture retrieval/model receipts, native application actions, persisted response metadata, reload source equality, compiler bytes and screenshots support this bounded workflow. Inference: these guards should fence analogous changes outside the exercised cases; this report does not claim exhaustive concurrency coverage.

External gates remain live-provider structured-output compatibility, licensed/provider availability and substantive scientific assessment quality. Neither "unsupported" nor "supported" is an objective fact-check certificate. The synthetic publication does not validate the truth of the example claims.

E's `cleanup.json` records absent `/tmp/quire-assembly-Ve9jie`, closed owned origins on ports 43917/46817/36287, disconnected browser and zero browser errors at `2026-10-28T18:24:22.368Z`. I independently observed the root absent and no matching listening TCP sockets at audit time. The audit owned no probe servers/browser/temp roots and left none running. It made no live-provider calls, port 5173 operations, code changes or commits, and wrote only this report and its named verification evidence directory.
