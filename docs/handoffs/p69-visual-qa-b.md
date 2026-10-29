# P69 visual QA, pass B - FINAL

Date: October 29, 2026. Independent read-only leaf review, A-F checklist.

## Bounded verdict

**REVISE - evidence coverage, not a confirmed new product layout defect.**

The inspected P69 controls preserve the existing modal identity, read in a sensible order, and remain usable beside the fixed footer in the rendered settings views. No newly introduced overlapping, horizontally overflowing, or inaccessible principal control is established by the supplied evidence. However, the two ZIP mobile `settings` frames still show the top of the form: they do not visually prove the main-path field or bottom status. A complete visual PASS therefore cannot be issued for all four modes. The recorded layout contract also names the old scroll owner and has no corresponding final scroll-owner probe.

This is not a whole-product HIG/accessibility certification. Literal checklist failures inherited from the shared typography, control-border, and tab primitives are recorded separately below. No source/test changes, runtime reruns, commits, or additional servers were made. Only this report was authored.

One assigned leaf pass was performed on the final retained set. No additional reviewer round was launched; review wall-clock duration was not instrumented.

## Evidence and freshness

`E` below means:

`docs/evidence/p69-import-choices/b492f986-801f-45d9-8af6-59c28b98c131/`

All **32 PNGs were opened individually at retained resolution**, not inferred from filenames or sampled from a contact sheet. They have valid PNG signatures, correct 1440 x 900 or 390 x 900 dimensions, and no visible compositor holes, browser chrome, or black missing regions. Their modification times run from `2026-10-29T00:53:24.946Z` to `2026-10-29T00:53:36.610Z`, after the latest changed UI source timestamp (`projects.css`, `00:45:25.870Z`). Current SHA-256 values for the three UI files match both hash records in `docs/evidence/p69-import-choices/final.log`:

- `NewProjectDialog.tsx`: `535784487f075caa9e40c27cd12dfc2262cb9a42d748341499cf77382f1f1b96`
- `CreationSettings.tsx`: `dcbfd31767f247e2aff9e0449a05107c2c5db201023b2caa214fda16ad0e049f`
- `projects.css`: `9371d605eb6f1a23fe6e91e44f8e44af70bbead60498c463580276fede769705`

### Complete frame inventory

Each table cell names an individually inspected file under `E`. L/D mean light/dark, not additional inferred states.

| Mode / position | 1440 L | 1440 D | 390 L | 390 D |
|---|---|---|---|---|
| Template top | `template-top-1440-light.png` | `template-top-1440-dark.png` | `template-top-390-light.png` | `template-top-390-dark.png` |
| Template settings | `template-settings-1440-light.png` | `template-settings-1440-dark.png` | `template-settings-390-light.png` | `template-settings-390-dark.png` |
| ZIP top | `zip-top-1440-light.png` | `zip-top-1440-dark.png` | `zip-top-390-light.png` | `zip-top-390-dark.png` |
| ZIP settings | `zip-settings-1440-light.png` | `zip-settings-1440-dark.png` | `zip-settings-390-light.png` | `zip-settings-390-dark.png` |
| GitHub top | `github-top-1440-light.png` | `github-top-1440-dark.png` | `github-top-390-light.png` | `github-top-390-dark.png` |
| GitHub settings | `github-settings-1440-light.png` | `github-settings-1440-dark.png` | `github-settings-390-light.png` | `github-settings-390-dark.png` |
| Git top | `git-top-1440-light.png` | `git-top-1440-dark.png` | `git-top-390-light.png` | `git-top-390-dark.png` |
| Git settings | `git-settings-1440-light.png` | `git-settings-1440-dark.png` | `git-settings-390-light.png` | `git-settings-390-dark.png` |

Desktop top/settings pairs can legitimately coincide when the requested anchor is already visible. The mobile ZIP pair is different: the compiler is visible at approximately y=694-738, so scrolling that anchor into view does not reveal the subsequent controls. The main document field and admission message remain below the body viewport ending at y=779.

Also inspected:

