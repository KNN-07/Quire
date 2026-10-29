# P71 visual QA B - round 2

October 29, 2026. Reviewer: `st_01a18675`. **VERDICT: FAIL.**
Confidence: high for the observed desktop clipping; bounded for platform
accessibility. This is a review of the changed inline-reference region, not
whole-product, exact D06, live-provider, or physical-device acceptance.

## Must fix

1. **[product] [defect] C4 / A9, medium: the sticky result header clips the
   selected citation key on desktop.** In the final `1440-light-long-results.png`
   and `1440-light-keyboard-next-result.png`, the top of the bold key and its
   checkmark disappear behind the References header. The corresponding dark
   frames and both 1920 themes show the same defect. These are the initial
   selection and an explicit keyboard selection, not a user deliberately
   scrolling the selected row out of view.

   All capture paths below are relative to:

   `docs/evidence/p71-inline-references/0c2ba8f3-639d-4721-9d6f-23f4233b7022/`

   The full 1440 frames locate this at approximately x=368-814, y=741-757.
   `1440-light-long-results.json:41-55` gives selected-key top **741**,
   bottom **756.59375**, and sticky-heading bottom **746**: a **5px**
   overlap. `1440-light-keyboard-next-result.json:41-55` gives key top
   **741.59375**, still **4.40625px** beneath that header. Independently read
   `1920-dark-keyboard-next-result.json:41-55` reports the same geometry.
   The pixels visibly corroborate the rectangles; this is not just a failed
   geometry heuristic.

   `apps/web/src/features/editor/source/source.css:54` makes the header sticky
   at every width, but `reference-layout.ts:13` returns before its selected-row
   correction at desktop widths. Its correction at lines 22-23 is consequently
   compact-only. Retain the independent manual-scroll behavior, but make the
   selected-row reveal account for the sticky header at desktop widths too,
   or change the list/header geometry so they cannot overlap. Verify initial
   opening and ArrowDown with the full key and checkmark below the header in
   both desktop themes. The compact frames do not have this defect:
   `390-light-long-results.json` puts the key at y=513.796875, below the
   heading's y=512.796875 bottom.

2. **[product] [defect] C2, low: publication metadata still emits the provider
   enum rather than its display name.** `remote-completion.ts:127` interpolates
   `publication.provider` directly. The corrected configuration/summary uses
   “Semantic Scholar,” but a successful Semantic Scholar candidate would still
   render `semanticScholar` in its metadata. This is the remaining specific
   source-backed part of round 1's C2 finding, not a claim that the current
   unavailable-provider screenshot exposes it: the six `*-error.png` frames
   now correctly say “Semantic Scholar” and give friendly guidance. Reuse the
   human-readable provider labels for candidate metadata while retaining the
   service identifier in requests. The successful candidates captured here
   are Crossref fixtures only.

No source or test was changed by this reviewer.

## Evidence actually inspected

I read the complete visual-QA skill, parent corrections, historical producer
handoff, prior B FAIL, independent inline verification, current Source
`DESIGN.md`, and the current InlineReferences, remote-completion, source CSS,
preferences, SourcePanel, editor, reference-layout and project-index source.
I also read typography/color tokens, the backend lifecycle handoff, the retained
round-2 native log, relevant before/after manifest entries, presentation metadata,
selected geometry records and the final cleanup receipt.

I directly opened **all 78 final PNGs as full frames**, not contact sheets:
three widths (390, 1440, 1920), two themes, and these exact 13 states at every
width/theme:

`off-expanded`, `keyboard-focus`, `pointer-hover`, `pointer-pressed`,
`loading`, `canceled`, `empty`, `error`, `long-results`,
`keyboard-next-result`, `results-end`, `dismissed`,
`tracking-off-withdrawn`.

The naming rule is `<width>-<theme>-<state>.png` under the root above.
The original `docs/evidence/design/06-editor-tools.png` was also opened.
Frames contain the page rather than browser chrome and have no visible
compositor gaps. Image reads identify PNG. Geometry records establish
390x844/DPR 3/touch and 1440x900/DPR 1; the 1920 frames are full-width desktop
captures. I checked filesystem freshness: the earliest final PNG is
`2026-10-29T06:58:08.347Z`, later than current InlineReferences, remote-completion,
source.css, preferences, editor, reference-layout and DESIGN source timestamps.
No stale screenshot is used for this verdict.

The retained functional run is **21 pass, 0 fail, 276 assertions, 142.49 seconds,
exit 0**, from `docs/evidence/p71-parent-privacy/round2-native.log`; it was not
rerun here. Relevant entries in `round2-before.sha256` and
`round2-after.sha256` agree for DESIGN, InlineReferences, reference-layout,
remote-completion and the suite's source.css. The parent explicitly records
that this final capture set follows a subsequent CSS-only button-border
revision; the earlier suite is not misrepresented as a functional rerun on
that color revision.

