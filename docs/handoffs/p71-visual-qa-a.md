# P71 independent visual QA A: G-J

October 29, 2026. Round 1. Independent read-only product review; only this report
was written. **Verdict: FAIL for comprehensive G-J acceptance.** The populated
desktop result is usable and the compact correction is substantial, but J2
still fails in the changed region, feedback has a cancellation lifecycle defect,
and the available evidence cannot establish every-state or accessibility
acceptance. This is not a rejection of the retained passing functional suite.

## Evidence and limits

I directly opened and visually inspected all nine requested images:

- Current root: `docs/evidence/p71-inline-references/01de63e9-bbad-474c-a443-de152e37c448/`.
  `completion-1440-light.png`, `completion-1440-dark.png`,
  `completion-390-light.png`, `completion-390-dark.png`.
- Before-correction root:
  `docs/evidence/p71-inline-references/eef5067e-3755-4ee0-b6b7-6e72daa38de7/`.
  The same four filenames.
- Original reference: `docs/evidence/design/06-editor-tools.png` (D06).

The four current capture JSONs report viewport width equal to document
scrollWidth (1440 or 390). I read the FINAL producer handoff, source DESIGN,
`docs/evidence/p71-parent-privacy/captures.json`, `final-native.log`, and
`final-source.sha256`. I compared current files with the latter using
`sha256sum -c`: all 19 entries OK, explicit exit 0. This is a current match to a
post-run snapshot, not proof of a pre-run freeze.

### Supplemental before/after image differences

I inspected `docs/evidence/p71-parent-privacy/image-diffs.json`, including the
leading hotspot coordinates for all four comparisons, and reopened all eight
before/current PNGs to identify their causes directly. The retained comparison
reports matching dimensions and intact alpha for all four pairs:

| Capture | Differing pixels | Difference ratio |
| --- | --- | --- |
| 1440 light | 116,961 / 1,296,000 | 9.02% |
| 1440 dark | 117,822 / 1,296,000 | 9.09% |
| 390 light | 82,913 / 351,000 | 23.62% |
| 390 dark | 83,475 / 351,000 | 23.78% |

Desktop's leading 180x112 hotspot tiles at x360/540/720, y225 and y450
correspond to the removed expanded settings content and the old/new positions
of Source, its guidance and completion row. The old raw-BibTeX tooltip at
approximately x849-1136, y505-660 is absent in the current images. Compact's
strongest tiles span x0-389, y450-562: the old provider/disclosure content is
replaced there by the restored source area and candidate. The old compact
BibTeX tooltip at approximately x49-364, y595-759 is also absent, and source
space plus bottom panel navigation is visible again. These are geometric and
content changes, not merely color differences; the similar light/dark ratios
are consistent with those same causes in both themes. Small selected/focus
appearance differences also exist, notably the desktop Source mode control.

This comparison is before-correction versus current, not current versus D06.
The reported similarity scores (91 desktop, 76 compact) are not correctness or
acceptance scores. Lower compact similarity reflects a substantial, useful
layout correction; it neither invalidates that correction nor resolves J2,
the cancellation-feedback defect, focus-driven geometry concerns or missing
state/accessibility evidence. No reviewed source changed for this supplement;
the per-item verdicts and explicit D06/full-shell limits remain unchanged.

I read native JSON from each of the manifest's seven directories: boundaries,
unavailable provider, acceptance, cancellation, stale copy, gates, and the
keyboard/session record in the retained log. I read every corresponding
`cleanup.json`: seven distinct temporary roots absent, browser closed, three
owned listeners closed per fixture, errors empty. The retained final suite is
**18 pass, 0 fail, 107 assertions**, exit 0. I did not rerun tests, start services,
or independently execute browser interactions. These are retained native
results, not a fresh run by this reviewer.

