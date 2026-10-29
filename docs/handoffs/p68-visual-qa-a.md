# P68 visual QA Pass A - FINAL

Date: October 28, 2026. Independent read-only review of checklist G-J.

**Overall: FAIL as a fully evidenced G-J gate.** The requested persisted-progress
behavior is supported by genuine native application receipts and the complete
40-frame matrix. No new progress-specific functional defect was demonstrated.
Several broader interaction/state requirements remain unproved, and the existing
failure presentation does not explain its cause in user-facing language.
Evidence failures below are not assertions that the product is broken.

Only this report was written. No runtime, browser, service, test, or static command
was restarted or rerun. No product/test file or commit was changed.

## Evidence references and coverage

All paths are relative to `/home/norman/Repos/Quire`.

- **E** = `docs/evidence/p68-ai-steps-frontend/after-509068ec-8998-4a0e-91b7-c82dc2383a79/`.
- **B** = `docs/evidence/p68-ai-steps-frontend/before-33877253-f834-4747-b91d-9f0f23c6ba6d/`.
- **R** = `apps/web/src/features/editor/assistant/RunProgress.tsx`.
- **P** = `apps/web/src/features/editor/assistant/AssistantPanel.tsx`.
- **C** = `apps/web/src/features/editor/assistant/assistant.css`.
- **D** = `apps/web/src/features/editor/assistant/DESIGN.md`.
- **U** = `apps/web/src/features/editor/assistant/use-assistant.ts`.
- **F** = `tests/ui-product/ai-steps/fixture.ts`.
- **T** = `tests/ui-product/ai-steps/progress.test.tsx`.
- **L** = `docs/evidence/p68-ai-steps-frontend/final-focused.log`.
- **S** = `docs/evidence/p68-ai-steps-frontend/final-static.log`.

Read and visually inspected every original named below, first through the five
bounded `E/{state}-contact.png` sheets and then as eight original frames per state.
There was no sampling. The desktop originals also show the surrounding real
editor, not just a cropped assistant. Every original has PNG signature
`89504e470d0a1a0a`, height 900, and the indicated width; no browser chrome, black
compositor region, or blank progress rendering was seen.

| State | All eight original filenames inspected under E |
| --- | --- |
| empty | `empty-1440-light-after.png`, `empty-1440-dark-after.png`, `empty-390-light-after.png`, `empty-390-dark-after.png`, `empty-end-1440-light-after.png`, `empty-end-1440-dark-after.png`, `empty-end-390-light-after.png`, `empty-end-390-dark-after.png` |
| provider-running | `provider-running-1440-light-after.png`, `provider-running-1440-dark-after.png`, `provider-running-390-light-after.png`, `provider-running-390-dark-after.png`, `provider-running-end-1440-light-after.png`, `provider-running-end-1440-dark-after.png`, `provider-running-end-390-light-after.png`, `provider-running-end-390-dark-after.png` |
| succeeded | `succeeded-1440-light-after.png`, `succeeded-1440-dark-after.png`, `succeeded-390-light-after.png`, `succeeded-390-dark-after.png`, `succeeded-end-1440-light-after.png`, `succeeded-end-1440-dark-after.png`, `succeeded-end-390-light-after.png`, `succeeded-end-390-dark-after.png` |
| failed | `failed-1440-light-after.png`, `failed-1440-dark-after.png`, `failed-390-light-after.png`, `failed-390-dark-after.png`, `failed-end-1440-light-after.png`, `failed-end-1440-dark-after.png`, `failed-end-390-light-after.png`, `failed-end-390-dark-after.png` |
| canceled | `canceled-1440-light-after.png`, `canceled-1440-dark-after.png`, `canceled-390-light-after.png`, `canceled-390-dark-after.png`, `canceled-end-1440-light-after.png`, `canceled-end-1440-dark-after.png`, `canceled-end-390-light-after.png`, `canceled-end-390-dark-after.png` |

All 20 `E/{state}-{width}-{theme}.json` geometry probes were read. Each reports
`scrollWidth === width`. Desktop lists only `.qa-assistant__body`; compact width
also lists the underlying editor `NAV` and `.cm-scroller`. Neither width lists
the progress list as a scroller. The probe does not record visibility or DOM
ancestry of the compact underlying scrollers; it should not be interpreted as
proof of their inertness. The screenshots show a full-width compact sheet and
the fixed assistant header at both ends of the body.

## Prioritized actionable findings

