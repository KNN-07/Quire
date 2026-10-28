# Visual authoring verification contract

The production component is `VisualPanel(props: VisualPanelProps)`. The bounded
browser fixture imports it directly, the shared typed session/workspace client,
and the production transport. Its source textarea is a fixture, not a substitute
for the source producer's CodeMirror implementation.

Primary action: the assembled editor's Recompile action remains outside this
panel. Local actions are neutral formatting and field edits.
Information priorities: document content, formatting controls, preserved source.
Left out on purpose: assistant stubs, simulated PDF, decorative counts and badges.

Layout: visual region - fixed wrapping toolbar above a readable document ->
scroll-body-shell
(https://github.com/changeroa/StyleGallery/blob/main/patterns/viewport-shell/scroll-body-shell.md);
scroll owner: `.q-visual-body`; `.q-visual-table-scroll` owns only wide-table
horizontal overflow; textarea scroll is limited to its own editable source.
Anti-patterns: fixed-width mobile content, document-level competing scroll,
unlabelled controls and reserializing the document after editing one field.

Required content: paragraphs; section/subsection/chapter/title headings; bold and
italic; simple ordered/unordered lists; inline/display/environment math; citation
keys with optional notes; reference/label targets; include placeholders with
actual navigation; simple tabular cells/alignment; figure previews from actual
file bytes, caption, label and width; project-image insertion; actual single PNG
upload; graphicx insertion; editable unsupported/comment source islands.

Coverage: one visual panel at 1440x900 and 390x844 (true touch/mobile, DPR 3).
Each final panel has light/dark top/figure/figure-controls/end captures. A single
document measure aligns headings, text, tables and figure fields. Preamble
source islands remain available inside one disclosure, with title headings
still rendered separately. The same E2E narrative edits an
unsupported source island, edits a heading, switches to the fixture source
surface, edits it, switches back, pastes TSV and one real PNG, updates figure
fields, compares actual API document bytes and reopens the persistent document.
Native cases separately cover all interval types, immutable source ranges,
unknown/whitespace preservation, stale ranges, Unicode boundaries and real
read-only authority. The parent owns independent assembled-editor browser QA.

The browser uses real served fixture HTML, a native Bun production bundle of
the production panel and harness, and the default same-origin transport.
Production bundling avoids the unused development HMR client; it does not
replace the API, authentication, socket, upload or persistence paths.
No direct-API WebSocket override is permitted. Browser evidence is not accepted
until the parent publishes the corrected shared-fixture receipt.
