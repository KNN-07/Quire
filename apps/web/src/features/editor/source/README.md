# Source authoring contract

Primary action: edit the current source document. Compilation remains the
workspace's primary button, owned by the PDF lane.

Information priorities: current file and editable source; current-file navigation
and search; source tools and independently labelled compiler/Code Check findings.

Left out on purpose: a second save indicator, assistant placeholders, sample
diagnostic counts, a second project tree, and a second persistence path.

Required content: TeX syntax; command/environment/label/citation completion; current
file outline; case/regex/whole-word/selection search and replacement; Code Check
with global/file/region suppression; source-linked compiler diagnostics; inline
and display math insertion; package hints; keyboard help including Mac completion;
Vim/Emacs; theme/font family/10-24 px size/line height; dictionary/spelling/custom
words; English/Vietnamese/Chinese UI controls. Unknown source and non-BMP text
must remain byte-preserving through the shared Y.Text and acknowledged transport.

Layout: Source panel - constrained authoring area with optional tools ->
scroll-body-shell (https://github.com/changeroa/StyleGallery/blob/main/patterns/viewport-shell/scroll-body-shell.md);
scroll owner: .q-source-editor .cm-scroller; utility tools independently scroll
inside .q-source-tools; anti-patterns: unconstrained flex minimums, document
scrolling behind a clipped editor, fixed mobile panel heights, reordered controls.

The panel is new; no pre-existing source implementation exists to capture.
Light styling follows docs/discovery/design.md and shared tokens.css. Dark
styling uses the shared derived dark tokens. Assembly owns the outer geometry.
All controls use shared primitives, neutral rules and wrapping control groups.
No generated mock supersedes the supplied decoded editor reference.

Spelling uses root-supplied nspell and bundled US English, British English and
Vietnamese dictionaries, with independent per-user custom words. Native browser
spellcheck is disabled so its OS vocabulary cannot disagree with the persisted
selection. The asset manifest marks Chinese spelling unavailable; the UI reports
that reason, independently of the working Chinese interface catalog. Dictionary
license links point at the actual root-supplied notices.
