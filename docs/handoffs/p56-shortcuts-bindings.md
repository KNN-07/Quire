# P56 shortcuts and binding isolation

FINAL, October 28, 2026. A08 native compile-key evidence and A09 two-user
binding-preference isolation pass in the bounded native Linux Chromium run.
Real macOS hardware/OS interception remains a platform boundary.

## Accepted native outcomes

The new target is `tests/ui-product/shortcuts-bindings/native.test.ts`.
It reuses the real application, login, browser, document and application-event
fixtures under `tests/ui-editor/shared` and bounded DOM signals from
`tests/ui-editor/assembly/actual-browser.ts`. No compiler/provider response,
editor instance or preference endpoint is substituted.

1. Control+Enter is pressed while the mounted `Source: main.tex` textbox has
   focus. Its logged browser event is trusted, has `ctrl=true`, `meta=false`
   and reports `Linux x86_64`. The native compile POST returns 202 with job
   `842770ef-37d6-4eaf-8877-876482cb0188`. Real application queued and succeeded
   events correlate to that exact job. Preview discovery and artifact fetch
   return the same job/PDF; PDF.js renders its real canvas.
2. Meta+Enter takes the same mounted path with `ctrl=false`, `meta=true` and a
   deliberately synthetic `navigator.platform=MacIntel`. The native POST
   returns 202 with job `0a5cfcdd-ac51-4edb-a867-3c1e584f2376`; queued/succeeded,
   preview/artifact correlation and PDF rendering pass again. This is Linux
   Chromium keyboard injection plus a synthetic platform value, not macOS
   browser or operating-system shortcut acceptance.
3. Independently authenticated browser contexts select and save bindings using
   the native Source actions / Source preferences controls. Kien
   (`00000000-0000-4000-8000-000000000001`, `kien@quire.local`) saves Vim at
   1440 x 900; Mai (`00000000-0000-4000-8000-000000000002`, `mai@quire.local`)
   saves Emacs at 390 x 844. Each PATCH response is parsed against the native
   contract. Kien's change leaves Mai's entire initial preference response
   unchanged; Mai's subsequent change leaves Kien's binding at Vim.
   Each context independently reloads, reopens native preferences, reads its
   own selected binding, and confirms its authenticated `/api/me` identity
   and `/api/me/preferences` value. Actual CodeMirror `cm-vimMode` /
   `cm-emacsMode` markers are observed before and after reload, with the
   other mode absent. Existing accepted emulation commands are not replayed.

Both real compile outputs are one-page, 90,004-byte PDF 1.7 files produced by
`pdfTeX-1.40.28`. The original seeded source is unchanged by either shortcut.
The seed intentionally includes an unresolved citation/empty bibliography;
its five warning diagnostics are retained in the real successful job logs.
No claim of a warning-free seed is made.

## Commands and receipts

All commands ran from `/home/norman/Repos/Quire` with
`PATH="$PWD/node_modules/.bin:$PATH"`, pinned Bun 1.4.4.

```sh
./node_modules/.bin/tsc --noEmit -p tests/ui-product/shortcuts-bindings/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings tests/ui-product/shortcuts-bindings/native.test.ts
./node_modules/.bin/bun test tests/ui-product/shortcuts-bindings/native.test.ts
```

`docs/evidence/p56-shortcuts-bindings/final.log` retains literal commands,
cwd, UTC bounds, raw outputs and exits: tsc 0, type-aware lint 0, browser
target 0; **3 pass, 0 fail, 50 assertions**, one target execution.
Monitor `mon_ZHA094GJNBMQX17E` completed exit 0. Combined final commands ran
18:28:26Z through 18:29:38Z; the browser target ran 18:28:38Z through
18:29:38Z (60.75 seconds).

The accepted generated evidence directory is:

`docs/evidence/p56-shortcuts-bindings/aab6186b-d059-4048-bd57-3f9522dada2e/`

- `receipts.json`: UTC native action/API responses, queued/running/succeeded
  job events, input hashes, actual key events, actor identities, persisted
  preferences, mounted mode classes and reopened control geometry.
- `linux-control.pdf`, `synthetic-mac-meta.pdf`: actual fetched artifacts.
- Matching compile PNGs: inspected real PDF.js pages in the assembled editor.
- `preferences-{1440,390}.png`: native save-control captures.
- `preferences-reloaded-{1440,390}.png`: inspected reopened Vim/Emacs controls.
  Both binding selects are visible and horizontally within their viewport.
  The mobile reload capture includes the transient document-connecting
  status; binding persistence and its actual mounted mode are independently
  established by native responses, selected value and mode marker.
- `../inspection-cleanup.log`: exact owned listener/root checks and PDF metadata.

All 14 recorded relevant source/fixture/test input hashes match before and
after the final run. The final test SHA-256 is
`4d3ffabbe64a254923e6e430615c69556172fcb03ed8591985f4d1bd887d47a8`;
the scoped tsconfig SHA-256 is
`1985ca01747fa66b7dbfd63e48717002306629ffc94c8c5ea64776c3b6deca19`.
This is scoped input stability, not an assertion that concurrent P54 or the
whole shared worktree was unchanged.

Earlier receipts are preserved: `test-01.log` and run directory
`e62e8fb5-3b51-41f0-ba2a-82948cc9df7a/` contain an initial passing native
run. `static-01-recovered.log` retains the first scoped tsc failure from two
test receipt fields using `email` instead of the contract's `primaryEmail`;
its lint passed. The original tee path was not created yet, so that
monitor-retained output is explicitly labeled recovered. Only those two
test logging fields changed before the passing final run. An LSP refresh
timed out; the actual scoped strict tsc command passed.

## Cleanup and boundary

The final owned web/API origins were `127.0.0.1:41159` /
`127.0.0.1:40139`, with `/tmp/quire-ui-editor-OGPc6c`.
The first run owned `127.0.0.1:33529` / `127.0.0.1:45873`, with
`/tmp/quire-ui-editor-8X2pDL`. Both fixture disposal receipts report root
removal and disconnected browsers. At 18:31:41Z all four exact origins
refused connections (curl raw exit 7), and both roots were absent.
Owned Vite/API/compiler/application/browser resources are closed; retained
evidence is intentional.

No product code, shared fixture, original input, P54-owned file or P55
correction was edited. No commit, dependency installation, unrelated-origin
operation, accepted-suite replay or production build was performed.
P53 remains a historical baseline; parent owns the final global build.
No reproducible product failure was found in this lane. A08/A09's missing
bounded behaviors are accepted; real macOS browser/OS interception is the
only shortcut-platform acceptance not established here.
