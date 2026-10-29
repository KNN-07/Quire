# P61 independent preferences verification

FINAL, October 28, 2026. Independent audit cutoff: 20:14:45Z.
**Overall acceptance: FAIL / incomplete.** This is a final verdict on the
available source and evidence, not a claim that all producer work is finished.
Missing/nonfinal producer evidence is incomplete, not passed. Later producer
revisions require a targeted follow-up; they are not preaccepted by this report.

## Per-preference verdict

| Control | Verdict | Actual effect and acceptance boundary |
| --- | --- | --- |
| `aiBranch` | **FAIL - incomplete verification** | Source defaults future unaccepted Agent approvals to `ai/<run-id>`, resets overrides by run ID, and sends branch creation only on Accept. No FINAL producer report or passing native approval receipt is available at cutoff. This is not a finding of automatic unapproved source mutation. |
| `shareAiChat` | **FAIL - incomplete verification** | Source defaults a future conversation choice; explicit Create/Open selects shared history and Send shares new messages. Saving has no conversation-publication side effect; empty creation and separate private/shared histories prevent copying old private messages in the inspected path. No passing native privacy/collaborator receipt or FINAL report is available. |
| `errorAssist` | **FAIL - incomplete verification** | Source gates real diagnostic offers, with tracking/editability/Viewer guards and consent at Send. The retained native attempt failed before completing that chain. No passing current native receipt or FINAL report is available. |
| `defaultEngine` | **FAIL - confirmed API defect and incomplete verification** | Ordinary service creation consumes the actor default and respects explicit engine precedence, but the actual dialog sends `engine`/`environmentId` to a strict API body that rejects both. No successful native creation/compile receipt or FINAL report is available. |
| `compileBeforeCommit` | **PASS - explicit Git commit endpoint only** | Backend ORs saved true with submitted `compileFirst`, so explicit false cannot bypass it. Real staged-tree success/failure, source-race rejection, receipt replay, Viewer denial and native correction are covered by unchanged passing evidence. This does not certify every possible named-commit producer; see finding 3. |

## Prioritized findings

1. **P1 - Ordinary native creation rejects its compiler/environment fields.**
   `packages/contracts/src/routes-core.ts:41` defines the strict input without
   `engine` or `environmentId`; the blank creation request in
   `apps/web/src/features/projects/NewProjectDialog.tsx` includes both.
   The independent no-service schema probe at 20:09:21Z returned
   `unrecognized_keys`. The engine producer's implementation receipt identifies
   this same pending contract change. The contract hash is unchanged at cutoff.
   Add the actual typed fields to the strict boundary under the producer's
   approved scope, forward them atomically, and prove native saved choice,
   explicit override, compatible environment, reopen and real compilation.
   Scoped TypeScript exit 0 does not establish strict runtime input acceptance.
2. **P2 - AI and engine producer delivery is incomplete.**
   AI consumers now have real behavior in source, but
   `p61-ai-preferences.md` is absent. The retained `native-run-1.log` has
   zero passing and two failing tests, not acceptance evidence: an ambiguous
   label locator and an application-event timeout. `p61-default-engine.md`
   is also absent. Both exact report reads still returned ENOENT at cutoff.
   The engine implementation receipt explicitly says its native test/captures
   are pending. These are delivery/evidence failures, not proof that the three
   inspected AI source behaviors are intrinsically wrong. Finish each producer
   report with raw pinned passing commands, stable runtime input hashes,
   inspected captures and owned cleanup before changing these verdicts.
3. **P2 - The label "Compile before every commit" exceeds the verified gate.**
   `compileBeforeCommit` has passing backend and native evidence against the
   current source hashes within the explicit Git commit boundary. It is not a
   global organization policy or a gate on every source checkpoint. Agent
   acceptance with `commit: true` calls `repo.commitTree` directly at
   `services/adapters/ai/decisions.ts:135-139`; it does not pass through the
   preference gate in `services/core/git/actions.ts:90`. This is an actual
   explicit reviewed Agent commit option, not merely an internal autosave.
   The PASS above is deliberately limited to `/api/projects/:p/git/commit`.
   A claim covering every explicit named commit remains unaccepted: either
   extend enforcement to that path or make the user-facing boundary precise.
   No Agent-commit runtime bypass probe was run; the direct call path is
   established by source inspection.

## Consumer inspection

