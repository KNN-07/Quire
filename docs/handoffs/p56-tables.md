# P56 tables - FINAL

## Result

A13's missing supported visual-table-to-real-compile chain is closed for plain two-column `tabular` tables. The actual authenticated native application inserted a table with its Visual **Table** button, edited its cells and supported column alignment, accepted a controlled rectangular TSV paste, switched to Source and changed a table value, saved and reloaded the exact source, and compiled that revision with the real sandboxed TeX toolchain. The genuine published PDF contains the expected values.

No production/shared fixture source was edited. No commit, new dependency, fake provider/compiler outcome, accepted-suite replay, or global build was performed. The parent retains the production-fix/global-build responsibility.

Working directory: `/home/norman/Repos/Quire`. Repository HEAD observed before and after this work: `17a8dd43e2f6662dad590de746339d24fe6181d4`. This is a shared dirty worktree, not a clean-HEAD-only verification.

## Final receipt

Final evidence directory:

`docs/evidence/p56-tables/runs/6b0c98fc-8934-48b1-a0bb-f5fca4091a0d/`

The exact final test ran from `2026-10-28T18:33:08.621Z` to owned cleanup at `2026-10-28T18:34:21.920Z`.

| Item | Actual result |
| --- | --- |
| Runtime | Repository-pinned Bun `1.4.4`, executable `node_modules/.bun/bun@1.4.4/node_modules/bun/bin/bun.exe` |
| Native web / API | `http://127.0.0.1:32849` / `http://127.0.0.1:35983` |
| Project / file | Seeded native project `00000000-0000-4000-8000-000000000020`, `main.tex` file `00000000-0000-4000-8000-000000000101` |
| Durable source | Revision `9`, epoch `0`, 265 bytes |
| Source SHA-256/blob | `6163db02c51139bb36c9f31efbbfe6c7b548d267637ef61f77365cf974039f21` |
| Immutable compile snapshot | `ebccbead-6cc1-438f-b0bb-b3a4bc695ba2`, revision `9`, tree `sha1:ff1cc913b3093a9ef65cfcd6a46f9b76db445381` |
| Successful job | `c0775b44-feca-420e-9089-a6e15b42ed71`, queued `18:34:04.394Z`, finished `18:34:05.394Z`, no diagnostics |
| Published PDF artifact | `d4c20c1d-365b-467b-9717-ee9850957e6c`, HTTP `200`, `application/pdf`, non-partial |
| PDF | `table-output.pdf`, 17,937 bytes, one Letter page |
| PDF SHA-256 | `c0b7c365a0aebbeb076e3eb350ccf7a92b2b766283e79538de42368bcaee6ad6` |
| Final test | `1 pass`, `0 fail`, `33 expect() calls`, exit `0` |
| Scoped strict TypeScript | Exit `0` |
| Scoped type-aware lint | Exit `0`, no warnings |
| PDF extraction / page rendering | Both exit `0`; all one page rendered and visually inspected |

`actions.json` retains the actual saved events, source revisions and bytes after each action, reloaded document, successful job event, complete preview/snapshot metadata, artifact response headers/hash, capture outcomes, UTC times, and disposal receipt. `docs/evidence/p56-tables/test-run.log` retains the actual API method/status/URL log and raw Bun output. This is an actual application/real compiler test, not the isolated Visual harness.

## Supported producer path and actions

Inspection reused `tests/ui-editor/visual/browser.test.ts` and `parser.test.ts`; the implementation uses the native fixture/event/browser helpers from `tests/ui-editor/shared` and `tests/ui-editor/assembly/actual-browser.ts`.

Supported production controls are in:

- `apps/web/src/features/editor/visual/VisualPanel.tsx:100`: tab-delimited `text/plain` paste invokes the real rectangular TSV producer.
- `apps/web/src/features/editor/visual/VisualPanel.tsx:116`: the **Table** button creates a simple two-column table.
- `apps/web/src/features/editor/visual/Nodes.tsx:80`: simple tables expose per-cell fields and supported column alignment.
- `apps/web/src/features/editor/visual/structures.ts:8`: interpretation is deliberately limited to simple `l/c/r` tabular shapes.

The final test:

1. Retains the original seeded `main.tex` in `original-input.tex`, then prepares a small document through the actual mounted Source editor in this owned ephemeral project.
2. Selects a body paragraph in Visual and clicks **Table**.
3. Changes the four cells to `Region`, `Score`, `North`, `42`, then changes alignment to `lr`.
4. Pastes the retained `controlled-input.tsv` through the actual bubbling clipboard event path, producing `Item / Count`, `Apples / 17`, and `Intentionally empty / [empty]`.
5. Switches to Source and changes `North & 42` to `North & 84` through mounted CodeMirror keyboard input.
6. Receives saved revision `9`, reloads, and checks byte-for-byte equality of the native document response.
7. Clicks the real **Recompile** button, observes the successful job and rendered PDF canvas, retains the artifact response/PDF and genuine compiler logs, and checks that preview snapshot revision equals the saved revision.
8. Extracts PDF text and checks all table labels/values and absence of the superseded `42`.

Save/job subscriptions are registered before their triggering action. DOM signals use the existing bounded MutationObserver helper. There are no fixed sleeps or polling delays in the new test.

## PDF and visual inspection

The retained `build.log` identifies the actual transient systemd compile unit, Latexmk 4.87, pdfTeX 1.40.28 / TeX Live 2025, and the actual `pdflatex ... /src/main.tex` invocation. It reports one output page and `status=0/SUCCESS`.

