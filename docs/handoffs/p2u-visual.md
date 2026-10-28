# P2U lossless visual editor - FINAL

October 27, 2026. Implemented and verified on native Bun 1.3.14. This is the
visual producer's completed implementation/evidence, not assembled-editor,
whole-transport, provider/assistant or release acceptance.

## Consumer contract

Entry: `apps/web/src/features/editor/visual/index.ts`.

```ts
function VisualPanel(props: VisualPanelProps): React.JSX.Element;
function parseLatex(source: string, revision: string): ParsedLatex;
function sourceRevision(document: EditorDocument): string;
function parseDocument(document: EditorDocument): ParsedLatex;
function applyVisualEdits(document: EditorDocument, parsed: ParsedLatex,
  edits: readonly SourceEdit[]): void;
function fieldEdit(source: string, range: Interval,
  change: { readonly text: string; readonly literal: boolean }): SourceEdit;
function selectionEdit(selection: SourceSelection, insert: string): SourceEdit;
function withPackage(parsed: ParsedLatex, edit: SourceEdit,
  packageName: "graphicx"): readonly SourceEdit[];
function tsvTable(text: string): string;
function tableShape(source: string, table: VisualNode): TableShape | null;
function figureShape(source: string, figure: VisualNode): FigureShape | null;
```

`VisualPanelProps` is the actual shared authoring interface: injected `client`,
`workspace`, `navigation`, `refreshWorkspace`, transport-owned `document`,
`preferences`, `onPreferencesChange`, `selection`, `onSelectionChange`,
`onHandle` and `diagnostics`. The panel publishes the shared `AuthoringHandle`
and null on cleanup. Assembly retains document/transport ownership.

The barrel also exports `Interval`, `ParsedLatex`, `VisualNode`, `VisualKind`
and `VisualEditError`. Its codes are `STALE_RANGE`, `INVALID_RANGE`,
`INVALID_INPUT`, `OFFLINE`. `TableShape`/`FigureShape` are defined in
`structures.ts`. All parser nodes, ranges and child arrays are immutable.

## Implemented behavior

Paragraphs, section/chapter/title headings, bold/italic, simple ordered and
unordered lists, inline/display/environment math, citations including optional
notes, references/labels, includes, simple tabular cells/alignment and figures
are interval-backed. Unknown constructs, complex/nested structures and comments
remain editable source islands. Untouched whitespace and syntax remain exact.
Math controls edit actual LaTeX; they do not pretend to be a TeX renderer.

Revisions include the actual document epoch, Yjs state vector and exact source.
Stale ranges and split-surrogate edits reject. Commands use the shared atomic
`document.replace`; field edits replace only changed characters. No document
serializer, second Y.Doc, save queue, global client or authoritative browser
store was introduced.

TSV paste validates rectangular shape and escapes text cells. Figures expose
separate caption, label and width fields, actual asset previews, project-image
insertion and an editable source view. `graphicx` insertion is one additional
interval in the same transaction, excluding commented/defined package examples.
Unsupported figure forms retain source rather than acquiring duplicate captions.
Includes preserve targets and invoke the injected file navigation after flush.

Single-PNG paste validates bytes and uses the actual scoped multipart upload
endpoint, current effective branch revision, CSRF/session client and idempotency
key. Workspace refresh follows upload. Preview bytes come from authorized file
content; cancellation never forces a later source insertion. No MIME workaround,
fake PDF, provider response, fabricated count or no-op production control exists.

## Layout and scope

Brief/required-content contract: `tests/ui-editor/visual/brief.md`.
The assembled Recompile action remains primary; local controls are neutral.
One readable measure aligns content. Preamble source is grouped without hiding
title fields or changing parser ranges. The wrapping toolbar stays fixed;
`.q-visual-body` owns vertical scrolling and wide tables own horizontal scrolling.
Existing shared controls, icons/styles and tokens were reused.

Coverage: A03, A11, A13, A15, A16, A26 and the assigned visual portions of D01/D06.
Only the assigned production/test paths and this handoff were authored. Root
dependencies/router, sibling implementations, original HTML and research archive
were not edited. No commit, push, nested reviewer or unrelated process shutdown.

