# P3 assistant independent verification

Verifier: st_01a17d62. Updated October 27, 2026 after the parent changed the supported project runtime.

## Current pinned-runtime verdict: PASS

The independent assistant target passed **once** on project-local **Bun 1.4.4
(38afee6c8): 22 pass, 0 fail, 68 expectations, 22 tests across 6 files,
100.31 seconds, exit 0**. Current strict typing and scoped type-aware lint
also returned exit 0 after the Bun types changed to 1.4.4.

This is a fresh verifier-owned run, not the producer's isolated comparison.
The old Bun 1.3.14 FAIL is historical and is not a blocker for the newly
supported pin. No global runtime upgrade or old-runtime repair is awaited.
The current functional/static gate is clean; broader integration and visual
coverage limits remain explicitly separated below rather than silently
certified by a passing test selection.

Current evidence root, abbreviated **C**:
`docs/evidence/p3-assistant-verification/bun-1.4.4-current/`.
Historical evidence root, abbreviated **H**:
`docs/evidence/p3-assistant-verification/`.

## Runtime and input provenance

The parent decision in `docs/evidence/runtime-fd/project-runtime.md` was
read, then the actual installed pin was independently inspected:

| Input | Verified value |
| --- | --- |
| packageManager | bun@1.4.4 |
| engines.bun | >=1.4.4 |
| .bun-version | 1.4.4 |
| Development bun / @types/bun | 1.4.4 / 1.4.4 |
| Resolved bun-types declaration package | node_modules/.bun/bun-types@1.4.4/node_modules/bun-types |
| Project-local test executable | 1.4.4, banner 38afee6c8 |
| Local executable SHA-256 | 10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235 |
| Workstation-global Bun before and after | 1.3.14, intentionally unchanged |

The executable hash matches the parent-recorded comparison hash; that equality
is provenance, not a substitute for this independent test run. The package
script is `test: bun test`; invoking it through `bun run test` selected the
local 1.4.4 executable as its actual banner confirms.

`C/source-before.sha256` and `C/source-after.sha256` contain **555 identical
entries**, including application/shared UI, assistant tests and fixtures,
runtime/contracts/services/adapters, package.json, bun.lock and .bun-version.
`C/types-before.sha256` and `C/types-after.sha256` likewise match for the
resolved Bun declaration inputs. Both diff commands returned 0. There was no
source, package, lock or measured type-input drift during the run.

Receipts: `C/pin-and-baseline.log`, both source/type manifests and
`C/provenance-and-cleanup.log`. An initial inspection assumed a flat
node_modules/bun-types path, which does not exist in this isolated install;
the actual linked 1.4.4 path above was then resolved and fingerprinted.

## Exact commands and terminal receipts

```sh
QUIRE_TEST_CHROMIUM=/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  bun run test tests/ui-editor/assistant \
  --config=docs/evidence/p3-assistant-verification/bun-1.4.4-current/bunfig.toml

./node_modules/.bin/tsc -p tests/ui-editor/assistant/tsconfig.json

./node_modules/.bin/oxlint --type-aware --deny-warnings \
  apps/web/src/features/editor/assistant tests/ui-editor/assistant
```

| Command | Result | Receipt |
| --- | --- | --- |
| Assistant package-script target, one invocation | 22 pass / 0 fail / 68 expectations / 100.31 seconds / exit 0 | C/assistant-suite.log; bash_35 completed exit_code 0 |
| Owned strict compiler with current types | TSC_CURRENT_EXIT=0 | C/static.log; bash_37 completed exit_code 0 |
| Scoped type-aware lint | LINT_CURRENT_EXIT=0; STATIC_CURRENT_EXIT=0 | C/static.log; bash_37 completed exit_code 0 |
| Source/type comparisons | Both diff exits 0 | C/provenance-and-cleanup.log |
| Terminal session outputs | Full actual exits retained | C/process-receipts.log |

The appended config is evidence-only. `C/redirect-evidence.ts` replaces only
the producer browser helper's generated-evidence directory literal with
`C/browser`. It does not replace the panel or service, alter assertions,
change test selection/timeouts, add error filters, or retry tests. The full
selection was run once; there was no retry loop and no fallback to either
global 1.3.14 or the producer's comparison process. No production source,
fixture source, dependency or workstation setting was edited by this verifier.

## Previously failing native cases now independently pass

| Case | Current 1.4.4 receipt |
| --- | --- |
| Actual AI branch and commit only on acceptance | PASS, 4479.10 ms |
| Explicitly opted-in shared chat persistence and clear | PASS, 5662.41 ms |
| Reviewed per-edit acceptance durably across reload | PASS, 4841.80 ms |
| Private session clear through actual endpoint | PASS, 4285.02 ms |
| Real exhausted shared-usage denial | PASS, 5367.85 ms |

