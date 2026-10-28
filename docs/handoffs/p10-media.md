# P10 native authoring media - FINAL

October 27, 2026. Media producer: `st_01a17f50`. Shared Source history seam
and stale Library regression follow-ups completed by the parent.

## Outcome

The elected A15/A16 native media flows are complete: existing project and saved
generated images, original-byte device upload, accessible cross-project images,
secure direct HTTPS image links, and single-image clipboard insertion in Source
and Visual beyond PNG-only input. Caption, label, width, `graphicx`, actual
project files, native persistence and representative compilation are verified.
Supported format and browser boundaries below are intentional.

## Delivered files and behavior

- `tools/FigurePanel.tsx`, new `tools/figure.css`: existing-project and saved
  generated images, original-byte device uploads, accessible cross-project
  links and real public direct HTTPS URL links through existing APIs. Caption,
  label, width and package insertion are retained. URL references are stored
  project paths, never remote TeX image URLs.
- `tools/insertion.ts`: optional selected-document guard after asynchronous
  package lookup; package scanning excludes comments, escaped examples and
  macro/group bodies while recognizing real `RequirePackage` declarations.
- `visual/media.ts`: safe paths, PNG/JPEG/PDF/PostScript signature matching,
  one-file clipboard selection and real browser rasterization of supported
  additional clipboard formats.
- `visual/upload.ts`: actual scoped multipart upload, live effective access,
  flush/branch revision, main-package checks, captured selection/source
  revision and stale-insertion rejection.
- `visual/VisualPanel.tsx`, `visual/Figure.tsx`: multi-format clipboard
  integration, guarded project-image insertion, explicit conversion boundary,
  cancellation and preview reset across asset identities.
- `source/SourcePanel.tsx`: real image-paste capture before CodeMirror's text
  handler, atomic image/package input transaction, cancellation on document
  change and ordinary source text copy/paste left with the native editor.
- `tests/ui-editor/media/**`: uniquely scoped native browser harness,
  meaningful media boundaries, real uploads/clipboard/links/compiles and
  stale-source/file-switch fences.

The parent-owned `source/editor.ts` seam isolates the actual **`input.paste`**
transaction before and after its update with the existing UndoManager. It does
not use the previously proposed custom `input.quire-media` name or expose a
second history manager. Package and image clipboard insertion remain one native
transaction, with exact preceding source restored by undo and insertion restored
by redo. Ordinary collaborative, Vim and Emacs history passed separately.

No transport/offline, bibliography/library/completion, shared tools
actions/styles/panel, workspace/PDF/chrome, router/package/contracts/backend
or feature-matrix changes were made by this media producer. The parent's
separate stale Library test follow-up is documented below. This child did not
edit the parent-owned Source/history/test follow-ups. No commit was created.

## Precise supported boundaries

See `docs/evidence/p10-media/README.md` for the full contract.

Device/project/link image inclusion supports PNG, JPEG and PDF with PDF
engines; EPS requires a compatible environment and was not independently
compiled here. Paths exclude traversal, absolute paths, spaces and TeX
metacharacters. Extensions must match PNG/JPEG/PDF/PostScript byte signatures.
Device bytes are not silently converted. Generated output must already be
saved as a project image; unsaved runtime or compiler output is not a separate
implicit import route.

Source and Visual accept one browser-delivered PNG, JPEG, GIF, WebP or BMP.
PNG preserves browser-delivered bytes; other accepted clipboard formats
rasterize explicitly to PNG, with first-frame/metadata/encoding loss. Limits:
20 MiB input and 40 million decoded pixels, plus actual server upload limits.
SVG and multi-image/file paste reject. Browser/OS clipboard exposure and
Chromium PNG sanitization remain explicit; arbitrary clipboard image copying,
crop/retouch, two-way remote links and shell-escape conversion are not offered.
PDF/EPS keep editable figure source; previews depend on browser image decoding.

Uploads that finish after a source edit retain the saved asset but do not
insert at stale offsets. Switching source documents cancels insertion.
Read-only/offline states reject, and server authority is never replaced.
Public URL tests require real public egress; private targets receive the
existing secure fetch rejection. Link refresh remains in Files.

## Completed evidence

All runs used project-local Bun **1.4.4**.

- Corrected native route/undo run: **1 pass, 0 fail, 40 assertions, 59.90 s**,
  exit 0 (`mon_PNS8N4Z4GT7NBSH3`). Fixed browser wall-clock reads with live
  timers, a genuine preceding keyboard comment inside the document body,
  native system clipboard paste, exact undo/redo and Source copying. Also real
  Source/Visual conversions, original device bytes, project/link routes and
  two actual compiles. Chained type-aware lint passed.