## Verification

Final owned terminal `mon_J5GHG5CH553EJRM2`: **exit 0**.
**17 tests pass, 0 fail, 77 assertions, 75.99 seconds.**

```sh
bun test tests/ui-editor/visual
bun node_modules/typescript/bin/tsc --noEmit -p tests/ui-editor/visual/tsconfig.json
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings \
  apps/web/src/features/editor/visual tests/ui-editor/visual/*.ts tests/ui-editor/visual/*.tsx
bun /home/norman/.omo/binary-runtime/5.1.48/plugin/skills/frontend/scripts/perfection/check-draft-guard.ts \
  apps/web/src/features/editor/visual tests/ui-editor/visual
```

Strict TypeScript, type-aware lint, draft guard and scoped diff check all exit 0:
`VISUAL_FINAL_REPAIRED_RECEIPT tests=0 types=0 lint=0 draft=0 diff=0`.
Fresh LSP checks on the three rendered components report no diagnostics.

Native tests prove immutable/source-complete parsing, unsupported syntax,
every supported interval class, Unicode boundaries, stale rejection, actual
Viewer denial, package insertion and exact durable source after backend restart.
Actual Chromium at 1440x900 and mobile/touch 390x844 DPR 3 edits supported and
unknown source, switches authoring modes, pastes TSV and PNG, compares every
uploaded byte through HTTP, decodes the preview, updates figure fields, rejects
invalid metadata without source mutation and reopens exact persisted source.
Save subscriptions precede actions; no sleeps/polling delays were added.

The browser fixture imports the real production panel and production transport,
using the canonical shared Node/Vite same-origin proxy and Bun API. Its bounded
source textarea is a fixture, not a claim about the source producer's CodeMirror.
Its native production bundle avoids the unused development HMR client, not the
real authentication, HTTP, WebSocket, upload or persistence paths.

## Retained evidence and cleanup

`tests/ui-editor/visual/evidence/final-receipt.txt` contains commands, exact
results, observations, terminal history and cleanup. `visual-review.md` records
the complete direct capture inspection. All 16 fresh original PNGs were opened:

`visual-{1440,390}-{light,dark}{,-figure,-figure-controls,-end}.png`.

Desktop originals are 1440x900; mobile originals 1170x2532. Signatures, original
dimensions and freshness were checked. Both viewport probes report no horizontal
document overflow and only `q-visual-body` as vertical owner. No blank, clipped,
overlapping principal control or missing required field was observed.

Final awaited disposal closed browser contexts/browser, native sockets/SSE,
Node frontend, API/runtime and `/tmp/quire-ui-editor-0swQn1`, with listeners
`127.0.0.1:40009` and `127.0.0.1:36189`. Six native fixtures also verified
closed sockets and removed unique roots. Parent-correction subscriptions are
closed/expired; no owned run is pending. Earlier failed roots were cleaned only
by exact owned path. Shared 5173/3001 listeners were untouched.

Historical proxy/admission/MIME and transient sibling-import failures are
retained, not suppressed; owners fixed their seams before the final rerun.
Two old diagnostic terminal handles expired before retrieval; no passing/exit
claim is made for them, and their observed failures and closed-root cleanup
remain explicit. Final acceptance uses only the complete current exit-zero run.

Post-write review: parser rules, structure ranges, source commands, asset I/O
and rendering have named responsibilities. Boundaries use existing schemas and
typed ports; node dispatch is exhaustive. A local TypeScript AST review found
no any/casts/non-null assertions/enums or >3-parameter functions. Maximum pure
LOC: 149 production, 193 tests. Logging is fixture evidence only. The external
skill checker requires TypeScript 7 unstable APIs unavailable in this pinned
TypeScript 5.9.3 project; that exit 2 was not called a pass.

The parent still performs independent assembled-editor browser QA. No Lighthouse,
human assistive-tech, whole-transport/presence or native EBADF certification is
claimed here. External adapters and AI assistant implementation remain required
in their later phase; this producer does not mark them complete.
