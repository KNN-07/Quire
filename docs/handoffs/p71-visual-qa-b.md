# P71 independent visual QA B

October 29, 2026. Round 1. **Verdict: FAIL for full A-F acceptance.**
The corrected populated inline-completion state is substantially improved and
usable at both supplied widths. This is not a comprehensive whole-product PASS,
an exact D06 match, or independent integrated-test acceptance.

## Evidence and boundaries

I directly opened and viewed all nine images:

- Current root `docs/evidence/p71-inline-references/01de63e9-bbad-474c-a443-de152e37c448`:
  `completion-1440-light.png`, `completion-1440-dark.png`,
  `completion-390-light.png`, `completion-390-dark.png`.
- Before root `docs/evidence/p71-inline-references/eef5067e-3755-4ee0-b6b7-6e72daa38de7`:
  the same four filenames.
- Original `docs/evidence/design/06-editor-tools.png` (D06).

Below, Current/Before plus width/theme denotes those exact files. I read
`docs/handoffs/p71-inline-references.md`, `docs/evidence/p71-parent-privacy/captures.json`,
`final-native.log`, `final-source.sha256`, Source `DESIGN.md`, the changed reference
source/CSS, typography tokens, and the four current geometry JSON files. I consumed
all seven native directories' cleanup receipts and the available acceptance,
boundaries, unavailable, cancellation, stale-copy and gates JSON.

The retained suite is **18 pass, 0 fail, 107 assertions, exit 0**, not a run made
by this reviewer. Seven cleanups report absent owned roots, closed browsers,
three closed listeners each, and no recorded page errors. The source hash list is
a post-run snapshot, not a before-run identity guarantee. No tests, services,
product changes, or commits were made for this review.

PASS below means supported for the changed region and supplied populated state,
unless explicitly broader. FAIL can mean an observed product defect or a missing
acceptance proof; each is labeled. N/A means the item does not apply, not that
missing evidence is being excused.

## Supplemental before/after difference evidence

I read `docs/evidence/p71-parent-privacy/image-diffs.json`, including all hotspot
coordinates, and directly reopened all eight before/after PNGs to inspect their
causes. The four supplied receipts report matching dimensions and intact alpha:

| Pair | Changed pixels | Difference ratio |
| --- | --- | --- |
| 1440 light | 116,961 / 1,296,000 | 9.02% |
| 1440 dark | 117,822 / 1,296,000 | 9.09% |
| 390 light | 82,913 / 351,000 | 23.62% |
| 390 dark | 83,475 / 351,000 | 23.78% |

Desktop's strongest tiles, x=360-900 at y=225-337 and y=450-562
(roughly 56-69% changed per tile), intersect the removed expanded provider
controls and the old/new guidance, source and completion positions. The
y=562-675, x=720-1260 tiles intersect the former raw-BibTeX tooltip, including
its former intrusion into Assistant. Direct comparison shows this content
removed, not recolored or hidden behind a second overlay. Assistant itself
otherwise retains its layout. The smaller x=540-720,y=0-112 hotspot corresponds
to the Source mode's selected/focus appearance; it is not displaced branding
or a new toolbar collision.

Compact's strongest entire-width band at y=450-562 (about 71-82% changed per
tile) is the old provider/disclosure prose replaced by the now-visible
editor/query and candidate. Bands y=562-787 cover the removed disclosure,
destination and BibTeX popup and the recovered source space; the result formerly
sat near y=759 and now sits near y=503. The y=787-900 hotspots include removal
of that low result's intrusion into navigation/status space, not a new bottom
overlay. The smaller y=337-450 band includes the disclosure's collapse and an
approximately 10px shift in the tracking/disclosure boundary. Direct inspection
finds no resulting clipped control there. Both themes exhibit the same causes.

These are **[evidence] observations**, not new product defects or taste scores.
The supplied 91/100 desktop and 76/100 compact similarity values measure changed
pixels, not correctness; the larger compact change is consistent with the
observed usability correction. They neither prove exact D06 fidelity nor close
the missing-state/device/scroll-owner findings below. No reviewed source changed
for this supplement, and no checklist verdict is upgraded on similarity alone.