- `E/terminal.png`: an actual editor screenshot, despite its name, not an xterm capture. It shows the imported Git project's `main.tex`, `Remote initial` source, XeLaTeX/environment status, and intact editor panes. Its “No successful PDF available” view is an uncompiled Git project, not evidence that the separately compiled ZIP failed.
- `E/receipt.json`, all 275 lines: successful native template/ZIP/GitHub/Git records, saved settings, real source, and successful ZIP compilation.
- `docs/evidence/p69-import-choices/final.log`: 1 native test passed, 0 failed, 57 expectations; subsequent type checking and type-aware lint completed with `P69_FINAL_EXIT=0`. These are retained results, not reruns by this reviewer.
- UI source: `NewProjectDialog.tsx`, `CreationSettings.tsx`, `projects.css`; shared `ui/surfaces.tsx`, `ui/Icon.tsx`, `styles/global.css`, and `styles/tokens.css`; relevant `contracts/src/projects.ts`, `multipart.ts`, and `routes-core.ts`; the capture loop in `tests/ui-product/creation-choices/native.test.ts:94-104`.
- `docs/handoffs/p1-ui-projects.md:33-53`, the existing screen brief and layout contract.

`E/selected-main.pdf` exists and its successful PDF artifact is in the receipt, but there is no retained page rendering in this directory. PDF visual inspection remains parent-owned as assigned; no PDF layout PASS is claimed here. No image-diff/hotspot JSON or scroll-owner probe was supplied in the final set. There is no full before-state set for these new import controls; the older P61 captures are not treated as such, and no fabricated comparison or literal parity requirement is imposed.

## Prioritized findings

### Evidence needed for an unqualified P69 visual PASS

1. **[evidence] [defect] P2 - Mobile ZIP lower settings are not captured.**
   `E/zip-settings-390-light.png` and `E/zip-settings-390-dark.png`, body bottom y=754-779: only the TeX Live label/top boundary appears; main document path and the bottom explanatory message are absent. These files retain the top framing. `native.test.ts:102` scrolls only the already-visible compiler into view. Capture the modal body at its true end, or scroll the main-path/status region into view and verify its bounds before taking both theme frames. This is a capture-coverage failure, not proof that those controls cannot be reached.

2. **[evidence] [defect] P2 - The layout record does not describe or probe the changed scroll owner.**
   `docs/handoffs/p1-ui-projects.md:49-51` names `.q-modal` as the creation scroller. `projects.css:64-65` now deliberately sets that dialog to `overflow:hidden` and its `.q-modal__body` to `overflow:auto`, keeping the header/footer outside the scroller. The rendered pattern is sound, but A12's documentary/probe requirement is unmet. Record `.p-create-dialog > .q-modal__body` as the owner and attach the final overflow-owner probe at both widths. No product redesign is indicated.

### New product defects

**None confirmed within this bounded pass.** The evidence findings above prevent completing the visual gate; they must not be converted into claims of product clipping without inspecting the missing scrolled ZIP state.

### Inherited limitations, not newly introduced P69 defects

- **C1:** `styles/tokens.css:30` defines body 13px and secondary 12px; shared fields use 14px. These miss the checklist's desktop 14px body and mobile 17/15pt-equivalent minima. P69 uses the established type scale rather than introducing a smaller one.
- **E2:** Existing `--q-control-border` is `#D5D8DF` against white, approximately **1.43:1**, and dark `#596273` against `#1B1E25`, approximately **2.72:1**. Both are below the checklist's 3:1 control-edge target. Body/help text token pairs are substantially stronger: secondary 8.08:1 light / 10.03:1 dark; tertiary 6.20:1 light / 8.25:1 dark. Ratios are calculated from the inspected token values, not an asserted whole-screen automated audit.
- **D1/F5:** Shared tabs have a 2px gap, not the literal 8-12px target separation, and use a selected surface/shadow without a selection glyph (`global.css:43-47`). P69's new mobile checkbox labels, by contrast, have an explicit 44px minimum and visible checked/unchecked glyphs.
- **F1:** Template selection retains its existing text check mark alongside the shared SVG close icon/native browser controls. No new emoji or competing icon family was introduced. A global icon-normalization audit is outside this feature.
- Safe areas, actual touch hardware, large-text/200% zoom, physical iOS native selects, and CJK font/line breaking are not proven by these desktop-browser viewport captures. The capture loop sets viewport and color scheme; that alone is not evidence of full phone emulation. The observed mobile modal has a 16px edge inset and 44px controls, but no physical-device certification follows.

