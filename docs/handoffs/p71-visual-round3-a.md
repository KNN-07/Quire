# P71 independent visual QA A, round 3

October 29, 2026. Reviewer: `st_01a18683`.
**VERDICT: PASS for the changed Source inline-reference region.**
Confidence: HIGH for the inspected Chromium states and selected-result geometry;
bounded for accessibility and platforms not exercised. No current blocking
product defect was found in the assigned G-J scope. This is not comprehensive
product, exact D06, P72, or human-accessibility acceptance.

Round 3 of 3; this independent review took approximately 6 minutes, starting
at 07:15 UTC. Round 2 A records approximately 8 minutes; round 1 duration was
not recorded. No additional reviewer or acceptance round was dispatched.

## Evidence admitted

Current evidence root **E**:
`docs/evidence/p71-inline-references/f325a788-b306-45fe-a420-2a356a962e35/`.

I directly opened all **78 PNGs as full frames**, not contact sheets: one
mounted Source surface, 13 states, 390/1440/1920 widths, both light and dark.
Exact path rule: `E/<width>-<theme>-<state>.png`. States:

`off-expanded`, `keyboard-focus`, `pointer-hover`, `pointer-pressed`,
`loading`, `canceled`, `empty`, `error`, `long-results`,
`keyboard-next-result`, `results-end`, `dismissed`,
`tracking-off-withdrawn`.

No enumerated frame was skipped. I also read all 78 matching geometry JSONs
and ARIA snapshots, `presentation.json`, and `cleanup.json`. Image reads
identify PNG; frames contain the page, not browser chrome, and show no missing
or black compositor regions. Geometry records show 390x844/DPR 3/touch 1 and
1440x900 or 1920x900/DPR 1/touch 0. All 78 document widths equal viewport width.

The ten inspected Source files (DESIGN, InlineReferences, reference-layout,
remote-completion, reference-receipt, source.css, editor, preferences,
SourcePanel, project-index) match their round-3 frozen-manifest hashes.
The latest source mtime among them is 07:10:04.592 UTC. PNG mtimes span
07:13:55.423-07:14:20.191 UTC, after those corrections.

I compared the complete paginated manifest contents: `round3-before.sha256`
and `round3-after.sha256` are identical, with 1,708 hash records each.
`round2-before.sha256` and `round2-after.sha256` are likewise identical,
with 1,705 records each. These establish the respective recorded input
boundaries, not a whole-filesystem or current P72 freeze.

Retained execution evidence, not commands replayed by this reviewer:

- `docs/evidence/p71-parent-privacy/round3-presentation.log`: completed exit 0,
  **1 pass, 0 fail, 167 assertions**, 71.75 seconds. The current presentation
  test checks selected-key/header geometry at every width, not only 390.
- `docs/evidence/p71-parent-privacy/round2-native.log`: completed exit 0,
  **21 pass, 0 fail, 276 assertions**, 142.49 seconds. Retained for unaffected
  functional behavior, not represented as a new full-suite run after the two
  round-3 corrections.
- E cleanup: owned temporary root absent, browser closed, all three owned
  listeners closed, errors empty. Expected canceled/unconfigured requests in
  the log correspond to deliberately exercised states.
- `docs/handoffs/p71-reference-lifecycle.md`: unchanged backend acceptance,
  including 8 lifecycle tests/21 assertions and 4 retrieval tests/22 assertions.
  This review neither reran nor expanded that backend acceptance.

Read the full visual-QA skill, parent corrections, historical producer handoff,
first A FAIL, independent inline verification, both round-2 visual reports,
current Source DESIGN, and the current mounted source path above. Also read
the presentation test and shared focus/button CSS. Historical failures remain
historical; their superseded findings are not current defects.

## Round-2 findings resolved

**Selected desktop keys no longer sit underneath the sticky heading.**
I inspected all eight full desktop initial/ArrowDown frames:
`E/{1440,1920}-{light,dark}-{long-results,keyboard-next-result}.png`.
The key and selected check are now visibly complete beneath the header around
x367-815, y702-763. Matching JSON rectangles, in CSS pixels:

| Widths/themes | State | Key top / bottom | Heading bottom | Clearance |
| --- | --- | --- | --- | --- |
| 1440 and 1920, both themes | long-results | 747 / 762.59375 | 746 | 1 px |
| 1440 and 1920, both themes | keyboard-next-result | 746.59375 / 762.1875 | 746 | 0.59375 px |
| 390, both themes | long-results and keyboard-next-result | 513.796875 / 537.796875 | 512.796875 | 1 px |

The current `apps/web/src/features/editor/source/reference-layout.ts:13`
checks only whether a visible sheet/list/heading exists; it no longer exits
at desktop widths. Heading-aware selected-row measurement at lines 22-23
therefore applies at all widths. Only caret reveal remains compact-specific
at lines 24-25. The public `requestMeasure` read/write path and
selected-completion update trigger retain CodeMirror ownership rather than
rebuilding a static list. Current presentation assertions at
`tests/ui-editor/inline-references/presentation.test.ts:66-68` cover initial
and ArrowDown keys across all six width/theme combinations.