## Blocking findings and concrete remedies

1. **[evidence] [defect] A12: scroll-owner acceptance is not established.**
   `DESIGN.md:12-19` names `.cm-scroller` as owner and names permitted auxiliary
   source scrollers. Current 1440 geometry logs only `qa-assistant__body`, an
   unexplained sibling relative to that regional contract; Current 390 logs only
   an empty class string. None logs the declared main owner. A short document
   can legitimately have no overflowing code, so this does not establish a
   broken Source scroller. It does establish a failing required probe.
   Fix the probe to identify bounded scroll containers even when not overflowing,
   report selectors and bounds rather than bare class strings, scope the owner
   assertion to Source, and name the Assistant region if whole-screen scrollers
   are included. Exercise a long document and result list. High confidence.

2. **[product] [defect] C1: mobile reference copy is below the checklist minimum.**
   `source.css:44` sets mobile Source text to `--q-text-brand`, which is 15px
   (`styles/tokens.css:29`). Current 390 guidance and metadata visibly use this
   compact sizing; the requested minimum is 17 pt-equivalent body / 15 pt
   secondary, not 15 CSS pixels. Desktop popup title also inherits the editor's
   compact code typography rather than a clear publication-text hierarchy.
   Raise mobile reference UI sizes to the requested equivalent, independently
   of user-selected code size, then recheck layout and zoom. High confidence.

3. **[product] [defect] E2: changed selects inherit low-contrast control edges.**
   `source.css:22` uses `--q-control-border` on `--q-surface`. Calculated from
   the actual token values: light `#D5D8DF` on white is **1.43:1**; dark
   `#596273` on `#1B1E25` is **2.72:1**, below the requested 3:1 edges.
   This is an inherited token problem now used by the changed controls, not a
   new palette. Use a compliant edge token for these controls or correct the
   shared token with sibling verification. Body secondary text is strong
   (8.08:1 light, 10.03:1 dark on surface); do not darken/lighten it blindly.
   Disabled states, focus variants and every syntax color remain unmeasured.
   High confidence on the two edge pairs.

4. **[product] [defect] C6: service errors lack a reader-level recovery action.**
   `remote-completion.ts:99-103` displays `failure.message` verbatim.
   `4a0fc67e-fbd3-4716-931e-5ac4f6e3e1d5/unavailable.json` records
   "Missing: operator semanticScholar base URL configuration".
   This truthfully reports failure but exposes implementation wording and gives
   the author no next step; "No remote references found" also offers no query or
   provider adjustment. Map known service failures to readable inline guidance
   such as choosing another provider or contacting the workspace operator,
   retaining technical detail separately if needed. Capture the resulting error
   at both widths. This is a changed presentation defect, not a request to
   fabricate results. High confidence from source/receipt; error pixels absent.

5. **[evidence] [defect] State and device coverage is incomplete.**
   Current screenshots show only one selected populated candidate. There are no
   final expanded-settings, off/loading/empty/error/receipt, many-results,
   long-title/path, CJK, 200% zoom, 1920-width, touch-keyboard or physical-device
   captures. Source and native receipts support behavior, not the missing visual
   states. In particular, the expanded disclosure is non-shrinking
   (`source.css:38`) and the receipt is above the editor, so their combined
   compact-height behavior still needs evidence after correcting text size.
   Add targeted captures/probes for the affected checklist items; do not turn
   every missing case into an invented product bug. High confidence.

## Direct comparison and preserved good aspects

At 390, Before has expanded settings consuming nearly all working height:
the BibTeX tooltip covers the destination/guidance, the result overlaps the lower
navigation/status region, and source context is effectively lost. Current
collapses settings while typing, removes the competing raw-BibTeX popup, retains
an approximately 274px-high source viewport (y=476-750), and shows the entire
candidate title and metadata without horizontal clipping. The completion's
ordinary occlusion of following code lines is expected popup behavior, not a
remaining control collision. At 1440, the editor begins around y=264 instead of
y=476; the result stays within Source rather than extending into Assistant.
The fix preserves both themes, source gutter, shell controls and Recompile.