1. **P2 [evidence] Interaction completeness is missing.** The only new disclosure
   is programmatically focused and opened/closed with Enter in F:228-234; terminal
   desktop captures show its focus ring. There is no captured expanded-times
   frame, Tab/Shift-Tab traversal, focus trace across live updates, pointer
   hover/pressed sequence, or same-frame press response. Preserve a small
   targeted interaction receipt and expanded disclosure image before declaring
   G5/H5/I1 fully verified. Do not infer these from resting screenshots.
2. **P2 [evidence] Missing initial/offline and inherited sheet/settings coverage.**
   All five captured states are online, after initialization. There is no
   first-paint/load sequence, offline capture, unsaved-composer dismissal
   receipt, or expanded preferences/consent capture. G6/H1/H6/H8/H11 cannot
   receive an unconditional PASS from this packet. Obtain only the relevant
   targeted evidence if those inherited surfaces are included in the final gate;
   this finding does not request their redesign.
3. **P2 [evidence] Compact-width captures are not true phone emulation.**
   F:149-151 uses `setViewportSize({ width, height: 900 })` and reduced-motion
   media emulation, not a mobile/touch/DPR device context. The 390 images prove
   compact layout, not a physical phone keyboard, touch, or safe-area behavior.
   Qualify phone claims; use the project's owned mobile capture path only if
   the final gate requires actual phone semantics.
4. **P3 [product] [defect, inherited] Failure cause is a machine code.**
   `E/failed-390-light-after.png` and its dark/desktop counterparts show
   "Failed" and `PROVIDER_HTTP_ERROR`, without a plain-language cause or next
   action near the failed stage. P's Run metadata renders `run.errorCode`
   directly; R:22,49 adds only "Failed". `E/failed-390-light-pair.png` shows the
   same error-code-only presentation in B, so this is not a new P68 regression.
   Track a separate failure-copy improvement rather than requiring a baseline
   redesign to validate recorded stages.
5. **P3 [evidence] Source manifest omits the new component.**
   `E/owned.json.inputs` fingerprints P/C/D/U/events/contracts but not R.
   All six recorded fingerprints match current source. R's filesystem mtime
   is `2026-10-28T23:34:21.732Z`, before capture startup
   `2026-10-28T23:37:57.534Z`; current source matches captured labels and
   structure. Nevertheless, add R to the next evidence manifest for a complete
   immutable source-to-capture link. Mtime is weaker evidence than a captured hash.

## G-J checklist verdicts

Verdicts apply to the changed progress region and preserved assistant controls
visible in this evidence packet. N/A means no corresponding instance in scope;
it does not certify unrelated editor or operating-system features.

