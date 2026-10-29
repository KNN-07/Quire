# P71 independent visual QA A, round 2

October 29, 2026. **VERDICT: FAIL, scoped to the changed inline-reference
region. Confidence: HIGH.** One current product defect remains: desktop
automatic result scrolling puts the selected citation key partly underneath
the new sticky heading. This is visible in the final CSS-color revision, not
a carried-forward round 1 finding. The prior cancellation feedback, compact
popover, focus-collapse, empty guidance and blocked-provider withdrawal
findings are resolved by current source and evidence.

This is independent pass A (G-J and functional/result geometry), not combined
A-J, exact D06, production-readiness or human-accessibility acceptance.
Round 2 of the product surface's 3-round budget; this pass took approximately
8 minutes. Round 1's duration was not recorded in its handoff. No additional
review round or implementation was initiated by this reviewer.

## Must fix

**P2 [product] [defect] [keyboard selection/result geometry]: desktop selected
keys are clipped by the sticky completion heading.**

Evidence root **E**:
`docs/evidence/p71-inline-references/0c2ba8f3-639d-4721-9d6f-23f4233b7022/`.
I opened the full PNGs directly, including all of:

- `E/{1440,1920}-{light,dark}-long-results.png`
- `E/{1440,1920}-{light,dark}-keyboard-next-result.png`

In these eight actual frames, the top of the selected key and selected check
are covered by the opaque heading around x367-815, y702-746. This is not
intentional manual scrolling. It already occurs on initial results and
immediately after ArrowDown selects the second record.

The matching JSON proves the overlap in CSS pixels at both desktop widths,
in both themes:

| State | Selected key top/bottom | Heading bottom | Covered top |
| --- | --- | --- | --- |
| long-results | 741 / 756.59375 | 746 | 5 px |
| keyboard-next-result | 741.59375 / 757.1875 | 746 | 4.40625 px |

`apps/web/src/features/editor/source/source.css:54` makes the heading sticky
with an opaque background and z-index 1. The corrective measurement in
`apps/web/src/features/editor/source/reference-layout.ts:13` returns before
doing anything outside compact width. Its heading-aware reveal at lines
22-23 therefore cannot protect desktop selections. The presentation test's
selected-key assertion is likewise inside the width-390 branch
(`tests/ui-editor/inline-references/presentation.test.ts:66-74`).

Fix the automatic selected-row reveal for desktop as well as compact width:
account for the sticky heading before displaying an initial or newly selected
key, while preserving independent manual result scrolling. Alternatively,
keep the heading outside the scrolling option viewport. Verify initial and
ArrowDown selections with the key entirely below the heading at 1440/1920 in
both themes. Do not forcibly reset a user's deliberate results-end scroll.
This is a required key/selection legibility defect, not a spacing preference.

## Evidence admitted

Read the current source DESIGN and mounted UI implementation:
`SourcePanel.tsx`, `InlineReferences.tsx`, `editor.ts`, `preferences.ts`,
`remote-completion.ts`, `reference-layout.ts`, `project-index.ts`,
`reference-receipt.ts`, and `source.css`, under
`apps/web/src/features/editor/source/`. Also read shared controls, global
focus styling, tokens, the current reference route/retrieval source, the
presentation test, the full visual-QA skill, and these handoffs:
`p71-parent-corrections.md`, `p71-inline-references.md`,
`p71-visual-qa-a.md`, `p71-inline-verification.md`, and
`p71-reference-lifecycle.md`.

**All 78 final PNGs were directly opened as full frames, not contact sheets.**
This is one mounted Source surface with 13 states, each at 390/1440/1920 in
light/dark. No enumerated frame was skipped. Exact filename rule:
`E/<width>-<theme>-<state>.png`; the states are:

`off-expanded`, `keyboard-focus`, `pointer-hover`, `pointer-pressed`,
`loading`, `canceled`, `empty`, `error`, `long-results`,
`keyboard-next-result`, `results-end`, `dismissed`,
`tracking-off-withdrawn`.

