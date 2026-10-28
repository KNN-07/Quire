# P3 governed assistant panel

Owner: `st_01a17cdf`. October 27, 2026.

Status: **FINAL owned-component acceptance on parent-selected project-local
Bun 1.4.4.** Matching 22/22 coverage is reused; the six historically failing
cases passed a fresh package-local rerun, and current owned strict types/lint
pass. Historical global-1.3.14 failures remain preserved. This does not claim
assembled-editor acceptance, live provider availability or an upstream FD cause.

## Current project-local acceptance

Evidence:
`tests/ui-editor/assistant/evidence/project-local-bun-1.4.4-1793106758876/`.
The installed local binary is 1.4.4 and its SHA-256 exactly matches the
controlled comparison. `package.json`, lockfile and `.bun-version` now select
the parent's project-local runtime; global binary/PATH were not changed here.

New acceptance uses **`bun run test <targets>`**, which invokes local 1.4.4.
Bare global `bun test` remains the obsolete 1.3.14 baseline and must not be used
for new acceptance. No additional obsolete-baseline run was made.

The unchanged assistant/test inputs reuse the full 22-pass comparison below.
For current runtime typing and previously failing behavior, one actual
package-script run passed **6 tests, 0 failures, 20 expectations, 35.51 seconds,
exit 0**: branch/commit acceptance, cancellation, live no-polling SSE,
rejection, regeneration and retained private review. Its log confirms Bun
1.4.4. Current owned strict TypeScript and type-aware lint also exited 0.
The real required WebSocket handler is used; no optional no-op was added.

All six fresh browser error files are empty. Eight current pending-review
captures were opened and inspected across desktop/mobile and light/dark.
Before/after temporary-root inventories match, and no active owned suite or
new fixture root remains. The old `/tmp/quire-assistant-ui-8srchV` stays retained.

Parent editor assembly and PDF-panel changes occurred during the checks and
are recorded in `during-checks-diff.txt`; they are outside this standalone
surface's imports. No frozen whole-repository or assembled-editor result is
claimed. The matching full-suite receipt, old failure logs, input manifests
and runtime-labeled captures remain intact.

## Historical global-1.3.14 check after native Git delivery

Evidence:
`tests/ui-editor/assistant/evidence/runtime-fix-bun-1.3.14-1793104189924/`.
Its unfiltered `native-assistant-runtime-fixed.log` records one full run on
default Bun 1.3.14: **16 pass, 6 fail, 1 error, 48 expectations, 272.79 seconds,
exit 1**. No owned UI/test code or error filter changed.

Operator login during retained-private-review fixture configuration returned
HTTP 500 after `EBADF: bad file descriptor, close` at
`native-admission.ts:27`. The other failures were a branch decision response
timeout, cancellation timeout/`SuppressedError`, closed-browser SSE evidence,
proposal rejection `SuppressedError`, and closed-browser regeneration setup.
One raw browser file preserves three `net::ERR_NETWORK_CHANGED` messages.
No single cause is asserted for all failures.

Before/after source manifests match, and that recorded source set also matches
the earlier isolated 1.4.4 snapshot. The submitted helper paths were inspected
and loaded; notification timing is not treated as proof of a source change
between these two runs.

The failed run's exact orphan Vite child (PID 2995480) was terminated with
SIGTERM and its exit observed before removing only the newly owned root
`/tmp/quire-assistant-ui-z8kS5V`. Final cleanup restores the pre-existing
`/tmp/quire-assistant-ui-8srchV` inventory and shows no active owned suite.
Raw errors and runtime-labeled artifacts remain in the evidence directory.
The runtime/startup issue is reported without a UI workaround or filtered error.

## Matching 1.4.4 full-suite comparison

Comparison evidence:
`tests/ui-editor/assistant/evidence/runtime-comparison-bun-1.4.4-1793103403109/`.
Its `README.md` records the exact command, binary digest and artifact provenance.

The supplied isolated Bun 1.4.4 binary ran the exact full assistant command
once: **22 pass, 0 fail, 68 expectations, 6 files, 85.79 seconds, exit 0**.
Before/after source manifests match exactly, including current event readers,
AI registration, runtime and owned UI/test inputs. No suite ran concurrently
against the owned evidence directory.

