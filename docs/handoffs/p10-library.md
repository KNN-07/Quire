# FINAL: native Library and citation workflow

Owner: `st_01a17f4e`. October 27, 2026.

The elected native A19/I45a/I45b workflow is implemented and verified in the
actual mounted editor. Final project-local **Bun 1.4.4** acceptance is
**6 pass, 0 fail, 148 expectations, 2 files, 64.11 seconds, exit 0**.
Scoped strict TypeScript and type-aware lint passed. Eight final light/dark
desktop/narrow captures were inspected, and owned cleanup completed before
this handoff was written.

## Delivered native behavior

Library entry now supports 12 declared BibTeX/BibLaTeX types and 27
bibliographic fields. Common fields stay visible; additional fields expand
without changing the existing control density. Form values are escaped as
plain LaTeX text. Generated raw code can be edited before saving. Existing
records remain editable as code, preserving a path for custom types, macros,
and fields rather than pretending that a fixed form models arbitrary BibLaTeX.

`.bib` upload now opens an editable UTF-8 review dialog before submitting to
the existing atomic multipart import. The extension and 2 MiB input bounds
remain explicit, and the server still validates edited source.

The DOI form calls the existing `libraryDoi` endpoint, saves the returned
account-owned Library record, and exposes native validation/provider errors.
It uses the configured Crossref-backed DOI contract; it does not synthesize
metadata, invent an API-key requirement, or claim universal DOI resolution.

Project and account Library searches offer key, author, title, journal,
year, date, and all-field filters. Journal searches include `journal` and
BibLaTeX `journaltitle`. Searches use literal source metadata, including nested
and quoted values and numeric years; they do not expand TeX/string macros.
Account search explicitly covers loaded records and retains pagination.

`Copy to project` only creates the independent project copy.
`Cite in project` obtains that native copy, inserts `\cite{key}` through the
active source authoring handle, durably flushes source, then performs the
normal workspace refresh. The local callback ordering avoids using a source
handle after a structural refresh can reopen it. No shared action or transport
contract was changed.

Zero editable bibliographies creates `references.bib`; a sole editable
bibliography is selected automatically; several require an explicit target.
Linked files remain readable/citable project sources but cannot be selected
as local copy destinations. An occupied linked `references.bib` is not
overwritten. Library patch/delete retain actor ownership, read-only flags,
and expected-version guards. A project Viewer can maintain their own account
Library but cannot copy or insert into that project.

## Evidence and retained boundaries

Authoritative current receipt:
`docs/evidence/p10-library/cursor-click.log`.
The exact commands, diagnostics limitation, byte receipts, visual inspection,
and cleanup audit are in
`docs/evidence/p10-library/verification.md`.

The new `tests/ui-editor/library-p10` selection exercises:

- Native form-to-code entry, reviewed multi-record `.bib` import, and DOI
  lookup through real safe HTTP/provider parsing.
- Actual `/projects/:id/edit` mounting at CSS widths 1440 and 390, with
  zero/sole/multiple-target copies and exact source/bibliography reload.
- A direct click in source line three, an observed line/column precondition,
  exact citation placement there, and persistence of all surrounding bytes.
- Journal metadata search in Library and author/title/year/date/key search in
  project records.
- Linked-target refusal and unchanged linked bytes, Viewer UI/server denial,
  another actor's Library privacy, a stale-version conflict retaining the raw
  draft, invalid DOI, and a real controlled-provider HTTP failure.
- Valid source generation for every declared form type, including school,
  institution, and location metadata.

The external provider is a controlled Crossref-shaped loopback fixture.
Its success proves the native consumer contract, not live Crossref access,
vendor health, credentials, or exhaustive retrieval. Provider-generated
publication DTOs do not acquire invented journal/date fields; absent fields
remain absent. ReadCube/private contracts, Mendeley groups, commercial account
eligibility, and live-provider prerequisites remain outside this native slice.

Existing independent-copy and provider-linked Library mutation behavior was
read from the actual catalogue/reference implementation and retained
`p1-core-catalog`, `p2u-tools`, and `p2x-references` receipts. It was not
reimplemented or promoted into a live-provider claim. Source key completion
and its preference gate were left in place.

Earlier failed/intermediate receipts remain retained and explained in
`docs/evidence/p10-library/README.md`. In particular, scripted arrow-key
positioning did not establish the required cursor, even after SourceTools
readiness. The final test uses a direct source-line click and asserts the
precondition. Those earlier failures do not prove a sole refresh root cause.
The earlier weaker presence-only roundtrip is not the final insertion receipt.

LSP returned clean results for the bibliography panel, helpers, and focused
tests. Final fresh LibraryPanel LSP requests timed out after 3 seconds; its
complete final code passed strict TypeScript and type-aware lint. No fresh
final LSP result is claimed for that file.

No broad suite, production build, or TeX bibliography compilation was run.
Final LaTeX/BibTeX/Biber formatting and arbitrary package/style configuration
remain distinct from this verified native source workflow.

## Owned files and integration

Source changes are limited to:

```text
apps/web/src/features/editor/tools/LibraryPanel.tsx
apps/web/src/features/editor/tools/BibliographyPanel.tsx
apps/web/src/features/editor/tools/ReferenceSearch.tsx
apps/web/src/features/editor/tools/library-metadata.ts
apps/web/src/features/editor/tools/library.css
```

Tests are isolated under `tests/ui-editor/library-p10/`; evidence is isolated
under `docs/evidence/p10-library/`. Existing component props and endpoint
contracts are unchanged. No backend or shared registration change was needed.
No shared tools CSS/actions/panel, SourceEditor, transport, visual media,
router, package/build script, feature matrix, original input, or other agent's
file was edited. No commit or push was made.

Final fixture root `/tmp/quire-assembly-0WAhEL`, all prior owned attempt roots,
API/web/provider listeners, and browser were closed/removed. All owned command
observers were stopped after terminal receipts. Unrelated listeners, roots,
and processes were left untouched. Nothing remains pending for this native
workflow.
