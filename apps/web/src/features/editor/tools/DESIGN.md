# Editor tools

The existing shared controls and `styles/tokens.css` implement the supplied
`docs/discovery/design.md` specification. Tools reuse those controls, IBM Plex
type, neutral dividers, selected washes and light/dark tokens.

## Spacing and layout

Layout: editor tools - navigate a project while retaining the document -> scroll-body-shell (https://github.com/changeroa/StyleGallery/blob/main/patterns/viewport-shell/scroll-body-shell.md); scroll owner: .editor-tools__body (a modal's .q-modal__body scrolls only its form); anti-patterns: no fixed 816px height, no document-level scroll forced by a panel, no sibling nested vertical scroll area.

Assembly owns panel bounds and mobile drawer geometry.
Assembly can pass `filesPresentation="compact"` to `ToolsPanel`, or
`presentation="compact"` to a direct `FilesPanel`. The exported
`FilesPanelProps` describes that additive option. Omission keeps standalone
controls unchanged. Compact creation/upload controls remain real actions in
the native keyboard-accessible `File actions` disclosure, initially closed.
In assembled compact mode the tool chooser and disclosure share one header;
the tree begins immediately below it. The anchored menu also retains selected
file rename/download/delete/link-refresh actions. Escape closes only the menu
and returns focus to its summary, not the enclosing mobile drawer. Starting a
form or upload closes the menu so the tree stays reachable afterward.
The settings view uses ordinary labelled fields, not schema-generated forms.
Main-file choices remain editable and unlinked. Exact roots `main.Rnw` and
`main.Rtex` are offered only for the selected Docker environment advertising `knitr`; other R source paths
are excluded. Changing to an incompatible environment requires a compatible
main before Save. Settings flush source, fetch the current project version and
reject a changed settings baseline before applying the user's edit.
Only an Owner sees the project-name field. An unchanged name is omitted, and
Editor compiler-settings requests never include `name`. A concurrent rename
is checked against the owner's original name before an explicit rename saves.

## Brief

Primary action: the document's Recompile remains primary in the assembled
editor. Tools are secondary commands; a submitted tool form has one Save,
Create, Search or Insert action.

Priorities: selected project file; active tool results; mutation/configuration
details. Required content: file/folder creation, path rename/move, deletion
confirmation, upload, binary download, linked/read-only explanation, project
search flags and excluded reasons, bibliography keys/targets, local Library
copies and editing/import, symbols/package requirements, engine/main/environment/
draft settings, independent interface language/dictionary/spell preferences,
optional browser Python installation and generated-file approval.

Left out on purpose: invented file counts, mock search results, decorative
badges, placeholder assistant, fake PDF preview and provider success claims.

Buttons, fields, native labelled selects/textareas, tabs and dialogs reuse the
shared primitives. All actions report errors next to their tool. File rows use
wash plus selected glyph; keyboard focus uses shared focus-visible rings.
No decorative motion is added. A Python runtime is explicitly installed and
enabled, runs in a disposable worker, and never saves generated files without
review. External provider connection state is read from actual endpoints.