## A-F checklist

PASS means supported within the named captured state and source scope, not proof of uncaptured states. FAIL entries explicitly identify inherited versus evidence-only failures. N/A means no applicable instance or the native-platform criterion does not apply to this browser modal.

| Item | Verdict | Exact evidence and assessment |
|---|---|---|
| A1 Intentional anchoring | PASS | `E/template-top-1440-light.png`, `E/git-top-390-dark.png`: centered bounded dialog; fields share a clear leading edge. |
| A2 Full-bleed background | PASS | `E/zip-top-1440-light.png`, `E/zip-top-390-dark.png`: scrim covers the viewport; intentional modal inset is not a stray page margin. |
| A3 Margins / measure | PASS | `E/template-settings-390-light.png`, `E/git-settings-1440-dark.png`: symmetric body insets, grouped short form/help copy. Long remote help spans the available desktop form width without clipping. |
| A4 Phone safe areas | N/A | Browser viewport evidence has no actual notch/home-indicator area. `E/git-settings-390-light.png` shows 16px outer spacing, not physical-device proof. |
| A5 Phone overlay scrollbar | PASS | All eight mobile top/settings pairs, especially `E/github-settings-390-dark.png`: no reserved right gutter or horizontal displacement. Phone OS scrollbar behavior remains untested. |
| A6 Scroll ownership / fixed bar | PASS | `E/git-top-390-light.png` versus `E/git-settings-390-light.png`, `E/template-top-390-dark.png` versus `E/template-settings-390-dark.png`: body moves; title and opaque footer remain legible and stationary. `projects.css:64-65`; native Modal locks background body scroll. ZIP lower-state coverage remains E-1 above. |
| A7 Shared edges / gaps | PASS | `E/template-settings-1440-light.png`, `E/github-settings-390-dark.png`: desktop three-column settings collapse to one column; labels and control edges align using existing spacing tokens. |
| A8 Grouping / clear space | PASS | `E/git-settings-390-light.png`: history/binding labels, their explanatory copy, and bordered compiler/main fieldset are distinct; checkbox labels are 44px minimum. |
| A9 Responsive / no overlap | FAIL | **Evidence-only for full matrix approval:** `E/zip-settings-390-light.png` and dark do not show the lower controls. All observed principal controls fit; `final.log` native run passes document-width assertions. No general 1920/long-content/zoom claim. |
| A10 Continuation cue | PASS | `E/template-top-390-light.png` shows the beginning of the compiler fieldset at the body boundary; `E/zip-top-390-dark.png` shows partial next environment content. This is intentional scroll continuation, not footer overlap. |
| A11 Native mac window / sidebar | N/A | Web modal, not a native macOS window/sidebar change. |
| A12 Layout contract and probe | FAIL | **Evidence-only:** old `.q-modal` owner at `p1-ui-projects.md:49-51` differs from `projects.css:64-65`; final owner probe absent. See E-2. |
| B1 One primary action | PASS | `E/template-settings-1440-light.png`, `E/zip-top-390-dark.png`, `E/github-settings-390-light.png`, `E/git-settings-390-dark.png`: exactly one prominent mode-specific create/import action; Cancel is secondary. Dimmed background actions are inert modal background. |
| B2 Destructive hierarchy | N/A | No destructive action in these creation/import views. |
| B3 Plain title | PASS | All 32 frames: persistent “New project” header, not merely the app name. |
| B4 Reading priorities | PASS | `E/github-top-390-light.png`: name/workspace, source mode, URL/branch/credential precede history/binding and compiler/main settings; fixed creation action remains visible. |
| B5 Accent restraint | PASS | `E/template-settings-1440-dark.png`, `E/git-top-390-light.png`: existing single brand accent for primary action/focus/checked state, neutral other controls. |
| B6 Type hierarchy | PASS | `E/template-settings-390-dark.png`, `E/zip-settings-1440-light.png`: title, medium-weight labels, and secondary hints remain distinguishable in both themes. The absolute type-size failure is recorded under C1. |
| B7 Brief fit | PASS | Existing `p1-ui-projects.md:33-44` and assigned P69 brief; all modes retain name/workspace/source and mode-specific outcome action, with actual compiler/environment/main/history/binding controls. New lower settings intentionally require scrolling on 390. |
| C1 Minimum type sizes | FAIL | **Inherited:** `E/git-settings-390-light.png`, `E/template-settings-1440-dark.png`; `tokens.css:30`, `global.css:35,40`: 13px body, 12px hints, 14px shared fields. |
| C2 Human-readable copy | PASS | `E/github-settings-390-light.png`: labels spell out history/binding outcomes and credential requirements; compiler labels are pdfLaTeX/LaTeX/XeLaTeX/LuaLaTeX/Plain TeX, not raw enum values. Environment is the actual service-provided label, not a leaked UUID. |
| C3 Action labels | PASS | Mode footer labels in all four `*-settings-1440-light.png` frames state outcomes; no generic “OK”. Existing creation-mode tab wording is preserved. |
| C4 Wrapping / clipping | PASS | `E/git-settings-390-dark.png`, `E/template-settings-390-light.png`: help copy wraps cleanly, title remains one line, main-path field and focus ring do not collide with neighbors. This is captured-size evidence, not 200% zoom certification; missing ZIP lower state remains A9/E-1. |
| C5 CJK precision | N/A | No CJK text in the 32 frames; no claim about unavailable CJK samples. |
| C6 Empty/error guidance | PASS | `CreationSettings.tsx:35-45` gives specific unavailable-environment/Plain TeX guidance; `NewProjectDialog.tsx:191-195,234-238` retains adjacent status/retry paths. Source-backed; these error states are not pictured in this set. |
| C7 Visible field labels | PASS | `E/zip-settings-1440-light.png`, `E/github-top-390-dark.png`: project, workspace, URL, branch, connection, compiler, TeX Live, main path and file input all have visible labels. “main.tex” is an example/field value, not the sole label. |
| C8 Selectable useful text | PASS | Main-path/URL are real inputs; instructions/errors are DOM text in `NewProjectDialog.tsx` and `CreationSettings.tsx`, with no inspected `user-select:none` rule on that text. `E/git-settings-390-light.png`. |
| D1 Targets / separation | FAIL | **Inherited shared-tab separation:** `global.css:43` uses 2px gaps. New history/binding labels meet the requested 44px minimum (`projects.css:67`); mobile fields/buttons/selects use 44px rules. `E/git-settings-390-light.png`, `E/github-settings-390-dark.png`. |
| D2 Phone tab bar | N/A | These are form mode tabs, not a bottom navigation tab bar. |
| D3 Toolbar structure | PASS | `E/template-top-390-light.png`: modal header has title and standard trailing close; footer has status plus Cancel/create, with no competing glyph cluster. |
| D4 Adjacent bar hit areas | PASS | `E/git-settings-390-light.png`: Cancel/create are padded 44px-high rectangular controls; mode tabs have continuous rectangular button targets. Literal neighbor spacing limitation stays under D1. |
| E1 Paired themes | PASS | All 16 corresponding light/dark pairs opened. Dark controls, native checkbox states, focus rings, template thumbnail and footer remain coherent; no glowing light-only raster. |
| E2 AA contrast | FAIL | **Inherited control-edge tokens:** `E/zip-settings-1440-light.png`, `E/git-settings-390-dark.png`; 1.43:1 light and 2.72:1 dark border/surface ratios. Text/help tokens pass their 4.5:1 threshold; complete disabled/native-state contrast is not measured. |
| E3 Non-color cues | PASS | `E/template-settings-390-dark.png`: selected template has check plus “Selected”; `E/git-settings-390-light.png` vs `E/github-settings-390-light.png`: checkbox glyph and disabled state/copy explain the difference; main field has an outline focus ring. |
| E4 Color semantics | PASS | `E/template-settings-1440-light.png`, `E/git-settings-390-dark.png`: accent is interactive selection/action, neutral text is explanatory; no conflicting new status palette. |
| E5 Translucent text surface | N/A | Modal header/body/footer are opaque. Scrim is translucent behind the modal but carries no foreground text. |
| E6 System theme | PASS | `tokens.css:42-80` follows `prefers-color-scheme` when no explicit light/dark override; native capture changes color scheme and all pairs respond. No new in-modal theme selector. |
| F1 Icon consistency | PASS | `E/template-settings-390-light.png`, `E/git-top-1440-dark.png`: inherited shared close/check/native select/checkbox language; `ui/Icon.tsx` uses consistent 1.6 SVG stroke. Existing text check is noted separately; no new emoji or icon family. |
| F2 Token spacing / radii | PASS | `projects.css` uses `--q-space-*`, `--q-radius-*`, and shared fields/Modal; `E/zip-settings-1440-dark.png`, `E/template-settings-390-light.png` show compatible nested corners and spacing. |
| F3 Shared component parity | PASS | All four modes' settings frames use the same `CreationSettings` fieldset and fixed footer model; native Modal is reused. Wider sibling-route certification is not claimed; source change is scoped to `.p-create-dialog`. |
| F4 Brand preservation | PASS | `E/template-top-1440-light.png`, `E/git-top-1440-dark.png`: Quire header identity remains behind modal, no new branding in form content. The mobile modal legitimately obscures the background header. |
| F5 Selection / focus pattern | FAIL | **Inherited tab pattern:** `E/github-top-390-light.png` mode selection has surface/shadow but no selection glyph. New checkboxes use actual checks; template selection uses wash/check/label, and path fields use visible focus rings. `global.css:47`. |
| F6 Standard glyph placement | PASS | All frames: conventional close at header trailing edge; native select chevrons at trailing input edge; shared close path in `ui/Icon.tsx:5`. |
| F7 Sheet/modal shape | PASS | All 32 frames show one native dialog with consistent rounded geometry, visible close/Cancel, and no stacked popover. Native `showModal()` and inert-background behavior are in `ui/surfaces.tsx:35-58`. |