Actual review rejection, reload-persistent acceptance and undo, intervening
source conflicts, real branch/commit acceptance and retained Agent review after
both private/shared chat clearing passed. Live terminal SSE also passed without
Refresh or polling. The separate pre-comparison 1.3.14 live-SSE visual runner
passed its generation/accept/undo source assertions and retained 24 inspected
review captures with zero browser errors.

At that comparison checkpoint, the 1.3.14 review/advanced run was 6 pass / 1 fail: the conflict case
timed out after `native-admission.ts:41` reported an FD close error during SSE
authorization. Its log and earlier full-suite receipts/source fingerprints
are preserved under `baseline-bun-1.3.14/`. This is not represented as a
same-input full-suite paired baseline or proof of the upstream FD cause.

Forty captures created/replaced by the comparison, their layout probes and
raw errors are explicitly runtime-labeled under `bun-1.4.4/` and fingerprinted
in `artifacts-bun-1.4.4.sha256`. All 22 raw-error files were inspected: 17 empty,
5 containing expected HTTP denial console messages only; no page exceptions.
All eight comparison conflict captures were opened and inspected. Archived
`review-*` captures remain labeled Bun 1.3.14.

No new assistant temporary roots or owned suite processes remain. The
pre-existing failed-run root `/tmp/quire-assistant-ui-8srchV` was retained
unchanged, as recorded by equal before/after root inventories. Default Bun
remains 1.3.14; no global installation, repository pin or PATH was changed.

## Exports and assembly

Entrypoint: `apps/web/src/features/editor/assistant/index.ts`.
Named value export: `AssistantPanel`. Named type export: `AssistantPanelProps`.

```ts
type AssistantPanelProps = {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly document: EditorDocument | null;
  readonly selection: SourceSelection;
  readonly navigation: EditorNavigation;
  readonly compile: CompileController | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly refreshWorkspace: () => Promise<void>;
};
```

Types are imported from the existing shared contracts, except `Diagnostic`
from `@quire/contracts`. Supply this node to the existing `EditorSlots.assistant`.
The panel does not add a shell or router.

`refreshWorkspace` must refresh authoritative file metadata and recreate the
transport/document when the published epoch changes. Calling `open` on a cached
old transport is insufficient. Preserve pending local recovery text before
disposing a document. The panel flushes the active document before capturing
context or making review decisions, never calls `replace` or mutates Y.Text,
and displays recovery state and retained local text rather than overwriting it.
The owned browser surface demonstrates fresh transport creation on epoch changes.

## Implemented surface

All 20 `AiToolSchema` values are selectable. Ask is read-only; Agent proposes
reviewed changes. Explicit context includes selected file IDs, an opt-in
UTF-16 range with active filename and exact text preview, a chosen diagnostic
and log-excerpt consent, and consented PNG/JPEG uploads. Translation has its
own target-language field.

Every backend action uses the injected typed client and scoped project headers.
Run ID, status, version, errorCode and conversationId are real DTO values.
Generation/regeneration, current-version cancellation, all/per-edit
accept/reject/undo, conflict reporting, optional real branch/commit, source
navigation and post-accept Error Fix recompilation are bound to governed
endpoints or the supplied real controllers. Pending/accepted edit IDs are sent
explicitly so partially decided runs do not misuse the backend's `[]` all-edits
semantics.

Consent loads authenticated `aiConsentGet` metadata. Required/accepted terms are
read-only server values; no terms input or date default remains. The checkbox
starts from the server's `current` field, so accepted but superseded terms
require renewal. Existing `aiConsent` POST sends the displayed
`requiredTermsVersion` and `expectedVersion: userVersion`, never the preference
version or a `/api/me` ETag. After acceptance/revocation it reloads actual
metadata. Model/style/default-mode/inline/error/retrieval settings persist
through `preferencesPatch`.

## Server-consent follow-up

The panel consumes the landed authenticated `GET /api/me/ai/consent`. Its
required terms come from configured `AiStore.termsVersion`; accepted terms and
`userVersion` come from actual stored consent/account state. No provider
credential or existing consent is needed for this read. The original privacy
disclosure remains visible, including external provider retention and
session-local private Ask history.

