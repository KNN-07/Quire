# P56 authoring verification - FINAL

October 28, 2026. Independent audit of the three FINAL lane handoffs, actual
production/test/fixture source, raw native action and command receipts,
current source fingerprints, native screenshots, generated PDF bytes, and
owned cleanup.

**Verdict: PASS for the bounded observed P56 authoring outcomes. Real macOS
shortcut acceptance remains an unpassed platform gate. No reproducible
product defect was established in these lanes.** This is not universal
macro, table, clipboard, browser, or operating-system acceptance.

## Prioritized findings and remaining gates

1. **P1 platform gate: real macOS is not verified.** The Meta test runs on
   Linux Chromium with injected Meta+Enter and synthetic
   `navigator.platform="MacIntel"`. Its trusted browser event and genuine
   compile prove that application's injected-key path, not macOS keyboard,
   browser, or OS interception. `apps/web/src/features/editor/index.tsx:136`
   accepts either Ctrl or Meta; no platform branch is independently proved
   merely by spoofing the platform string. Retain a real macOS/browser run
   as the outstanding platform acceptance, not a product regression.
2. **P2 evidence indexing hazard: table root artifacts are historical.**
   `docs/evidence/p56-tables/test-run.log` records the successful final run,
   while root `actions.json`, `table-output.pdf`, and several root captures
   still belong to the earlier interrupted attempt. They must not be mixed
   into one execution. The FINAL table handoff correctly names the unique
   `runs/6b0c98fc-8934-48b1-a0bb-f5fca4091a0d/` directory; only that
   directory's source/job/PDF chain is accepted below. Earlier artifacts
   remain useful failure history, not current acceptance.
3. **P2 scope gates: supported inputs only.** Symbols establish one
   package-requiring command at Source math and a Visual simple-table cell;
   no symbol compilation was requested. Tables establish plain two-column
   `tabular` editing and a controlled bubbling `ClipboardEvent` with
   `DataTransfer`, not an actual OS clipboard transaction. Source inspection
   confirms deliberate simple-table limits in
   `apps/web/src/features/editor/visual/structures.ts:8`; complex shapes
   remain source islands. No arbitrary TeX macro, package-installation,
   complex-table, Safari/Firefox, or mobile-OS claim follows.

The five shortcut-seed diagnostics are expected retained warnings, including
the deliberately unresolved citation/empty bibliography. The table compile
has no diagnostics. Transient connecting/loading states in preference and
secondary PDF-pane screenshots are recorded truthfully and are not used as
proof of completed rendering or document readiness.

## Per-lane verdicts

| Lane | Verdict | Independently checked outcome |
| --- | --- | --- |
| Shortcuts / A08 | PASS, bounded Linux Chromium | Ctrl+Enter and synthetic-Mac Meta+Enter from the mounted Source textbox each create a real compile POST, matching queued/succeeded job, published artifact, and rendered PDF. Real macOS gate above remains unpassed. |
| Binding isolation / A09 | PASS | Two separately logged-in users in independent browser contexts persist Vim versus Emacs, leave the other account's preferences independent, reload, reopen native controls, and retain the matching actual CodeMirror mode. |
| Symbols / A11 | PASS | Actual Symbols search and insertion in both actual Source and Visual layouts, with exact source persistence, one package declaration, and no duplicate insertion, at both widths and themes. |
| Tables / A13 | PASS | Native Visual button/cell/alignment edits and controlled TSV paste, Source value edit, exact save/reload, real revision-correlated compile, genuine valid PDF, and all required responsive capture types. |

All three required handoffs were read and marked FINAL:
`p56-shortcuts-bindings.md`, `p56-symbols.md`, and `p56-tables.md`.
They were not replaced by test summaries or inferred from artifact existence.

### Shortcuts and independent preferences

Canonical evidence:
`docs/evidence/p56-shortcuts-bindings/aab6186b-d059-4048-bd57-3f9522dada2e/`.
`receipts.json` and `../final.log` retain actual native responses and events.

- Ctrl+Enter: HTTP 202, job `842770ef-37d6-4eaf-8877-876482cb0188`.
- Synthetic Meta+Enter: HTTP 202, job
  `0a5cfcdd-ac51-4edb-a867-3c1e584f2376`.
- Both job IDs match their own queued/succeeded events and preview response;
  fetched PDFs are HTTP 200 and render in the actual editor. The source stays
  at revision 0 with input SHA-256
  `392c2b10d1f883ac1a73ca0f77efe11c044a71a8e979877ca8df405d8b0f12ab`.