**Provider display names are now shared.**
`remote-completion.ts:12-13` exports the provider labels;
`InlineReferences.tsx:8,87,93-95` uses that list for configuration/summary,
and `remote-completion.ts:129` resolves candidate metadata through the same
labels. The previous successful-Semantic-Scholar `semanticScholar` prose path
is corrected in source. Current successful fixture frames visibly say
Crossref; no successful live Semantic Scholar frame is claimed.

## Scroll ownership and actual context

DESIGN identifies `.cm-scroller` as Source owner and names the independent
completion/configuration and existing draft/tool/proposal regions. The
regional probes report those real selectors and their overflow.

| Width, both themes | Source scrollTop: initial / next / end | Result scrollTop: initial / next / end |
| --- | --- | --- |
| 390 | 1761 / 1761 / 1761 | 0 / 278 / 2044 |
| 1440 | 1161 / 1161 / 1161 | 0 / 102 / 717 |
| 1920 | 1161 / 1161 / 1161 | 0 / 102 / 717 |

The manually scrolled `results-end` frames reach the final item's
authors/year/provider without moving Source or resetting to selection. A
selected row intentionally out of view after manual scrolling is not a
recurrence of the former automatic-reveal defect. No list scroll listener
forcibly recenters selection in `reference-layout.ts:40-49`.

At 390, Source scroller bounds are y413.5-452 and the actual caret is
y430-447. The sheet begins at y452 and ends at y694, above navigation.
Its list is 240px high with 2,284px content; Source has 1,806px content.
Desktop Source is approximately 645px high, and results have a separate
140px viewport/857px content. Both themes agree.

Compact deliberately open configuration occupies nearly all remaining Source
height, but its bounded configuration scroller moves from 0 to 286 to expose
the destination and Done in hover/pressed frames. Explicit Done restores
typing space. This is a configuration mode, not the removed focus-triggered
collapse. Software-keyboard space remains an unproved platform limitation.

## Assigned G-J checklist

PASS is regional and evidence-bounded. Source-backed conclusions below are not
claims that this reviewer independently drove a new browser session.
Each state name expands to the E path rule above, across all widths/themes
unless narrowed explicitly.

| Item | Verdict | Evidence and boundary |
| --- | --- | --- |
| G1 | PASS | No decorative animation added in source.css. Configuration/query/hover/press states have explicit interaction or state causes; pointer-hover/pressed frames show feedback. |
| G2 | PASS | InlineReferences.tsx:84-110 uses explicit Done, not a Source-focus collapse. Long/next/dismissed geometry preserves context. The current all-width selected-row correction resolves the actual desktop defect. No custom animated transition is introduced. |
| G3 | N/A | No new timed animation to interrupt or gate input. Lookup cancellation does not await a visual effect. |
| G4 | N/A | No new positional/scale/depth/blur animation. The presentation uses reduced-motion reduce; inherited shared-spinner behavior is not accepted here. |
| G5 | PASS | Searching and Copying are published before their request/flush awaits in remote-completion.ts. All six hover/pressed pairs show control feedback. No spinner/progress bar is introduced. Exact same-frame input-to-photon latency is unmeasured. |
| G6 | PASS | Scoped source-backed: the feature initially renders real Off/configuration controls, not a splash or delayed raster. Removed focus-collapse stays removed. Whole-app first paint/CLS telemetry is not supplied or approved. |
| G7 | PASS | No flashing/strobing/looping motion introduced by this region; all inspected states remain readable. No inherited shell video audit is claimed. |
| H1 | PASS | Loading/empty/error frames cover all six combinations. Empty gives refine-query/provider next steps. Offline/recovery blocks and reconnect guidance are source-backed at InlineReferences.tsx:54-67, not an offline screenshot claim. |
| H2 | PASS | Loading text appears immediately in source and in held-request frames. Every canceled frame/tree removes Searching. Retained round-2 tests explicitly cover both Off and Escape feedback clearance. No stopped spinner is added. |
| H3 | PASS | Error text is adjacent to Source in a status region; empty/error/canceled frames agree with ARIA. Successful insertion and stale-copy disclosure remain source/retained-native-backed, not newly captured success/receipt visuals. No routine alert/toast added. |
| H4 | N/A | No alert or destructive reference action introduced. Existing tracking dialogs are outside this region. |
| H5 | PASS | Keyboard-focus, hover, pressed, withdrawal and selected-option frames plus native-control/source semantics show distinguishable states. Provider focus has a 2px solid outline; selected options have wash plus check. OS-native option-menu and every possible control-state combination remain unproved. |
| H6 | PASS | Compact long/next/end frames show one in-flow sheet with explicit Close. Source close handler returns focus; dismissed frames and retained assertions establish no copy/insertion on Close. No resizable modal, staged form submission or unsaved modal draft introduced. |
| H7 | PASS | remote-completion.ts:47-69 aborts request-owned lookup and clears its feedback. editor.ts:114-120 intercepts Escape at highest DOM priority. Accepted durable copy is not falsely offered as safely undoable cancellation; stale insertion is withheld and copy disclosed. |
| H8 | PASS | Off is default; configuration explains typed-query transfer, provider semantics and separate Library/linked bibliography scope. Tracking withdrawal is exercised before Off becomes disabled (presentation.test.ts:158-161). This is contextual provider consent, not system-permission/onboarding acceptance. |
| H9 | N/A | No sign-in/password/onboarding UI added. Mendeley grant requirement is named; account sign-in is outside scope. |
| H10 | PASS | Active citation argument is the single remote query location; provider summary identifies scope and real candidates are suggestions. Configuration explicitly separates Account Library. No second remote search input is added. |
| H11 | PASS | Provider/destination are visibly labeled native selects; Off explains local-only behavior. Saved autocomplete preference is honored rather than duplicated. No OS-wide setting or native settings window introduced. |
| I1 | PASS | Keyboard-focus frames/JSON prove provider ring and focus order from summary to field. Global CSS:8 and source.css:27 cover remaining controls; CodeMirror retains editor focus during option selection. Done/Close restore focus only after user action. Exhaustive human focus traversal is unproved. |
| I2 | PASS | Current presentation proves ArrowDown selection, Escape request cancellation, and Close dismissal. Retained native run proves actual Enter acceptance/no-copy Escape. editor.ts preserves collaborative Mod-Z and completion bindings; native Cmd-comma/menu parity is outside scope. |
| I3 | PASS | All 78 snapshots expose named Source region/textbox; open configuration exposes named provider/destination comboboxes; results expose Completions listbox, selected option metadata and named Close; loading/errors expose status. Human announcement quality and assistive-technology linkage behavior are not certified by these snapshots. |
| I4 | PASS | Native fields, summary, Close and pointer/keyboard candidate acceptance supply controls; no gesture-only operation introduced. |
| I5 | N/A | No media/autoplay introduced. |
| J1 | N/A | Browser Source region, not a native macOS application. No native chrome, menu parity or settings-pane acceptance. |
| J2 | PASS | Both compact themes show an in-flow sheet, not an overlay popover, with visible caret and Close. No large collapsing title or numeric/email/URL field introduced; Source is TeX text. Physical phone/IME/software-keyboard behavior remains unproved. |

