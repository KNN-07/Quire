# FINAL: editor tools

Owner: `st_01a17c3d`. October 27, 2026.

Owned tools acceptance is complete on project-local **Bun 1.4.4**:
**24 passed, 0 failed, 148 assertions, 6 files, 219.28 seconds, exit 0**.
Strict TypeScript and type-aware lint passed. Cleanup and capture inspection
finished before this final handoff was written.

## Integration signatures

Entrypoint: `apps/web/src/features/editor/tools/index.ts`.

```ts
type FilesPanelProps = ToolsPanelProps & {
  readonly presentation?: "standalone" | "compact";
};
type EditorToolsProps = ToolsPanelProps & PreferencesCallbacks & {
  readonly panel?: ToolPanel;
  readonly onPanelChange?: (panel: ToolPanel) => void;
  readonly filesPresentation?: FilesPanelProps["presentation"];
};
type PreferencesCallbacks = {
  readonly onPreferencesChange?: (preferences: Preferences) => void;
  readonly onSessionChange?: () => Promise<void>;
};
```

Value exports include `ToolsPanel`, `FilesPanel`, `SearchPanel`, `SymbolsPanel`,
`BibliographyPanel`, `FigurePanel`, `ProjectSettings`, `InterfacePreferences`,
`ProviderState` and `PythonPanel`. The corresponding public props/types are
exported. `ToolPanel` values are `files`, `search`, `symbols`, `bibliography`,
`figure`, `settings`, `preferences`, `providers` and `python`.

Supply the existing injected client, workspace, document, authoring/navigation
handles and workspace refresh callback through unchanged shared
`ToolsPanelProps`. Forward preference/session callbacks to assembled editor
state. No shell, router or sibling contract was replaced.

Assembler contract: `<ToolsPanel filesPresentation="compact" {...props} />`,
or direct `<FilesPanel presentation="compact" {...props} />`. Omission preserves
standalone controls. Compact mode starts with the native keyboard-accessible
`File actions` disclosure closed; creation, links and both upload inputs retain
their real handlers. The tree stays outside that disclosure. The exact contract
was published in `tools/DESIGN.md` and sent to the parent for forwarding to
`st_01a17c89`; that task was not directly addressable from this child.

## Delivered behavior and direct proof

- `files.test.ts`: native file/folder creation, rename/move, deletion/reopen,
  roving tree keyboard behavior, file and directory upload, exact binary
  download and Unicode source bytes, source search/navigation and excluded-file
  reasons. Both standalone widths and real compact disclosure workflows pass.
- `catalog.test.ts`: project bibliography keys and insertion, independent local
  Library copies/editing, persisted compiler/preferences settings and reload.
  Multiple-target and linked-bibliography cases also run in `features.test.ts`.
- `features.test.ts` and `insertion.test.ts`: symbol commands/package edits,
  source preservation, deterministic bibliography targets, native read-only
  links/manual refresh and actual uploaded figure insertion with `graphicx`.
- Settings flush pending source, fetch the authoritative project version and
  guard the edited settings/name baseline against concurrent changes.
- Exact editable, unlinked root `main.Rnw` is selectable only when the chosen
  environment is Docker and advertises `knitr`. Native and Docker-without-knitr
  selections exclude it; incompatible switches disable Save. Both widths
  persist/reload the actual main/environment pair and reopen unchanged editable
  source. The preserved Rnw cases contain 22 assertions. Operator registration
  independently probes both real Docker profiles; no MIME override or fake
  compiler result is used.
- `access.test.ts`: Viewer UI/server denial, visible server conflict errors,
  actual Owner rename and Editor settings persistence/reload. Only Owner sees
  the name input. Unchanged names are omitted; Editor PATCH bodies never contain
  `name`. Request interception captures the actual body and forwards unchanged.
- `python.test.ts`: installed same-origin Pyodide runs a real selected script;
  no project output exists before approval; approved output persists byte for
  byte at the chosen new path. Viewer execution cannot save. The owner run
  contacts no external HTTP origin.

Browser Python remains opt-in. Parent provisioning serves pinned
`pyodide@314.0.7` core/standard-library assets at `/extensions/pyodide/`.
`tools/PYTHON.md` documents installation, exact runtime verification, selected
inputs, disposable worker, cancellation/30-second limit, output bounds and
per-file review. Scientific wheels are not implied or automatically installed.
Existing destinations require a new path because the upload API does not
provide overwrite semantics. Scripts' browser-network capability is disclosed.

Rnw test prerequisites are the environment owner's retained
`docs/evidence/p2o-environments/knitr-report.json` and its immutable installed
image. The operator API re-probes availability; it is not a fabricated manifest.
Actual standalone Rnw compilation is separately owned by the environment lane,
not claimed from a settings-only UI test.

## Commands and retained receipts

Run from repository root; `bun run test` selects the project-local runner.

| Command | Observed result |
| --- | --- |
| `bun run typecheck -p tests/ui-editor/tools/tsconfig.json` | exit 0 |
| `bun run lint apps/web/src/features/editor/tools tests/ui-editor/tools` | exit 0 |
| `bun run test tests/ui-editor/tools` | 24 pass, 0 fail, 148 assertions, exit 0 |

Authoritative current receipt:
`tests/ui-editor/tools/evidence/native-local-acceptance.txt`.
It records `bun test v1.4.4 (38afee6c8)` and all terminal fixture closures.
The same-UI-input draft guard also exited 0 in `native-local-final.txt`, using:

```sh
./node_modules/.bin/bun /home/norman/.omo/binary-runtime/5.1.48/plugin/skills/frontend/scripts/perfection/check-draft-guard.ts apps/web/src/features/editor/tools tests/ui-editor/tools/browser-harness.tsx tests/ui-editor/tools/harness.css
```

That earlier receipt's compact-only mount failures remain historical. The
harness readiness marker was corrected from hidden `New folder` to visible
`File actions`; the current complete command passes without retries. Old Bun
1.3.14, HMR, request-metadata and network-change failures were retained rather
than filtered or relabeled. No blanket runtime root-cause claim is made.

## Captures and cleanup

All paths below are under `tests/ui-editor/tools/evidence/`:

- Owner/Editor audit: `settings-owner-{1440,390}-{light,dark}.png` and
  `settings-editor-{1440,390}-{light,dark}.png`; exact passing cases are also
  in the current acceptance receipt.
- Compact tree/actions: `files-compact-{1440,390}-{light,dark}.png`.
- Other inspected families: `search`, `bibliography`, `settings`,
  `settings-rnw`, `symbols`, `python-approved` and `python-review`.

Desktop captures use 1440x900; true mobile cases use CSS width 390, touch and
DPR 3. Light/dark compact and role-specific settings captures were inspected.
These are real tools-only harness captures, not a replacement for the parent's
assembled-editor visual acceptance.

`cleanup-final.md` records awaited closure of all five browser/application
fixture groups, absence of all 38 owned roots recorded in retained receipts,
an empty matching process inventory and termination of the owned network
observer. Receipt subscriptions are terminal; no owned run remains pending.
No unrelated listener, process, temporary root or evidence was removed.

No commit/push, global Bun/PATH mutation or sibling source edit was performed
by this producer. Logs and captures remain retained. Whole-product/transport
acceptance, production build and separate external-adapter/assistant/live-
provider acceptance are not inferred from this tools gate.
