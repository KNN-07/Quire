# P72 project search: independent integrated verification

Audit date: October 29, 2026. Reviewer task: `st_01a1868c`.

## Verdict

**FAIL for unconditional P72 acceptance: two P2 defects remain.** The actual
Assistant-to-model-to-native-search workflow exists and passes its retained
tests. I found no cross-project/branch authority override or discovered-file
edit-authority bypass in the reviewed path. However, long-line matches can
return excerpts containing none of the matched text, and the new protected
credential check omits the returned file path.

This is an independent code and retained-evidence review, not acceptance based
on producer completion. The parent owns corrections, regression execution and
final root validation. No source, test or matrix file was changed; no test,
build, service, browser or live-provider run was launched by this audit.

## Findings, ordered by severity

### F1 - P2 FAIL: the credential guard excludes a disclosed source field

References: `services/adapters/ai/project-search.ts:54-58`,
`services/adapters/ai/project-search.ts:65-72`,
`services/adapters/ai/provider.ts:120-123`.

The search guard checks `text.includes(checked.settings.secret)` but then
returns `document.file.path` without checking it. That path also enters
`manifest_json` before the next provider request.

Concrete triggering input: with the fixture's configured credential
`fixture-ai-key`, add an editable source named `fixture-ai-key.tex` containing
`document harmless content`. Invoke an opted-in search for `document`.
The excerpt text passes the credential guard, but the tool result contains
`"path":"fixture-ai-key.tex"` and the next completion sends it to the model.
The manifest retains the same path. The existing protected-content test puts
the credential in the text only, so it does not cover this case.

This is a narrow failure of the implemented protected-credential boundary,
not a way to read an unknown credential from configuration or a claim of
cross-project access. Evidence is the complete code path above; this audit
did not launch a new runtime reproduction.

Minimal fix: check the returned path as well as the excerpt text before
adding a hit to `hits`/`excerpts`, preserving the existing
`PROVIDER_SECRET_LEAK` failure. Add the path case beside the existing
protected-content regression and assert there is no second model request
or secret-bearing manifest.

### F2 - P2 FAIL: long-line search hits lose the matched text

References: `services/adapters/ai/project-search.ts:47-53`,
`services/core/base/search-worker.ts:15-18`,
`services/core/base/limits.ts:10-21`.

Native search supplies a one-based UTF-16 `column`, but excerpt construction
ignores it. Every hit starts at the beginning of its line and ends at most
4,096 code units later. Editable sources allow lines longer than that.

Concrete triggering input: an editable file whose line is
`"x".repeat(5000) + "late-search-token"`, queried for `late-search-token`.
The worker returns column 5001. The current excerpt is `[0,4096)` and contains
only `x`, not the match. Repeating the query returns the same unusable prefix;
the query-only tool has no offset/read operation with which to recover the
actual matching text. A similarly long TeX paragraph has the same problem.

I evaluated the exact offset arithmetic without starting a test or service:
`nativeWorkerColumn=5001`, `returnedFrom=0`, `returnedTo=4096`,
`excerptLength=4096`, `excerptContainsQuery=false`. The native Unicode bound
test uses `document` at the beginning of every line and therefore cannot
detect this.

Minimal fix: use the line start plus `match.column - 1` to place a bounded
window at or around the actual match, retaining valid UTF-16 boundaries and
accurate absolute `from`/`to`. Add a native long-line case proving that the
returned excerpt contains the late match and equals the corresponding
document slice.

## Integrated invariant assessment

PASS below means the stated, bounded property is supported by the reviewed
code and the evidence named here. It does not erase F1/F2 or imply that every
possible interleaving has a dedicated test.