Read all 78 matching geometry JSONs and all 78 ARIA YAML snapshots. The
images decode as PNG, show page content without browser chrome, and show no
missing/black compositor region. Dimensions are 390x844 and desktop
1440x900/1920x900. Mobile geometry records DPR 3 and touch 1; desktop DPR 1
and touch 0. All 78 documentWidth values equal viewport width.

The inspected rendered-source files' latest mtime is `source.css`,
2026-10-29 06:57:02.774 UTC. Final PNG mtimes span 06:58:08.347 through
06:58:33.231 UTC, so none predates that source revision. Current hashes of
the eight inspected executable Source TS/TSX files match the frozen run's
manifest. CSS does not match that earlier manifest, consistent with the
declared subsequent border-color correction; these are the post-color PNGs.
Freshness/identity checks do not replace visual judgment.

Independently compared `round2-before.sha256` and `round2-after.sha256`:
byte-identical, 1,705 records each. Read `round2-native.log`: completed exit
0, **21 pass, 0 fail, 276 assertions, 142.49 seconds**. This is retained
execution evidence, not a run by this reviewer. The final E cleanup receipt
reports root absent, browser closed, all three owned listeners closed and
errors empty.

No tests were replayed, services started, live providers contacted, ports
taken over, commits created, or source/test files edited. The parent owns
the in-flight static/build checks; no result from them is assumed here.

## Prior findings reconciled

| Prior finding | Current disposition |
| --- | --- |
| Compact completion overlays source | RESOLVED. `source.css:59-73` uses an in-flow sheet. In both 390 long/next-result themes the source scroller ends at y452 and the sheet begins at y452, ending at y694 above panel navigation. Close is visible. |
| Caret or selected key lost after compact resize | RESOLVED for captured geometry. Both 390 themes show caret y430-447 within scroller y413.5-452. Selected key begins y513.796875, below heading bottom y512.796875, on initial and next selection. Desktop has the distinct current defect above. |
| Source focus collapses configuration | RESOLVED. No contentDOM focus-collapse listener remains. `InlineReferences.tsx:107-110` closes only through explicit Done and restores Source focus. Opening resets configuration scroll at lines 84-85. |
| Permanent Searching notice after cancellation | RESOLVED. `remote-completion.ts:44-69` aborts and clears request-owned feedback, including context abort; `InlineReferences.tsx:71-77` separates transient feedback from the saved receipt. Final loading/canceled PNG and ARIA pairs remove Searching. The frozen run explicitly passes both Off and Escape feedback regressions. |
| Escape does not reliably intercept pending lookup | RESOLVED. `editor.ts:114-120` installs the highest-priority DOM handler before completion key bindings; it invalidates even when no result popup exists. Held-request cancellation is covered by the retained native tests. |
| Empty result lacks next action; known unavailable-provider error is raw | RESOLVED. `remote-completion.ts:117-118,136-138` supplies actionable guidance. All six empty/error frame pairs show the actual new copy next to Source. This does not claim every possible provider error has been visually exercised. |
| Off cannot be selected while blocked | RESOLVED. `InlineReferences.tsx:89-95` leaves an existing selection withdrawable while disabling provider options. Presentation code asserts enabled before Off and disabled after withdrawal; all six tracking-off-withdrawn ARIA records show Off selected with remote choices disabled. |
| No state/focus/tree/scroll evidence | Substantially resolved for this region by the 78-frame geometry/ARIA matrix. Human screen-reader output, physical keyboard/phone behavior, first-paint telemetry and every other application state remain unproved, not silently passed. |

## G-J item ledger

PASS below is bounded to the inspected changed region, source paths and
retained cases. Source-backed conclusions are identified; they are not
claims that every item was independently driven in a fresh browser session.
E filename abbreviations expand by the rule above.