- `aiBranch`: `assistant/Review.tsx:14` derives `ai/<run-id>` for a future
  unaccepted Agent run. Only `decide("accept")` sends `newBranch`; Reject
  changes proposal metadata. Backend `ai/decisions.ts:20-47` requires an
  authorized, succeeded Agent run, current version and valid pending edit
  selection. Branch creation and reviewed source publication occur in the
  accepted decision path, with dirty-source and `ai/` branch checks.
- `shareAiChat`: `assistant/Conversation.tsx:10` defaults a future choice.
  Saving preferences only updates the actor's preference row
  (`identity/profile.ts:41-55`). Explicit Create calls the conversation API;
  `ai/conversations.ts:15-32` creates an empty conversation. The composer
  includes `conversationId` only for the explicitly selected conversation.
  Shared history is read from that conversation, not the prior private local
  session map (`ai/conversations.ts:48-50`). Saving does not publish a chat or
  copy earlier private messages. Returning the preference to false does not
  erase already shared messages or deselect an existing shared conversation.
- `errorAssist`: `editor/index.tsx:204` supplies the real
  `onFixDiagnostic` callback only when enabled and tracking is off.
  `pdf/logs.tsx:74-80` renders the offer only with that callback and disables
  it without loaded diagnostics, edit access or editable source.
  `assistant/Composer.tsx` still requires diagnostic consent and current
  source revision. This is an offer preference, not an API-wide ban on the
  manually selected error-fix tool.
- `defaultEngine`: the dialog loads the actor's preference and uses an
  explicit local choice first, filtering selectable compatible environments.
  `core/base/projects.ts:27-31` uses explicit engine, then actor default for
  ordinary blank/example creation; template creation retains its separate
  pdfLaTeX fallback. `createFromFiles` retains explicit settings or its existing
  pdfLaTeX fallback. `prepareCreation` rejects manifest incompatibility before
  repository initialization. Blank/example LaTeX seeds reject `plain`.
- `compileBeforeCommit`: `core/git/actions.ts:82-108` authorizes before receipt
  lookup, samples the saved preference only for a new admission, and uses
  `input.compileFirst || preferences.compileBeforeCommit`. Explicit false
  cannot bypass saved true. An immutable staged workspace is compiled outside
  the source queue. The eventual commit rechecks source state, exact compiled
  tree, authorization and fenced publication; a committed receipt replay does
  not compile again. `GitPanel.tsx:115-123` sends effective true rather than
  relying on a disabled checkbox's form serialization.

## Accepted unchanged commit evidence

`p61-compile-before-commit.md` is FINAL. Independently read the raw retained
logs and the regression assertions, rather than accepting saved-field equality:

- `docs/evidence/p61-commit-preference/backend-verified.log`: pinned Bun 1.4.4,
  literal command, 11 pass / 0 fail, `P61_BACKEND_EXIT=0`. Real successful and
  failed TeX with saved true and explicit false; per-commit opt-in; immutable
  valid staged bytes despite invalid unstaged bytes; replay without a compiler;
  Viewer denial; source race; expired/revoked fences; atomic receipt recovery.
- `race-verified.log`: final test source correction separately verified,
  1 pass / 0 fail, `P61_RACE_EXIT=0`. A real completed compile followed by a
  coordinated live source change returns `STALE_VERSION`, no named commit.
- `native-stable.log`: pinned command and runtime, 1 pass / 0 fail,
  `P61_NATIVE_EXIT=0`; all ten recorded before/after input hashes match.
  Invalid commit HTTP 409 `COMPILE_REQUIRED` preserves named head and staging;
  corrected and restaged source succeeds HTTP 202, real compile tree
  `sha1:e82161c26eac7abc2b3334b70d4b5ec5fa6b78df` equals the named commit's
  tree. Native request postData is honestly null; backend test requests
  explicitly construct `compileFirst: false`.
- `static-clean.log`: scoped core/UI types and type-aware lint exit 0.
  This is scoped evidence, not the parent's current integrated gate.

Independently opened all four captures under
`p61-commit-preference/a721bec0-cc99-4aea-91f4-2b0897dfddae/`.
Both 1440 and 390 widths, light and dark, show the checked disabled compile
gate, explanatory text and commit action without overlap. Mobile uses Changes.

At 20:09:31Z all ten current source/test/config hashes matched the stable native
run. Exact values and the schema probe are retained in
`docs/evidence/p61-preferences-verification/independent-probes.md`.
At 20:10:22Z all eight recorded backend roots and
`/tmp/quire-ui-editor-YX6aMJ` were absent. A read-only `ss -ltnp` inventory
showed neither native port 41745 nor 34917 listening. Producer cleanup also
records browser disconnection and disposal. No owned service, browser,
compiler, temporary project or test process was started by this auditor.