The final cleanup reports its owned root absent, browser closed, three listeners
closed, and `errors: []`. No browser, provider, service, test or build was
started here. Parent-owned root static/build work is not duplicated or given
an invented result.

## Round-1 findings reconsidered

The prior report remains historical FAIL, but its superseded defects are not
carried forward:

- **Geometry/configuration:** focus no longer collapses the disclosure.
  Done is explicit; the compact result list is in flow with Close and keyboard
  hints. Long-results frames keep the caret above the sheet and the app tabs
  below it. Configuration can consume nearly all compact source height while
  deliberately open (`390-light-off-expanded.json` records 2.42px of Source);
  it is a configuration mode with scrolling to Done, not a typing-state
  collapse. The hover/pressed frames show the reachable bottom controls.
- **Ownership:** the current DESIGN names Source's `.cm-scroller`, the
  completion list, and bounded configuration. The current regional probe names
  those actual selectors and records overflow, bounds and scroll position,
  rather than the old empty selector/Assistant-only list.
  In compact long-results, Source is 39px high with 1,806px content and the
  result list is 240px high with 2,284px content. Desktop records separate
  645px/1,806px Source and 140px/857px result scrolling. Manual `results-end`
  frames show the last candidate's authors/year/provider without moving the
  source caret or resetting to the selection.
- **Readability:** compact reference body is now 24px, key/hints/status/Close
  are 20px, and selects are 52px high in the inspected compact geometry.
  Desktop select geometry is 44px. Disclosure prose is constrained to 65ch.
  Candidate key, title, authors and year/provider occupy distinct lines rather
  than one italic run. The remaining desktop key clipping is finding 1.
- **Feedback:** empty and unavailable-provider frames now give a next step.
  Loading disappears in canceled frames. Tracking withdrawal visibly reaches
  Off; source preserves the ability to withdraw an already-selected provider.
  Native log evidence separately covers actual Escape/Off cancellation.
- **Color:** the changed selects now use `--q-muted`, not the old
  low-contrast `--q-control-border`. Done/Close edges are locally scoped to
  `--q-tertiary`, so this is not a global-token change requiring unrelated
  sibling-route recapture. Parent calculations give button edge ratios
  light **6.20/5.43/4.92**, dark **8.25/6.56/5.57**
  for rest/hover/pressed. Full frames show those variants coherently.
- **Selection/content:** the checkmark is implemented and appears beside
  selected keys on compact captures; the wash remains. The actual fixture
  metadata is preserved, not replaced with illustrative D06 publications.

## Assigned A-F checklist

PASS is limited to the stated changed region and evidence, not an assertion
about every inherited shell element. “Unproved” is an evidence limit, not an
invented rendered defect. N/A marks a platform/component outside this region.