Only populated-result screenshots exist in the authorized set. There is no
complete visual matrix for initial/off, loading, empty, error, offline, disabled,
focus, copy-in-progress, success or stale-copy receipts; no interaction video,
first-paint/layout-shift recording, accessibility-tree dump, screen-reader
session, on-screen keyboard capture, physical phone proof or native macOS proof.
In the table below, FAIL [evidence][defect] means an acceptance evidence gap, not
an invented product bug. PASS is limited to the changed inline-reference surface
and the cited evidence; it never approves the entire editor or platform.

## Blocking findings and concrete fixes

1. **P2 [product][defect], changed region: compact results remain a popover
   instead of a sheet (J2).** Both current 390 captures show a floating
   CodeMirror candidate at approximately x20-389, y503-560, covering source
   lines beneath the active query. The removed raw-BibTeX popup is genuinely
   gone, but the remaining completion is still a popover. `source.css:41-44`
   only limits width/wraps rows; `preferences.ts:24` installs the same
   autocompletion at compact width. Fix: use a compact sheet presentation for
   the same candidates, with an explicit dismiss control and preserved source
   query/context; preserve Enter/arrows/Escape and pointer acceptance. Verify
   with long/multiple records and an on-screen keyboard. Confidence: high for
   the current viewport result; physical-device behavior remains unproven.

2. **P2 [product][defect], changed region: cancellation can leave a permanent
   "Searching remote references..." notice (H2, H3).**
   `remote-completion.ts:69` publishes searching, while invalidation at line 44
   only aborts and increments generation. Both the stale-result return at
   line 74 and abort catch at line 91 return without clearing or replacing the
   status. `InlineReferences.tsx:29,107` continues rendering that transient
   notice. Changing a pending provider to Off, or leaving a pending query
   without starting another eligible search, therefore has no terminal
   feedback path. The native cancellation scenario proves discarded results
   and no copy, but does not assert cleared loading feedback. Fix: represent
   request-owned loading explicitly and clear it on cancel/invalidation without
   erasing a durable copy receipt or a newer request's status. Retain a bounded,
   event-driven cancellation assertion. Confidence: high from source tracing;
   no screenshot reproducer was run in this read-only review.

3. **P2 [product][defect], changed region: focusing Source abruptly changes its
   geometry (G2).** `InlineReferences.tsx:78-83` synchronously closes an open
   disclosure on contentDOM focus. The before/current screenshots demonstrate
   the large height difference: desktop source starts around y477 before
   versus y265 after; compact source was nearly squeezed out before and now
   starts around y477. The correction restores usable height, but clicking or
   tabbing into Source still collapses a surface without an identity-preserving
   transition and can move the clicked source under the pointer. Fix: make
   dismissal explicit, or remove settings from source-flow geometry while
   preserving context. If animated, honor reduced motion and never delay input.
   Verify pointer-to-caret position during dismissal. Confidence: high for the
   synchronous geometry change; exact caret impact needs interaction evidence.

4. **P3 [product][defect], changed region: empty results provide no next action
   (H1).** `remote-completion.ts:75-76` reports only "No remote references
   found." Fix: offer a concise next step such as refining the citation query
   or changing the selected provider; do not fabricate results. Confidence:
   high from source; empty-state rendering is uncaptured.

5. **P2 [evidence][defect], acceptance gate: the state/interaction matrix is
   incomplete (G5-G6, H5, I1, I3).** Four populated screenshots cannot prove
   first-frame acknowledgement, initial layout stability, all control states,
   focus order, or the live accessibility tree. Fix: retain state captures in
   both themes/widths, keyboard-only focus/Escape/Enter evidence, a live
   accessibility-tree/screen-reader check, and first-paint/interaction
   recordings. This requests evidence, not a product redesign. Confidence:
   high that this evidence is absent from the supplied final set.

Additional nonblocking changed-region issue: **[product][defect]**
`InlineReferences.tsx:88` disables the entire provider selector when blocked
with zero/one bibliography, including Off. A user who loses connectivity or
enters tracking cannot withdraw an already selected provider until the blocking
condition clears. Requests are correctly blocked meanwhile. Keep Off selectable
while preventing newly enabled remote requests. This is a control/consent
usability issue, not evidence of unauthorized egress.

## Per-item verdicts