| Item | FINAL | Evidence and bounded conclusion |
| --- | --- | --- |
| G1 Animation has a cause; no permanent loop | PASS | R:34-60 and C's progress rules introduce no animation, timer, decorative loop, or hover-only motion. `E/provider-running-390-light-after.png` shows a static play glyph plus specific running text, not an animated spinner. |
| G2 Geometry transitions preserve identity | N/A | No authored moving/resizing transition in R/C. Persisted stage arrivals change content intentionally; no transition animation is claimed. Resting top/end frames cannot establish pointer stability during an arrival. |
| G3 Motion is interruptible and never gates input | N/A | No animation in the changed region. H7 separately proves an actual cancel while the provider is held. No motion interruption test is applicable to this static progress implementation. |
| G4 Reduced motion preserves usable progress | PASS | F:150 applies reduced motion to the complete matrix; R/C has no positional, scale, depth, or blur animation to replace. All four `provider-running` top frames retain readable progress. This is a scoped progress verdict, not an audit of every shell animation. |
| G5 Immediate press feedback and honest progress pacing | FAIL | [evidence] No same-frame press or timing sequence is retained. Positive evidence: R has no percentage, bar/spinner switch, elapsed estimate, or fabricated pacing; `E/provider-running-1440-light-after.png` matches an actual held provider. The immediate-feedback portion remains unproved. |
| G6 Real first paint; no post-load layout shift | FAIL | [evidence] Empty captures are settled after consent; F calls `openSurface` and `consent` before capture. No first-paint or load sequence proves this item. Intentional stage arrivals are not being labeled load-shift defects. |
| G7 No flashing, strobing, or reading-blocking motion | PASS | No motion rules in the changed progress region; all 40 originals retain static readable content, and R contains no interval/timer or animated media. |
| H1 Empty/loading/error/offline states | FAIL | [evidence] `E/empty-390-light-after.png` gives an actionable context/prompt instruction; running/failed matrices exist. P supplies an offline alert and U tracks online/offline, but there is no offline capture or executed offline interaction in L/F. Legacy missing history is source/unit covered, not visually captured. |
| H2 Immediate descriptive loading | PASS | `E/provider-running-{1440,390}-{light,dark}-after.png` shows "Running · Generate response" and the actual active row. P has immediate request/preferences loading text; no spinner requiring delayed appearance or continued animation exists in R. Native GET below proves the state is real, not a frozen fake indicator. |
| H3 In-place failure cause and changed-state success | FAIL | [product] Inherited cause-copy defect described above. Success is correctly visible as "Result ready", completed rows, and pending review in `E/succeeded-390-light-after.png`; no routine outcome alert/toast substitutes for it. |
| H4 Alert content/buttons/destructive styling | N/A | No alert dialog is introduced or exercised by progress. P's inline `role="alert"` messages are not modal alert dialogs. |
| H5 Hover/pressed/focus/disabled states | FAIL | [evidence] C provides summary hover, focus-visible outline, button active/disabled styling; desktop terminal images show summary focus and end images show disabled Send/Undo. No hover/pressed frame sequence proves all control states. The native disclosure has no disabled/on-off toggle requirement. |
| H6 Sheet/modal escape and unsaved dismissal | FAIL | [evidence] All 390 captures show a single sheet with a visible close control. Shared `ui/surfaces.tsx` provides native dialog cancel/focus restoration. F does not exercise dismissal with a dirty composer or verify restoration; captures alone cannot prove preservation/confirmation. No new modal was added by R. |
| H7 Safe cancellation of a long operation | PASS | `E/provider-running-end-390-light-after.png` exposes "Cancel run". F holds the real provider before clicking cancel; `E/requests.json` POST `/api/ai/runs/46f399fb-625a-4211-8285-0ca4d2725716/cancel` returns 200 at `23:38:09.247Z`; subsequent authorized GET is canceled/version 2. `E/canceled-390-dark-after.png` shows the canceled active step; source hashes are unchanged. Generation is explicitly separate from applying source edits. |
| H8 Contextual permission/consent | FAIL | [evidence] Existing `Preferences.tsx` names selected-content transmission and an explicit provider-terms decision; requests prove server consent metadata was read. All matrix frames have this disclosure collapsed. The consent presentation and timing are not visually established by the packet. This is inherited governance coverage, not a progress permission regression. |
| H9 Deferred sign-in/named auth/password behavior | N/A | Fixture is already authenticated; progress adds no sign-in/onboarding/password surface. |
| H10 Search scope/history | N/A | No search surface is added or shown by recorded progress. Optional backend retrieval is not a search input UI. |
| H11 Settings labels describe ON | FAIL | [evidence] `Preferences.tsx` has descriptive Enable/default/consent labels and no new duplicated system setting. `E/*-end-*-after.png` shows only the collapsed "AI preferences and consent" disclosure. Expanded rendered settings are unproved; no native macOS settings window is in scope. |
| I1 Visible focus, order, and no unsolicited focus | FAIL | [evidence] R has a native summary, stable stage keys, and no focus calls. C supplies the ring, visible in `E/succeeded-1440-{light,dark}-after.png`; compact terminal captures focus the sheet close button after user-driven reopening. F uses `.focus()`, not Tab traversal, and retains no before/after active-element trace across events. Full reading-order traversal and focus persistence remain unproved. |
| I2 Escape/Enter/default shortcuts | PASS | Scoped to the new disclosure: F:228-234 opens and closes it with Enter in the passing native workflow. R installs no key handler or form/default action, so Enter on it cannot accept edits. Shared Modal has native cancel handling; actual Escape and editor shortcut regression execution are not established here and are not claimed. |
| I3 Named semantic controls/landmarks | PASS | R:35,39,44,52-58 supplies a named region, atomic status, ordered list, native named disclosure, and semantic times. Shared `ui/Icon.tsx` makes glyphs decorative; text labels independently carry status. Shared `IconButton` supplies title and aria-label. F asserts actual DOM step attributes and datetime values. No complete assistive-technology tree/screen-reader run is claimed. |
| I4 Gesture alternatives | PASS | New disclosure is a native keyboard/click control, not gesture-only. The compact sheet has a visible close button in all 20 compact frames; cancellation is text-button accessible. No progress gesture requires a separate alternative. |
| I5 Autoplay media controls | N/A | No media/audio in the changed surface. |
| J1 Native macOS chrome/menu/column conventions | N/A | This is an embedded web assistant, not a native macOS window, menu bar, or sortable table implementation. |
| J2 Compact presentation/input semantics | PASS | Qualified compact-width verdict: `E/empty-390-light-after.png`, all terminal compact frames, and end frames use a full-width sheet rather than a floating popover. No large-title collapse or numeric/email/URL input is introduced by R. True phone/touch/keyboard emulation is missing, as finding 3 states. |