## Choice truthfulness and real workflow evidence

`CreationSettings.tsx:19-32` exposes all five contracted engines for template/import: pdfLaTeX, LaTeX, XeLaTeX, LuaLaTeX, and Plain TeX. Blank projects omit selectable Plain TeX, retaining a disabled explanatory option if it is the saved default. `contracts/src/projects.ts:5` contains the same five engine values. Environments are filtered for the selected engine; unavailable/admission-blocked environments remain disabled with an explanation. Main selection is an optional exact path, not a falsely populated file chooser; empty means discovery.

`NewProjectDialog.tsx:112-115,147-175` carries the real selection into project creation, ZIP multipart, or remote import requests. `multipart.ts:5-8,65-84` admits main path, engine, environment, history, and binding choices. `routes-core.ts:40` admits template creation choices. The receipt confirms XeLaTeX and the admitted environment persisted for every mode. ZIP selected `z-selected.tex` rather than the fixture's alternative source; its retained source is `RIGHTIMPORT`, and its compile job succeeded with an `output.pdf` artifact.

`E/github-settings-390-light.png` shows history off and remote binding unchecked/disabled, with copy saying it is an independent snapshot and explaining that pull/push are explicit, not automatic synchronization. The native receipt agrees: `preserveHistory:false`, `keepConnected:false`, `bindingId:null`, one `main` branch and no tags. `E/git-settings-390-dark.png` shows both on; the receipt agrees with both true, a real binding ID, two branches including `protected/release`, and tag `v1.0.0`.