| Item | Verdict | Evidence and boundary |
| --- | --- | --- |
| G1 | PASS | No decorative animation is introduced. Query, configuration, hover and pressed states have user/state causes; final pointer-hover/pressed frames show feedback. |
| G2 | PASS | The prior focus-driven reflow is removed (`InlineReferences.tsx:84-110`). Done/Close are explicit actions. Compact measured layout preserves the actual caret; long/next/dismissed frames retain source context. No animated transition fidelity is claimed. |
| G3 | N/A | No new timed animation or animation gate exists. Input/cancellation proceeds without awaiting a visual transition. |
| G4 | N/A | No new positional, scale, depth or blur animation. Presentation explicitly uses reduced-motion reduce; there is no new animation to substitute. This does not accept the inherited shared spinner policy. |
| G5 | PASS | Scoped code-backed immediate feedback: report Searching precedes the request await; Copying precedes flush/copy awaits. Hover/pressed states are visible in all six pairs; no spinner/bar is added. Exact input-to-photon/same-frame latency was not measured. |
| G6 | PASS | Scoped source-backed conclusion: this feature renders real controls with provider Off, not a splash or deferred mock. No focus-on-load geometry collapse remains. State-driven status/sheet changes are deliberate; whole-app CLS/first-paint instrumentation was not supplied. |
| G7 | PASS | No flashing, strobing or looping motion in the changed source; all final frames are readable. This is not a video audit of inherited shell motion. |
| H1 | PASS | All six loading/empty/error states are captured; empty says refine query or choose provider. Offline/recovery is source-backed by `InlineReferences.tsx:54-67`, which blocks requests and gives reconnect/recovery guidance; no final offline PNG is claimed. |
| H2 | PASS | Immediate specific text, not a stopped spinner. Final canceled PNG/ARIA pairs clear it; frozen Off and Escape tests cover terminal feedback. |
| H3 | PASS | Error is next to Source with next steps; success changes source key and retains separate copy disclosure (`remote-completion.ts:142-183`). Retained native acceptance/stale-copy/session tests pass. Success/stale receipt visuals are not part of the 13-state final matrix. |
| H4 | N/A | No new alert or destructive action; reference feedback uses status. The inherited draft-discard dialog is outside this acceptance. |
| H5 | FAIL | [product][defect] Desktop keyboard-selected state partly conceals the selected key/check under the sticky heading; see Must fix and eight cited full frames. Other inspected controls retain hover, pressed, focus and legible disabled styling; Off text and disclosure triangle are not color-only. |
| H6 | PASS | Compact sheet has one visible Close control; desktop has the same dismissal action (`remote-completion.ts:103-113`). It is not resizable. Dismissing suggestions/configuration does not discard source or a committed copy. Final dismissed frames and native no-copy assertions support this scope. |
| H7 | PASS | Pending lookup is abortable by Escape, Off, context/provider/target changes. A committed bibliography copy is not falsely advertised as cancellable; stale insertion is withheld and copy disclosed. Retained native cancellation/stale-copy evidence, not a fresh replay. |
| H8 | PASS | Starts Off; contextual disclosure says typed query only, not document text, and distinguishes Library/linked bibliographies. Final off-expanded/withdrawal ARIA and `InlineReferences.tsx:89-106`. No system permission prompt introduced. |
| H9 | N/A | No sign-in/password/onboarding UI added. Mendeley names its account grant requirement; account authentication acceptance is outside this region. |
| H10 | PASS | One active citation-argument search, selected provider visible in summary, actual candidate suggestions. `remoteCitationQuery` and final result frames/ARIA; no duplicate remote query field. |
| H11 | PASS | Provider and destination have separate labels; Off says local keys only; unavailable providers stay disabled. Existing saved autocomplete is respected rather than duplicated. No new OS preference or macOS settings window. |
| I1 | PASS | Bounded focus mechanism: provider keyboard-focus frames show a ring, global/source rules cover summary/buttons/selects, CodeMirror retains editor focus and uses selected wash/check. Done and Close restore focus only after user action. DOM reading order is configuration then Source. Selected-key legibility still fails H5; this is not an exhaustive human tab-order certification. |
| I2 | PASS | Highest-priority Escape handler invalidates and closes; Close offers equivalent action. Real Enter acceptance and Escape no-copy/abort are retained native results; collaborative undo bindings remain. Native Cmd-comma/menu parity is not certified. |
| I3 | PASS | All 78 scoped ARIA snapshots are present and read: named Source region/textbox, separately named provider/destination comboboxes, named Completions listbox, real options/selected state and named Close button. Status updates appear/disappear in the snapshots. No new meaningful image/icon-only control. Actual human announcements and low-level active-descendant behavior were not tested by this reviewer. |
| I4 | PASS | Select/summary/buttons and keyboard arrows/Enter/Escape provide control alternatives; no gesture-only interaction is introduced. Final Close/dismissal evidence and retained keyboard acceptance. |
| I5 | N/A | No media or autoplay introduced. |
| J1 | N/A | Browser region, not a native macOS window. No native menu/chrome/settings-pane acceptance. |
| J2 | PASS | Both 390 themes show an in-flow compact sheet, not a popover, with retained caret and explicit Close. No large collapsing title or specialized numeric/email/URL field is introduced; Source is TeX text. Physical mobile/IME/on-screen-keyboard behavior remains unproved. |

