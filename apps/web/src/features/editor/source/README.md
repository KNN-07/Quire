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

## Source tracking

Track changes is available in both presentations. Tracking binds CodeMirror to
a private Y.Doc, never the transport-owned Y.Text or its awareness. Typing,
composition, deletion, paste, formatting, Find replace and Code Check suppression
all operate on that private binding. Its Yjs undo manager also serves the Vim and
Emacs bindings. Normal collaborative undo remains owned across tracking toggles.

This is an explicit submission workflow, not autosaved proposals. Submit proposal
computes one conservative net replacement, with code-point-safe UTF-16 bounds,
then creates its relative anchor against unchanged shared source. It reads current
effective authority and branch revision and calls the existing suggestionCreate
endpoint. The server records the authenticated proposer and rechecks authority,
policy, version and anchor under its existing transaction. Acceptance/rejection
belongs exclusively to the existing Review consumer and suggestionDecide endpoint.

Draft text is retained in memory and tab-scoped sessionStorage, keyed by actor,
project, branch and file, with its base text and epoch. Toggling off pauses it;
file/branch navigation and reload recover it. Source or epoch changes do not
silently rebase a dirty draft: submission is blocked and full recovery text stays
available until explicit discard. Empty drafts follow current source. Browser
unload warns about unsubmitted text. Storage failures explicitly report memory-only
recovery. A stored request body and idempotency key allow a lost response to retry
the same submission after reload; a retry denial does not erase an uncertain
earlier outcome.

Reviewer source-read-only status is never changed. Tracking permission is separate
and current effective-access reads follow transport authority notifications.
Offline drafts remain recoverable but editing/submission waits for reconnection.
Persisted proposals are read from the existing list and event stream, with actual
proposal author IDs, insertion/deletion previews and anchor-conflict disclosure.
The source save indicator describes shared source, not private drafts.

Image paste, external authoring-handle/structural insertion and Visual editing are
explicitly unavailable while tracking. The external handle rejects before callers
can perform subsequent direct package edits. Draft selection offsets are not
published as committed-source selections to Review or Assistant. Normal source
mode retains its existing transport and authoring paths.

Assembly also supplies ToolsPanel with `sourceToolsClient`. It checks the current
retained tracking state at HTTP dispatch and rejects every project mutation before
delegating to the authenticated client. This covers citation copies (which mutate
the bibliography before insertion), uploads, links, file operations and project
settings; reads and independent personal-Library management remain available.
The guard does not change effective access or EditorDocument write authority.
Previously captured normal source handles reject once their editor is replaced,
before insertion helpers can perform a later direct package edit. Tracking cannot
be enabled during a source image upload.

Primary API evidence: CodeMirror's reference for EditorState/EditorView and UTF-16
positions (`https://codemirror.net/docs/ref/`), Yjs relative positions
(`https://docs.yjs.dev/api/relative-positions`), and the installed
`y-codemirror.next/src/{index,y-sync,y-undomanager}.js`. The binding installs its
remote-selection plugin only when awareness is supplied, and writes only the
Y.Text passed to yCollab.