Absent, obsolete, and revoked consent all start unchecked from `current: false`.
Required/accepted versions are static text, not editable controls. Existing
`POST /api/me/ai-consent` receives the returned required version and
`expectedVersion: userVersion`, then GET is reloaded.

| Follow-up check | Actual result |
| --- | --- |
| Strict owned TypeScript, type-aware lint, draft guard | Exit 0; 25 files clean; `consent-static-final.log` |
| Owned component diagnostics | 0 diagnostics across 6 TSX files |
| Renewal with opaque non-date terms and user version distinct from preference version | Passed against actual HTTP/SQLite state; verified current consent after reload |
| Combined two-case native run | 1 pass / 1 fail, exit 1; second fixture failed before the UI at `repository-process.ts:27`, `EBADF: bad file descriptor, epoll_ctl`; `consent-persisted-native.log` |
| Current-consent revocation, isolated native process | 1 pass / 0 fail, 4 expectations; actual persisted revoked state; `consent-revoke-native.log` |
| Fresh consent captures | Four `consent-after-{1440,390}-{light,dark}.png` files opened and inspected; static opaque terms, retained privacy disclosure, no overlap; `consent-after-errors.json` is `[]` |
| Genuine pre-edit consent baseline | Unavailable: shared Node browser-host connection timed out before rendering; retained `consent-before.log`. No baseline was reconstructed |
| Cleanup | Owned processes closed; no temporary assistant SQLite roots remain; `consent-cleanup.log` |

These initial consent receipts did not constitute a clean combined/full-suite
gate. The later isolated 1.4.4 comparison above passed both cases together with
the full current suite. The 1.3.14 runtime FD failure remains preserved for its
owner. No root dependency was installed and no live-provider inference claimed.

Shared chat requires an explicit create/open action. Shared clear and private
session clear are distinct endpoints, with Agent audit retention stated.
Late run reads are fenced from restoring cleared/switched chat. Actual monthly
used/reserved/refunded counts and the owner-controlled confidential label are
shown. Missing provider/model configuration, consent/quota/policy denials,
viewer restrictions and offline/recovery states are visible without fabricated
provider output.

Clearing either private or shared chat preserves separately governed Agent
review. Both retained-review paths were accepted through real HTTP after clear;
the inverse source/publication behavior is not replaced with a local editor edit.

The component uses the existing Plex fonts, shared controls and light/dark
tokens. The local `DESIGN.md` records the brief, required content and
`.qa-assistant__body` scroll ownership. A real flex-shrink clipping defect in
run metadata was found in Chromium and fixed before the retained review matrix.

## Retained Bun 1.3.14 commands and checkpoint evidence

The commands in this historical section are retained provenance, not current
acceptance instructions. Use the project-local `bun run test` command above.

Runtime: native Bun 1.3.14 (`0d9b296a`). Chromium:
`/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`.

```sh
QUIRE_TEST_CHROMIUM=/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  bun test tests/ui-editor/assistant
./node_modules/.bin/tsc -p tests/ui-editor/assistant/tsconfig.json
bunx oxlint --type-aware --deny-warnings apps/web/src/features/editor/assistant tests/ui-editor/assistant
bun /home/norman/.omo/binary-runtime/5.1.48/plugin/skills/frontend/scripts/perfection/check-draft-guard.ts \
  apps/web/src/features/editor/assistant tests/ui-editor/assistant
QUIRE_TEST_CHROMIUM=/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  bun tests/ui-editor/assistant/visual-runner.ts
```

The owned strict config includes actual imported application/runtime/service
files; it is not a declaration-only panel check. The backend's unchanged
44-test receipt is reused from `p2x-ai.md`; no full backend rerun or live provider
claim is made.