- Both retained PDFs are 90,004 bytes and SHA-256
  `86b24a45d9459c3eecb291f5b1ba7119efa69f75d69672329e518304dedc16e4`.
  Equal output bytes do not collapse two separately correlated compile jobs.

Source tracing confirms the window key listener calls the mounted viewer's
recompile handle; `pdf/panel.tsx` delegates to `PdfCompileController.compile`,
which flushes the real document and invokes `endpoints.compileCreate`.
The shared application fixture creates native services and the real seeded
application, and its Vite proxy forwards to an OS-assigned native API port.
No substituted compiler response or editor handle appears in the target.

Kien (`...0001`, `kien@quire.local`) and Mai (`...0002`, `mai@quire.local`)
authenticate separately through the real login endpoint; the inspected
helper consumes server-issued cookies/CSRF, not database-injected sessions.
Each actor has a separately created browser context. Kien saves Vim at
1440 x 900 and Mai saves Emacs at 390 x 844 through native preference
controls and successful PATCH responses. Mai's full initial preference value
is unchanged after Kien's save; Kien remains Vim after Mai's save. Each
actor's `/api/me` identity, preference GET, selected binding after reload,
and `cm-vimMode`/`cm-emacsMode` marker agree, with the other mode absent.
Existing accepted emulation-command tests were not replayed.

### Symbols in both actual authoring modes

Canonical evidence: `docs/evidence/p56-symbols/final/` and
`docs/evidence/p56-symbols/final-run.log`.

The actual Source layout selects `S` inside `$S$`; the native Symbols result
for `triangleq` replaces it and adds `\usepackage{amssymb}`. After reload,
the actual Visual layout selects `V` at offsets 1..2 in `$V$` in simple
`tabular{lc}` Row 1 column 1. The Symbols action uses the mounted Visual
authoring handle, rather than editing a hidden CodeMirror instance.
`SymbolsPanel.tsx`, `insertion.ts`, `VisualPanel.tsx`, and `Nodes.tsx` support
the retained action path.

Independent native document responses and reload responses show Source /
Visual revisions 3/4, 7/8, 11/12, and 15/16 for 1440 light/dark and 390
light/dark respectively. Every intermediate source is 139 UTF-8 bytes with
SHA-256 `90a3b6f1ff19143ba2c295c0f17bba8b59c1826bcaf150144547ce9c5a37e5af`;
every final source is 148 bytes with SHA-256
`2a40024b50babb03c7c3eb4921e2c75e2a2080bb2dc54e974cb390102ddab0bc`.
The final document contains two `\triangleq` occurrences and exactly one
package declaration. Full-source equality excludes unrelated byte changes.

The earlier failed harness attempts remain retained: save-event timing before
the package's second save, a desktop-only mobile selector, and then a wrong
modal close label. Final source uses actual saved-state signals and the real
mobile tool route/close button. Those earlier attempts are not product
failures and are not counted as passing evidence.

### Table source-to-real-PDF chain

Canonical evidence:
`docs/evidence/p56-tables/runs/6b0c98fc-8934-48b1-a0bb-f5fca4091a0d/`.

The raw saved-event chain progresses through preparation at revision 1,
Visual Table insertion at 2, four cell edits at 3..6, alignment `lr` at 7,
controlled rectangular TSV paste at 8, and Source `42` to `84` edit at 9.
Reload returns exactly the final 265-byte source. Its retained
`compiled-source.tex` SHA-256 equals the document blob:
`6163db02c51139bb36c9f31efbbfe6c7b548d267637ef61f77365cf974039f21`.

Real compile POST returns 202. Successful job
`c0775b44-feca-420e-9089-a6e15b42ed71`, completion-event resource,
preview job, and artifact job agree. Snapshot
`ebccbead-6cc1-438f-b0bb-b3a4bc695ba2` is revision 9. Artifact
`d4c20c1d-365b-467b-9717-ee9850957e6c` is HTTP 200, non-partial,
`application/pdf`, 17,937 bytes, SHA-256
`c0b7c365a0aebbeb076e3eb350ccf7a92b2b766283e79538de42368bcaee6ad6`.
Independent hashing matches the response metadata and fetched artifact.