| Item | Verdict | Evidence / boundary |
| --- | --- | --- |
| A1 | PASS | All long-results: source/caret anchoring on desktop, bounded sheet below Source on compact. |
| A2 | PASS | All 78: regional backgrounds reach their panel bounds; no stray outer canvas margin. |
| A3 | PASS | All off-expanded: shared leading/trailing field margins; CSS 65ch disclosure measure. |
| A4 | Unproved | Emulated 390 frames do not prove a physical notch, home indicator or software-keyboard safe area. |
| A5 | PASS | 390 result/configuration scroll frames show no reserved page gutter; native overlay scrollbar acceptance on actual mobile remains unproved. |
| A6 | PASS | Named regional owner probes and long-results/results-end show independent Source/configuration/result content; sticky header remains legible. Key occlusion is separately FAIL C4. |
| A7 | PASS | All configuration frames: shared edges and spacing tokens. |
| A8 | PASS | Provider, disclosure, destination and Done remain grouped; completion header separates Close/hints from rows. |
| A9 | FAIL | Desktop selected key overlaps sticky header; finding 1. Compact long titles wrap without horizontal primary-content overflow in supplied cases. |
| A10 | PASS | Compact long-results intentionally exposes a partial candidate as continuation; configuration is visibly cut by its bounded scroller. Desktop overflow affordance is weaker but the list scrolls to the recorded end. |
| A11 | N/A | No native macOS window/minimum-size acceptance in this browser review. |
| A12 | PASS | Current DESIGN layout line plus identified regional scrollers in 390/1440 long-results JSON. No fixed editor height or replacement shell introduced. |
| B1 | PASS | Brief deliberately keeps Recompile's primary styling; selected reference plus Enter guidance identifies regional acceptance. |
| B2 | N/A | No destructive action introduced in this region. |
| B3 | PASS | References header, labeled configuration and Source filename provide concrete titles. |
| B4 | PASS | Query context precedes candidate key/title/authors/year/provider; configuration is explicitly dismissible. |
| B5 | PASS | Reference region uses existing selection/action accent, not decorative new colors. |
| B6 | PASS | Sans publication text and mono keys preserve a clear hierarchy in both themes, subject to C4 clipping. |
| B7 | PASS, bounded | Brief and required controls are implemented. Destination is available in deliberate configuration rather than duplicated in each row. Copy receipts are source/log-backed, not in this 13-state visual set. |
| C1 | PASS, bounded | Compact 24px body / 20px secondary and desktop 14px publication text; 13px mono citation keys remain code identifiers, not prose. |
| C2 | FAIL | Friendly known-provider errors corrected; raw candidate provider enum remains at remote-completion.ts:127, finding 2. Citation keys and destination filenames are intentional useful identifiers. |
| C3 | PASS | Done configuring references, Close, outcome guidance and noun field labels; no generic OK. |
| C4 | FAIL | Current desktop key/header overlap; finding 1. Long compact title wrapping otherwise legible; 200% zoom is unproved. |
| C5 | PASS, bounded | Japanese phrase in every long-results family renders without tofu or broken Japanese phrase in supplied frames; no Korean/Chinese or citation-parenthesis stress proof. |
| C6 | PASS | All empty/error: refine query, choose another provider, or ask administrator. Canceled frames do not retain Searching. |
| C7 | PASS | Off-expanded/keyboard-focus frames and ARIA/source: visible provider and destination labels, named Source textbox. |
| C8 | Unproved | Status is ordinary text and source is selectable; pointer selection of list metadata/errors/path is not demonstrated. |
| D1 | PASS, compact scope | Compact selects 52px; Done/Close at least 44px and separated; result row is a large continuous target. Desktop Close/Done retain standard pointer sizing, not a physical-touch desktop claim. |
| D2 | N/A | Existing shell tab anatomy is unchanged; not accepted as compliant by this review. |
| D3 | N/A | Existing assembled toolbar groups/placement are not the changed reference region. |
| D4 | N/A | No adjacent bar-button group introduced; Close is one standalone target. |
| E1 | PASS | All 39 light/dark pairs inspected; coherent surfaces, glyphs and publication text. |
| E2 | PASS, scoped | Current local select/button edges corrected; parent rest/hover/pressed ratios above. No claim to comprehensive syntax/shell/OS-native-option contrast audit. |
| E3 | PASS | Off/provider/status text, selected checkmark plus wash, visible field outline. Desktop glyph clipping fails C4, not absence of a glyph implementation. |
| E4 | PASS | No conflicting reference status-color semantics in the captured states. |
| E5 | N/A | Reference surfaces are opaque, not translucent overlays. |
| E6 | PASS, source-backed | Existing system-color tokens and System/Light/Dark preference preserved; no physical OS-toggle acceptance run here. |
| F1 | PASS | No emoji or competing decorative icon family; checkmark is a selection indicator. |
| F2 | PASS | Regional spacing/radius/shadow use shared tokens; popup geometry remains a live component. |
| F3 | PASS, scoped | Local selectors constrain corrections to references/completion; no global palette/control primitive changed. Whole-app siblings are not certified. |
| F4 | PASS | Quire shell branding remains present; no new reference branding. |
| F5 | PASS, implementation | Selected checkmark plus wash, native field outline, no accent side-border. Desktop header currently clips part of glyph/key; C4 must still be fixed. |
| F6 | PASS | Close is plainly labeled; existing shell glyph placement is preserved. |
| F7 | PASS | One live completion surface, no raw-BibTeX competing popup; compact uses in-flow sheet, desktop anchored list. |

## Reference and acceptance limits

D06 is an original design reference, not a pixel-identical current-shell
baseline. Its wide source/search rail, Back to editor header and two
illustrative candidates differ from the inherited assembled Files/Source/
Assistant shell. Current reference rows now recover key-first metadata
hierarchy, a grouped header and keyboard guidance without fabricating the
D06 publications. Those whole-shell differences are not new P71 blockers.
No same-state, same-shell image-diff or new before/after pair was produced
by this review; no similarity number is invented or used as acceptance.

The 78-frame matrix does not include final copy-in-progress, successful-copy,
stale-copy receipt, offline/recovery, 200% zoom or software-keyboard frames.
Receipt persistence and cancellation have retained functional evidence, but
that is not visual certification of those additional states. Human screen-reader
announcement/focus behavior, iOS Safari/Android device behavior, physical safe
areas, OS-native select menus, live vendor metadata and exact D06 fidelity remain
unproved. Backend lifecycle passing evidence is retained unchanged, not rerun.
Root static/build outcome remains with the parent.

This independent B round is complete. The current changed region is **not
accepted** until the concrete desktop clipping and remaining provider-label
defects above are resolved; lack of human/device acceptance is reported
separately rather than relabeled as a screenshot product bug. Preserve the
correct explicit Done, compact in-flow sheet, real metadata, local border
contrast, Off withdrawal, friendly known-provider feedback and independent
manual scrolling.