The actual fixture record is correctly visible: **Research dest0; Grace Hopper;
Ada Lovelace; 2026; crossref; crossref_6946c927154ce523**. It matches the acceptance
receipt's returned publication. These are controlled fixture values, not proof
of a live publication. Do not replace them with D06's illustrative World Models
or Planning from Pixels entries to make the screenshot look closer.

D06 is nevertheless **not matched exactly**. Its 1440 screen has a 56px header
with Back to editor, a 352px-wide leading rail/search composition, no Assistant
column, and a wide source canvas. Current has a 287px leading file composition,
Source starting at x=287, Assistant starting at x=1120, shell modes, Recompile,
tracking/disclosure/status bands, and a wrapped 222px mobile header.
These are inherited shell/full-product differences, not P71-created defects
to repair by replacing the application shell.

D06's popup is a rounded, shadowed card near x=601,y=270, about 442px wide,
with a bibliography/query header, individually grouped candidates, small
metadata, a remote-search row and footer keyboard guidance. Current is the
native CodeMirror list near the caret (desktop about x=363,y=291), with a
monospaced title and one italic sans metadata line, no card header/footer, and
guidance in the band above Source. Title-first remains understandable, but the
key/year/provider/authors are visually flattened into one italic run. This
hierarchy/card treatment difference is **[product] [taste]**, not a blocker by
itself: real CodeMirror behavior and authorized remote acceptance take priority
over reproducing fictitious reference content. If closer D06 fidelity is
required, retain actual records and improve row hierarchy/grouping inside the
existing list; do not revive the removed secondary popup.

## Per-item checklist

### A. Layout and alignment

| Item | Verdict | Evidence / finding |
| --- | --- | --- |
| A1 | PASS | Current four: query and candidate anchored to Source/caret, not an unrelated empty canvas corner. |
| A2 | PASS | Current four: backgrounds and editor boundaries reach shell edges; no stray outer inset. |
| A3 | FAIL | [product] [defect] Expanded disclosure prose has no measure limit (`source.css:12,38-40`); Before 1440 shows a roughly 110-character first line. Same current paragraph/CSS persists. Constrain prose independently of full-width selects; mobile final expanded-state proof is absent. |
| A4 | FAIL | [evidence] [defect] Desktop-resized Chromium has no notch/status/home-indicator proof. `workspace.css:134` only establishes a bottom tab safe-area rule, not physical-device acceptance. |
| A5 | FAIL | [evidence] [defect] No reserved page gutter is visible, but short desktop-emulated mobile content does not prove overlay scrollbars during overflow. |
| A6 | FAIL | [evidence] [defect] Current has no visible nested-scroll collision, but unidentified/sibling scrollers prevent owner verification; see finding 1. |
| A7 | PASS | `source.css:12,22,38-43` uses shared spacing; Current disclosure, guidance, editor and toolbar share edges. |
| A8 | PASS | Current collapsed settings separate configuration from query/results; Before demonstrates labeled control grouping. Expanded final layout remains an evidence residual. |
| A9 | FAIL | [evidence] [defect] Supplied 390/1440 populated content does not clip/overlap; geometry gives width=scrollWidth=390/1440. 1920, empty, long labels and unbroken strings are not captured. `overflow-wrap:anywhere` is intent, not complete proof. |
| A10 | FAIL | [evidence] [defect] Disclosure chevron provides its cue, but there is only one result and a short document; continued-result/source overflow cues are unproven. |
| A11 | N/A | Browser view, not a native macOS window review. Inherited responsive sidebar hides at 390; no macOS minimum-window certification. |
| A12 | FAIL | [evidence] [defect] Layout line exists and pattern is recognizable, but logged ownership does not meet the required contract; finding 1. No horizontal document overflow is recorded. |