The public-repository wording is truthful about this installation's requirement: the source requires a ready saved connection before remote creation (`NewProjectDialog.tsx:111-113`) and visibly says that includes public repositories (`:189`). There is no credential textbox pretending to accept an unsupported public/no-grant path, and no claim of background sync. This pass verifies the correspondence of UI, source, and retained native workflow receipts, not every provider/network failure mode.

## Keep

- The actual source/name/workspace choices precede advanced settings; the persistent mode-specific create action is never lost on mobile.
- History removal makes binding unavailable and explains why, rather than leaving an ambiguous disabled “sync” switch.
- Compiler/environment/main controls are real DOM controls backed by contracts and persistent native results.
- Fieldset boundaries, wrapped help text, focus outline, and opaque fixed footer remain readable in both themes.

## Completion boundary

The assigned inspection and report are complete. An unqualified final visual gate remains open only for the two concrete evidence fixes above, plus parent-owned PDF inspection. Inherited checklist failures are explicitly disclosed, not silently marked PASS or attributed to P69. No additional product change is recommended from the supplied pixels alone.

## Targeted follow-up - revised evidence, October 29, 2026

**Current bounded feature verdict: PASS. Both evidence findings from this pass are closed.** This follow-up supersedes the earlier REVISE verdict for P69's inspected layout and choice presentation, not the recorded inherited checklist failures or the physical-device/PDF boundaries. No new product defect was found in the revised end views, template wrapper, or submitted-choice states.

