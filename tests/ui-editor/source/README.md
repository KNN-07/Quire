# Source acceptance

The production entry point is
`apps/web/src/features/editor/source/SourcePanel.tsx`, exported from that
directory's `index.ts`. It consumes the frozen `SourcePanelProps` from
`features/editor/shared`: the injected API client, shared `EditorDocument`,
persisted preferences, selection, diagnostic DTOs, and navigation ports. It owns
its CodeMirror view and undo manager, not the document, transport, or workspace.

Run from the repository root:

```sh
bun test tests/ui-editor/source
bun node_modules/typescript/bin/tsc --noEmit --pretty false -p tests/ui-editor/source/tsconfig.json
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings apps/web/src/features/editor/source tests/ui-editor/source/*.ts tests/ui-editor/source/*.tsx
```

The strict target compiles the actual application fixture imports and canonical
`packages/runtime/src/assets.d.ts`; it does not replace raw text modules with
producer-local unknown casts.

The browser scenarios use the parent-owned same-origin fixture, actual
authenticated sessions, actual HTTP/WebSocket services and acknowledged Yjs
documents. No service implementation is replaced. Cases exercise Unicode/CRLF
round trips, incomplete main-source drafts, independent collaborators and local
undo, actual source tools, Vim/Emacs, personal dictionary persistence, and
language/font/theme controls across reload.

Compiler diagnostic navigation is exercised using a real failed compiler job,
not a manufactured diagnostic. A terminal job subscription is registered before
the compile request. The resulting diagnostic DTOs are supplied through the
ordinary panel props; disabling heuristic Code Check must not hide that compiler
diagnostic or prevent navigation to its source line.

Native browser spellcheck is disabled. The bundled nspell engine uses the
root-provided English US, English GB, and Vietnamese dictionaries and per-user
custom words. Chinese spelling is explicitly unavailable in the supplied asset
manifest; Chinese interface selection remains independent and functional.

Visual evidence is under `evidence/`:

- `source-{1440,390}-{light,dark}.png` and corresponding `-end.png` captures.
- `outline-{1440,390}-light.png`.
- `preferences-{1440,390}-{en,vi,zh}.png`.
- `preferences-{1440,390}-dark-reload.png`.
- `dictionary-{zh,vi}-{1440,390}.png` for explicit availability and dictionary selection.
- `source-diagnostic-1440.png` for actual compiler-linked navigation.

The browser runner logs its owned API/web listeners and temporary data roots,
then closes its browser contexts, transport subscriptions, compiler worker,
servers, and temporary directories through the shared disposable fixture.
Source views are explicitly unmounted before page reload and final disposal.
Browser page errors and error-level console messages fail the scenarios.