### B. Hierarchy

| Item | Verdict | Evidence / finding |
| --- | --- | --- |
| B1 | PASS | Regional interpretation: selected candidate wash plus explicit Enter guidance identifies acceptance; shell Recompile remains the single accent-filled action, as explicitly required by the brief. No competing new accent button. This does not claim a separate accent-filled Accept button exists. |
| B2 | PASS | Changed region has no destructive action; Enter accepts rather than cancels/deletes. Retained keyboard log confirms acceptance. |
| B3 | PASS | `main.tex`, Source mode and "Inline remote references" identify the surface; not app-name-only. Expanded section label is longer than a short toolbar title but is not a toolbar title. |
| B4 | PASS | Current query precedes actual title then metadata; configuration is collapsed out of the typing path. D06 metadata grouping difference is taste, documented above. |
| B5 | PASS | Blue selection/primary and inherited purple Assistant accent remain restrained; no new decorative reference accent. |
| B6 | PASS | Current light/dark retain sans UI and mono code/title, distinguish guidance by color, metadata by sans/italic. Legibility size fails C1 separately. |
| B7 | FAIL | [evidence] [defect] `DESIGN.md:27-43` supplies brief/omissions; Current shows query and actual metadata, but selected destination is hidden during completion and receipts are uncaptured. Cannot prove all three priorities on the first viewport. Preserve collapse; expose a compact destination indication or agree/document its disclosure exception, then capture receipts. |

### C. Text and copy

| Item | Verdict | Evidence / finding |
| --- | --- | --- |
| C1 | FAIL | [product] [defect] Mobile reference copy is 15 CSS px, below required pt-equivalent sizes; finding 2. Desktop non-code popup sizing is not independently measured. |
| C2 | FAIL | [product] [defect] Provider enum is emitted directly (`remote-completion.ts:86`, `InlineReferences.tsx:87`); `semanticScholar` can appear as machine casing. Actual citation keys are useful required identifiers, not a defect. Humanize provider display names and error wording; finding 4. |
| C3 | PASS | Provider/destination labels are nouns; acceptance/copy guidance uses outcome verbs. Native source actions use coherent sentence-style labels. |
| C4 | FAIL | [evidence] [defect] Current 390 wraps actual metadata without clipped glyphs, but no long-title/large-text/200%-zoom proof. C1 correction must be rechecked here. |
| C5 | FAIL | [evidence] [defect] No CJK examples supplied. Arbitrary wrapping can split long citation keys (`source.css:42`); current key fits one line at 390, so no observed broken key is claimed. |
| C6 | FAIL | [product] [defect] Truthful but operator-oriented service failure / no next-step empty copy; finding 4. Authority and occupied-path guidance is more actionable. |
| C7 | PASS | `InlineReferences.tsx:89-104` provides visible provider/destination labels and accessible select names, not placeholder-only labeling. Source has filename context and an aria-label. |
| C8 | FAIL | [evidence] [defect] Status is ordinary paragraph text and code is selectable; actual pointer selection of popup keys, paths and errors was not captured/probed. Do not infer selectable metadata from appearance. |

### D. Touch and pointer targets

| Item | Verdict | Evidence / finding |
| --- | --- | --- |
| D1 | FAIL | [product] [defect] Expanded provider/destination selects in Before 390 are about 40px high; unchanged CSS sets `--q-field-height:40px` (`source.css:22`, tokens). Summary/result rows specify 44px. Raise select targets to 44px on mobile and capture final expanded state; list spacing with many candidates remains unproven. |
| D2 | FAIL | [product] [defect] Inherited Current 390 tab bar has four visible one-word text labels and correct Source state, but no icons above labels and about 46px total height, not the specified icon/label pattern. This is shell/full-product debt, not introduced by P71. |
| D3 | FAIL | [product] [defect] Inherited mobile header spans several rows with modes, branch, Assistant, Share and Workspace; Recompile is leading, not trailing. No new reference toolbar groups were added; shell redesign is out of scope. |
| D4 | FAIL | [evidence] [defect] Native bar buttons look separated and padded, but no hit-region probe establishes continuous adjacent hit areas. |

