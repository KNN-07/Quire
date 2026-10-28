# Editor assembly handoff

October 27, 2026. Owner: `st_01a17c89`.

Status: **owned integration and targeted verification complete** on
project-local Bun 1.4.4 (`38afee6c8`). This is not the parent's independent
whole-product or pixel-accuracy approval. Producer receipts were read rather
than inferred from file presence. The formerly missing PDF combined gate is
now verified; no producer run is being awaited by this task.

## Mounted application

`apps/web/src/router.tsx` mounts the actual `EditorPage` for all seven paths:
`/projects/:p/edit`, `git`, `agent`, `history`, `review`, `logs`, and `pdf-diff`.
It passes the existing session client, navigation and session-refresh callback.
No second application client, placeholder panel or synthetic authority was
introduced.

The coherent assembly modules are:

- `editor/index.tsx`: producer wiring, navigation, selection, shortcuts,
  preferences and share/chat dialogs.
- `editor/session-controller.ts`: one project/branch transport lifetime,
  acknowledged settling, file opening, authoritative refresh, epoch replacement,
  retained pending source and awaited/idempotent disposal.
- `editor/workspace.tsx` and `workspace.css`: bounded viewport geometry,
  source/split/visual/PDF/vertical layouts, resizing, drawers and mobile panes.
- `editor/chrome.tsx`: reference SVG paths, header, rail, actual collaborator,
  Git/environment/compile/save metadata, Source menu and retained-source UI.

All actual Source, Visual, Tools, PDF, Review, Git and Assistant exports are
mounted through their typed contracts. The ordinary PDF owner remains mounted
across native route changes. History restoration replaces the transport cache
when epochs change; it does not reopen an obsolete cached document.

Source reveal uses actual authoring handles. Assistant Open source changes the
selected document and returns from the Agent route to the editor. Root manual
compile delegates to `PdfPanelHandle.recompile()`, so live Draft and
Stop-first-error settings are not replaced with workspace defaults. The shared
`CompileController` remains the real Assistant compilation port.

Split preferences use `quire.editor.sizes.<actual-user-id>`. Stored values are
validated, remain within their declared ranges, and are clamped to current pane
geometry without overwriting the wider-viewport preference. Desktop chrome is
56 px with a 52 px rail; mobile drawers/panes remain viewport-bounded. Native
PDF toolbars scroll horizontally on narrow/stacked surfaces, retaining their
actual controls and leaving a real paper viewport. Producer bodies retain
their own scroll ownership; no document-level overflow was accepted.

## Approved additive Source and Files contracts

`shared/contracts.ts`, `source/SourcePanel.tsx` and `source/index.ts` add:

```ts
type SourceTool = "find" | "outline" | "check" | "preferences" | "shortcuts";
interface SourceToolsHandle {
  readonly open: (tool: SourceTool) => void;
  readonly close: () => void;
  readonly format: (command: SourceCommand) => boolean;
}
type SourcePanelProps = AuthoringProps & {
  readonly presentation?: "standalone" | "embedded";
  readonly onToolsHandle?: (handle: SourceToolsHandle | null) => void;
};
```

Standalone remains the default. Embedded assembly supplies the selected
filename and all five tool actions plus actual formatting commands in its
keyboard-accessible menu. Errors, read-only reason, spelling state, tools and
the real editor remain present. Cleanup publishes `onToolsHandle(null)`.
The formatting port focuses the editor before dispatching the native command,
preserving the native Go-to-line input's subsequent focus.

Assembly consumes the Tools owner's
`<ToolsPanel filesPresentation="compact" {...props} />`. File actions are a
closed native disclosure; the tree stays visible and creation/link/upload
handlers remain real. Standalone Tools callers are unchanged.

`source/editor.ts`, including the parent's exact multiline-input correction,
was not edited by this task. The original exact-source assertion was not
relaxed. No authoring-handle expansion, cast or DOM-click proxy was used.

## Direct evidence

All receipt paths below are under `tests/ui-editor/assembly/evidence/`.
These are scoped receipts, **not an invented single final aggregate run**.
Previously passing input was preserved; affected targets followed actual
changes or failures.

| Receipt | Observed result |
| --- | --- |
| `before-terminal.log`, `before/` | 28 immutable pre-edit route/viewport/theme captures |
| `local-144-exact-source.log` | 1 pass, exact leading-LF/Unicode server bytes and reload, 2 assertions |
| `local-144-embedded-browser.log` | 35 pass, 0 fail, 170 assertions; all seven real routes at 1440/390 in light/dark, source persistence, real compile, epoch restore and Source tools |
| `local-144-compact-files.log` | 4 pass, 28 assertions; real compact-disclosure creation, opening and exact selected-file persistence |
| `local-144-frame.log` | 4 pass, 24 assertions; actual standalone Source/Visual frame, dimensions, splitter persistence and modal focus/Escape return |
| `local-144-integration.log` | Actual ErrorFix case passed; enclosing selection had 5 pass/2 initial-loading failures, retained unchanged |
| `local-144-loading-diagnostic.log` | Both affected retrieval/navigation and genuine pending-source recovery cases passed; 18 assertions |
| `local-144-final-pdf-layout.log` | 13 pass, 0 fail, 97 assertions, 95.95 s; live header flags, acknowledged fresh source, all five layouts, user namespaces, 2560-to-1440 split clamping, visible mobile paper, changed logs/comparison surfaces |
| `local-144-source-focus-verified.log` | 4 pass, 0 fail, 56 assertions, 56.43 s; five real tools, native Go-to-line focus, Escape return and Find-selected Bold persisted exactly |
| `local-144-delivery-static.log` | Root TypeScript, owned TypeScript, root type-aware lint, production build and nine-file draft guard all exit 0 |