## Integrity, retained corrections and limits

The region is real React/native controls plus CodeMirror completion DOM, not
a pasted image. Shared typography, surface/spacing/radius/selection tokens
and Button styling drive it. Real HTTP-fixture metadata supplies key, title,
authors, year and provider; initial/next ARIA selection and visible check agree.
No fictional D06 publication replaces the actual record. Opaque surfaces
composite correctly in the full PNGs; no new numeric alpha/image-diff score
was produced by this reviewer.

Keep the prior resolved fixes: explicit Done, compact sheet/Close, request-owned
cancellation feedback, highest-priority Escape, friendly empty/error guidance,
withdrawable provider selection, durable copy receipts, actual metadata,
24px compact body/20px secondary text and compact 44px controls. Current scoped
tertiary button borders remain present at source.css:48. Parent-calculated
rest/hover/pressed edge ratios are light 6.20/5.43/4.92 and dark
8.25/6.56/5.57; this pass visually inspected those states but did not remeasure
the ratios. No taste changes are requested.

I opened `docs/evidence/design/06-editor-tools.png`. Its search rail, broader
source canvas, simpler header and bibliography-card composition differ from
the inherited assembled Files/Source/Assistant shell. Those differences are
not new P71 geometry regressions and exact D06 fidelity is not approved.
No retrospective before capture or new D06 pixel comparison was manufactured.

Unproved: human screen-reader announcements/traversal; physical iOS/Android,
notches/safe areas and software keyboards; Safari/Firefox/native macOS;
IME, 200% zoom, whole-product motion/CLS/first-paint telemetry; live providers;
successful LaTeX compilation; every authority/error variant. The 13-state
matrix does not include offline/recovery, copy-in-progress, success or
stale-receipt PNGs; related conclusions are explicitly source/retained-native
backed. Inherited spinner and unrelated AI consent failures are not fixed or
accepted here.

The parent's final-validation.log predates the two round-3 corrections and
P72. It is not current global/P72 validation. Parent-owned static/build work
was not duplicated and no pending result is assumed. P72 backend/Assistant UI,
port 5173, live providers and unrelated root file `1` were outside this review.

**Must fix: none in the inspected P71 region. Recorded taste findings: none.**
The assigned independent round-3 A gate passes on the current full capture
set, with the explicit limits above; combined A-F/G-J synthesis and any broader
acceptance remain the parent's responsibility. Only this report was written;
no source/test edits, tests/builds, browser/service launches, commits or
additional reviews were performed.