The requested targeted follow-up used `R`:

`docs/evidence/p69-import-choices/0c26269b-0f25-4251-be73-4a39109a6498/`

This is an evidence follow-up, not an unchanged full runtime rerun. Directly opened **27 revised images**: all 16 `*-settings-{1440,390}-{light,dark}.png` end frames, all four `template-top-{1440,390}-{light,dark}.png` wrapper frames, and seven submitted-state frames named below. All 16 `*-layout-*.json` probes were read in full. The remaining unchanged top views were not re-audited as a new full matrix. The initial 32-frame inspection above remains separately attributed.

### Resolved findings and targeted checklist updates

| Finding / item | Follow-up verdict | Revised evidence and observation |
|---|---|---|
| E-1 / A9: ZIP mobile lower settings | PASS, closed | `R/zip-settings-390-light.png` and `R/zip-settings-390-dark.png` now show compiler, TeX Live, `z-selected.tex`, its full hint, and the deployment admission message above the footer. Input/focus ring fit the body width; admission text ends around y=744 and the fieldset around y=762, before the footer begins at y=778.5. |
| E-2 / A12: recorded scroll owner | PASS, closed | `docs/handoffs/p1-ui-projects.md:52-56` explicitly supersedes the historical `.q-modal` owner with `.p-create-dialog > .q-modal__body`; `docs/handoffs/p69-project-choices.md:8-13` records that current contract. All 16 `R/*-layout-*.json` probes agree with the owner, region geometry, and actual overflow behavior. |
| A6/A9: remote desktop end visibility | PASS | `R/git-settings-1440-light.png`, `R/git-settings-1440-dark.png`, `R/github-settings-1440-light.png`, `R/github-settings-1440-dark.png` show the whole compiler/main fieldset, including the deployment message at approximately y=768, with its bottom around y=792 before the footer at y=816. The partly scrolled name fields at the header boundary are expected at this end position. |
| A6-A9: remote phone end visibility | PASS | All four `R/{git,github}-settings-390-{light,dark}.png` frames show the history/binding explanation and complete settings fieldset above the fixed footer. Git retains checked history/binding; GitHub retains the independent-snapshot state and disabled binding. No new overlap or competing content scrollbar appears. |
| A7-A9/F2: template wrapper | PASS | All eight `R/template-{top,settings}-{1440,390}-{light,dark}.png` frames were opened. The new disabled-capable wrapper visibly groups search, filters, and the selected template using the existing bordered-fieldset treatment. It adds an inset without introducing horizontal clipping; the selected card still wraps cleanly on phone, and the settings end retains the whole main-path field, hint, and admission message. The visible wrapper is consistent with the existing generic `.p-stack fieldset` rule, even though the weaker `.p-template-choice` rule specifies no border/padding. No correctness fix is indicated by that styling detail. |
| Submitted-choice presentation | PASS, bounded to supplied states | `R/template-submitted-pending.png`; `R/{zip,github,git}-submitted-pending.png`; `R/{zip,github,git}-submitted-complete.png` show the chosen values retained and disabled rather than presenting editable controls that no longer affect the submitted operation. Pending primary buttons show the busy indicator; completed imports keep creation disabled and permit Cancel. These seven frames are desktop/dark only; no new phone/light submitted-state certification is inferred. |

The four template top images are wrapper evidence, not a guarantee of exactly zero scroll offset. In particular, `R/template-top-390-light.png` starts with the name input at the header boundary while its label is above view; the full name-label region appears in the dark counterpart and remains ordinary scrollable source content. This does not reopen the lower-settings coverage finding or establish a hidden control.

### Probe audit: all 16 files

Each row covers both individually read `R/{mode}-layout-{width}-light.json` and `R/{mode}-layout-{width}-dark.json`. Light/dark geometry and scroll values agree within each row.

