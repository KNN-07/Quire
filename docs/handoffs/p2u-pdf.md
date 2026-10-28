# PDF slice handoff

October 27, 2026. Final owned combined acceptance is **verified**:
15 passed, zero failed, 120 assertions, terminal exit 0 on local Bun 1.4.4.
The parent-authorized replacement run has durable raw output and an exit
receipt. Captures were inspected and all four owned fixtures were cleaned.

## Integration

The public entry is `apps/web/src/features/editor/pdf/index.ts`.
`PdfPanel` accepts the shared panel props plus controlled `view`,
`sourceLocation`, and `onViewer` options. The assembler receives:

```ts
type PdfPanelHandle = {
  readonly reveal: (location: PdfLocation) => void;
  readonly forward: (location: SourceLocation) => Promise<void>;
  readonly recompile: () => Promise<CompileJob>;
};
```

Use `handle.recompile()` for the root header. It reads live local settings
and the current controller, then takes the same current-document flush
path as the panel button. Do not copy workspace settings into that action.
The shared `CompileController` assistant port is unchanged.
`onViewer(null)` clears the assembly handle on cleanup.

`PdfLayoutControls` exposes controlled layout callbacks; the assembler owns
pane geometry. Source reveal/navigation is delivered through shared typed
callbacks. This slice does not claim full assembled-editor caret/layout QA.

## Implemented behavior

- Durable manual and automatic compilation, current acknowledged revision,
  Draft/Stop-first-error settings, cancellation, and generated-cache clearing
  while preserving source and uploaded binary assets.
- Discovery and retention of the last successful PDF after an invalid draft,
  including a fresh panel reload and exact invalid-source readback.
- Actual PDF.js page rendering, pagination, zoom, presentation, downloads,
  native-browser viewer choice, and bidirectional typed SyncTeX.
- Diagnostic filters, file/line source callbacks, and byte-exact raw logs.
- Historical side-by-side and overlay rendered comparisons, change-region
  imagery and actual diff PDF downloads without replacing ordinary preview.
- Scoped SSE credentials, boundary parsing/project filtering and disposal.

The owned design/integration notes are in `pdf/DESIGN.md`. No sibling
implementation, root dependency, original design archive, or git commit was
changed by this producer.

## Verified combined acceptance

Project-local runtime: Bun 1.4.4, revision `38afee6c8`. The final command was:

```sh
QUIRE_TEST_CHROMIUM=/home/norman/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome node_modules/.bin/bun run test tests/ui-editor/pdf
```

Terminal `bash_12` exited 0: **15 passes, zero failures, 120 assertions
across five files in 124.66 seconds**. This is one combined run, including
12 real browser cases and three scoped HTTP/SSE cases.

Durable evidence under `tests/ui-editor/pdf/evidence/`:

- `combined-final-1.4.4.log`: full stdout/stderr and
  `PDF_COMBINED_EXIT_CODE=0`.
- `combined-final-exit.json`: independent machine-readable exit code 0.
- `final-run-receipt.txt`: current acceptance, visual inspection and cleanup,
  followed by the superseded lost-receipt history.

Native readiness checks the actual Chromium PDF extension frame, not the
outer iframe's early load event. Earlier strict TypeScript, type-aware
deny-warnings lint and the 25-file draft guard passed; the parent's current
restore/types/lint green stands. Scoped whitespace validation passed again.
No source or test implementation changed for this replacement run.

The parent's accepted assembler matrix 35/35, Files 4/4, exact-source,
ErrorFix accepted recompile, retrieval/source navigation and genuine
pending-source epoch recovery checks stand and were not repeated.

## Retained required evidence

All paths below are under `tests/ui-editor/pdf/evidence/`.

- `header-settings-http.json`: real HTTP 202, then successful job
  `3820ba3d-151c-42ac-8fb7-54d9279e9c70`, acknowledged revision 2,
  persisted `draft=true` and `stopOnFirstError=true`. The typed handle was
  retained before toggles and invoked after an edit without a test-side
  flush. DevTools request metadata is null; stored settings, returned job
  and source revision establish propagation, not an invented request body.
- `browser-viewer-1440.png` and `browser-viewer-390.png`: refreshed native
  Chromium toolbar and rendered known PDF text, refreshed by the passing
  combined run and visually inspected. Mobile is 390 CSS pixels at DPR 3.
- `viewer-*`, `invalid-logs-*`, `failed-reloaded-*`, and `diff-*` capture
  desktop/mobile light/dark views with end-of-scroll and scroll-owner JSON.
- `invalid-source-http-*`, `failed-preview-http-*`, `synctex-*`,
  comparison HTTP receipts and `raw-log-*` retain endpoint/byte evidence.
- `valid-output-1440.pdf`: actual two-page compiler output.
  `diff-side-by-side-1440.pdf` and `diff-overlay-390.pdf`: actual one-page
  comparisons. Final `pdfinfo`/`pdftotext` inspection exited 0 and found
  both Result 42/Result 43 and the moved paragraph in the comparisons.

## Cleanup

The combined log records completed disposal for all four fixtures.
Their exact temporary roots are absent:
`OormaZ`, `Rflokg`, `EQfLMJ`, `r0iDEQ` under `/tmp/quire-ui-editor-`.
Their eight listeners are closed:
37601/33313, 35737/39057, 40177/46557, 45621/33637.
Cleanup verification exited 0. No unrelated process or resource was stopped.

The earlier lost `bash_23` receipt remains historical; the authorized
replacement closes that missing gate. No pending run or producer failure
remains. The bounded verified handoff is complete.
