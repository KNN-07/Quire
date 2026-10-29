# P61 parent native and regression follow-up

FINAL scoped evidence, October 28, 2026. Read alongside the independent
`p61-preferences-verification.md`, the three original preference reports and
`p61-ai-commit-preference.md`. This does not assert a current whole-product
build or close the separate P63 event-sharing review.

## Explicit native AI commit

`docs/evidence/p61-ai-preferences/native-commit-final.log` retains the literal
invocation, repository Bun 1.4.4, UTC 22:13:12Z-22:14:34Z, seven matching
before/after hashes, **1 pass, 0 fail, 60 assertions**, scoped TypeScript and
type-aware lint exit 0, and `P61_NATIVE_AI_COMMIT_FINAL_EXIT=0`.

The actual browser review selected Commit accepted changes and accepted
Agent run `cd66d4b3-abf9-45a7-a82d-b5aee4f6eae7`. The saved compile preference
was enabled through the authenticated preferences API; native account-toggle
behavior is separately proved by the original Git preference report.
The fixture's server-side request capture confirms `commit:true`, not a
fabricated browser POST body. Actual compiler job
`2dbafd2f-344e-42af-91eb-626869ee28d7` succeeded with tree
`sha1:039b0b30930c5a5031d0d1d92ec750ea7ed14228`, equal to the named Git tree
of `ai/cd66d4b3-abf9-45a7-a82d-b5aee4f6eae7`.
Original main source remained byte-equal at SHA-256
`392c2b10d1f883ac1a73ca0f77efe11c044a71a8e979877ca8df405d8b0f12ab`.

The final packet is
`docs/evidence/p61-ai-preferences/8fb1a5b4-b892-44c6-a37e-a3172db91761/`.
Its `workflow.json` retains the actual compiler DTO, named tree, original
and accepted source hashes, approval DTO and private/shared conversation
results. The parent opened all eight functional screenshots across both
widths and themes. The captures show the real scrolling conversation/review
controls without new overlap. Unsent local Git choices can reset on a
responsive/tracking remount; the final test explicitly chooses the commit
checkbox after the tracking guard exercise and verifies the submitted choice.
It does not claim that an unsent checkbox remains selected across all remounts.

Earlier native attempts remain historical:
`native-commit.log` submitted `commit:false` after the tracking remount, so
its compile wait correctly timed out. `native-commit-followup.log` submitted
`commit:true` and received HTTP 200, but its new assertion used unavailable
browser `postDataJSON()` metadata, which was null. The final assertion uses
the existing actual server capture. Neither failed run is counted as passing.

The backend exact-tree/authority/race suite is separately **21 pass, 127
assertions** in the producer's `verified.log`. That log lacks a contemporaneous
full-input manifest and exit sentinel; its FINAL handoff supplies invocation
and exit attribution. The parent native run does retain source hashes and
raw exit 0. These evidence levels are not conflated.

## Affected existing regression tests

Delayed producer messages exposed stale existing interactions. The parent
enabled `errorAssist` through authenticated owner/Viewer preference updates
where those older tests intentionally exercise visible offers. Existing
Assistant cases now explicitly select shared conversation creation and do
not close the default-expanded privacy/Git controls. All original behavioral
assertions remain.

`affected-regressions.log` has three passing existing cases and two failures
on old shared-create notice text. `affected-followup.log` supersedes those
two failures with **2 pass, 6 assertions**, using subscribed actual POST
response/schema validation and rendered conversation IDs instead of new
prose-pinned waits. The already passing private clear/review and branch cases
were not replayed.

The configured/unconfigured/policy/disabled/Viewer diagnostic case passed
in `affected-followup.log`. The repair case initially observed a review
before its busy action finished. Its readiness subscription now observes the
enabled source-navigation action. `diagnostic-targeted.log` records that
case passing with actual reviewed source replacement, successful compilation
and rendered PDF. The parent opened
`docs/evidence/p27-diagnostic-ai/5e0dcbf6-c628-4011-86be-f700295a895e/accepted-real-pdf.png`.

The remaining same-context collaborator case exposed a real product
connection stall, not a bad assertion. Captured network evidence in
`p27-diagnostic-ai/7a623f36-4023-4411-8b5a-6d55d4487f65/`
shows long-lived event requests alongside pending session/preview/suggestion
requests; the second editor stayed Connecting. P63 owns the event-sharing
fix and independent acceptance. Its producer reports the unchanged native
case passing; the P63 FINAL evidence, not this report, must establish that
claim.

`regression-static.log` records the previously unreached Assistant and
diagnostic scoped TypeScript checks, touched-file deny-warning lint and matrix
verification, all exit 0 (`P61_REGRESSION_STATIC_EXIT=0`). Matrix output maps
all 164 inventory IDs: 73 MOUNT, 9 UI, 31 BE, 17 EXT, 26 PART and 8 BOUND,
with no missing, unexpected or duplicate IDs. Mapping is explicitly not
behavioral product acceptance.

## Cleanup

All three parent native-commit roots were independently confirmed absent:
`/tmp/quire-assembly-3g6lJe`, `/tmp/quire-assembly-VuLGYw`, and
`/tmp/quire-assembly-cdLyLl`. Their receipts record closed browsers and all
nine owned listeners closed, with no cleanup errors. The final run used
web 39575, API 42753 and owned provider 45317. No port 5173 or unrelated
service was changed, and no project commit was made.

## Session-bound event consumer supersession

The first P63 pool revision did not remain converged after workspace refresh,
and actor/token equality alone did not distinguish sessions for one actor.
The parent rejected that boundary. The settled implementation resolves the
server-issued CSRF/session discriminator for every shared subscriber and
revalidates it on stream reopen; it scopes sharing by injected client, session,
actor and project token. Metadata-free standalone consumers are dedicated,
not pooled by an untrusted actor claim.

The parent reran both native preference cases against those settled inputs.
`docs/evidence/p61-ai-preferences/session-native.log` records October 28
22:44:46Z-22:46:13Z, Bun 1.4.4, **2 pass, 0 fail, 93 assertions**, seven
matching before/after hashes, `P61_SESSION_NATIVE_EXIT=0` and traced exit 0.
This supersedes the earlier frontend input set without changing the accepted
backend decision-gate hash.

Packet `45a6ba32-211e-4ea5-8afc-22c29d3144cf/` retains private/shared chat,
branch, tracking guard and explicit commit results. Run
`8c7ef92d-4fcd-4762-9efa-2728943dbf55` has actual successful compiler job
`b7f9a654-9942-4681-a9de-fb960a48a27c`; compiled and named trees both equal
`sha1:039b0b30930c5a5031d0d1d92ec750ea7ed14228`, and main remains byte-equal.
Packet `8dc65c59-973e-4bc9-b7d9-8283716e48c5/` retains the passing diagnostic
offer/consent/confidential/Viewer/tracking case.

Both cleanup receipts report closed browsers, six owned listeners closed and
no errors. The parent independently confirmed
`/tmp/quire-assembly-7Ke0Vx` and `/tmp/quire-assembly-YKLdAs` absent.
P63's independent pool/session/replay/count audit and the P67 integrated
gate remain separate deliverables; this is current native preference evidence,
not an assertion that those pending deliverables passed.

The subsequent FINAL `p63-verification.md` independently accepts session,
token, lifetime/replay and real two-tab connection convergence, plus exact
cleanup. `p67-integrated-validation.md` records root types/lint/matrix/build
exit 0 at the settled input set. Together with the current two-case native
receipt, this closes the five saved-preference consumers within their stated
boundaries. Broader settings, AI tool selection, run-step presentation and
the remaining product tasks are not silently included in that closure.