## Remaining evidence and command scope

The engine producer's `core-final.log` records the literal repository-local
Bun 1.4.4 command across `default-engine.test.ts`, `import-settings.test.ts`,
`dropbox-creation.test.ts` and `template-selection.test.ts`: 12 pass, 0 fail,
`P61_CORE_FINAL_EXIT=0`. The audit inspected the actual preference/precedence,
actor separation, restart, import/template and prepublication-denial assertions.
Its HTTP fallback/replay test omits explicit engine/environment fields, so it
does not cover the broken native dialog request. `static-updated.log` records
the later scoped types/lint command and `P61_STATIC_UPDATED_EXIT=0`.

The AI producer's `scoped-checks.log` records Bun 1.4.4 and scoped type/lint
exit 0, but no literal commands or passing native behavior. The audit inspected
the actual workflow and fixture: they exercise native future-sharing choice,
private-history isolation, independent collaborators, branch approval and
diagnostic gating, but a test's intended assertions are not a passing run.
The two failed fixture cleanup receipts record removed roots, closed listeners
and browser disposal; they do not turn their failed tests into acceptance.
No successful AI native captures or engine native captures were accepted or
claimed inspected.

Only the missing/suspect strict-schema boundary received a new executable
probe. Passing unchanged real compiler/native checks were reused, not rerun.
This auditor did not run root typecheck/lint/build/matrix or broad tests; those
remain the parent's integrated gate. No new prose test is appropriate for this
report-only change.

Current consumer hashes, exact independent probe, cleanup inventory and final
cutoff are in `docs/evidence/p61-preferences-verification/independent-probes.md`.
The AI hashes establish what was inspected, not provenance for a passing
runtime run that does not exist in the supplied evidence. Account save alone
cannot pass any row.

No source/test edits, commits, live-service writes, service launches or port
5173 interactions were performed by this auditor. The only writes are this
report and its named evidence directory. The default-deadline audit
file-creation subscriptions no longer had a live session at finalization;
cleanup calls returned `No terminal session found`.
No runtime probe resources need cleanup.

---

## FINAL targeted follow-up - findings 1 and 2

October 28, 2026; independent source fingerprints checked at 21:46:55Z and
fixture cleanup checked at 21:48:53Z. The original 20:14:45Z cutoff verdict
above is preserved as history. This follow-up closes findings 1 and 2 for
the four preferences below. **Finding 3 remains OPEN; overall P61 is not closed.**
The moving explicit AI-commit compile-gate implementation was not inspected,
hashed, tested or accepted in this follow-up.

Both previously missing reports are now FINAL:
`p61-default-engine.md` and `p61-ai-preferences.md`. Their final native logs,
actual assertions, selected stable source hashes, workflow/diagnostic JSON,
decisive HTTP receipts and all 24 final functional captures were independently
read. No passing suite was rerun.

| Preference | Follow-up verdict | Verified effect and precise residual semantics |
| --- | --- | --- |
| `defaultEngine` | **PASS - ordinary creation boundary** | The strict API now admits optional `EngineSchema` engine and typed environment ID; `project-routes.ts:42-46` forwards the validated body atomically to creation. Native account save selected XeLaTeX; creation and reopen retained that engine/environment with zero settings PATCHes; actual editor input compiled successfully to an authenticated PDF artifact. Other-actor isolation and explicit LuaLaTeX override are covered. Blank/example LaTeX seeds cannot use saved `plain`; template/import defaults remain separate. This is not proof of a completed visible PDF rendering in the outcome captures. |
| `aiBranch` | **PASS - reviewed future default** | Saved false leaves the branch field empty; saved true defaults `ai/<run-id>`. Per-run current-branch override, rejection without branch/source mutation, Track Changes denial and explicit Accept into the new branch all pass. Main source remains byte-equal. Accept in this workflow sends `commit:false`; it does not exercise or accept finding 3. |
| `shareAiChat` | **PASS - future conversation choice** | Saving true changes the future choice while current chat remains private, with zero conversations created on save. Explicit Create starts empty; the subsequent Send shares only the new prompt/response. Earlier private text is absent from shared history/provider context; the independent collaborator can read shared messages but receives HTTP 404 for the private run. Turning the preference off does not revoke prior sharing or silently deselect a selected shared conversation. |
| `errorAssist` | **PASS - actual diagnostic offers** | Actual failed TeX produces diagnostic cards; preference off/on/off hides/shows/hides Fix with AI. Diagnostic-context consent remains opt-in, confidential Send returns HTTP 403 `AI_CONFIDENTIAL` with zero provider calls, Viewer actions are disabled and Track Changes suppresses offers. Broken source remains unchanged. This is not a claim of successful automatic repair or an API-wide prohibition on manually chosen tools. |