| Check | Actual result | Receipt |
| --- | --- | --- |
| Full native assistant command on current parent imports | Exit 1; 14 pass, 4 fail, 18 tests, 49 expectations, 195.67 s; runtime failure below | `evidence/native-verified.log` (`bash_22`) |
| Unsuppressed no-Refresh SSE regression on current registered callback | Exit 0; 1 pass, 0 fail, 2 expectations, 4.75 s | `evidence/sse-native.log` (`bash_21`) |
| Agent review accepted after private/shared chat clear | Exit 0; 2 pass, 0 fail, 4 expectations, 14.03 s | `evidence/chat-review-native.log` (`bash_26`) |
| Current strict tsc, exact type-aware oxlint and draft guard | Exit 0; draft guard 23 files clean | `evidence/static-final.log` (`bash_27`) |
| Current owned LSP diagnostics | 0 diagnostics | `bash_28` tool receipt |
| Final real generation/accept/undo-after-reload matrix | Exit 0; one actual fixture inference, all three source assertions true, raw browser errors `[]` | `evidence/visual-verified.log`, `visual-workflows.json` (`bash_28`) |

The two chat-clear review regressions were added after that full native process
started; that checkpoint contained 20 test cases. The server-consent follow-up
adds two more cases, bringing the current directory to 22. No clean single-run
full gate is claimed from the earlier receipt. No test is skipped or weakened
to hide the native issue.

Evidence lives under `tests/ui-editor/assistant/evidence/`. The
`review-pending`, `review-accepted`, and `review-undone` groups each have
1440/390 light/dark top/end captures, layout probes and real source receipts.
Mobile capture uses CDP mobile/touch emulation at DPR 3. `visual-workflows.json`
records unchanged source after generation, accepted source, undo persisted after
reload, one provider call and raw browser errors. That dedicated visual runner
now waits for authorized browser SSE without manual Refresh or polling.
Its latest pre-comparison run is `review-events-visual.log`; the separate
unsuppressed SSE test also proves live delivery.

Additional browser states include pending, conflict, viewer, unconfigured and
usage-denied capture groups. `raw-errors-*.json` preserves original browser
console/page errors, including historical failures and expected HTTP denial
messages; none are rewritten or hidden.

All 24 latest Bun 1.3.14 `review-*` PNGs were regenerated after the server-consent
and event-reader updates and opened from the preserved comparison baseline:
pending/accepted/undone × 1440/390 × light/dark × top/end. Their
layout probes report matching viewport/document widths and the declared
assistant scroll owner. No overlap or clipped run metadata remains. Earlier
non-review capture groups are checkpoint evidence, not a claim that every one
was regenerated after later unrelated chat-state edits.

## Parent-owned delivery/runtime receipts

`docs/handoffs/p2x-events-delivery.md` supersedes the initially observed missing
AI SSE authorization branch. Current core calls `operationEventScope`; current
AI registration supplies `AiStore.accessible`. The owned no-Refresh regression
remains enabled. Its provider is held until the initial UI request settles,
then released without Refresh or polling. A second real authenticated SSE
reader records raw frames for comparison in `sse-observation.json`.

Retained dependency SHA-256 fingerprints (also matching the frozen comparison
manifest):

| File | SHA-256 |
| --- | --- |
| `services/core/review/events.ts` | `423366f9fbbcf8c4f01ea6f2a5fd17341774f2a08e54e8d3637fe7418e8155fb` |
| `services/core/review/operation-events.ts` | `c9317071566b813627b26c443f8fe5f0f5e78fbad95e7c97e10ef22a1459f8a7` |
| `services/adapters/ai/index.ts` | `f0248c7a41f61939534c073a09345b9070099a26f692bcec730780a93523ad1f` |
| `packages/runtime/src/repository-process.ts` | `100ea45c724cb7095d7da3cd2860b598c9f7da745f7c65b59914f859511dcc4d` |
| `packages/runtime/src/native-admission.ts` | `2dc6bc3c0da640966def64792e017497b0d3051189989cd673c01c3f78b48189` |

Fixture module order is real identity, core base, core review/realtime, core Git,
core catalog, shared connections/providers, references, then AI. AI contributions
and `retrieval: () => references.retrieval` are supplied to that actual runtime.
Storage is unique SQLite/blob/Git data with OS-assigned provider/API/web ports.
The provider is an explicitly named loopback HTTP fixture, never a production
fallback. Parent/server production adapter composition remains another owner's
path.

## Exact retained runtime blocker

The full run loaded the current **Bun.spawn** repository helper, not its old
Node-spawn implementation. It still observed:

```text
packages/runtime/src/repository-process.ts:27
await child.exited
EBADF: bad file descriptor, epoll_ctl

packages/runtime/src/native-admission.ts:39
finally { await gate.close(); }
EBADF: bad file descriptor, close
fd: 432
```