### E. Contrast, colour and themes

| Item | Verdict | Evidence / finding |
| --- | --- | --- |
| E1 | PASS | Current paired light/dark at both widths have legible icons and coherent surfaces; no glowing light-only reference asset. |
| E2 | FAIL | [product] [defect] Both select-edge token pairs miss 3:1; finding 3. Other states are not comprehensively measured. |
| E3 | PASS | Written provider/off, copy/search/status sentences and list selection shape do not rely solely on status color. Field focus has an outline (`source.css:27`); no new color-only warning. |
| E4 | PASS | No conflicting status meanings in supplied state; blue is consistently action/selection, separate from inherited Assistant purple. Error-state palette remains uncaptured. |
| E5 | N/A | Changed popup/disclosure surfaces are opaque; no new translucent scrolling overlay. |
| E6 | PASS | Tokens implement system dark when no explicit override; Source Settings `Settings.tsx:49` offers System/Light/Dark. This is source-backed, not an observed OS-toggle run. |

### F. Consistency and brand

| Item | Verdict | Evidence / finding |
| --- | --- | --- |
| F1 | PASS | Current shell retains consistent line glyphs; no new emoji or decorative reference icon set. |
| F2 | PASS | Changed CSS reuses spacing/radius tokens and native controls; no bespoke nested-corner geometry added. D06 card silhouette difference is taste. |
| F3 | FAIL | [evidence] [defect] Source reuses shared controls, but every sibling route/app has not been visually checked. Any token contrast fix requires sibling verification. |
| F4 | PASS | Current retains leading Quire logo/wordmark and shell identity; no added content branding. No stage badge is visible in D06 or the supplied current shell. |
| F5 | FAIL | [product] [defect] Completion selection is wash/ARIA-selected without a visible selected glyph (Current popup; `preferences.ts:38`). Inherited mobile Source tab is also wash-only. Field rings are present; no accent side border. Add a non-text-corrupting selection glyph if strict checklist compliance is required. |
| F6 | PASS | Existing source/file/branch/search/Assistant shell glyph positions remain intact; new controls use native disclosure/select indicators. |
| F7 | PASS | Current has one completion popup, no competing BibTeX popup, and it is anchored to the caret. A native listbox need not fabricate a sheet arrow. D06's more rounded/shadowed card remains a documented fidelity difference, not silent equivalence. |

## Required-content trace and residual confidence

Provider is initially off (`InlineReferences.tsx:18`); explicit options include
Crossref/arXiv/Semantic Scholar/Mendeley and disabled ReadCube/Dimensions.
The expanded disclosure contains external-query-only disclosure, provider
semantics caveat and separation from Account Library/linked bibliographies.
Destination handles zero/one/multiple editable bibliographies; receipts show
`references.bib`, `target0.bib`, and explicitly selected `target1.bib`. Current
captures show actual title/authors/year/provider/key and Enter/arrows/Escape
guidance. Errors and durable-copy receipts are source/log-backed, not visually
accepted: `remote-completion.ts:111-142` separates copy from insertion, retains
successful-copy failure notices, and the session keyboard log reports one
retained receipt hidden after session renewal.

Confidence is high for the nine-image comparison, removed overlap, actual fixture
metadata, geometry limitations, token calculations and source-backed copy.
Confidence is moderate for configuration/error/receipt appearance because only
Before shows the expanded configuration and there are no final screenshots for
the other states. Touch, device safe areas, CJK, zoom, long content, sibling
routes and complete accessibility/contrast remain explicitly unaccepted.

Preserve the successful collapse-on-focus, one-popup design, true metadata,
privacy opt-in, honest copy receipt, actual CodeMirror keyboard handling, full
width backgrounds and restrained Quire palette. Address changed-region defects
and evidence gaps without silently converting this into an inherited-shell
redesign or a whole-product certification.
