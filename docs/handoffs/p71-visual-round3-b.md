# P71 visual QA B - round 3

October 29, 2026. Reviewer: `st_01a18684`.
**VERDICT: PASS for the corrected Source inline-reference region and the
supplied 13-state matrix.** Confidence: high for rendered layout and the two
round-2 corrections; bounded for platform accessibility. No current
changed-region product defect was found. This is not whole-product, exact
D06, human screen-reader, physical-device, live-provider or P72 acceptance.

Round 3 of 3. This independent B review inspected the existing evidence;
it did not launch another review, test, build, browser or service. Review
wall-clock duration was not instrumented; the retained presentation execution
took 71.75 seconds, which is not the review duration.

## Evidence admitted

Current evidence root **E**:

`docs/evidence/p71-inline-references/f325a788-b306-45fe-a420-2a356a962e35/`

I directly opened all **78 PNGs as full frames**, not contact sheets, plus
`docs/evidence/design/06-editor-tools.png`. One mounted Source surface has
these 13 states at each of 390, 1440 and 1920, in both light and dark:

`off-expanded`, `keyboard-focus`, `pointer-hover`, `pointer-pressed`,
`loading`, `canceled`, `empty`, `error`, `long-results`,
`keyboard-next-result`, `results-end`, `dismissed`,
`tracking-off-withdrawn`.

The exact naming rule is `E/<width>-<theme>-<state>.png`. All 78 matching
geometry JSONs and all 78 regional ARIA YAML snapshots were read. Frames
show page content, not browser chrome; there are no visible compositor
gaps. Image reads identify PNG. Geometry records 390x844/DPR 3/touch 1,
and 1440x900 or 1920x900/DPR 1/touch 0. Every recorded document width
equals its viewport width.

The 78 PNG timestamps span **07:13:55.423-07:14:20.191 UTC**. The latest
inspected P71 rendered-source timestamp is **07:10:04.592 UTC**
(`InlineReferences.tsx`). Current content hashes of DESIGN, InlineReferences,
SourcePanel, editor, preferences, reference-layout, remote-completion,
source.css, project-index and reference-receipt all match the round-3
before manifest. These captures therefore follow both corrections and the
earlier CSS-color revision.

Read the full visual-QA skill and the requested parent corrections,
historical producer, prior B FAIL, inline-verification and both round-2
reports. Read the current Source DESIGN, the executable files listed above,
shared typography/color tokens and the unchanged backend lifecycle handoff.
Historical FAIL reports remain historical; their superseded findings are
reconsidered below rather than silently carried forward.

Retained execution evidence, not commands run by this reviewer:

- `docs/evidence/p71-parent-privacy/round3-presentation.log`: completed
  exit 0, **1 pass, 0 fail, 167 assertions**, 71.75 seconds; names E.
  `round3-before.sha256` and `round3-after.sha256` are independently
  compared byte-identical, **1,708 records** each.
- `round2-native.log` in that directory: **21 pass, 0 fail, 276 assertions**,
  142.49 seconds. Its before/after manifests are independently compared
  byte-identical, **1,705 records** each. This prior full run is retained
  for unaffected behavior, not represented as a full rerun after the
  all-width layout and provider-label corrections.
- `E/cleanup.json`: owned root absent, browser closed, all three fixture
  listeners closed, `errors: []`.

The earlier parent `final-validation.log` predates these two corrections
and P72. It is not evidence of current global/P72 validation. Current
root static/build outcomes remain parent-owned. Backend passing evidence
in `p71-reference-lifecycle.md` is retained unchanged, not rerun.

## Round-2 findings resolved

### Desktop selected-key clipping: resolved in pixels and geometry

Opened all eight current full desktop initial/next frames:

`E/{1440,1920}-{light,dark}-{long-results,keyboard-next-result}.png`.

The complete bold key and selected checkmark now sit below the opaque
References heading. The corresponding JSONs, at lines 41-55, give:

| Width/themes | State | Heading bottom | Key top / bottom | Clearance |
| --- | --- | ---: | --- | ---: |
| 1440 and 1920, both | long-results | 746 | 747 / 762.59375 | 1px |
| 1440 and 1920, both | keyboard-next-result | 746 | 746.59375 / 762.1875 | 0.59375px |
| 390, both | long-results and keyboard-next-result | 512.796875 | 513.796875 / 537.796875 | 1px |

The prior 5px / 4.40625px desktop overlap is absent. This is an actual
visible correction, not a changed assertion accepting the old pixels.
`apps/web/src/features/editor/source/reference-layout.ts:22-23,32`
now calculates and applies heading-aware selected-row scrolling at every
width. Only caret revelation remains compact-specific at lines 24-25.
The plugin reacts to document, selection, geometry and selected-completion
changes at lines 45-47; it does not install a list-scroll reset handler.

Manual scrolling remains independently usable. Across initial, next and
manual-end states, both themes record:

| Width | Source scrollTop | Result-list scrollTop |
| --- | --- | --- |
| 390 | 1761 / 1761 / 1761 | 0 / 278 / 2044 |
| 1440 | 1161 / 1161 / 1161 | 0 / 102 / 717 |
| 1920 | 1161 / 1161 / 1161 | 0 / 102 / 717 |

