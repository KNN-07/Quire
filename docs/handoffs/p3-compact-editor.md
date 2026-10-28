# Compact reference editor controls

Status: parent correction verified, October 27, 2026.

Direct comparison with `docs/evidence/design/01-editor.png` found two concrete
assembly defects despite passing functional tests: PDF controls consumed about
450 pixels before the paper, and duplicate file controls displaced the tree.
The original assembly receipt remains valid for its recorded functional input,
not an assertion that those proportions matched the reference.

## Changes

- `PdfPanel` accepts optional `presentation="embedded"`; standalone remains
  unchanged. Real settings, cache clearing and viewer choice live in an anchored
  PDF options disclosure. Escape closes it and returns summary focus.
- Successful current-build details remain in the live status region and root
  status bar. Failed/stale/offline/action notices stay visible.
- Compact viewer navigation retains page/count, zoom, presentation and download.
  Existing labeled icons and a short View control fit without horizontal clipping;
  touch controls retain 44-pixel targets.
- Compact Tools uses one chooser/actions header. Creation, uploads, selected-file
  rename/download/delete and link refresh remain real menu actions. Form/upload
  initiation closes the menu; Escape does not dismiss the surrounding mobile drawer.
- File rows now win the generic button centering rule and align to the leading
  edge. Tree and selected-file persistence behavior is unchanged.
- The header compile capture explicitly uses 1440x900 and waits for the returned
  artifact's rendered canvas. The prior 1280x720 loading image named 1440 is not
  accepted as a settled desktop capture.

## Recorded verification

These are affected runs, not one invented aggregate:

| Receipt | Result |
| --- | --- |
| `bash_184` | Five actual header/settings/PDF and desktop/mobile layout cases passed. |
| `bash_185` | Two desktop passes, two mobile failures exposed unprevented native dialog Escape. Retained as failure. |
| `bash_186` | Corrected Escape: all four file workflows passed; scoped lint and full TypeScript exit 0. |
| `bash_187` | Seven cases passed: actual file/folder uploads, header compile, touch/DPR-3 layouts and compact file workflows; lint/types exit 0. |
| `bash_188` | Final navigation fit: three header/touch layout cases passed; lint/types exit 0. |
| `bash_189` | Final leading-edge alignment and menu/persistence: four desktop/touch cases passed; lint exit 0. |
| `bash_190` | Production web/API/repository/compiler build exit 0. Existing large-chunk warning retained, main entry approximately 1.85 MB minified. |

LSP freshness timed out on several changed files; actual TypeScript and
type-aware lint receipts above are the successful static evidence, not those
timeouts.

## Captures and cleanup

Under `tests/ui-editor/assembly/evidence/`:

- Final PDF/navigation: `runs/2f69271f-e773-4327-90a7-d958e49cb763/`.
  Desktop settled PDF and true-mobile dark PDF were opened and inspected.
- Final tree/menu: `files/9dbe79a0-82c5-4612-b906-b4880c3ed603/`.
  All eight closed/open desktop/mobile light/dark captures were inspected.
- Actual compact upload acceptance remains in the tools producer evidence,
  refreshed by the affected `bash_187` selection.

The eight exact parent-owned fixture roots from these runs were confirmed absent:
`KLccYM`, `BCsB14`, `5MHcvg`, `8yJM6C`, `paReuV`, `8tyTnq`, `AwFKdS`,
and `SHbk5A`, each under `/tmp/quire-ui-editor-`. Terminal receipts record awaited
browser/application disposal, including the failed mobile run.

This closes the specific compact-control correction. Independent whole-product
browser acceptance and the separately occupied localhost:5173 requirement remain
open. No original input, production rate limit, permission rule or external
provider result was changed.