## Functional integrity and actual receipts

**Real ordered stages: PASS.** R:43-50 maps only `run.steps` in received order,
without fixed slots. `E/requests.json` has 168 retained requests. For run
`b0d21a67-da83-490e-a529-e2592c8987d5`, POST returns queued/version 0 with only
completed context; GET at `23:38:03.532Z` returns running/version 1 with completed
context and running provider (`finishedAt: null`); GET at `23:38:04.564Z`
returns succeeded/version 4 with exactly context/provider/validation/publication.
The four success top captures match that order. Failure and cancellation each
retain only context plus the reached provider step. No retrieval or future
validation/publication row is manufactured.

**Authorized event refresh rather than polling: PASS for this fixture.**
`E/events.json` records success seq 3-7, including multiple distinct running
notifications, failure seq 9-11, and cancellation seq 12-14.
`E/browser.json` retains ten HTTP 200 `/api/events?after=0` response observations
and no page or console errors. U's receive handler reads on each matching
`operation.changed`, without status-only deduplication or a polling interval.
F observes authorized GET responses, gates the provider before Send, and releases
it only after inspecting the running state; it does not call Refresh or poll.
Repeated GETs coincide with events and responsive remounts, not evidence of a
timer. `E/workflow.json`'s `eventDriven` and zero-refresh claims are corroborated
by this source and these receipts, not accepted alone. Events JSON is the server
event record, not a retained raw browser SSE payload transcript.

**Exact recorded datetime and keyboard disclosure: PASS with visual limitation.**
R:27-28 formats the supplied timestamp locally while preserving its original
UTC `dateTime`. F:135-144 compares actual rendered row attributes and every
native `datetime` against the authorized DTO; F:228-234 exercises Enter.
L records that workflow passing. Equal/subsecond timestamps are not replaced
with fabricated durations. The visible local format uses seconds, while the
machine attribute retains the exact original instant. No expanded-times image
was saved, so expanded layout/wrapping is not visually approved.

**Honest legacy no history: PASS at source/unit level only.** R:60 explicitly
says no history was recorded when the array is empty, and creates no stage rows.
T's legacy case verifies no rows or progressbar; L records it passing. The
40 captures include a no-run empty state, not a legacy terminal empty-history
state. Do not describe the legacy rendering as browser visually verified.

**Publication is not approval: PASS.** R:21,42 labels success "Result ready"
and explains that generation does not accept proposed edits. All four succeeded
top captures show one pending change with separate Accept/Reject controls.
`E/workflow.json` retains the pending proposal and identical before/after source
SHA-256 `392c2b10d1f883ac1a73ca0f77efe11c044a71a8e979877ca8df405d8b0f12ab`.
F checks unchanged source after each terminal state and explicitly Rejects all
after the success captures; the real decide POST returns 200/version 5.
Progress is a display component with no Y.Text mutation or acceptance action.
Accept/undo execution itself was not part of this native fixture.

**Scroll ownership and identity: PASS for the changed region.** D declares the
existing fixed-header/body-scroll layout and explicitly forbids a progress
scroller. C applies overflow only to the assistant body, not progress/list/times;
all 20 probes corroborate absence of a progress scroll owner. End frames retain
the header, usable composer/cancel or regenerate controls, and governance.
The implementation imports shared SVG Icon, uses existing spacing/type/theme
tokens, and renders real DOM controls rather than screenshots/canvas substitutes.
Existing editor/assistant identity is preserved; exact mock screenshot cloning
was not required and is not used as a rejection criterion.

## Freshness, validation, and cleanup

`E/owned.json` records Bun 1.4.4, the workflow command, exact owned root
`/tmp/quire-assembly-wzLrss`, and three loopback origins. All six captured source
hashes match current source. R predates the captures but is absent from that
manifest, as finding 5 qualifies. Current source and all state captures agree
on the progress labels, row counts, status glyphs, review distinction, and
disclosure structure. No stale-source contradiction was found.

