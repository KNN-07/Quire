# P61 native AI preference consumers

FINAL, October 28, 2026. Parent takeover completed the native verification
and corrected a duplicate React key defect. This report accepts `aiBranch`,
`shareAiChat` and `errorAssist` within the boundaries below. It does not
accept the separate explicit AI commit compile gate, whose follow-up remains
open, or declare the overall product complete.

## Behavior

The saved branch choice defaults future pending Agent reviews to
`ai/<run-id>`. A run-specific override can use the current branch. Nothing
creates a branch or changes source until explicit acceptance. Reject retains
the original branch/source. Existing Track Changes and authorization guards
remain enforced.

The sharing preference defaults a future conversation choice, not the
currently selected conversation. Explicit Create starts an empty shared
conversation; future sends enter that conversation. Earlier private messages
are neither copied nor sent as shared history. Turning the preference off
does not erase already shared content or silently deselect a conversation.

Error assistance controls offers on actual diagnostic cards. It does not
disable manual selection of an AI tool. Diagnostic-context consent,
confidential-project denial, Viewer restrictions and Track Changes guards
remain independent checks.

`AssistantPanel.tsx` now gives sibling review and claim components distinct
`review:` and `claims:` keys. The former shared run-ID key left stale duplicate
review controls after successive runs. The native rejection/acceptance sequence
exposed this product defect; the final run covers the corrected lifecycle.

## Commands and actual results

`docs/evidence/p61-ai-preferences/parent-keys-native.log` records repository
Bun 1.4.4, October 28 21:38:15Z through 21:39:40Z:

```text
bun test tests/ui-product/ai-preferences/workflow.test.ts
2 pass
0 fail
89 expect() calls
P61_PARENT_AI_EXIT=0
```

All seven outer source/test/helper SHA-256 pairs match. The two final packets
are `8cc62028-dab0-46e5-a47b-739e5c4711f2/` and
`3fe36824-770a-4b38-9910-45457443dfd0/` in that evidence directory.
Each retains actual HTTP requests, owned origins, provider requests, workflow
or diagnostic records, screenshots and cleanup JSON.

The first native case proves separate private and shared histories, empty
shared creation, collaborator access, private run concealment as HTTP 404,
actor-specific saved defaults, per-run branch override, rejection without
mutation, Track Changes denial and explicitly accepted new-branch source.
Original main source remains byte-equal. The loopback provider received only
the permitted context; this is not a live external-provider claim.

The second case creates an actual failed TeX compile with an undefined
command. It verifies absent/present diagnostic offers after preference saves,
opt-in diagnostic context, confidential denial without provider calls, disabled
Viewer actions and suppressed offers under Track Changes. The broken source
remains unchanged. No successful automatic repair is claimed.

The parent opened all sixteen final functional captures in paired
1440/390 light/dark contact sheets. Conversation choice, review controls,
branch field and diagnostic offer states are visible without new overlapping
controls. The mobile Assistant is a scrolling native overlay; screenshots
are not represented as simultaneous editor/PDF views.

`docs/evidence/p61-default-engine/parent-final-static.log` records clean
scoped TypeScript for both native preference suites and type-aware
deny-warning lint over the touched frontend, contract and test files,
`P61_PARENT_STATIC_EXIT=0`. The shared subscription cancellation regression
tests separately passed twice with six assertions in
`parent-lint-final.log`; disposal no longer masks a failed action, and an
explicit await still observes rejection.

Earlier failed logs remain historical. Test corrections target the actual
combobox, focus Source before editing, use the API's intentional private-run
404, and use an actually undefined TeX command. They do not weaken privacy,
source equality, approval or authorization assertions.

## Cleanup and remaining scope

Both final cleanup receipts report no errors, closed browsers and all six
owned listeners closed. The parent independently confirmed absence of
`/tmp/quire-assembly-sIY8VR` and `/tmp/quire-assembly-6c9V8c`. No live provider,
unrelated service or port 5173 was modified.

The original P61 independent report predates these receipts and remains a
historical FAIL at its stated cutoff. A targeted audit update and the
explicit AI-commit compile preference follow-up are still required before
closing the full saved-preferences task. Integrated gates will be refreshed
after those source changes settle.