All six `results-end.png` frames show the final record's authors and
`2026 · Crossref`, rather than snapping back to the selected second row.
The selected key is deliberately out of view after this manual scroll.
That is not recurrence of automatic-selection clipping. At desktop end,
the sticky heading can mask the upper part of the manually scrolled final
row's key; the user can scroll back to read it. Initial and keyboard
selection, where automatic visibility is required, are now unobscured.
The Source caret remains at y843-860 within y226.5-871 on desktop;
compact retains y430-447 within y413.5-452.

### Candidate provider enum: resolved in current source

`remote-completion.ts:12-13` exports the shared provider/display-label
table. Candidate metadata at line 130 now resolves its human-readable
label. `InlineReferences.tsx:8,84,90` imports and uses the same table for
summary and options. A supported Semantic Scholar candidate therefore
uses `Semantic Scholar`, not `semanticScholar`; request values remain
service identifiers.

The current successful fixture captures/ARIA visibly say **Crossref**.
The error-state summary visibly says **Semantic Scholar**. A successful
Semantic Scholar response is not in the supplied fixture matrix: that
specific label conclusion is source-backed, not a fabricated screenshot
or live-provider claim.

## Earlier corrections preserved

Explicit Done remains the only configuration-close action here
(`InlineReferences.tsx:104-107`); focusing Source does not collapse it.
Opening resets configuration's own scroll position at lines 81-82.
Compact long/next frames retain an in-flow sheet below Source, visible
Close, keyboard hints and the active query; there is no competing raw
BibTeX popup. Deliberately expanded compact configuration is a bounded
configuration mode, not evidence of a usable typing viewport while open.
Its scrolled hover/pressed frames expose the destination and Done.

The named Source `.cm-scroller`, configuration stack and completion list
are now actual bounded regional probes. DESIGN's `Layout:` contract
names these owners rather than using the old unidentified sibling probe.
Long titles wrap, actual key/title/authors/year/provider remain distinct,
and selection has a check plus wash. Compact reference body is 24px,
secondary/key/hint text is 20px; select geometry is 52px compact and 44px
desktop. These sizes are independent of compact code text.

Empty/error frames give a concrete next step; canceled frames remove
Searching. Off remains withdrawable while a provider is selected under a
block (`InlineReferences.tsx:87-90`), then is visibly disabled only after
withdrawal. Frozen native evidence supports Escape/Off cancellation,
copying and session receipt boundaries; screenshots alone do not prove
those network/persistence operations.

## Assigned A-F ledger

PASS below means the changed region in the inspected cases, not every
inherited shell element. Unproved identifies an acceptance limitation,
not an observed product bug. N/A identifies an item outside this region
or absent from the component.