The genuine retained build/output logs identify sandboxed systemd execution,
Latexmk 4.87, pdfTeX 1.40.28, `/src/main.tex`, one PDF page, and compiler
`status=0/SUCCESS`. Independent `pdfinfo`, `pdftotext`, and page rendering
confirm a valid one-page PDF with Region/Score, North/84, Item/Count,
Apples/17, and the intentionally empty final cell; no superseded 42 remains.
This is the PDF after the Source edit, not merely a successful pre-edit job.

## Commands, revisions, and concurrent-source accounting

All lane commands use cwd `/home/norman/Repos/Quire`, repository-local Bun
1.4.4 and `node_modules/.bin` first in PATH. Raw retained outputs/exits show:

| New native target | Bun result | Scoped strict tsc | Scoped type-aware oxlint |
| --- | --- | --- | --- |
| `tests/ui-product/shortcuts-bindings/native.test.ts` | 3 pass, 0 fail, 50 assertions, exit 0 | exit 0 | exit 0 |
| `tests/ui-product/symbol-modes/workflow.test.ts` | 4 pass, 0 fail, 56 assertions, exit 0 | exit 0 | exit 0 |
| `tests/ui-product/table-composition/native-table.test.ts` | 1 pass, 0 fail, 33 assertions, exit 0 | exit 0 | exit 0 |

Literal commands are in the lane handoffs and raw `final.log`,
`final-run.log`, `test-run.log` plus `*-exit.txt` receipts. Strict tsconfigs
inherit the actual strict UI-editor configuration. Initial harness/type
failures and LSP timeouts are disclosed by the lanes; successful scoped CLI
checks, not timed-out LSP requests, establish their final static results.

Audit HEAD is `17a8dd43e2f6662dad590de746339d24fe6181d4`, with an extensively
dirty shared worktree. In particular, concurrent P54 changed editor
`index.tsx`; `git diff --numstat` shows 46 additions and 12 deletions there.
HEAD alone is not the tested product revision.

At `2026-10-28T18:38:25Z`, independent current hashing matches all sampled
before/after inputs: shortcuts 14/14, symbols 9/9, tables 11/11. Shared
`index.tsx` is consistently
`299f13ea8b1e10af88886bcf689f5abb8de45201a50604d7967c0f65bb70359c`.
No sampled product-source drift was observed across those final runs and
the audit snapshot; the P54 dirty delta is explicitly included, not ignored.
The sample is not a complete transitive dependency or whole-worktree freeze.

Current new-test hashes are retained in audit `current-inputs.log`; shortcut
and table self-hashes also match their run receipts. Symbols' nine runtime
fingerprints do not include its own test file; its current hash is recorded
separately rather than misrepresented as a runtime self-fingerprint.

## Native images, every PDF page, and cleanup

The independent auditor opened all 42 accepted native screenshots: six
shortcuts/preferences, twenty symbol captures, and sixteen table captures.
All required actual capture types, both table/symbol widths and themes, and
the reopened binding controls were inspected. Mobile vertical scrolling,
small fit-width PDF text, and transient secondary-pane loading are recorded
in `docs/evidence/p56-authoring-verification/visual-inspection.md`.

All seven retained P56 PDF files, including superseded attempts and duplicate
historical root files, were independently checked as one page each. Every
page was rendered and opened. Audit page renders are retained; the newly
retained table lane `pdf-page-1.png` was also opened. No PDF page was omitted.

At `18:40:32Z`, the exact fourteen lane-owned origins all refused connections
(raw curl exit 7), and all seven recorded temporary roots were absent.
At `18:45:24Z`, both accepted shortcut compile units, final table unit, and
interrupted-attempt table unit returned `LoadState=not-found`,
`ActiveState=inactive`, `SubState=dead`, each systemctl exit 0.
The earlier interrupted table fixture needed explicit owned cleanup; the
retained recovery record and independent absence checks establish its
resolution. Final fixture receipts also establish browser disposal.

Independent audit evidence is retained under
`docs/evidence/p56-authoring-verification/`: `probe.sh`, `probe.log`,
`compiler-cleanup.log`, `current-inputs.log`, `input-comparison.json`,
`chain-comparison.json`, `pdf-validation.log`, `visual-inspection.md`, and
all seven page renders.

No accepted test suite was replayed. Audit probes were limited to missing
independent artifact/hash/cleanup checks and retained with commands/output.
No product/test file, commit, dependency, or port-5173 resource was touched.
The audit started no application/browser/service and owns no remaining probe
resource. P53 remains historical; the parent owns the final global build,
which this bounded audit neither reran nor claims.