## Scroll ownership and functional integrity

The design contract names `.cm-scroller` as source owner, plus independent
completion/configuration and existing draft/tool/proposal regions. Final
geometry logs now identify the real source owner under overflow, not absent
placeholder selectors. Source content height is 1,806 px in the long case.
Across initial result, keyboard-next and manual results-end:

| Width | Source scrollTop | Result list scrollTop |
| --- | --- | --- |
| 390 | 1761 / 1761 / 1761 | 0 / 278 / 2044 |
| 1440 | 1161 / 1161 / 1161 | 6 / 107 / 717 |
| 1920 | 1161 / 1161 / 1161 | 6 / 107 / 717 |

Both themes have the same relevant geometry. Manual result scrolling reaches
the authors/year/provider of the final long item without moving Source.
The selected item need not remain onscreen during deliberate manual scrolling;
that is not the desktop defect, which occurs on automatic reveal.
Configuration is independently bounded and reopening resets its own scroll.
At 390 the inherited shell leaves only 38.5 px for the source scroller while
the result sheet is open; the active query/caret is nevertheless actually
visible in the supplied viewport. A physical software keyboard could reduce
that further and has not been accepted.

The implementation is real React/native controls plus CodeMirror
autocompletion, not a raster substitute. Shared surface/spacing/type/radius/
selection tokens and Button styling drive the region. Actual HTTP fixture
publications supply title, Japanese/English metadata, authors, year, provider
and parsed BibTeX key; screenshots and ARIA agree on first/second selection.
Acceptance copies through citationCreate before replacing only the active
query, and source/session/provider/target/authority fences remain present.
No fabricated D06 sample records were substituted. Unchanged backend
lifecycle acceptance remains the retained `p71-reference-lifecycle.md` result,
not a rerun or a live-provider availability claim.

## Good, keep it; limits

Keep explicit Done, default Off, withdrawable consent, friendly empty/error
guidance, request-owned cancellation feedback, durable-copy disclosure, the
compact in-flow sheet, Close, measured caret retention, independent manual
scrolling, actual metadata, and selected wash/check. The current tertiary
button-border rule is present at `source.css:48`; final resting/hover/pressed
frames show it. The supplied light ratios 6.20/5.43/4.92 and dark
8.25/6.56/5.57 are parent calculations, not new measurements by this pass.
No taste-only changes are requested.

I also opened `docs/evidence/design/06-editor-tools.png`. Its search sidebar,
wide editor, simpler header and bibliography card differ from the assembled
file/editor/Assistant shell. Those inherited whole-shell D06 differences are
not this correction's desktop key-clipping defect and are not accepted as an
exact reference match. This pass did not perform a new D06 pixel diff or
reconstruct historical before frames.

Unproved: human screen-reader announcements, physical iOS/Android and
software-keyboard/safe-area behavior, IME input, Safari/Firefox/native macOS,
200% zoom, whole-product motion/first-paint/CLS, live providers, successful
LaTeX compilation, every authority/provider error variant, and final
parent-owned root static/build results. The 13-state matrix does not include
offline, copy-in-progress, success or stale-receipt PNGs; those conclusions
above are explicitly source/retained-native-backed. Inherited shared-spinner
reduced-motion behavior and unrelated AI consent-guard failures are not
changed-region regressions or fixed by this review.

**Completion gate: NOT satisfied for the changed region because the current
desktop selected-key defect remains.** Round 2 is complete with one concrete
Must fix; no comprehensive product acceptance is asserted. Only this report
was written.