| Result | Property and concrete evidence |
| --- | --- |
| PASS | **Default-off API and supported tools.** `packages/contracts/src/routes-adapters.ts:61` makes `projectSearch` an optional boolean. `services/adapters/ai/service.ts:70-76` rejects true for tools other than Chat/TeXGPT before dispatch. `execution.ts:73-76` creates the capability only for opted-in requests. Native tests cover omission, unsolicited calls and unsupported grammar requests. |
| PASS | **Authenticated, server-owned authority.** `ai/routes.ts:10-25` derives the actor/session from authenticated identity, verifies mutation authority and rejects URL/body project mismatch. `project-search.ts:10` accepts only a bounded query; `model.ts:41-42` derives scope/actor from the admitted run. Model arguments cannot select a project, branch, actor, session, file, URL or filesystem path. The authority-argument regression fails before a second provider request. |
| PASS | **Actual core scope enforcement.** `ai/store.ts:19-58` checks project read authority, active session, current AI terms, confidentiality, provider configuration/enabled state and intersected policy. `core/base/access.ts:17-45` checks the active user, project membership/link authority and branch existence. `core/base/store.ts:40-53` resolves files through the exact project/branch; `core/base/source.ts:43-58` reads that branch's native document. There is no separate per-file ACL in this read contract: the explicit AI authorization plus branch-scoped reads is the applicable authority boundary. The native workflow excludes a second project's file even though the same actor can access it. |
| PASS | **Rechecks at search and outbound admission.** `project-search.ts:20-45,60-74` rechecks authorization and running status under `quire:accounts` before each search, after collecting hits and before every completion dispatch. `store.ts:101-112` also fences provider/operator configuration versions and changed model preference. `execution.ts:94-103` repeats the fence at final publication. Session, configuration, cancellation and confidentiality changes are exercised at controlled provider responses. Policy/membership/operator-version variants are supported by the shared code path, not individually exercised by these 20 P72 tests. |
| PASS | **Discovered-source freshness.** The first search captures branch ID/revision/epoch. Every later check compares those plus each discovered file's path, epoch/revision and exact excerpt text (`project-search.ts:26-35,44`). Source finalization takes the same accounts lock (`core/base/source-records.ts:54-56`). `provider.ts:78-83` runs the outbound check before each model call; `execution.ts:97` checks again before publishing. The native changed-source test commits a real source change during the second provider response and gets `AI_CONTEXT_STALE`, canceled status and no messages. |
| PASS | **Bounded model protocol.** `provider.ts:12-18,75-125` permits only `project_search`, validates the complete returned call batch before executing it, rejects malformed JSON/arguments, unknown names, duplicate IDs and excessive calls, and executes at most three searches. At most four completion requests occur; after search three, `tool_choice` is `none`, and ignoring it fails closed. Each query is trimmed, nonempty and at most 1,000 UTF-16 code units. The native logs exercise these paths, including duplicate IDs and four calls in one response. |
| PASS, with F2 | **Result and context size bounds.** `project-search.ts:47-53` returns at most ten hits **per search** (at most thirty across three searches), each at most 4,096 UTF-16 code units, with surrogate-safe end boundaries. `context.ts:10-14` and `provider.ts:78-80,123` enforce the 256-KiB serialized aggregate-message cap before disclosure. The Unicode/count and oversized-model-content tests pass. Size correctness does not imply that the bounded window includes its match; F2 is the missing behavior. |
| PASS | **Existing text-source exclusions, not arbitrary file reading.** `core/base/search.ts:19-23` skips folders and noneditable binary, oversized or linked files. Native source materialization makes linked sources noneditable (`core/base/source.ts:103-107`). Search obtains actual text via core reads, not a provider-side filesystem/network tool. The model receives IDs, paths, absolute ranges, text and versions from these reads. |
| FAIL, F1 | **Protected credentials.** Exact configured credentials in excerpt text are blocked before the second request; the retained boundary test proves it. Provider-message/output checks also exist at `provider.ts:95-97,130-132`. The returned source path is an unchecked disclosed field. These checks are not a general detector for all secrets in project content. |
| PASS | **Discovered excerpts cannot authorize proposals.** `execution.ts:79-80` rejects all Ask patches and passes only the original `selected.files` to `proposals`. `proposals.ts:10-21` checks original ID/path/range/base text, Unicode boundaries and overlaps. Discovered files never join that input. The native discovered-file Agent patch is rejected with `AI_PATCH_INVALID`, no proposals and unchanged source. `decisions.ts:23-41,95-130` retains explicit reviewed decision, current write authorization and live-source checks. |
| PASS | **Private Ask retention and actual manifest.** `admission.ts:31-32` redacts private Ask prompt/selection text. `conversations.ts:13,49-56` keeps private history in memory by session/project/branch. `execution.ts:108-115` does not persist private Ask messages/findings. `project-search.ts:65-72` stores deduplicated actual selected/discovered file IDs/paths and a digest of outbound messages, not raw queries or excerpts. The native test verifies the discovered file manifest, digest, absence of private prompt/source in the receipt and unchanged source. The manifest represents files supplied as context, not every file scanned internally. |
| PASS | **Optional logging preserves the retention boundary.** `request-log.ts:9-14,24-29` retains encrypted content only for admitted retained conversations/Agent requests; private Ask has no raw request/response log. Tool queries/results do not enter that logging path. Search-derived text may legitimately appear in a retained model answer; this is different from persisting raw tool transcripts. |
| PASS | **One run allowance, cancellation and no automatic paid replay.** `admission.ts:18-38` provides session-key idempotency and one usage reservation. `execution.ts:59` marks it dispatched once, outside the tool loop. Search does not reserve usage again. The native two-completion test reports one use. `service.ts:144-163` cancels with a version check and aborts the local controller; only reserved usage is refunded. `execution.ts:103,131-135` rejects late publication and preserves dispatched-use accounting. `service.ts:41-47` fails interrupted expired leases rather than replaying calls. |

