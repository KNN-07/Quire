# Source inline references

## Tokens and components

Source retains `source.css`, shared native controls, IBM Plex typography and
`styles/tokens.css`. Inline reference selects reuse Source settings fields.
Completion rows reuse CodeMirror's real listbox, selection wash, focus and
keyboard handling. No decorative motion is introduced.

## Spacing and layout

Layout: Source inline references - retain citation context while selecting a
remote record -> scroll-body-shell
(https://github.com/changeroa/StyleGallery/blob/main/patterns/viewport-shell/scroll-body-shell.md);
scroll owner: .cm-scroller; additional scrollers: CodeMirror completion list
for provider results, .q-source-tracking for retained drafts,
.q-source-tools for a deliberately opened tool, .q-source-proposals for review;
anti-patterns: no document-level horizontal overflow, no fixed editor height,
no replacement application shell.

The provider/destination disclosure sits above the editor. Assembly continues
to own desktop/mobile panel bounds. Closing the disclosure retains the selected
provider and destination without sending a request.

Configuration uses a bounded `.q-source-references .q-source-stack` scroller.
Opening it starts at the provider control; Done explicitly closes it and
returns focus to Source. Focusing Source alone never changes panel geometry.
At compact width, the real CodeMirror result list becomes an in-flow sheet
below the source scroller, with a visible Close control and keyboard hints.
Its list scrolls independently. Measured-layout updates keep the source caret
visible after the sheet reserves space and reveal the selected row's start
below its sticky header; manual list scrolling is not reset.

## Brief

Primary action: accept the selected citation with Enter in the completion popup.
The assembled editor's Recompile retains its existing primary styling.
Information priorities: current citation query; actual key, title, authors,
year and provider; editable destination and copy/insertion status.

Required content: explicit Off/provider selection, external query disclosure,
provider-specific search semantics, disabled ReadCube/Dimensions, separate
Account Library/linked bibliography explanation, zero/one/multiple editable
destinations, actual title/authors/year/provider/key, arrows/Enter/Escape hints,
truthful service and authority errors, already-completed-copy receipts.

Left out on purpose: fabricated keys/results, AI completion, provider entitlement
claims, source excerpts sent externally, decorative badges and custom popup
animations. Provider completion remains off until deliberately selected and is
unavailable when the saved autocomplete preference is false.

Copy and source insertion are separate durable operations. A stale source never
receives an insertion; a successful bibliography copy is disclosed and its
receipt survives document navigation/reload in this browser tab and authenticated
session. Only the latest receipt occupies tab storage; a new session does not
display its predecessor's receipt.