The other 17 cases also passed in the same selection. They cover confidential
policy blocking, consented HTTP image upload, exact UTF-16 context and all
selectable tools, opaque-term consent/revocation with actual user versions,
cancellation, viewer access, live authorized terminal SSE, rejection without
source mutation, durable undo with no new inference charge, model/preferences
and unconfigured-provider/model states, regeneration charging, and retained
Agent review after private/shared chat clearing. The log contains no EBADF,
native admission/repository failure, HTTP 500, between-test error or timeout.

## Fresh browser artifacts and unfiltered errors

All **40 current-runtime PNGs** were opened and inspected: pending, conflict,
viewer, unconfigured and usage-denied, each at 1440 and 390 CSS pixels, in
light and dark, at top and scrolled end. All signatures/dimensions/hashes and
the inspected-image inventory are retained in `C/verification-summary.json`.
They show the actual exported panel driven by the real service fixture, not a
copied reference or prior-runtime screenshot. No blank, black, browser-chrome
or obvious overlap capture was accepted as a successful frame.

All 20 fresh layout probes were inspected: no horizontal document overflow,
and qa-assistant__body is the recorded main scroller. Every current raw-error
file was read: **22 files, 17 empty and 5 containing one expected denial
console message each** (HTTP 400, 403, 403, 429 and 503). No raw file was
filtered or overwritten. No page exception or HTTP 500 was recorded. The
intentional AI_UNCONFIGURED request.failed diagnostic also remains in the
terminal test log; a passing denial case is not described as zero errors.

`C/browser/sse-observation.json` retains authorized queued, running and
succeeded operation.changed frames, rawErrors=[], and actual succeeded run
metadata. It passed without Refresh or a polling workaround.

These current artifacts are distinct from the prior standalone manual mobile
workflow and its 96 PNGs under H/independent. Those older receipts retain their
Bun 1.3.14 provenance; they are not relabelled as new 1.4.4 executions.

## Requirement ledger and residual scope

The current ledger has **24 PASS and 4 FAIL/coverage-gap rows**, while the
specific requested current-runtime functional/static gate is PASS. FAIL here
identifies an integration or broader visual proof this target does not supply,
not a remaining observed failure in the 22-case selection. Historical workflow
proofs and historical verdicts remain separately labelled in
`C/requirements.json`; no missing proof is manufactured by changing runtime.