L explicitly names this E directory and records **9 pass, 0 fail, 244
assertions, TEST_EXIT=0**, including native workflow, all recorded step states,
timeout, legacy history, and ordinary four-stage history; UTC boundaries are
`23:37:10Z` to `23:38:10Z`. S records **TYPES_EXIT=0, LINT_EXIT=0,
DRAFT_EXIT=0** and three draft-guard files clean. S labels its commands only
"scoped tsc"/"scoped oxlint" rather than preserving their full arguments, so
the exact static invocation/scope cannot be independently reconstructed from
that log alone. These are inspected existing receipts, not reviewer reruns.

`E/cleanup.json` and L agree: owned data root absent, origins on ports 40761,
45627, and 43373 closed, browser closed, at `23:38:10.357Z`. No cleanup was
performed by this review. Broader backend failures described in
`docs/handoffs/p68-ai-steps-backend.md` were read as contract context, not
independently reexecuted or represented as frontend failures.

The evidence supports the central P68 behavior. The FAIL verdict is bounded to
the named evidence gaps and inherited cause-copy finding above; it is not a
request for unrelated baseline redesign or a claim of fabricated progress.

## Targeted follow-up - October 29, 2026 - FINAL

**Targeted recovery, disclosure interaction, overlay keyboard behavior, and
source provenance: PASS. Complete G-J gate: still FAIL for the bounded residual
items below.** This appendix supersedes the affected factual findings above;
the October 28 packet and verdict remain historical. This was a targeted
re-audit, not another complete 40-frame visual pass. Only this report was edited;
no runtime rerun or product/test edit was performed.

**N** = `docs/evidence/p68-ai-steps-frontend/after-e2b5f8e3-31c8-4f10-b2c9-8d88b3eeab8b/`.
**PL** = `docs/evidence/p68-ai-steps-frontend/parent-final.log`.
Read N's interactions/workflow/requests/events/provider-requests/owned/browser/
cleanup receipts, current R/C, and the current fixture and interaction drivers.
All nine `N/owned.json.inputs` hashes match current files, including R and both
test drivers. PL retains matching outer pre/post hashes for R, C, fixture, and
interactions, resolving original finding 5. PL names N, records 9 pass / 0 fail /
288 assertions, the actual scoped tsc and deny-warning oxlint arguments, and
`P68_PARENT_FINAL_EXIT=0`; its UTC boundaries are `01:06:16Z` to `01:07:27Z`.
The native cleanup receipt closes ports 35469/34039/44505 and the owned browser,
and records `/tmp/quire-assembly-WXfdVS` absent at `01:07:14.498Z`.
N/browser.json records no page/console errors and 15 successful event-stream
response observations. These are existing receipts, not reviewer executions.

**Fresh frames actually opened: 21.** Under N, these were all eight
`times-{focus,hover}-{1440,390}-{light,dark}.png`, all four
`overlay-keyboard-{open,closed}-{light,dark}.png`, all eight
`failed[-end]-{1440,390}-{light,dark}-after.png`, and
`regenerated-result.png`. Failure guidance wraps legibly in both themes and
widths; end frames retain the real Regenerate control. Focus frames visibly
show the disclosure ring; hover frames show the new wash and the natural
successor's ring. Overlay-open frames show focus on Refresh inside the compact
Assistant dialog, and closed frames show focus back on the header trigger.
No expanded-times image is among these frames: Enter opens and closes the
disclosure before the screenshot. `regenerated-result.png` is scrolled to the
composer, not a visible result/review proof; the recovery result is established
by the native DOM assertions and server receipts below.

### Resolved and remaining item verdicts