### Evidence closing the two findings

`docs/evidence/p61-default-engine/parent-ready-native.log` records repository
Bun 1.4.4, 21:38:15Z-21:39:13Z, **1 pass, 0 fail, 24 assertions** and
`P61_PARENT_ENGINE_EXIT=0`. Its six inner input hash pairs and outer event-helper
hash match current files. Project `a4a38fc8-2171-4494-b26e-dceb345323f2`
retains XeLaTeX in admitted environment
`00000000-0000-4000-8000-000000000030`. The revision-2 source produces successful
job `385dc024-61a5-4fa8-a8c5-aa59c2b8b77c`, HTTP-200 artifact
`90a101f5-bdd1-4eb5-a30d-afb2af3b165e`, 4,104 PDF bytes, SHA-256
`e6960276b3ed3aca11658d0d3a740e3d36b9a8b47325089f35c2d1fe90f9a635`.
The later native override chooses LuaLaTeX after the saved `plain` rejection;
it should not be described as a separately executed override while XeLaTeX
was still the saved value. Earlier backend cases separately cover service
override, restart, HTTP replay, import/template precedence and prepublication
denial. Their mixed historical invocation has four passes and one native
locator failure, not an entirely green command.

`docs/evidence/p61-ai-preferences/parent-keys-native.log` records repository
Bun 1.4.4, 21:38:15Z-21:39:40Z, **2 pass, 0 fail, 89 assertions** and
`P61_PARENT_AI_EXIT=0`. All seven outer before/after fingerprints match current
files. `AssistantPanel.tsx:52-53` now uses distinct `review:`/`claims:` keys,
and the passing successive rejection/acceptance sequence covers the formerly
stale duplicate controls. These are selected-input fingerprints, not an
assertion that every transitive runtime dependency was hashed.

`parent-final-static.log` records `P61_PARENT_STATIC_EXIT=0` at
21:44:30Z-21:44:58Z. Both FINAL producer reports attribute that result to
scoped types and type-aware deny-warning lint; the short raw log itself does
not print the command list or individual tool output. The separately read
`parent-lint-final.log` contains the subscription cleanup regression result:
**2 pass, 0 fail, 6 assertions**. Explicit-await cancellation still rejects.
No root build/typecheck/lint/matrix completion is inferred.

All eight engine and sixteen AI/diagnostic final functional screenshots were
individually opened at 1440/390, light/dark. Compiler/environment selection,
future-sharing privacy choice, pending review/branch controls and diagnostic
offer differences are visible without new overlapping controls. Desktop engine
outcomes show `Rendering PDF page...`; mobile outcomes show the Assistant
overlay. They are **not** completed rendered-PDF visual evidence. Successful
job, PDF signature and authenticated artifact bytes establish compiler output.
The scrolling mobile Assistant captures do not show editor/PDF simultaneously.

The three final fixture roots are independently absent and their eight
application/provider ports are not listening; cleanup JSONs/logs also record
browser/application disposal and no AI fixture errors. No new browser, service,
compiler or temporary project was started by this auditor.

Exact current hashes, receipt IDs, capture inventory and cleanup observations
are retained in
`docs/evidence/p61-preferences-verification/follow-up-evidence.md`.

### Open residuals at this follow-up

- **Finding 3 stays OPEN.** Neither the prior explicit Git-endpoint PASS nor
  these four preference PASSes certify exact-tree compilation for explicit
  Agent commits. That implementation and its eventual evidence require their
  own audit after the code settles.
- **Affected legacy regressions are not accepted as passing.** The parent
  confirms `affected-regressions.log` finalized exit 1, three passes/two failures,
  both stale shared-create prose waits. It has replaced those waits with
  subscribed POST response/schema validation and rendered conversation IDs.
  `affected-followup.log` is still pending its terminal marker for the two
  failed shared cases, three previously unreached diagnostic cases and scoped
  types/lint. No result from that pending run is claimed here. The parent will
  append its actual outcome.
- Integrated gates and overall P61 closure remain with the parent after the
  explicit AI-commit gate and affected regression results settle. The historical
  cutoff failure is not rewritten and earlier failed attempts remain retained.

