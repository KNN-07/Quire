# P56 Symbols: FINAL

The missing A11 native two-mode composition evidence is closed for one
declared package-requiring symbol, `\triangleq` with `amssymb`. The actual
assembled editor passed four cases: 1440 x 900 and 390 x 844, each in light
and dark mode. No product defect was observed and no production file was
edited.

## Verification

Final execution: `2026-10-28T18:34:32.769Z` to
`2026-10-28T18:35:47.033Z`, cwd `/home/norman/Repos/Quire`, repository Bun
1.4.4, with `node_modules/.bin` first in `PATH`.

| Required evidence | Result and retained artifact |
| --- | --- |
| Inspect actual SymbolsPanel and authoring ports | `SymbolsPanel.tsx`, `symbols.ts`, `insertion.ts`, Source `editor.ts`, Visual `VisualPanel.tsx` and `Nodes.tsx` were read. The test reuses `tests/ui-editor/shared` actual native application/browser/document/event fixtures and `assembly/actual-browser.ts` DOM signals. |
| Search a declared package-requiring symbol | Actual Symbols search input receives `triangleq`; exactly one enabled native insertion button is found. Catalog metadata asserts `amssymb`; actual hint/title is logged as `P56_SEARCH` and visible in search captures. No explanatory prose is pinned. |
| Source and Visual native insertion | Real keyboard selection replaces `S` inside `$S$` in CodeMirror. Then the real Visual layout selects `V` at offsets 1..2 inside `$V$` in supported simple `tabular{lc}` Row 1 column 1. Actual Symbols buttons invoke the mounted handles. |
| Exact TeX, package, persistence, no duplicate/unsupported edit | Full independent document API values equal the expected source after each insertion. One `\usepackage{amssymb}` and two `\triangleq` occurrences remain after Visual. Full document API responses after reload equal the expected Source and final Visual results. The Visual native cell value also equals `$\triangleq$`. |
| Scoped new Bun target | 4 pass, 0 fail, 56 assertions, exit 0. |
| Strict scoped TypeScript | `tsc --noEmit -p tests/ui-product/symbol-modes/tsconfig.json`, exit 0. |
| Scoped type-aware lint, zero warnings | `oxlint --type-aware --deny-warnings tests/ui-product/symbol-modes/workflow.test.ts`, exit 0. |

Literal commands are in `docs/evidence/p56-symbols/commands.md`. Raw shell
exits, runtime, UTC timestamps, nine relevant pre/post SHA-256 inputs,
action/selection records, actual API request/status logs, exact source
responses, revision values and cleanup receipts are in
`docs/evidence/p56-symbols/final-run.log`. The isolated workflow output is
`workflow-final.log`; the successful static tools emitted no diagnostics
(`tsc-final.log`, `lint-final.log`), with their exit statuses retained in
`final-run.log`.

All nine sampled final-run hashes match before and after, including the
concurrently owned editor `index.tsx`. This is evidence for those inputs
during this run, not a claim that the wider shared worktree was stable.
The final scoped LSP diagnostics request timed out after 3000 ms; the actual
scoped strict TypeScript and type-aware lint commands completed successfully.

## Exact final source

```tex
\documentclass{article}
\usepackage{amssymb}
\begin{document}
$\triangleq$
\begin{tabular}{lc}
$\triangleq$ & Value \\
\end{tabular}
\end{document}
```

The Source-only intermediate differs only in the table cell, which remains
`$V$`. Each case starts with no `amssymb` package and both original markers;
the first insertion adds the package, and Visual reuses it without duplication.
Original temporary fixture document values are retained as
`P56_ORIGINAL_OWNED_INPUT` before replacement.

## Capture inspection

Twenty final captures are under `docs/evidence/p56-symbols/final/`, five per
viewport/theme case: `source-search`, `source-inserted`, `visual-search`,
`visual-inserted`, and `persisted-source`.

The four search, four Visual-inserted, and four persisted-Source captures
were opened and visually inspected. They show the actual search controls,
package hint, native Visual table cell containing `$\triangleq$`, and
reloaded Source with both symbols and exactly one package declaration.
Mobile tool drawers are closed through the real `Close dialog` button
before authoring/persistence captures. The mobile Visual document body is
scrollable; the inserted table value and formatting controls remain visible.
No blank principal surface or obstructing drawer remained in those captures.

No compilation was requested or simulated. The visible uncompiled PDF pane
is the real application's state; these receipts prove insertion and source
persistence, not compiler/package installation or arbitrary macro rendering.
Only the supported math and simple-table boundaries in this workflow are
claimed. Existing macro, complex-table and other package limitations remain.

## Harness history and cleanup

Original `workflow.log` and root PNGs retain the first harness failures:
the first document-save event preceded the package's second save, and the
mobile action targeted a desktop-only rail. `workflow-verified.log` and
`verified/` preserve the next run, which proved both desktop modes but used
`Close` instead of the actual modal label `Close dialog` on mobile.
Final corrections use a real saved-state mutation signal and the real mobile
Files > Editor tool > Symbols route. No sleeps, polling, fake compiler/provider
results, dependencies, shared-fixture edits, or weakened assertions were added.

`docs/evidence/p56-symbols/cleanup.md` records exact owned cleanup for all
three runs: all temporary roots absent and all six exact owned listener
ports refusing connections. Final native app root was
`/tmp/quire-ui-editor-NETUm8`; web/API origins used ports 38943/39323.
No resource on 5173 was used. No commits were created. P53/global checks
were not replayed; final global build remains with the parent.