## Actual consumer and visual evidence

**PASS for the requested consumer scope.** This is the production Assistant
composer, not a standalone mock. `apps/web/src/features/editor/assistant/Composer.tsx:17`
initializes false; lines 66 and 119 gate the request field and checkbox to
Chat/TeXGPT; line 114 clears the choice on a tool change. The choice is local
React state, not an account/storage preference. `Context.tsx:27-28` distinguishes
explicit file selection from separately enabled search. Lines 122-125 of the
composer disclose provider transfer and the original-selection edit boundary.

The passing UI fixture first sends without search and receives no advertised
tools. It then opts in and sends through the actual `aiRunCreate` HTTP route.
The configured loopback model HTTP fixture asks for `project_search`; the
server supplies native `main.tex` excerpts in its next request. It finally
observes a succeeded Ask run with no proposals and unchanged native source.
The fixture checks unsupported-tool hiding, cleared choice on tool change,
default-off after reload, no horizontal document overflow and no page errors.

Retained consumer directory:
`docs/evidence/p72-project-search-ui/d63155d6-d6b6-44ec-a1d6-bff9659cedb2`.
I opened and visually inspected all four files, not just their filenames:

| Screenshot | Result |
| --- | --- |
| `consent-1440-light.png` | PASS: the checked control, two-line label and provider/read-only disclosure fit the Assistant column without overlap. |
| `consent-1440-dark.png` | PASS: the same region is legible with the dark surfaces and visible checked state. |
| `consent-390-light.png` | PASS: the drawer shows the full wrapped search label and disclosure without horizontal clipping or overlap. |
| `consent-390-dark.png` | PASS: the same consent region remains legible in the dark drawer. |

These are 1440x900 and 390x900 Chromium viewport observations. The form extends
below the captured region; the screenshots do not prove that every action is
simultaneously above the fold. The successful Send occurs after returning to
desktop width, not as a separately proved physical-mobile Send workflow.

The existing responsive sidebar/drawer remount clears unsent composer state.
The test explicitly renews consent and message after resize. Its mobile
screenshots accordingly show an empty message, not preserved pending text.
The checkbox otherwise remains selected while the same composer stays
mounted, including after a Send; this report claims default-off/no persisted
preference, not automatic one-shot clearing after every request.