| Item | Follow-up FINAL | Exact evidence and remaining boundary |
| --- | --- | --- |
| G5 | FAIL, evidence limit retained | Regenerate performs a real new request; no synthetic percentage or pacing was introduced. No same-frame press capture/timing sequence was added, so that portion of the original checklist remains unproved. |
| H3 | FAIL under the full cause requirement; recovery portion PASS | R:42-45 and all four N/failed top frames now explain that publication stopped, no edits were applied, and how to use the exact real label **Regenerate (new use)** or seek administrator help. The original missing-next-action finding is resolved, and the action succeeds natively below. The actual cause remains `PROVIDER_HTTP_ERROR` in Run details rather than a plain-language cause explanation; this narrower inherited copy limitation remains. No provider/policy diagnosis was fabricated. |
| H5 | FAIL for complete coverage; disclosure hover/focus PASS | N/interactions.json has four width/theme records with active focus, solid 2px outline, native `:hover`, and background changing from transparent to `rgb(238, 240, 243)` / `rgb(42, 48, 59)`. All eight times frames corroborate it. `interactions.ts:14-47` drives native Enter, Tab, and hover. Pressed-state frames and all inherited control states are still not covered. |
| H6 | FAIL for the full inherited requirement; keyboard exit/restoration PASS | N/interactions.json and all four overlay frames establish native keyboard opening, one forward Tab remaining inside, Escape closing Assistant, and trigger focus restoration in both themes. Dirty-composer preservation/confirmation and complete Tab wrapping are not exercised. The light receipt explicitly records `toolsWereOpen: true`; closing that existing Project tools dialog with Escape before opening Assistant does not prove the inherited two-panel stack satisfies the single-sheet rule. |
| I1 | FAIL for full traversal/live-update scope; new local focus behavior PASS | Four native Tab-successor checks and focus-ring captures now replace the earlier programmatic-focus-only evidence. The successor is Conversation privacy in this failed-state fixture. The overlay receipts add focus containment and restoration. There is still no complete Tab/Shift-Tab traversal or active-element trace across live progress updates. |
| I2 | PASS, strengthened | `interactions.ts:16-19` asserts Enter opens and closes Recorded times. Its compact overlay branch uses trigger Enter, Tab, Escape, hidden-state observation, and active-trigger assertions; N's open/closed images and booleans corroborate these actions. This is not an editor-wide shortcut audit. |
| J2 | PASS only for compact web layout, unchanged qualification | Fresh overlay and failed frames retain a full-width compact dialog and readable controls. The driver still resizes a desktop browser context; physical touch, virtual keyboard, mobile DPR, and safe-area behavior remain unproved. |

G6/H1/H8/H11 remain **FAIL [evidence]** for the previously recorded first-paint,
offline, and expanded inherited consent/settings gaps. H6's unsaved-dismissal
gap also remains. G1/G4/G7/H2/H7/I3/I4 retain their earlier scoped **PASS**
conclusions; G2/G3/H4/H9/H10/I5/J1 remain **N/A**. This targeted appendix does
not recertify unseen fresh matrix frames or broaden those scopes. Legacy empty
history and timeout remain source/unit-backed, not new browser capture states.
The new recovery paragraph applies to both failed and timeout receipts in R;
the actual recovery exercise here starts from provider HTTP failure.

### Genuine failure-to-new-success recovery

N/requests.json retains 231 application requests. The failed run
`14217f6c-27a4-4090-b4cd-2cbdfdae37d2` is observed by authorized GET at
`01:07:08.081Z`, status failed/version 2, with only completed context and failed
provider. The fixture configures the owned HTTP provider to 500 for that run,
then to 200 at `fixture.ts:246`. It selects context and fills a new recovery
message before clicking **Regenerate (new use)** at line 257. This therefore
proves recovery using the current displayed message/context, not preservation
of an untouched draft across responsive remounts.

The button's actual POST is
`/api/projects/00000000-0000-4000-8000-000000000020/ai/runs`, returning 202 at
`01:07:12.046Z` with new ID `94d1c070-564b-443a-9778-659694911ef4`.
No `/regenerate` route is involved. Authorized GET at `01:07:12.602Z` returns
succeeded/version 4 and exactly context/provider/validation/publication, with
a pending proposed edit. Events seq 12-16 retain the new run's real transitions.
The browser fixture verifies that returned ID, rendered persisted rows and exact
datetime attributes, and unchanged document source before capturing.
Explicit Reject all then POSTs `decision: "reject"` to that new run's `/decide`,
returning 200/version 5 with the edit rejected at `01:07:12.934Z`.
N/provider-requests.json retains four actual provider requests;
N/workflow.json preserves identical before/after source hash
`392c2b10d1f883ac1a73ca0f77efe11c044a71a8e979877ca8df405d8b0f12ab`.
Success still means result publication, not source approval.

Historical failed test attempts are not counted as successful evidence.
The current driver fixes the two mistaken test assumptions with normal UI/API
behavior: it closes the underlying Project tools dialog through Escape before
keyboard-opening Assistant, and observes the existing create-run route used by
Regenerate. It does not force open the dialog, inject a success receipt, change
run status in the page, or bypass reviewed source decisions.

Remaining actions are evidence-only unless the parent separately scopes an
inherited copy/overlay change: retain the same-frame/pressed, expanded-times,
full traversal/live-focus, first-paint/offline, and inherited settings/dismissal
limits in synthesis. The fresh packet resolves source provenance and proves the
targeted recovery and keyboard behaviors without justifying a blanket G-J PASS.