---

## FINAL targeted backend follow-up - finding 3

October 28, 2026. **Backend mechanism PASS; native explicit-commit acceptance
remains pending. Overall P61 is not closed.** The earlier cutoff and
findings-1/2 follow-up above remain historical and are not rewritten.

Read the FINAL `p61-ai-commit-preference.md`, settled
`services/adapters/ai/decisions.ts`, the complete new compiler tests/harness,
and reused private compiler/AI publication paths. No passing tests were rerun.
The prior unguarded explicit Agent commit path is addressed in inspected source:

- A matching committed idempotent decision receipt returns before preference
  sampling. For a new accept or undo with `commit:true`, saved
  `compileBeforeCommit:true` requires the real compiler gate. Reject, saved-false
  commits and noncommit source acceptance preserve their existing semantics.
- A short serialized pass prepares candidate tree/settings/revision/head
  without publishing the AI decision. Original and target leases release
  before compilation; the real compiler runs on the immutable private tree.
- A fresh serialized pass rechecks receipt replay, AI/source authority, AI
  version, original revision/head and settings. It reapplies the edit and
  requires the fresh tree to equal both admission and successful job snapshot,
  with matching stored job/current settings and fresh project version.
  Existing journal stage/finalize authorization, publication and receipt
  invariants remain. Failed compilation cannot reach those publication steps.

The retained `docs/evidence/p61-ai-commit-preference/verified.log` reports
repository Bun 1.4.4, **21 pass, 0 fail, 127 assertions**. Actual assertions
cover successful/failed accept on current/new branches, successful/failed undo,
exact named-tree equality, no failed source/ref/proposal/receipt publication,
replay without another job, and deterministic source/settings/authority/version
races during a real successful compile. Race tests acquire both leases during
the compile boundary, rather than passing by timeout luck. Existing review,
conflict/concurrent acceptance and recovery checks are included.

Successful current-branch job `1e194956-5238-4a4e-b3c5-4e1e3ec419de` compiled
`sha1:2ba682ab68f27cdfd5e8949ea6238b454f55afb8`, asserted equal to the actual
named commit tree. New-branch job `b81371c7-e243-4570-8bcd-dcd232fadc34`
compiled that same reviewed tree while original source/head stayed unchanged.
Failed new-branch job `a4c4dae6-47f0-4b67-be18-b258f2ba7f32` left the proposal
pending and published no target workspace, AI journal or decision receipt.

**Provenance limitation retained:** the raw backend log has no contemporaneous
before/after input manifest, invocation header, wall-clock bounds or test exit
sentinel; types/lint logs are empty. Commands and exit-zero outcomes come from
the FINAL producer handoff. The parent confirms no additional backend manifest
is known. This audit's 21:56:33Z fingerprints establish the current inspected
source, not a retrospectively pinned runtime run. No such pin or raw exit is
invented, and no rerun was requested. Exact hashes, inspected checks, concrete
jobs and this limitation are in
`docs/evidence/p61-preferences-verification/ai-gate-backend-audit.md`.

All 12 recorded fixture roots are independently absent at 21:57:19Z; retained
cleanup logs also report their absence and all 14 recorded compiler units
inactive, each cleanup command exit 0. This auditor created no runtime resources.

### What this follow-up does not close

- The parent owns acceptance of the active actual-native explicit-commit run
  in `docs/evidence/p61-ai-preferences/native-commit.log`, including its
  decisions/workflow before/after hashes, raw exit sentinel, saved preference,
  checked Commit option and actual successful named/compiled tree equality.
  No pending native result is claimed here. Finding 3's backend bypass is
  addressed; its full native acceptance remains open.
- The parent reports corrected legacy sharing, diagnostic offers/denials and
  successful reviewed repair/recompile cases passing. This is not a new
  independent regression-suite acceptance by this backend audit.
- The late-proposal same-context second editor stuck at Connecting remains a
  separate unresolved workflow issue. Compiler-gate acceptance does not waive
  it or reinterpret it as a gate failure. Integrated and overall P61 closure
  remain with the parent.

---

## FINAL recorded-input native finding 3 acceptance

October 28, 2026. **Finding 3 backend PASS; native integration PASS at the
recorded input set.** All three scoped preference findings have passing evidence
at the inputs documented below. Earlier cutoff verdicts, failed attempts and
provenance limitations above are retained as history. This does not accept
newly changing frontend event consumers, global gates or P63.

