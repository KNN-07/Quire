# Source authoring handoff

Status: the assigned source lane is complete. The previously failing actual
browser paths pass on the parent's corrected admission implementation. This is
source acceptance, not whole-transport or whole-product acceptance; the
parent-owned cursor-presence throttle test was not changed or masked.

## Integration

Import `SourcePanel` from `apps/web/src/features/editor/source`. Its public
interface remains the frozen `SourcePanelProps` in `features/editor/shared`.
Supply the injected client, shared `EditorDocument`, actual preferences,
selection callbacks, compiler diagnostic DTOs and navigation ports.

The panel owns its CodeMirror view, per-document collaborative undo manager and
subscriptions. It does not own or dispose the shared document or transport, add
another save indicator, or create another persistence path. All editing goes
through the shared Y.Text and acknowledged transport. Root assembly still owns
the outer workspace, tree, compile button and PDF surface.

The implementation provides:

- TeX syntax, commands, environments, package hints, actual project label/citation
  completion and nested current-file outline.
- Case-sensitive, regex, whole-word and mapped-selection find/replace.
- Inline/display math, bold/italic, comments and keyboard help, including the
  Mac completion alternative.
- Distinct heuristic Code Check with session/file/region suppression, genuine
  compiler diagnostics and source-linked navigation. Suppression does not hide
  compiler diagnostics.
- Vim/Emacs bindings with collaborative undo; persisted theme, font family,
  10-24 px font size, line height and independent interface-language controls.
- Browser nspell using fetched same-origin aff/dic assets, selected US English,
  British English or Vietnamese vocabulary, and persisted personal words.
  Browser/OS spellcheck is disabled. Dictionary package modules are never
  imported into the browser.

Chinese spelling is explicitly unavailable in the root asset manifest and is
reported as such, without English substitution. The English/Vietnamese/Chinese
interface catalog remains independent, with English fallback for untranslated
controls. Dictionary license links use the actual bundled notices.

Unknown source, CRLF bytes and non-BMP text are preserved rather than parsed and
regenerated. TeX spelling masks comments, verbatim, math, command names and
technical arguments; Code Check is identified as heuristic, not compilation.

## Verification receipts

All commands used native repository Bun 1.3.14 and the real shared same-origin
application/browser fixture. No service methods, persistence ports or compiler
results were substituted.

| Receipt | Result |
| --- | --- |
| `bash_31`: authoring and real bundled dictionary unit tests | 12 passed, 0 failed, 26 assertions |
| `bash_32`: earlier complete source baseline | 22 passed, 0 failed, 93 assertions |
| `bash_37`: expanded preference/dictionary availability browser tests | 2 passed, 0 failed, 50 assertions |
| `bash_38`: affected real-service source browser file, after the parent admission receipt | 5 passed, 0 failed, 28 assertions; exit 0 |
| `bash_40`: current strict source consumer TypeScript, type-aware lint and draft guard | exit 0; guard clean across 22 files |

The earlier expanded pre-fix run (`bash_33`) timed out in the mobile path and
cascaded after Bun killed dangling fixture processes. That run is not presented
as a pass. Its affected browser file was rerun on corrected input in `bash_38`;
already-passed unrelated suites were not repeated. No aggregate 23-test
single-run result or whole-transport pass is claimed.

The final affected browser command was:

```sh
bun test tests/ui-editor/source/browser.test.ts
```

It proved source-byte persistence and reload at both 1440x900 and 390x844,
independent collaborator convergence with local undo preserving the remote
edit, ordinary incomplete-main-command persistence, and navigation from a real
failed compiler job while heuristic Code Check was disabled.

The final compiler job was `884b60a1-979a-4f03-88bd-6fa1df41f2ca`. Its actual
error linked `main.tex:3`; activating that diagnostic selected UTF-16 offset 41
in the source view. No manufactured diagnostic or PDF was used.

The dictionary availability tests switched through unavailable Chinese and
working Vietnamese using acknowledged preference PATCHes and bounded DOM
mutation subscriptions. They also exercised independent en/vi/zh profile
language changes, custom words, and real typography after reload: 18 px / 36 px
at desktop and 24 px / 48 px on mobile, with Source Serif and dark theme.

The strict target compiles actual application fixture imports together with
canonical `packages/runtime/src/assets.d.ts`. No producer-local unknown text
module casts remain. Reproduction commands are in
`tests/ui-editor/source/README.md`.

## Visual evidence

Captures are retained in `tests/ui-editor/source/evidence/`. Desktop and mobile
light/dark source captures, their scrolled-end variants, outline navigation,
en/vi/zh preferences, dictionary availability and persisted typography captures
are included. The final actual compiler-linked capture is
`source-diagnostic-1440.png`.

Fresh desktop source, mobile dark scrolled-end, actual compiler navigation,
Chinese interface and dictionary availability captures were inspected. Source
remains visible, controls wrap on mobile, no document-level horizontal overflow
was measured, and the mobile source scroller reaches the final source lines.
The utility pane has its own scroll owner. Assembly owns final workspace
geometry.

## Resource closure

The final browser fixture closed its contexts, source views, transport
subscriptions, compiler worker, servers and temporary data through the shared
disposable lifecycle. Its web/API listeners at ports 41359 and 37071 subsequently
returned `ECONNREFUSED`. The owned temporary root
`/tmp/quire-ui-editor-i1Gvj5` was confirmed removed.

The preference and isolated diagnostic roots
`/tmp/quire-ui-editor-zRR1D2` and `/tmp/quire-ui-editor-va2zga` were also confirmed
removed. The failed run's retained owned root
`/tmp/quire-ui-editor-R9vKZm` and obsolete failure capture were removed after
checking that its owned processes were gone. The dependency watch was stopped.
No commits, sibling edits, transport-test weakening or unrelated process
termination were performed.