References below use `InlineReferences.tsx`, `remote-completion.ts`,
`preferences.ts`, `editor.ts` and `source.css` under
`apps/web/src/features/editor/source/`, unless another path is given.

| Item | Verdict | Evidence, finding and scope |
| --- | --- | --- |
| G1 | PASS | Changed CSS introduces no animation or transition; disclosure and completion appear for focus/query interactions. No decorative loop in the changed surface. Static captures alone do not audit inherited motion. |
| G2 | FAIL | [product][defect] Finding 3: focus-driven disclosure closure changes source geometry synchronously (`InlineReferences.tsx:80`). No transition/retarget mechanism exists. |
| G3 | N/A | No new animation to interrupt or gate input. This does not excuse G2's abrupt geometry change. |
| G4 | N/A | No positional/scale/depth/blur animation is introduced by inline references. Reduced-motion playback was not captured. Shared spinner policy is an inherited full-product limit below. |
| G5 | FAIL | [evidence][defect] Searching/copy notices are set before their awaits (`remote-completion.ts:69,105`), and no new spinner or bar is introduced. Same-frame acknowledgement and elapsed-time behavior were not measured. |
| G6 | FAIL | [evidence][defect] No initial-paint/CLS record. Conditional notice insertion (`InlineReferences.tsx:107`, `SourcePanel.tsx:195-198`) changes source-flow height; supplied populated stills do not establish load stability or the absence of a splash. |
| G7 | PASS | No flashing, strobing or viewport-filling oscillation introduced in the inspected implementation; current results remain readable in both themes. No comprehensive inherited-motion/video acceptance. |
| H1 | FAIL | [product][defect] Finding 4: empty-result text omits a next action. Loading, service-error and blocked/offline paths exist (`remote-completion.ts:69-94`, `InlineReferences.tsx:54-62`), but their complete visual matrix is absent [evidence][defect]. |
| H2 | FAIL | [product][defect] Finding 2: immediate textual loading exists but may remain after cancellation. No new spinner/bar is used. The retained tests do not assert this feedback's terminal state. |
| H3 | FAIL | [product][defect] The stale loading notice in finding 2 can misreport a completed cancellation. Otherwise errors are adjacent to Source via role=status, insertion visibly changes the key, and a retained receipt correctly discloses a separately durable copy; no routine toast/alert is added. Success/stale-copy native checks pass; their visual captures are missing. |
| H4 | N/A | Inline references adds no alert dialog or destructive action. Its messages use role=status. The inherited draft-discard modal is not P71 alert acceptance. |
| H5 | FAIL | [evidence][defect] No hover/pressed/focus/disabled matrix for the new summary, native selects or option rows. Source CSS provides focus for selects; global focus also covers summary. Native disabled semantics are present, but native styling is not cross-platform proof. Off/provider text and disclosure triangle distinguish state beyond color. |
| H6 | N/A | No new sheet/modal is implemented; desktop completion is a listbox popup. This is not a compact-width waiver: the missing phone sheet fails J2. Existing Assistant/dialog behavior is outside changed-region acceptance. |
| H7 | PASS | Lookup aborts on context abort/doc change and invalidation (`remote-completion.ts:44,58`); native cancellation JSON confirms no copy on Escape and stale provider results discarded. Once accepted, a durable bibliography mutation is not represented as safely cancelable; stale source insertion is withheld and the committed copy disclosed. Feedback cleanup still fails H2. |
| H8 | PASS | Contextual explicit Off/provider selection defaults Off (`InlineReferences.tsx:18,84-103`); disclosure explains typed-query-only transfer and separate Library/linked files. No system permission prompt added. This is contextual provider opt-in, not approval of all account onboarding. Off availability while blocked is the nonblocking issue above. |
| H9 | N/A | No new sign-in UI, password field, onboarding or authentication-method choice in this surface. Mendeley explicitly names its grant requirement; account-level sign-in was not reviewed. |
| H10 | PASS | One inline remote query location: active citation argument (`remote-completion.ts:20-33`). The selected provider is visible in the collapsed scope summary; candidates are suggestions. Account Library/linked bibliography separation is disclosed. This does not certify every inherited project-search surface. |
| H11 | PASS | Provider and bibliography controls have explicit labels and Off wording; no duplicate OS-wide preference is introduced. Autocomplete's existing saved setting is respected rather than duplicated. The blocked Off-control issue is reported separately; no macOS settings window is claimed. |
| I1 | FAIL | [evidence][defect] Global `:focus-visible` (`apps/web/src/styles/global.css:8`) covers summary; source CSS adds control focus and editor theme provides editor outline. DOM order is sensible, and completion retains editor focus. No complete keyboard focus-order/ring evidence in either width/theme; automatic focus elsewhere in the inherited shell is not accepted. |
| I2 | PASS | Scoped completion behavior: `editor.ts` installs completionKeymap and collaborative Mod-Z bindings; retained native log proves actual Enter acceptance and Escape no-copy dismissal. No new shortcut override in the reference controller. Cmd-comma/native menu behavior is unproven and outside this scoped PASS (J1). |
| I3 | FAIL | [evidence][defect] Source has a named section; selects have labels/aria-label, editor has `Source: <path>`, notices use role=status; real CodeMirror options were targeted by role in native tests. No new icon/image needs naming. However no live accessibility-tree or announcement evidence proves the listbox linkage, error/loading updates and all inherited landmarks/icon tooltips; do not claim full tree acceptance. |
| I4 | PASS | No gesture-only operation added: provider/destination use selects, disclosure uses summary, and candidates support pointer and keyboard acceptance. Gesture behavior of the inherited application is not part of this PASS. |
| I5 | N/A | No media or autoplay is introduced in inline references. |
| J1 | N/A | Inspected product is the browser editor, not a native macOS application. No native window/menu/settings-pane evidence exists; Cmd-comma, menu parity and native split-view behavior are not silently approved. |
| J2 | FAIL | [product][defect] Finding 1: current 390 captures retain a completion popover, not a sheet. Source is a general TeX text editor, so numeric/email/URL inputmode is not appropriate here; no collapsible large title is introduced. [evidence][defect] No physical-device/keyboard proof. |