| Preference | Scoped verdict at the documented inputs |
| --- | --- |
| `aiBranch` | **PASS** - future branch default, per-run override and explicit reviewed acceptance; no automatic unapproved source mutation. |
| `shareAiChat` | **PASS** - future conversation choice only; explicit empty shared creation and future Send, no publication on save or copied earlier private history. |
| `errorAssist` | **PASS** - actual diagnostic offer gate, with independent consent, confidentiality, Viewer and tracking checks; not automatic repair or a manual-tool prohibition. |
| `defaultEngine` | **PASS** - ordinary creation uses saved default unless explicitly overridden, with typed atomic compiler/environment submission and compatibility checks; template/import semantics remain separate. |
| `compileBeforeCommit` | **PASS** - direct explicit Git commits and explicit reviewed Agent accept/undo commits enforce the admission-time saved preference; exact candidate tree/settings and publication/replay checks remain. Ordinary source checkpoints/noncommit acceptance are not gated. |

Independently read
`docs/evidence/p61-ai-preferences/native-commit-final.log`: October 28,
22:13:12Z-22:14:34Z, Bun 1.4.4, **1 pass, 0 fail, 60 assertions**, followed
by clean scoped TypeScript and type-aware deny-warning lint, raw
`P61_NATIVE_AI_COMMIT_FINAL_EXIT=0` and traced `exit 0`. Seven before/after
hash pairs match each other and the independent current check at 22:16:56Z,
including the previously audited decisions source
`0dc6727b685f03384078d6be8f687af9ae959e01fe215915f51397cb6171cda3`.
No passing suite or static command was rerun.

Final packet
`docs/evidence/p61-ai-preferences/8fb1a5b4-b892-44c6-a37e-a3172db91761/`
retains the actual server request: authenticated preference PATCH sets
`compileBeforeCommit:true` (HTTP 200, version 4), then native Accept sends
`commit:true` into `ai/cd66d4b3-abf9-45a7-a82d-b5aee4f6eae7` (HTTP 200).
The test rechecks Commit accepted changes after the Track Changes remount and
subscribes before Accept. Its server capture, not unavailable browser
`postDataJSON()`, establishes the submitted commit option. The earlier
top-level `workflow.saved` object predates that PATCH and is not misrepresented
as the admission preference. This run uses authenticated API preference setup;
the native account toggle was separately covered by the retained Git evidence.

Actual successful compiler job `2dbafd2f-344e-42af-91eb-626869ee28d7` has tree
`sha1:039b0b30930c5a5031d0d1d92ec750ea7ed14228`, equal to the actual named
`ai/<run-id>` Git tree read by the native test. Main before/after source hash
remains `392c2b10d1f883ac1a73ca0f77efe11c044a71a8e979877ca8df405d8b0f12ab`.
The approved branch source differs as intended. Existing bibliography warnings
remain disclosed; successful compilation does not mean warning-free source.

The earlier timeout and browser-postData matcher failures remain retained and
are not accepted as passing runs. Final fixture cleanup records browser closure,
no errors and all three owned ports closed; the independent audit confirms
`/tmp/quire-assembly-cdLyLl` absent and those ports not listening. Exact commands,
hashes, request sections and residual semantics are in
`docs/evidence/p61-preferences-verification/native-commit-final-audit.md`.

The historical 21-case backend invocation still lacks its own contemporaneous
manifest/raw exit sentinel; the new stable-input native pass does not
retroactively create those records. It supplies current explicit-commit
integration evidence for the same audited production gate.

**Separate remaining work:** root integrated gates, broad regression/static
completion and P63 independent event-sharing/late-proposal verification are
not closed by this preference verdict. The parent reports that the same-context
late-diagnostic native case now passes; that is not a new independent P63
acceptance here. No source/test edits, runtime starts, commits, unrelated-service
changes or port 5173 interactions were performed by this audit.

**Subsequent current-state correction from the parent:** the P63 producer
found a header-identity convergence gap after refresh/remount despite that
earlier pass: actual streams were first tab 3 / second tab 1. Event consumers
are being corrected again, including same-actor new-session isolation in the
sharing key; actor plus token alone is insufficient for that requirement.
This report does not independently audit or accept that moving implementation.
The native commit result above remains valid at its recorded hashes, not as
new-current frontend acceptance. Backend gate source is unchanged according
to the parent, so its bounded finding-3 acceptance stands separately. Current
P61 frontend integration and P63 convergence acceptance remain pending; the
parent will rerun only the native sharing/commit case after P63 settles.
