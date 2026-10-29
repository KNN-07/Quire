# P30 review thread to Assistant

October 28, 2026. FINAL scoped thread-to-Assistant implementation and verification.

## Accepted result

`docs/evidence/p30-review-ai/workflow-navigation-fixed.log` records one real
browser test passing with 21 assertions in 51.58 seconds. Scoped strict
TypeScript and typed deny-warning lint passed before the browser command;
monitor `mon_MPYVJ7BBM1HPQ732`, session `bash_391`, completed with exit 0.
Earlier attempts and their distinct failures remain below.

The accepted packet is
`docs/evidence/p27-diagnostic-ai/2f020f63-e584-44a0-8b2e-5ab21832f893/`.
Parent opened all four `review-thread-{1440,390}-{light,dark}.png` images:
captured version, both comments, transmission consent, Clear, Ask/Agent and
zero source-file context are readable without overlapping controls. Mobile
uses the existing scroll area. The native UI creates the thread; no AI request
occurs before both independent consents. A real reply makes the captured
version stale and blocks dispatch. Reopening resets consent and then sends
exactly the recorded two comments to the controlled HTTP provider. No source
file is transmitted automatically and source bytes remain unchanged.

The final root `/tmp/quire-assembly-H7l5jC` is independently absent; web/API
ports 42733 and 37955 refuse connections after disposal. The provider is an
owned protocol fixture, not live vendor inference. Existing server authority
and reviewed-edit rules remain authoritative; this is not source tracking or
automatic thread resolution. No global build or whole-product acceptance is
claimed.

## Implementation

The actual review thread action now opens an Assistant draft with an explicitly
captured thread version. It displays the recorded comments and anchor quote,
defaults to read-only Ask, selects no source files automatically, and leaves
thread-transmission consent unchecked. Opening the action sends no AI request.
Provider terms consent and current server project/provider policies remain
independent requirements.

Sending checks current thread access and version through the existing typed
thread reader. A changed version requires clearing and reopening the context.
This is a captured snapshot with a preflight stale check, not a claim that the
thread cannot change after that check. Only the displayed snapshot is included
in the structured prompt after consent. Its identity, version, scope and
comments remain distinct from the user's instruction.

The editor owns the thread intent and clears any diagnostic intent when it is
opened, and vice versa. Assistant runs use intent-specific session-storage keys,
so an unrelated saved run cannot replace the new thread draft. Clear restores
the ordinary composer. Any user-selected Agent output still uses the existing
review and explicit approval path.

Changed production scope:

- `apps/web/src/features/editor/shared/contracts.ts`
- `apps/web/src/features/editor/index.tsx`
- `apps/web/src/features/editor/review/threads.tsx` (one optional action)
- `apps/web/src/features/editor/assistant/{types.ts,AssistantPanel.tsx,use-assistant.ts,Composer.tsx}`

The history lane was told to preserve the thread action and may continue its
separate review presentation work. No source tracking or automatic thread
resolution is claimed.

Initial validation was registered as `mon_YEKTB0A9Z3R3Q9E2`, session `bash_388`:
scoped strict TypeScript, typed deny-warning lint, then the actual
`tests/ui-editor/review-ai/workflow.test.ts`. Raw output is retained at
`docs/evidence/p30-review-ai/workflow.log`. The test exercises UI thread
creation, no-send-before-consent, independent terms consent, a real reply
changing the thread version, stale rejection, reopening and fresh consent,
actual controlled HTTP inference, exact structured thread content and unchanged
source, with four desktop/mobile light/dark captures.

This test reuses the existing native diagnostic fixture for application and
provider ownership; its generated packet is therefore under
`docs/evidence/p27-diagnostic-ai/`, with the exact packet path printed in the
raw receipt. It does not run the diagnostic compile/fix scenario.
The following sequence preserves the historical failures and pending states;
the accepted result above supersedes those states, not their raw receipts.

## First validation result

The initial strict TypeScript and typed lint steps passed. The browser then
failed at the test-created reply because the new test incorrectly converted
the ETag `"v0"` with `Number(...)`, yielding an invalid expected version.
Production uses the correct metadata parser. The test now imports
`parseResourceVersionTag` rather than implementing its own parser. The failed
receipt remains `workflow.log` (one failed case, eight assertions, exit 1).
Its fixture root `/tmp/quire-assembly-bMwcq8` is independently absent.

Only the changed/failed scenario and its scoped static checks are rerunning:
`mon_06Y3Z8TK8AEEXXH4`, session `bash_389`, raw receipt
`docs/evidence/p30-review-ai/workflow-version-fixed.log`. Acceptance remains
pending.

That rerun stopped in TypeScript (exit 2) before starting its browser scenario:
the concurrently edited `review/history.tsx:164` resolves
`document.createElement` to the nullable editor document. Parent reported the
specific DOM-name collision to the active history owner and registered a source
modification watch. This receipt is not a second browser failure or evidence
against the corrected ETag parser. The browser remains unverified until the
current-tree type blocker is corrected.

The history owner has corrected the DOM call to `window.document.createElement`.
Before restarting the stopped browser test, the remote-reference lane reported
a separate browser runtime error at the new
`HistoryChangesSchema` expression `SnapshotSchema.unwrap().shape.reason`.
Parent read the current source, notified its active owner and registered
`mon_D1Y61V3K4VBCP1XD` for the schema file. No passing receipt is inferred from
TypeScript for that browser failure, and no duplicate browser rerun has started
while the owner investigates.

Two subsequent fresh reference fixtures reported no schema runtime errors,
without proving the cause of the original error. Parent stopped the unused
schema watch and resumed its corrected scenario under
`mon_4EJ27F72XK6QJEMZ` / `bash_390`. Static checks passed, and the browser
reached successful real reply creation and stale-thread rejection. It then
timed out because the new test installed `surfaceSignal` in the outgoing
document before a full `page.goto`, which destroys that observer.
`workflow-resumed.log` retains exit 1, nine assertions and the exact timeout.
The root `/tmp/quire-assembly-DoRWQ2` is independently absent.

That navigation now uses the existing `openSurface` helper, which installs
its bounded observer in the incoming document. No production code or outcome
assertion was changed for this correction. The failed scenario and scoped
checks are running as `mon_MPYVJ7BBM1HPQ732` / `bash_391`, retaining
`workflow-navigation-fixed.log`. No final browser pass is claimed yet.