## Functional integrity and required content

The actual DOM/component path is `SourcePanelContent` -> `useInlineReferences`
-> `createSourceEditor` -> preference autocompletion combining local and remote
sources. SourcePanel subscribes to document snapshots; blocked decisions
therefore see persistence changes. The inline controls precede Source, not a
replacement editor or a detached account Library workflow.

The initial provider is Off. Blocking covers unresolved account session,
autocomplete off, tracking, insufficient editing authority, readOnly,
connecting/offline/recovery/closed, unresolved multiple targets and an occupied
noneditable `references.bib`. Only editable unlinked .bib targets are offered.
`remoteCitationQuery` masks supported inert syntax and extracts the active
argument segment; the call transmits query/provider/project/limit, not source
text. This is lexical handling, not proof for arbitrary TeX macro expansion.

Search route `services/adapters/references/index.ts:100-112` authenticates the
actor and delegates to retrieval. `retrieval.ts:51-108` checks active actor,
project read access, configured provider and Mendeley grant as applicable, then
rechecks authority/configuration/cancellation around retention. Unsupported
providers are not invented. Search is project-read-authorized at the server;
the stricter no-automatic-Viewer-request rule is the UI gate, not a claim that
all direct Viewer searches are forbidden.

Acceptance checks source/session/scope/provider/target/caret freshness, flushes
source, fetches current project access and revision, then copies the returned
publication before replacing only the active query range.
`services/core/catalog/index.ts:48-56` authenticates, checks route/body scope and
files.write, and uses replay protection.
`services/core/catalog/citations.ts:15-37` serializes, reauthorizes, excludes
linked/noneditable targets, requires multiple-target selection, guards occupied
paths/key conflicts and commits against the expected revision. These are real
authorization and persistence paths, not UI-only enforcement.