The latter occurred during `identity.require` in live SSE `deliver`. One branch
acceptance returned HTTP 200 and its actual Git ref/source assertions passed,
but the browser retained an unexpected HTTP 500; the test correctly failed.
The full-run image and SSE cases failed during native setup before their browser
actions. The full-run undo case timed out; its actual durable undo/reload
workflow subsequently passed in the final standalone visual run.

This is an observed native FD failure boundary, not a proven upstream cause
or the already-fixed missing AI event-reader branch. The parent raw FD probe
passed on both runtimes. The current no-Refresh test passed separately.
`sse-observation.json` retains actual authenticated queued/running frames, the
rendered succeeded/version-2 DTO and zero raw browser errors from that passing
run. No runtime, service, shared transport, router or shell file was changed by
this lane to work around it. Parent notification receipt: delivery
`bf57552f-fe6b-4ca2-8de5-eb9144f1c1d5`, parent turn 99.

The isolated 1.4.4 comparison now passes the current full command once. The
pinned 1.3.14 failure and any runtime adoption decision remain with the
parent/runtime owner and independent verifier. No client retry, polling loop
or mock production provider is substituted for that work.

## Verification boundary

The independent verifier is the parent DAG's `verify` node in `dag_9ca044a6`;
this lane does not spawn nested reviewers or claim their approval.
No Lighthouse score, human screen-reader certification, live external inference
or full assembled editor certification is claimed here.

The standalone fixture supplies `compile: null` and no synthetic compiler
controller. Real diagnostic IDs and a real compile controller are accepted from
assembly; diagnostic backend isolation is covered by the unchanged AI receipt.
No fake compile, PDF, model or publication result is supplied to production.

## Architectural review

Each source module owns one concern: panel composition, context, prompt,
review, preferences, conversation, notifications or assistant session state.
Owned source modules are below 200 pure lines. DTO/input parsing uses the shared
Zod contracts at boundaries; persistence-state handling is exhaustive; no
casts, non-null assertions, lint/type suppressions or direct source-write shim
were added. Reused state/read helpers have multiple consumers. Parameters remain
bounded, logging follows the existing application practice, and no prose/prompt
snapshot tests were introduced. Tests use actual HTTP/native storage/Git,
event subscriptions and bounded deadlines, not fixed sleeps or broad mocks.

Review answers: (1) each file has one named responsibility; (2) external values
parse at contracts/UI boundaries; (3) persistence variants are exhaustive;
(4) no escape hatches/suppressions; (5) nullable checks correspond to actual
nullable props or external values; (6) no speculative helper layer; (7) actual
source, clear, quota and event outcomes are tested; (8) no parameter-smuggling
helper; (9) no redundant production post-delete/set verification; (10) positive
state names; (11) no production logging or logger changes.

## Cleanup

Successful fixtures await browser/context closure, HTTP admission stop, AI and
references/shared shutdown, review/realtime disposal, runtime/database closure,
Vite child exit and exact temporary-root removal. Earlier failed assembly and
timeout roots are cleaned explicitly and retained in the final cleanup receipt.
No shared browser profile, Docker resource, application listener, git commit or
push is owned or modified by this lane.

Cleanup receipts `bash_14`, `bash_15`, `bash_25`, `bash_30` all exited 0. Five
initial orphaned assistant Vite children were sent SIGTERM. Exact stale roots
removed across failed/time-limited checkpoints:

```text
/tmp/quire-assistant-ui-y3HVZJ
/tmp/quire-assistant-ui-sRpcmS
/tmp/quire-assistant-ui-LFcaZQ
/tmp/quire-assistant-ui-52mJuo
/tmp/quire-assistant-ui-7Sw0la
/tmp/quire-assistant-ui-upa65z
/tmp/quire-assistant-ui-2JrKdg
/tmp/quire-assistant-ui-tWMgy4
/tmp/quire-assistant-ui-fw8hsq
```

Final process probe printed `ASSISTANT_OWNED_PROCESSES_CLOSED` (`bash_31`).
Successful final focused/visual fixtures performed their own awaited cleanup;
raw receipts and screenshots remain in the owned evidence directory.
