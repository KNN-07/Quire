# PDF editor region

## 1. Purpose
Compile durable source and inspect the actual resulting PDF, diagnostics and
historical rendered differences. Assembly owns the surrounding editor shell.

## 2. Tokens
Use `apps/web/src/styles/tokens.css` and `ui/index.ts` unchanged. They encode
the light reference in `docs/discovery/design.md` and accessible dark colors.
Paper remains white as authored in the compiled PDF, not theme-inverted.

## 3. Type and controls
Plex Sans chrome; Plex Mono raw logs and filenames. Shared Button, Field and
Tabs own interactive styling. Native labelled selects and checkboxes use the
same control tokens. No decorative icons, badges or stat tiles.

## 4. Layout
Layout: PDF panel - fixed controls above scrollable rendered paper -> scroll-body-shell (https://github.com/changeroa/StyleGallery/blob/main/patterns/viewport-shell/scroll-body-shell.md); scroll owner: .q-pdf-body; anti-patterns: unbounded panel height, document scrolling instead of panel, controls reordered visually.
Layout: Logs - class filters above diagnostic list -> scroll-body-shell (https://github.com/changeroa/StyleGallery/blob/main/patterns/viewport-shell/scroll-body-shell.md); scroll owner: .q-pdf-body; anti-patterns: nested vertical raw-log scroll, clipping long messages.
Layout: Historical comparison - revision and mode controls above real diff PDF -> scroll-body-shell (https://github.com/changeroa/StyleGallery/blob/main/patterns/viewport-shell/scroll-body-shell.md); scroll owner: .q-pdf-body; anti-patterns: fake source-text difference, fixed-width papers overflowing phone.

The host supplies a bounded height. Toolbars wrap; paper fits the available
width by default. Browser-native PDF embeds own their internal scroll.

Embedded assembly uses `presentation="embedded"`: PDF/Logs/Comparison tabs
and a compact navigation row remain above the paper. A keyboard-accessible
PDF options disclosure contains the real compile settings, cache action and
viewer choice. Escape closes it and restores focus to its summary. Successful
fresh-build detail remains available to assistive technology and the root
status bar; failures, stale previews, offline notices and action feedback stay
visible. Standalone presentation retains its existing controls.

Layout: embedded PDF - compact fixed tab/navigation rows and an anchored
options disclosure above scrollable paper -> scroll-body-shell; scroll owner:
.q-pdf-body; options have their own bounded temporary scroller when open.
No action is removed to recover paper space. Before captures are the settled
assembly run `ed02e06d-749a-41e8-b033-b1285f5224d3`; the incorrectly named
1280x720 intermediate loading capture is not desktop acceptance evidence.

## 5. Screen briefs
PDF primary action: Recompile.
Priorities: latest compilation and stale/failure label; actual PDF; navigation.
Required content: Recompile, cancel, automatic compile, draft, stop on first
error, cache clear, actual job status/revision/time, last-good PDF label,
page number/count, zoom, presentation, PDF.js/browser viewer, download,
source-to-PDF and PDF-to-source navigation.
Assembly receives Source, Split, Visual, PDF and Stacked layout controls;
the surrounding workspace, not this panel, owns their geometry.
Incomplete TeX is persisted unchanged, including a missing or misspelled
documentclass. Compilation uses the acknowledged source revision and displays
the compiler's diagnostics; the UI does not repair or reject draft syntax.
Automatic compilation also follows durable source events when the panel has
no active document handle.
Assembly receives `PdfPanelHandle` through `onViewer`. Its parameterless
`recompile(): Promise<CompileJob>` reads live local settings and uses the
controller's current-document flush path, including automatic mode's pending
revision handling. Header actions must use this port rather than copying
workspace settings. The shared compile controller remains the assistant port.

Logs primary action: Recompile.
Priorities: failure and retained PDF notice; diagnostics; raw log/artifacts.
Required content: all/error/warning/typesetting counts, parsed/raw view,
file/line source links, raw excerpts, raw log, every generated artifact,
cache clear and optimization advice. AI fixes belong to the later real
assistant adapter; no no-op AI button is rendered.

Comparison primary action: Compare PDFs.
Priorities: selected revisions; rendered comparison; changed pages.
Required content: From/To independent history revision selectors, side-by-side
and overlay modes, real changed-page rectangles, downloadable diff PDF.
Rendered changes may reflect reflow; they are not semantic source changes.

Left out on purpose: fabricated sample page/count/time, fake paper HTML,
promotional subtitle, AI placeholder, redundant summary cards.

## 6. States
Discovery loading, uncompiled, queued/running, succeeded, failed/timeout/
canceled with retained successful preview; disconnected stream with reconnect;
action errors at the affected panel. Controls are disabled when offline or
unauthorized. Error does not clear the old PDF.

## 7. Verification
New panel: there is no pre-existing rendered surface to baseline. Capture
actual sandboxed valid/invalid compile, stale/reload, navigation and diff in
the native browser fixture. Parent performs independent final visual QA;
nested reviewers are prohibited by this task.

## 8. Constraints
No new dependencies. React development instrumentation belongs to root owner;
the installed entry has none. No root tooling changes are made here.