`workflow.json` contains three captured completion requests: one unopted
request, one opted-in initial request, and one with three actual `main.tex`
hits. The final run ID is `0109821a-05f1-4c23-abc1-4ccb92a38002`; it is
`succeeded`, Ask/Chat, with empty proposals and `errors: []`. The fixture's
capture schema omits assistant `tool_calls` and `tool_call_id`; correlation
is covered separately by the backend test rather than overclaimed from this
JSON transcript.

`cleanup.json` reports `/tmp/quire-assembly-mTOdgo` absent and `errors: []`.
`passing-run.log` records matching `ASSEMBLY_INTEGRATION_OWNED` and
`ASSEMBLY_INTEGRATION_CLOSED` addresses on ports 33633/36825. The producer
handoff separately records cleanup of an earlier failed fixture; I did not
relaunch it or independently inspect historical process state. No port 5173
takeover is part of this evidence.

## Test evidence and root-check disposition

| Evidence read | Observed result |
| --- | --- |
| `docs/evidence/p72-project-search-backend/workflow.log` | Exit 0; 11 pass, 0 fail, 53 assertions. |
| `docs/evidence/p72-project-search-backend/boundaries.log` | Exit 0; 9 pass, 0 fail, 57 assertions. Combined native P72 evidence: 20 pass, 110 assertions. |
| `docs/evidence/p72-project-search-ui/passing-run.log` | Exit 0; 1 pass, 0 fail, 23 assertions; the retained directory above is named in the log. |
| `docs/evidence/p72-project-search-backend/integrated-validation.log`, as read during this audit | Legacy affected tests: 16 pass, 0 fail, 41 assertions, `P72_LEGACY_EXIT=0`. Scoped types: `P72_SCOPED_TYPES=000`. Root sequence: `P72_ROOT_EXITS=0100`, overall exit 1 because lint failed. Typecheck, mapping and production build completed; the mapping output explicitly says `behavioralAcceptance: false`. |

The root lint record names an unused `answer` import in
`tests/adapters/ai/project-search/boundaries.test.ts:5` and a redundant
`unknown` union in `tests/adapters/ai/project-search/provider.ts:21`.
The current files inspected by this audit already omit those two patterns.
That is evidence of source correction, not evidence of a successful root
rerun. Any subsequent root result is parent-owned and is not assumed here;
the audit neither waited nor polled for it.

The native harness subscribes to a terminal operation event before creating
the run and uses a bounded timeout (`tests/adapters/ai/harness.ts:85-109`).
P72 tests synchronize mutations through the actual provider response instead
of fixed sleeps. The UI joins its response wait and click promises and
disposes its resources in `finally`; the captured passing result is not a
claim that the earlier failed fixture attempts passed.

The earlier broader-AI result of 95 pass / 2 consent-guard failures was
identified as pre-existing in the task/handoff. It was not rerun, repaired,
suppressed or reclassified as green by this audit.

## Unproved limits and acceptance boundary

- F1 and F2 are code findings with explicit triggering inputs, not newly run
  regression failures. Their fixes and native regression evidence remain
  with the parent.
- Freshness checks cover discovered sources from the first search snapshot
  onward. They do not add a new freshness invariant for the original
  explicitly captured selection before that first search, nor revalidate
  all text in earlier conversation history.
- Outbound checks are application admission fences before HTTP dispatch.
  The retained tests mutate authority/source while provider responses are
  controlled; they do not prove atomic revocation with physical socket
  transmission or withdrawal of bytes already sent.
- Read-only access, same-branch native text search and inherited exclusions
  are the elected capability. Arbitrary binary/linked file reads, general
  `read_file`, shell/network access and commercial Assistant/TeXGPT tier
  eligibility are not implemented or promised by this evidence.
- No live model compatibility, physical device, full accessibility,
  exhaustive distributed race or full-suite green claim is made. Root
  acceptance remains parent-owned. P71 Source visual acceptance is separate
  and was not reopened.

Only this report was created. The audit chose narrowly actionable failures
over speculative changes to unrelated AI behavior or already accepted P71
surfaces. Documentation diagnostics were unavailable because no Markdown LSP
server is configured; this prose-only report required no build or test run.
