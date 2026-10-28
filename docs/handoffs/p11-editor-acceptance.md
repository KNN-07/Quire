# Parent native editor acceptance: FINAL scoped packet

October 27, 2026. This closes the recovered functional scenario and inspected
route/layout follow-up. It is not whole-product acceptance or literal
localhost:5173 verification.

## Functional result

The child's earlier `bash_15` terminal receipt expired and its functional
artifact was missing. No matching process remained. That run remains unknown,
not retroactively passed or failed.

The parent corrected the verifier: its invalid draft now retains the already
persisted collaborator text, and project search uses a token in the current
draft and waits for both the actual search response and rendered results.
Production search behavior was not changed.

`mon_69DD1RXCAV4MJB8C` passed the one missing scenario on Bun 1.4.4:
1 passed, 12 assertions, 71.64 seconds. It exercises source reload, two actual
sessions, valid/invalid compilation, retained successful PDF, linked diagnostics,
project search, bibliography/settings mounting, comments, history restore and
Viewer source/Git read-only state. The resulting native document has revision 4,
epoch 1, 181 bytes, and both invalid-source and collaborator markers preserved.

Durable report:
`docs/evidence/p2u/runtime/native-parent-79686ce7-5469-4ceb-a853-d2698bf17f76.xml`.
Observation: `docs/evidence/p2u/runtime/functional-observations.json`.
The report explicitly filters the already-evidenced creation/import/export
case; it does not claim two new passing cases. Its retained project-flow
artifact and native source ZIP remain under `docs/evidence/p2u/runtime/`.
The affected existing bibliography copy/settings mutation checks subsequently
passed separately in `p10-library-regressions.md`.

## Visual result and correction

The selected final matrix has all seven routes at CSS widths 1440 and 390,
light/dark: **28 distinct cases, 68 selected images**. The narrow contexts use
touch/mobile emulation with device scale factor 3. Every selected image was
opened and inspected; byte-identical end frames reuse the same inspection.

`docs/evidence/p11-editor-acceptance/index.json` records each case's actual
source packet, geometry and exact images. `captures.sha256` fingerprints them.
The accepted selection is disjoint:

- 16 unaffected cases retained from `visual-parent-974fd6aa-b404-42f0-b3f7-241eeba1af53`.
- 6 affected edit/comparison cases from
  `pdf-controls-fixed-76bc2e09-3181-4e71-8fb1-511a360db1a4`.
- 6 settled History/narrow-Logs cases from
  `history-log-settled-2f770265-536e-4c84-9d7b-09bfef58a40a`.

The original geometry-only matrix passed but image inspection found real
clipping: mobile options had scroll width 998 against client width 356, and a
comparison control ended at x=572 in a 390-wide viewport. Stacked options also
extended beyond their pane. A focused red run retained those failures.

Four workspace CSS selectors now apply nowrap only to the PDF viewer's compact
toolbar, not every PDF toolbar. Options, comparison controls and log filters
can wrap. Checks now cover actual control/popup bounds, horizontal menu content,
pane containment, stacked options and narrow Raw log access.

The six affected edit/comparison cases passed **68 assertions, 60.96 seconds**
in `mon_APC88ETBYHMDBAMN`. The six History/Logs cases passed **32 assertions,
67.75 seconds** in `mon_XCZ3SM6XCQSFV1QR`. History now waits for its comparison
content instead of capturing a loading spinner. Both chained test-file lint
commands passed. No CSS fix was made for the initially suspected hidden
comparison pane: actual browser use disproved that hypothesis.

Each selected packet's setup retains a real `native-preview.pdf` and
`compile-http.json` with queued/terminal HTTP bodies and artifact metadata.
The download must be HTTP 200, have a PDF signature, and exactly match the
recorded byte count and SHA-256. These are actual native compiler outputs.

## Input and cleanup boundaries

`original-inputs.sha256` matches both supplied originals. Read-only change
watches remain active until final cleanup. `end-of-packet-inputs.sha256` is
explicitly an end-of-packet fingerprint, not a fabricated before/after
measurement for all earlier runs. Later P10 workflow changes retain their own
scoped evidence; old screenshots are not relabeled as captures of new dialogs.

All six exact parent-owned roots were independently confirmed absent after
awaited disposal: `lrNmn3`, `LELp6r`, `civ1lo`, `YfI87E`, `prUXle`, `E9L9sS`,
each under `/tmp/quire-ui-editor-`. Their terminal/JUnit records retain actual
origins. The lost child run's exact resource identifiers were not retained;
that limitation remains separate from this parent cleanup receipt.

The literal requested origin is still owned by unrelated FastShort
(`127.0.0.1:5173`, PID 1143097). It was not interrupted or silently substituted.
No full browser/accessibility certification, live external-provider result,
configured all-role installation, final global build or whole-task cleanup is
claimed here.