| Producer requirement | Current verdict | Current proof or limit |
| --- | --- | --- |
| Final handoffs and real named exports | **PASS** | Current index/types compile under changed Bun types; final handoffs were already read. No export was replaced. |
| Ask/Agent and all 20 selectable tools | **PASS** | Current explicit UTF-16/tool-values case passed; all 20 options retained. |
| Explicit selected file and exact UTF-16 range | **PASS** | Current explicit UTF-16 range test passed against the provider context; no unchecked file was silently added. |
| Diagnostic/log consent and actual Error Fix compilation | **FAIL** | Unchanged coverage gap: fixture diagnostics=[] and compile=null. Current target does not exercise actual diagnostic/recompile integration. |
| Consented PNG/JPEG attachment surface | **PASS** | Current real-HTTP consented PNG image case passed, including actual provider image envelope. JPEG execution was not separately added. |
| Explicit translation target and read-only Ask | **PASS** | Historical standalone translation proof remains labelled Bun 1.3.14; panel source is unchanged. Current 22-case target does not separately execute translation. |
| Generate/regenerate/current-run cancellation | **PASS** | Current cancellation and regeneration cases passed, with real provider count and shared-use accounting. |
| Real run status/version/errorCode/conversationId | **PASS** | Current live-SSE case passed; fresh pending/conflict captures show real version, run ID, error and conversation metadata. |
| Source unchanged before approval and after rejection | **PASS** | Current reject case passed and asserted durable source unchanged; pending proposal generation did not publish source. |
| Actual all-edit acceptance and undo persistence | **PASS** | Current accept-across-reload and undo-across-reload cases passed; undo made no extra provider invocation. |
| Complete per-edit/all decision verification | **PASS** | Current target proves per-edit Accept plus all-edit reject/undo and optional-branch acceptance. Not every permutation is separately multiplied into a test. |
| Optional actual AI branch and commit | **PASS** | Current actual AI branch/commit-on-acceptance case passed in 4479.10 ms. |
| Intervening-source conflict retention | **PASS** | Current intervening-source conflict case passed; all eight fresh conflict images inspected. |
| Retained local recovery source | **FAIL** | Unchanged gap: no genuine retained-local-recovery fixture/capture is produced by the current target. |
| Retrieved-source provenance display and source navigation | **FAIL** | Unchanged gap: no retrieval-publication UI result or nontrivial navigation fixture is produced by this target. |
| Server consent metadata, renewal and revocation | **PASS** | Both current opaque-terms/current-user-version consent acceptance and revocation cases passed. |
| Persisted model/style/mode/inline/error/retrieval preferences | **PASS** | Current model-preference persistence passed. Broader style/mode/inline/error/retrieval toggle proof remains historical standalone evidence, not a relabelled current run. |
| Missing provider/model configuration states | **PASS** | Current missing-provider and missing-model cases passed, preserving actual AI_UNCONFIGURED and absent-consent denials. |
| Actual quota and monthly usage surface | **PASS** | Current exhausted shared-usage case passed in 5367.85 ms; fresh usage-denied matrix captured. Actual zero-allowance denial, not the producer comparison. |
| Viewer, confidential-policy and offline restrictions | **PASS** | Current viewer/confidential cases passed and viewer matrix inspected. Real CDP-offline toggle proof remains historical only. |
| Private/shared chat clear and persistence as a complete gate | **PASS** | Current shared-chat persistence/clear, private clear, and retained Agent acceptance after both private/shared clear all passed. |
| Live authorized terminal SSE without polling | **PASS** | Current authorized queued/running/succeeded SSE frames retained with rawErrors=[] and no Refresh/polling workaround. |
| Real token-driven DOM and responsive light/dark layout | **PASS** | All 40 fresh current-runtime PNGs inspected; 20 layout probes have no document overflow and declare qa-assistant__body as scroller. |
| Visual baseline and independent dual-oracle approval | **FAIL** | Existing broader visual coverage gap remains: inherited 13px desktop body finding, no dual-oracle approval or full 1920/zoom/keyboard/CJK/motion matrix. No new runtime blocker is inferred. |
| Pinned native full-suite gate | **PASS** | Current independent run: Bun 1.4.4, 22 pass, 0 fail, 68 expectations, 6 files, 100.31 seconds, exit 0. Exactly one selection run. |
| Owned strict tsc and scoped type-aware lint | **PASS** | Current changed-type strict tsc exit 0 and scoped type-aware lint exit 0; no type/assertion or error suppression was added. |
| Owned resource cleanup | **PASS** | Current cleanup receipt retains only baseline root 8srchV and pre-existing editor servers 559395/688441; both verifier sessions exited 0. |
| Hard write-boundary compliance | **PASS** | Current run uses a new evidence-only config and writes to bun-1.4.4-current/browser. Earlier routing incident remains historical FAIL and is not erased. |

The remaining integration gaps are actual diagnostic/log and Error Fix
compilation (the fixture supplies diagnostics=[] and compile=null), genuine
retained-local-recovery behavior, and retrieved-publication/nontrivial source
navigation UI. The existing broader visual baseline/approval gap also remains:
the desktop 13px body-token finding and absence of dual-oracle/full
1920px/zoom/keyboard/motion/CJK proof are not resolved by a runtime change.
These limits are disclosed; this follow-up did not silently broaden its scope
into producer edits or unrelated fixture work.

No live provider credentials were supplied. This loopback run establishes
service/UI contracts and durable governance, not live external inference,
provider reliability, citation availability, PostgreSQL execution or complete
editor/deployment approval.

## Cleanup and historical preservation

The passing suite disposed its owned browser, application and temporary roots.
The final probe has **no newly owned assistant root or running assistant test,
fixture, Vite child or Chromium resource**. Only the exact baseline
`/tmp/quire-assistant-ui-8srchV` and pre-existing unrelated editor-server PIDs
559395/688441 remain. They were not touched. Both verifier background sessions
finished with exit 0. The global binary remains 1.3.14. The parent-owned isolated
comparison executable remains parent-owned and was neither invoked nor removed.
Cleanup proof is in `C/provenance-and-cleanup.log` and
`C/process-receipts.log`.

The complete previous independent report is preserved verbatim at
`H/bun-1.3.14-historical-handoff.md`, alongside its 17-pass/5-fail native log,
original static receipts, raw errors, images and requirement ledger. That
report's old-runtime release-blocking language is historical and is superseded
by the current runtime-gate verdict above. The earlier evidence-routing
boundary incident remains disclosed in `H/evidence-routing-incident.md`; it
was not erased or repeated by this current-runtime run. No old-runtime fix or
global upgrade is a pending task for this verification.