The current screenshots correctly display the controlled provider fixture's
actual metadata: **Research dest0; Grace Hopper; Ada Lovelace; 2026; crossref;
crossref_6946c927154ce523**. `acceptance.json` retains that exact publication and
the zero/one/multiple destinations (`references.bib`, `target0.bib`,
`target1.bib`). These are actual fixture response values, not claims about a
live scholarly publication. D06's World Models/other sample data must not be
substituted for them. Code supplies missing-author/year fallbacks and the actual
key parsed from one returned BibTeX record.

Required Off/provider, destination, data disclosure, provider-dependent search
semantics, unavailable ReadCube/Dimensions, separate Library/linked explanation,
metadata and keyboard instructions are implemented. The prior open-settings
captures show the disclosure/destination; current captures show collapsed scope,
actual candidate and Enter/arrows/Escape guidance. Error and copy receipts exist
in source and retained native checks but lack final visual captures.

Receipts intentionally distinguish copy from insertion. A committed stale copy
remains disclosed without insertion, is scoped to project/branch and opaque
session fingerprint, and survives same-session tab navigation/reload; retained
native evidence verifies a renewed same-actor session hides the prior receipt.
The fixture inserts an unfinished citation at the start of a minimal document,
not a compile-ready research example. The observed incomplete command therefore
does not prove the product deletes a closing brace, and it does not establish
successful compilation.

## D06 comparison, inherited limits and preserved aspects

**Exact whole-screen D06 match is not achieved or approved.** D06 has a narrow
project-search sidebar, a broader editor extending to the right edge, a simple
Back to editor header and a rounded, shadowed multi-row bibliography popup with
scope header and footer guidance. Current 1440 screens instead have the
assembled full mode/Recompile header, file sidebar, tracking controls and a
large Assistant panel, plus a plain CodeMirror candidate row. The changed popup
does not reproduce D06's card hierarchy, separators or integrated scope footer.
These are explicit visual differences; they are not all new P71 defects.

The surrounding shell differences occur in both before and after captures and
are inherited relative to this correction. The 390 header occupies roughly the
first 222 px and the shell/footer another large block, limiting total source
space. This is an inherited compact-shell limit, not a newly invented
inline-reference regression. The source-area restoration is nevertheless real:
current compact captures show a readable source pane through roughly y750,
where the earlier open settings plus raw-BibTeX popup nearly erased it.

**[product][taste], nonblocking:** adopting more of D06's rounded card,
metadata hierarchy and integrated hint footer could improve resemblance.
Recreating the original fiction or replacing the assembled shell is not an
authorized fix. Lack of exact D06 fidelity remains a separate unaccepted
full-screen goal, not a silent taste-based PASS.

**[product][defect], inherited full-product limit:** shared
`apps/web/src/styles/global.css:60-62` stops the spinner animation under reduced
motion and leaves a dotted static indicator, which conflicts with H2's
never-stopped-indicator requirement when that component is used. Inline remote
references does not render this spinner, so this is not a changed-region H2
failure. Native settings/menu parity, Assistant overflow/focus, other dialogs,
and all other full-product states remain outside this review.

Preserve the Quire brand mark, Plex/sans and source-monospace roles, shared
surface/border/selection tokens, understated one-pixel panel dividers and
readable light/dark results. Preserve the clear candidate selection, actual
metadata/key, nearby keyboard guidance, default Off consent, no-copy-before-
acceptance, durable-copy disclosure and authority fences. Recompile retains
shell prominence while candidate acceptance remains the inline task's primary
action. No decorative badges or motion were added.

## Confidence and handoff

High confidence in the nine-image comparison, hash identity, missing evidence,
compact popover and traced feedback/geometry defects. Moderate confidence in
overall keyboard/accessibility usability: retained tests establish specific
Enter/Escape cases, not a complete human-accessibility evaluation. No claim of
live-provider, physical-mobile, native-macOS, compilation, final static-check or
comprehensive G-J PASS is made.

The next review should target the listed changed-region fixes and missing
evidence, while preserving the passing authorized copy lifecycle. This report
does not authorize implementation, a shell redesign or test changes.