| Item | Verdict | Named evidence / boundary |
| --- | --- | --- |
| A1 | PASS | All long-results: anchored desktop list and compact in-flow sheet preserve citation context. |
| A2 | PASS | All 78: regional backgrounds reach panel bounds without stray margins. |
| A3 | PASS | All off-expanded: symmetric field edges; source.css constrains disclosure to 65ch. Compact wraps to available width. |
| A4 | Unproved | 390 emulation is not physical notch/home-indicator/software-keyboard acceptance. |
| A5 | PASS, emulated | 390 long-results/results-end/configuration frames show no reserved page gutter. Physical overlay-scrollbar behavior remains unproved. |
| A6 | PASS | All long/next/end JSONs identify independent Source/configuration/result scrollers; manual end does not move Source. |
| A7 | PASS | All configuration states align fields and button on shared token spacing. |
| A8 | PASS | Provider/disclosure/destination/Done and header/hints/Close/rows remain visibly grouped. |
| A9 | PASS, captured cases | All 78 geometry records have no document-width overflow. Eight desktop initial/next full frames correct the prior overlap; compact long titles wrap. |
| A10 | PASS | Compact partial content and bounded configuration signal continuation; results-end proves list traversal. Desktop scrolling affordance is less prominent, but usable in retained evidence. |
| A11 | N/A | Native macOS window sizing/chrome are not this browser-region review. |
| A12 | PASS | DESIGN.md:12-32 names Source and auxiliary owners; current regional JSON probes identify their bounds/overflow/scrollTop. |
| B1 | PASS, regional | Brief names Enter acceptance; selected row and Enter hints identify it. Existing Recompile keeps the shell's primary accent styling. |
| B2 | N/A | No destructive reference action introduced. |
| B3 | PASS | References heading, labeled configuration and main.tex/Source context name the region. |
| B4 | PASS | Query context precedes key/title/authors/year/provider; configuration is deliberately dismissible. |
| B5 | PASS | Existing action/selection palette; no decorative reference accent. |
| B6 | PASS | Both themes retain sans publication hierarchy and bold mono key; current desktop key/check is fully readable. |
| B7 | PASS, bounded | DESIGN brief and required controls are implemented. Destination lives in deliberate configuration; receipt visuals are outside this 13-state set, not silently certified. |
| C1 | PASS, regional | Compact 24px body/20px secondary; desktop 14px prose. Mono citation keys remain 13px code identifiers, not prose. |
| C2 | PASS | Shared provider labels at remote-completion.ts:12-13,130 and InlineReferences.tsx:84,90; friendly current empty/error frames. Useful citation keys/paths are intentional identifiers. |
| C3 | PASS | Done configuring references, Close, labeled nouns and outcome guidance; no generic OK. |
| C4 | PASS, captured cases | All desktop initial/next keys/checks clear heading; long compact titles wrap. 200% zoom/large OS text remain unproved. |
| C5 | PASS, supplied Japanese | All long/next/end families show the fixture's Japanese phrase without tofu or an observed unnatural split. Korean/Chinese and long parenthetical citation stress remain unproved. |
| C6 | PASS | All empty/error/canceled frames: refine query, choose provider or ask administrator; no permanent Searching after cancellation. |
| C7 | PASS | off-expanded/focus ARIA and pixels show separate visible provider/destination labels; named Source textbox. |
| C8 | Unproved | Ordinary status/source text and exposed ARIA do not establish actual pointer selection of popup metadata or native-select paths. |
| D1 | PASS, compact/pointer scope | Compact selects are 52px; Done/Close have 44px minimums; result row is continuous. Desktop Done retains ordinary pointer sizing, not touch-desktop acceptance. |
| D2 | N/A | Inherited shell tab-bar anatomy is not changed or accepted by P71. |
| D3 | N/A | Inherited assembled toolbar groups are outside the changed reference region. |
| D4 | N/A | No adjacent bar-button group introduced; Close is standalone. |
| E1 | PASS | All light/dark state pairs: coherent opaque surfaces, legible controls/glyphs, no glowing light asset. |
| E2 | PASS, scoped | Local selects use muted edges; scoped Done/Close borders use tertiary. Rest/hover/pressed frames show the corrected variants; ratios below. No whole-shell/syntax/native-option audit claimed. |
| E3 | PASS | Written Off/provider/status, selected check plus wash and visible focus outline; not color alone. |
| E4 | PASS | No conflicting reference-status color meanings in current cases. |
| E5 | N/A | Reference surfaces are opaque, not translucent. |
| E6 | PASS, source-backed | Existing system-color tokens and theme preference preserved; no physical OS-toggle run performed. |
| F1 | PASS | Native disclosure/select controls and a selection check; no emoji or competing decorative icon family. |
| F2 | PASS | Shared spacing/type/radius/shadow tokens and real DOM primitives, not a screenshot substitute. |
| F3 | PASS, scoped | Local reference/completion selectors contain the style changes; no shared global palette replacement requiring unrelated sibling certification. |
| F4 | PASS | Quire branding remains; no new content-space reference branding. |
| F5 | PASS | All initial/next frames show selected wash plus unobscured check; keyboard-focus shows outline; no accent side-border. |
| F6 | PASS | Plain Close and native disclosure/select indicators; existing shell glyph placement retained. |
| F7 | PASS | One real completion surface, compact sheet/desktop anchored list, no competing BibTeX popup. |

The parent-calculated scoped button-edge ratios retained in corrections are
light **6.20/5.43/4.92**, dark **8.25/6.56/5.57** for rest/hover/pressed.
Current source.css:48 uses tertiary locally; corresponding current frames
show the variants. These are attributed calculations, not fresh contrast
measurements by this reviewer.

## Reference, platform and completion boundaries

D06 was opened directly. Its search rail, Back to editor header, wider
source canvas and illustrative publications do not match the inherited
assembled Files/Source/Assistant shell pixel-for-pixel. Those are not new
P71 defects. The current rows recover key-first metadata, grouped heading
and keyboard guidance using actual fixture records rather than fabricated
D06 content. No same-shell/state pixel-diff or new before/after composition
was generated, and no similarity score is invented.

Unproved: human screen-reader announcements and low-level focus experience;
physical iOS/Android, Safari/Firefox/native macOS, safe areas, software
keyboard and IME; 200% zoom/large text; OS-native option menus; actual
pointer selection of useful metadata/path text; all provider/error variants;
live vendor metadata and successful LaTeX compilation. The final 13-state
matrix does not include copy-in-progress, success/stale-copy receipts or
offline/recovery screenshots. Their existing source/native evidence is
retained without turning it into visual acceptance. Whole-product motion,
first paint, root checks and unrelated P72 backend/Assistant UI are outside
this verdict.

**Must fix: none found in the assigned changed region.**
Recorded taste findings: none requiring action. Preserve explicit Done,
withdrawable Off, friendly feedback, actual metadata, compact in-flow
layout, scoped contrast, selected check, all-width selected-key reveal and
independent manual scrolling.

This B round's scoped completion gate is satisfied by the current evidence
and resolved concrete round-2 defects. It does not replace pass A, the
parent's integration verdict or unavailable human/device acceptance.
Only this report was written. No source/test edits, tests/builds, service
actions, live requests, port 5173 takeover, commits or changes to `1` were
made.