`pdfinfo.txt` confirms one page. `pdf-page-1.png` is the complete rendered page and was opened and visually inspected. Both table shapes and all non-empty cells are present: `Region`, `Score`, `North`, `84`, `Item`, `Count`, `Apples`, `17`, and `Intentionally empty`. The empty count beside `Intentionally empty` is intentional: the TSV has a trailing tab in that row, the Visual cell value is asserted to be empty, the source retains `Intentionally empty &`, and the PDF correctly leaves the corresponding count empty. It is not missing output.

All 16 final screenshots were opened and inspected: `visual-*`, `tsv-controls-*`, `source-*`, and `pdf-*`, each at `1440` and `390` in `light` and `dark`. Table insertion/format controls, editable cells, alignment controls, Source syntax, and real PDF.js output are present without page-level horizontal overflow. The mobile Visual document has its normal scroll owner; the separate TSV-controls capture shows its final row and intentional empty cell. The mobile fit-width PDF has small text as expected for a full Letter page; the complete independent page render provides readable inspection of every value.

The desktop Visual captures were taken while the secondary PDF pane was initially rendering; the separate `pdf-*` captures explicitly wait for the correct artifact's rendered canvas and show the actual output.

## Literal verification commands and exits

All commands used cwd `/home/norman/Repos/Quire`. Repository `node_modules/.bin` was first in PATH; port 5173 was never used.

```sh
PATH="$PWD/node_modules/.bin:$PATH" ./node_modules/.bin/bun test tests/ui-product/table-composition/native-table.test.ts
# P56_TEST_EXIT=0

PATH="$PWD/node_modules/.bin:$PATH" ./node_modules/.bin/tsc --noEmit -p tests/ui-product/table-composition/tsconfig.json
# P56_TSC_EXIT=0

PATH="$PWD/node_modules/.bin:$PATH" ./node_modules/.bin/oxlint --type-aware --deny-warnings tests/ui-product/table-composition
# P56_LINT_EXIT=0

pdftotext -layout docs/evidence/p56-tables/runs/6b0c98fc-8934-48b1-a0bb-f5fca4091a0d/table-output.pdf -
# exit 0; retained as pdf-text.txt by the test

pdfinfo docs/evidence/p56-tables/runs/6b0c98fc-8934-48b1-a0bb-f5fca4091a0d/table-output.pdf
# P56_PDFINFO_EXIT=0

pdftoppm -png -r 110 docs/evidence/p56-tables/runs/6b0c98fc-8934-48b1-a0bb-f5fca4091a0d/table-output.pdf docs/evidence/p56-tables/runs/6b0c98fc-8934-48b1-a0bb-f5fca4091a0d/pdf-page
# P56_PDF_RENDER_EXIT=0
```

Raw command output/exits are retained in root `test-run.log`, `tsc.log`, `lint.log`, `test-exit.txt`, `tsc-exit.txt`, `lint-exit.txt`, and final-run `pdf-render-exits.txt`. File modification receipts put final lint completion at `18:33:10Z`, TypeScript at `18:33:19Z`, and Bun at `18:34:21Z`.

The language-server check on the initial test found no errors; its later refresh timed out after 3 seconds. The required definitive scoped strict `tsc` run completed with exit `0`.

## Source stability and scope

Final-run `inputs-pre.json` and `inputs-post.json` retain exact SHA-256 hashes for the table producers, editor assembly/source/PDF/compiler integration, shared fixture/server, and new test. The two files compare equal (`P56_HASH_COMPARISON_EXIT=0`), including the concurrent-owner editor assembly input. This is only a statement about the listed inputs during the final run, not invented stability of the entire shared worktree.

New test source hash: `141817fb4d778bf3780b58821405ff596a25d0a56e0e88518fc27658a3725bae`.

Writes are limited to `tests/ui-product/table-composition/`, `docs/evidence/p56-tables/`, and this handoff. No P54-owned files or shared fixture sources were edited.

The initial harness failure and artifacts are retained under `docs/evidence/p56-tables/attempt-1/`, including `recovery.md`. That first attempt also produced a real successful PDF, but its desktop-to-mobile resize kept an already-open Assistant as a modal drawer and its unjoined signal rejection interrupted disposal. Fresh authenticated viewport contexts and immediately joined trigger/signal promises corrected the test setup. This does not claim arbitrary complex-table parity or a table product defect.

## Exact owned cleanup

The successful final fixture disposed authenticated browser contexts, Chromium, native application/API, Vite, and `/tmp/quire-ui-editor-TeG2jF`. Its UTC cleanup event records `rootRemoved: true`; a later explicit directory check returned `P56_FINAL_ROOT_REMOVED=0` and exact owned-path process lookup returned `P56_OWNED_PROCESS_MATCH_EXIT=1` (no matches).

The exact final compiler unit `quire-compile-c0775b44-feca-420e-9089-a6e15b42ed71.service` and attempt-1 unit `quire-compile-a50ddea3-f5e5-49fd-b25c-f27cd70a62a7.service` both returned `LoadState=not-found`, `ActiveState=inactive`, `SubState=dead` with `systemctl --user show` exit `0`.

Attempt-1's interrupted disposal left owned Vite PID `2944730` and `/tmp/quire-ui-editor-NQ6C3T`; those exact resources were removed with exit `0`, as retained in `attempt-1/recovery.md`. No unrelated origin/process/storage was cleaned. All retained evidence remains available.