| Probe stem | Body scrollTop / scrollHeight / clientHeight | Footer top-bottom | Active content scrollers |
|---|---|---|---|
| `template-layout-1440` | 46 / 770 / 724 | 816-883 | `q-modal__body` |
| `template-layout-390` | 400 / 1085 / 685 | 778.5-883 | `q-modal__body` |
| `zip-layout-1440` | 0 / 616 / 616 | 761.75-828.75 | None; whole content fits |
| `zip-layout-390` | 251 / 936 / 685 | 778.5-883 | `q-modal__body` |
| `github-layout-1440` | 55 / 779 / 724 | 816-883 | `q-modal__body` |
| `github-layout-390` | 616 / 1301 / 685 | 778.5-883 | `q-modal__body` |
| `git-layout-1440` | 55 / 779 / 724 | 816-883 | `q-modal__body` |
| `git-layout-390` | 596 / 1281 / 685 | 778.5-883 | `q-modal__body` |

Every probe reports `overflowY:"auto"` on the designated body, document width equal to viewport width, non-overlapping header/body/footer bounds, and a footer inside the dialog and the 900px viewport. In every scrolling case `scrollTop + clientHeight == scrollHeight` at recorded integer precision: these are actual end positions, not merely an anchor already in view. ZIP desktop correctly has no active scroller because content fits. No probe contains a sibling or nested active content scroller. The probe searches active scrollers inside the dialog; background body locking remains source-backed rather than being overstated as a document-wide probe result.

### Submitted-state source and native evidence

Read the revised `NewProjectDialog.tsx:48-72,175-244`, `projects.css:55-79`, `presentation.ts` in full, and `native.test.ts:85-184`. The source now derives `choicesLocked` from busy, created project, existing operation, or locked onboarding state. Name/workspace, repository URL/branch/saved connection, history/binding, template-selection fieldset, and compiler/main settings consume that lock. ZIP file selection and drop handling separately enforce the same pending/created/operation restrictions while retaining the required-file onboarding exception.

`presentation.ts:5-19` asserts the actual disabled state of all applicable controls, including the template button, rather than inferring it from opacity. `native.test.ts:115-138` holds the actual request before continuing to its real handler, awaits the disabled surface signal, asserts locks, records pending screenshots, then releases the request and asserts completed import locks. The imported-project navigation remains a live action. The completed Git/GitHub frames are still at the earlier body scroll position, so their operation panel begins below the visible body edge; the follow-up does not claim those two screenshots themselves display the whole success panel. ZIP's complete frame does display success and “Open imported project”; the retained native case checks and clicks that action for all imports.

`review-fix.log` records two native tests passing with **248 expectations, 0 failures**, strict TypeScript and type-aware deny-warning lint, and `P69_REVIEW_FIX_EXIT=0`. Its before/after hashes are stable across all five recorded inputs. Independently checked current hashes match those receipts:

- `NewProjectDialog.tsx`: `634d57738a7966c054dd157bcfed4f3c2feaa987d9f7cf82d8708773b746b912`
- `CreationSettings.tsx`: `dcbfd31767f247e2aff9e0449a05107c2c5db201023b2caa214fda16ad0e049f`
- `projects.css`: `e2a70d405173a8e7562544b85c2c362d144de9c941256a3a59e52923e0d63b5e`
- `native.test.ts`: `392a309678b24f1d2906c08727f1c663cb3d169fd9172800cb0546f8d9d2fbaf`
- `presentation.ts`: `8917ef787f00274771968161949f08b5b111f6b4e7e76afe607a29af80ca7d76`

All 23 settings/submission images have valid PNG signatures and expected 1440 x 900 or 390 x 900 dimensions. Their timestamps span `01:41:43.029Z` through `01:41:54.154Z`, after all five input modification times (latest `01:36:24.029Z`). The four template top frames were also directly viewed; no compositor defect was visible. These are inspected retained results, not reviewer reruns.

### Final follow-up boundary

**No open new product or evidence finding remains in this pass's requested follow-up scope.** A9 and A12's previous evidence-only FAILs are superseded by the PASS results above. The inherited C1, D1, E2, and F5 checklist limitations are unchanged and are not silently upgraded. Physical-phone safe areas/touch, zoom/CJK, broader submitted-state matrices, and parent-owned PDF visual inspection remain separate evidence limits, not newly introduced P69 defects. This appendix makes a bounded feature verdict, not a claim that every A-F baseline criterion now passes or that a new full application/runtime audit was performed.