- Ordinary source history: **3 pass, 0 fail, 11 assertions, 52.36 s**, exit 0
  (`mon_QCPNEYNQGYC0X0G3`). Local undo preserves a remote edit; Vim and Emacs
  use the same collaborative history.
- Earlier native route run: **1 pass, 34 assertions**. Real Source PNG paste,
  Visual JPEG/WebP/GIF/BMP conversion, original PNG/JPEG device bytes, project
  image insertion, another-project linking, actual W3 HTTPS image linking and
  private-target HTTP 403. Retained as history, not a substitute for the
  corrected fixed-clock undo proof.
- Independent Source JPEG/fence run: **1 pass, 0 fail, 17 assertions, 43.80 s**.
  SVG rejection, successful upload held during source change and file switching
  preserve exact source. Responses are real and forwarded unchanged.
- Media/package units: **11 pass, 0 fail, 39 assertions**.
- Strict media and source TypeScript projects passed, exit 0
  (`mon_D8MGDN580R0BJNZY`); scoped type-aware lint passed.
- Earlier affected batch: **30 pass, 2 fail, 122 assertions**. All Visual
  parser/command/browser cases, native figure insertion, package units and real
  Viewer/Owner/Editor authority cases passed. Both historical failures were
  stale bibliography flows and have since been resolved by the parent:
  **4 pass, 0 fail, 32 assertions, 57.52 s**, exit 0, plus lint
  (`mon_JQH62JC6RZ4KZJZX`). Permission, version, link refresh and independent
  byte assertions were retained; no production Library change was needed.

The corrected native route run's two compile jobs succeeded with inserted
representative PNG/JPEG/PDF assets. Repeated/empty fixture labels produced
visible label/rerun warnings; these were not warning-free compiles and no
compiler error or warning was suppressed.

These are completed focused receipts combined with the retained independent
proofs, not a newly claimed broad-suite pass. The parent intentionally filtered
unrelated cases, and this child performed no behavior rerun after that handoff.

## Retained failures, captures and cleanup

The original fixed-clock undo failure and the initial incorrect custom-event
attempt remain in:

- `docs/evidence/p10-media/undo-red-abf91d49-1841-4ff4-839f-62cd231e1248.xml`
- `docs/evidence/p10-media/undo-fixed-73465200-2a84-45c5-84df-c65c4fdf319f.xml`

The corrected receipt and ordinary history report are
`parent-undo-result.txt`, `parent-source-history.txt`, `parent-undo-types.txt`,
`parent-undo.sha256`,
`undo-paste-fixed-443eaaee-89fe-4a18-bc1b-4370832614cb.xml` and
`source-history-492ec507-f5a2-4f29-81ea-7cd481b37d47.xml`, all under
`docs/evidence/p10-media/`. The parent's closure is
`docs/handoffs/p10-source-undo.md`.

Exact historical bibliography stacks and their original transcript location
remain in `docs/evidence/p10-media/bibliography-failures.txt`. Passing follow-up
receipts are linked by `docs/handoffs/p10-library-regressions.md`; no historical
failure was erased.

The original producer desktop/narrow light/dark images are preserved. All eight
fresh parent images in
`docs/evidence/p10-media/undo-paste-fixed-1f511c78-b7e3-4f65-abcf-8b3eb73505e6/`
were inspected as well. Controls fit, the Visual toolbar wraps, and actual
previews render. The narrow light Figure capture includes a fixture-toolbar
crop at its top edge; the original scoped capture preserves the unobstructed
complete panel. Details are in `docs/evidence/p10-media/verification.md`.

Native fixtures disposed their roots, transports, browser contexts, listeners
and applications. The producer's last source-fence root
`/tmp/quire-ui-editor-jrMb0N` was removed and both listeners closed. The corrected
parent run removed `/tmp/quire-ui-editor-qesMqk`, closed
`127.0.0.1:46805` and `127.0.0.1:44671`, and disconnected its browser.
The parent independently confirmed all five exact undo/history probe roots
absent (`PooJ2I`, `ZnisRU`, `qesMqk`, `ulZK1e`, `TEI2AG`, under
`/tmp/quire-ui-editor-`) and both Library follow-up roots absent (`hACRfz`,
`j7SkYP`). The unsuccessful auxiliary offline browser probe and this child's
parent/file wait subscriptions were explicitly closed. Final documentation
started no new behavioral run or resource.

No elected media behavior or acceptance item remains deferred. EPS compilation,
unsupported clipboard types and broader media editing remain the explicit
boundaries above, not claimed features.