The production build retains Vite's greater-than-500-kB chunk warning; it was
not suppressed. The main client bundle is approximately 1.85 MB minified.
Owned TS/TSX modules remain below 250 nonblank lines; workspace/chrome are in
the 200-250 warning band.

### Coupled behavior, not substitute results

- The header test inserts fresh source without a test-side flush, toggles real
  PDF settings, then checks actual stored compile settings and acknowledged
  snapshot revision. It downloads genuine `%PDF-` bytes and awaits PDF.js
  rendering. DevTools' null request-body metadata was not invented.
- ErrorFix starts with a real undefined TeX command and actual failed compiler
  diagnostic/log artifact. Selection without consent sends no provider request.
  Consented provider context equals the recorded log byte slice. Source stays
  unchanged until real acceptance; the fresh epoch then recompiles successfully
  through the actual Assistant controller and renders its PDF.
- Recovery holds a real branch lease before native keyboard input, leaving the
  update unacknowledged. A real new-epoch commit rejects the queued old update.
  Exact local source remains visible, authoritative server source remains
  different, and reopening retains the old local text separately. Canceling
  discard preserves that copy. There is no mocked socket or timing sleep.
- Retrieval crosses the actual configured HTTP adapter, displays the returned
  publication provenance, then opens another proposed source file from the
  Agent route without applying its unaccepted proposal. The provider is an
  owned loopback protocol fixture, not a live-inference availability claim.

## Captures and retained failures

The complete passing route matrix and scrolled-end captures are in
`runs/6390c886-ec9b-4a39-97b4-e671a3cc9337/`. Final affected PDF/layout/log/
comparison captures, actual PDF and stored header-settings receipts are in
`runs/ed02e06d-749a-41e8-b033-b1285f5224d3/`. Final Source captures are in
`runs/43c88553-8eda-4e42-9328-7c56bbb15aa1/`.

Compact Files evidence is under
`files/98046a49-17fe-4a47-a087-65a39b882241/`; fresh frame evidence is under
`frame-runs/3f1f21f8-ccb9-4a64-827c-b8fb25191a4e/`.
Actual ErrorFix evidence is under
`assistant/fdb2030d-151f-4582-bad3-9fb3f7954d53/`, retrieval/navigation under
`assistant/8f4f0a11-205f-47b4-96b1-5ecc48fdeca0/`, and genuine recovery under
`assistant/b3ce155b-b186-4b82-80da-ef2e4a23ed2f/`.

Desktop/mobile light/dark route, tool, drawer, layout and relevant end-of-scroll
captures were opened and inspected. Mobile PDF now visibly contains genuine
paper/title content. A short stacked PDF viewport still scrolls its actual
page; horizontal toolbar controls remain reachable rather than removed.
Seeded empty review/comparison and unconfigured-provider states are actual
server states, not fabricated populated examples.

Historical global-1.3.14 failures, initial auth-rate fixture pressure, two
`ERR_NETWORK_CHANGED` initial-loading failures, the rejected wide split value,
the insufficient paper viewport and the obsolete `.cm-gotoLine` test selector
remain in their original logs. The selector was corrected from the installed
native `.cm-goto-line` implementation. Assertions/timeouts were not weakened,
production rate limits were not changed, and no blanket descriptor/runtime
cause is claimed. Canceled lifecycle SSE requests remain in raw request logs.

## Producer gates, cleanup and remaining approval

The final `p2u-tools.md` reports 24/24, 148 assertions on local 1.4.4.
The updated `p2u-pdf.md` reports one combined 15/15, 120-assertion run; its
`combined-final-exit.json` was read and records exit 0. The old lost receipt
is historical, not a current blocker. `p3-assistant-verification.md` records
independent 22/22 current-runtime acceptance. Other required producer contracts,
exports and handoffs were read before/through integration.

`cleanup-final.json` records the final independent probe at
2026-10-27T15:24:09.079Z: all 20 exact recorded owned temporary roots are absent
and all 40 recorded listeners return `ECONNREFUSED`. Current logs contain
awaited browser/application disposal. No owned test or publication watch remains
pending. Unrelated listeners/processes/roots were not stopped.

No commit/push, global Bun/PATH change, production rate-policy edit or sibling
source rollback was performed. Original reference HTML/images/research archive
remain untouched. The parent's independent assembled-editor/release review is
still separate. This handoff does not certify every capability/guest/offline
expiry permutation, live external providers, or whole-product visual approval.
