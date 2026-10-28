# P2U shared editor contract - FINAL

October 27, 2026. Implemented and verified on native Bun 1.3.14. This freezes
the shared consumer contract and real-service fixture, not the editor panels,
transport implementation, later adapters/assistant, or parent's final browser QA.

## Imports and ownership

Production entry: `apps/web/src/features/editor/shared/index.ts`.
Fixture entry: `tests/ui-editor/shared/index.ts`.
All authored files are inside the assigned shared/test paths, the test tsconfig,
and this handoff. No root dependencies, router, sibling producer, original HTML,
research archive, commit, or push was changed.

`contracts.ts` owns component interfaces; `state.ts` owns presentation selection;
`api.ts` owns route parsing and workspace hydration. DTOs come from
`@quire/contracts`, including `EffectiveAccess = ResponseOf<typeof endpoints.projectAccess>`
and `CompileState = ResponseOf<typeof endpoints.compilePreview>`.
The verified foundation prerequisites are `p2u-access.md` and `p2u-preview.md`.

## Frozen signatures

```ts
type EditorClient = ReturnType<typeof createClient>;
type EditorPageProps = {
  readonly path: string;
  readonly client: EditorClient;
  readonly navigate: (path: string) => void;
  readonly onSessionChange: () => Promise<void>;
};
type EditorWorkspace = {
  readonly scope: Scope;
  readonly project: Project;
  readonly access: EffectiveAccess;
  readonly files: readonly FileEntry[];
  readonly requestHeaders: EditorRequestHeaders;
};
// EditorRequestHeaders is a readonly Pick of the actual request DTO's
// optional x-project-token header, not a second HTTP schema.
type SourceSelection = { readonly anchor: number; readonly head: number };
type SourceEdit = { readonly from: number; readonly to: number; readonly insert: string };
type SourceLocation = { readonly fileId: Id; readonly line: number; readonly column: number };
type PdfLocation = { readonly page: number; readonly xPt: number; readonly yPt: number };
```

`SourceSelection`/`SourceEdit` offsets are zero-based UTF-16 units. Lines,
columns and PDF pages are one-based; PDF coordinates are points. Batch source
edits are non-overlapping intervals in the pre-transaction source, applied as
one atomic local operation. Producers preserve untouched source bytes.

`EditorDocument` has readonly `scope`, `file`, `ydoc: Y.Doc`, `source: Y.Text`,
`awareness: Awareness`, `getSnapshot(): DocumentSnapshot`,
`subscribe(listener: () => void): () => void`,
`replace(edits: readonly SourceEdit[]): void`, and
`flush(signal?: AbortSignal): Promise<void>`.
Transport alone creates/destroys the Y.Doc, awareness, socket and save queue.
Both authoring modes consume that same handle. Shared state never creates a
Y.Doc, keeps source text, saves, or creates a global API client.

`DocumentSnapshot` contains `version: Version`, `persistence: PersistenceStatus`,
`readOnly: boolean`, and `readOnlyReason: string | null`. Snapshots must be stable
until a subscribed change, suitable for `useSyncExternalStore`.
`PersistenceStatus` is exhaustive:

| kind | Additional fields |
| --- | --- |
| connecting | None |
| saved | `revision: number` |
| saving | `acknowledgedRevision: number`, `pendingUpdates: number` |
| offline | `pendingUpdates: number`, `editable: boolean`, `since: number` (epoch milliseconds) |
| recovery | `code: string`, `message: string`, `localText: string`, `serverText: string \| null` |
| closed | `reason: string` |

`replace` rejects read-only edits; it never means saved. `flush` resolves only
after matching durable server acknowledgments and rejects on recovery/closure.
Sending a frame is not persistence. Recovery retains local text separately
from optional server recovery text. `readOnlyReason(access, file, persistence)`
uses effective capabilities, linked/binary status and transport locks, not a
nominal editor role. Offline editing is transport-bounded; compile, file/branch
switch, comments and assistant calls must remain blocked offline.

`AuthoringHandle` exports `focus(): void`, `select(SourceSelection): void`,
`reveal(SourceLocation): void`, `replaceSelection(text: string): void`.
`EditorNavigation` exports `openFile(Id): Promise<void>`,
`revealSource(SourceLocation): Promise<void>`, `revealPdf(PdfLocation): void`,
`changeBranch(Scope["branch"]): Promise<void>`.
Navigation must settle or explicitly recover pending document work before
disposing its transport handle.

`CompileController` exports `getSnapshot(): CompileState`,
`subscribe(listener: () => void): () => void`,
`compile(request: CompileRequest): Promise<CompileJob>`, `cancel(): Promise<void>`.
The compile state is exactly `{job, preview}` from the endpoint, including
preview artifact, source snapshot and stale flag. Flush first; use the current
authoritative branch revision from matching acknowledgments/effective access,
not project.version or maximum file revision. PDF owns compilation; no second
compile queue or discovery cache is introduced here.

All props are readonly; callback keys below are required:

| Export | Exact prop surface |
| --- | --- |
| `SourcePanelProps`, `VisualPanelProps` (both `AuthoringProps`) | `client`, `workspace`, `navigation`, `refreshWorkspace: () => Promise<void>`, `document: EditorDocument`, `preferences: Preferences`, `onPreferencesChange: (Preferences) => void`, `selection`, `onSelectionChange: (SourceSelection) => void`, `onHandle: (AuthoringHandle \| null) => void`, `diagnostics: readonly Diagnostic[]` |
| `ToolsPanelProps` | `client`, `workspace`, `document: EditorDocument \| null`, `authoring: AuthoringHandle \| null`, `navigation`, `refreshWorkspace` |
| `PdfPanelProps` | `client`, `workspace`, nullable `document`, `preferences`, `navigation`, `onController: (CompileController \| null) => void`, `onCompileStateChange: (CompileState) => void` |
| `ReviewPanelProps` | `client`, `workspace`, nullable `document`, `selection`, `navigation`, `refreshWorkspace`, `view: "review" \| "history" \| "share" \| "chat"` |
| `GitPanelProps` | `client`, `workspace`, nullable `document`, `navigation`, `refreshWorkspace` |

Source/visual use their injected client and workspace for labels, citations,
real uploads and project settings. Source edits still use the shared document,
not a second persistence path. After `preferencesPatch` succeeds, pass its
actual `Preferences` response to `onPreferencesChange`, including custom words.
Refresh workspace after structural changes. Both authoring and PDF publish
null handles on unmount; assembly can wire header commands to these handles.

`EditorLayout = Preferences["defaultView"] | "stacked"`.
`EditorPanel = "files" | "search" | "symbols" | "bibliography" | "review" | "history" | "git" | "logs"`.
`EditorSlots` contains ReactNode slots `header/tools/source/visual/pdf/review/git/status`
and optional `assistant`. Assembly owns geometry and uses existing `ui/index.ts`
primitives and token/global styles. Assistant is supplied only by its real later
adapter phase, not a placeholder button.

`initialWorkspaceState(workspace, layout = "split"): WorkspaceState`,
`workspaceReducer(state, action): WorkspaceState`, and
`createWorkspaceStore(initial)` expose `getSnapshot`, `subscribe`, `dispatch`.
Actions are `workspace/file/selection/layout/panel`. Branch changes, file removal
and epoch replacement reset stale selection; ordinary revision refresh preserves
the transport/authoring-managed selection. The store owns no network lifecycle.

`parseEditorRoute(path): EditorRoute | null` parses the seven actual editor pages,
Id, branch and share token. `loadEditorWorkspace(client, route, signal?)` returns
`Promise<EditorWorkspace>`. Branchless routes begin with canonical `main`, then
retain the returned project default branch; explicit branch routes stay explicit.
`editorValue<T>(Result<T>): T` throws typed `EditorApiError(code, message)`.

## Credentials and native transports

Forward `workspace.requestHeaders` on every project/document/preview/artifact
HTTP call, merged with that call's idempotency/version headers. Never install
the share token in a global client. The real token-only regression uses the
server-emitted `/projects/:id/edit?share=...` URL, then reads a document using
only the loader's returned credential context.

Use `client.url(endpoints.realtime, input)` for the WebSocket URL, convert its
scheme to ws/wss, and append `share` from the scoped token when present.
Named sessions use protocols `quire` and `quire.csrf.<csrfToken>`; preserve browser
cookies and same-origin behavior. A signed nonmember editor-link reader must
explicitly call CSRF-protected `projectJoin` and refresh effective access before
writing. GET never admits a member.

SSE is `/api/events?after=...`, with `x-project-token` in headers for token-only
readers. Native EventSource cannot set this header, and this server rejects
extra `share` query parameters: use a header-capable, abortable fetch stream
(installed ky is available), parse `EventSchema`, and retain the event cursor.
`createClient.call` intentionally rejects SSE/WS; use its URL builder plus the
native transport. Do not invent an EventSource query-token workaround.

## Reusable real-service fixture

`startEditorApplication()` returns async-disposable
`{application, url, apiUrl, dataDir, password}`. It creates the actual application
with all registered services, the actual seed and compiler startup. Unique
SQLite/blob/Git storage and OS-assigned loopback ports isolate each run.
Vite middleware runs on an owned Node HTTP listener because Vite's configured
port 0 otherwise selects 5173. No shared 5173/3001 listener is used or stopped.

`startEditorBrowser()` returns async-disposable `{browser}`.
`authenticatedContext(browser, app, options?)` returns async-disposable
`{context, session}`; options are BrowserContextOptions plus optional `email`.
`authenticateApi(app, email?)` returns `{user, cookie, session, http}` using actual
HTTP login, server cookie and CSRF. This avoids Bun 1.3.14/Playwright's relative
IncomingMessage.url cookie parsing defect without inserting fabricated sessions.
Browser contexts receive that real server-issued HttpOnly cookie.

`openProjects(page)` subscribes to the exact project response before navigation.
`projectDocument(context, scope & {fileId})` parses the actual document DTO.
`waitForRenderedText(page, text)` uses a bounded MutationObserver subscription.
`nextApplicationEvent(app, predicate, timeoutMs = 30000)` returns disposable
`{promise}`; register before the action and await it together with the action.
Disposal/timeout rejects with `EventWaitError`, not a hidden success.

From a sibling `tests/ui-editor/<producer>` test:

```ts
import { startEditorApplication, startEditorBrowser, authenticatedContext } from "../shared";
await using app = await startEditorApplication();
await using browser = await startEditorBrowser();
await using actor = await authenticatedContext(browser, app, { email: "mai@quire.local" });
const page = await actor.context.newPage();
await page.goto("/projects");
```

The fixture defaults to installed Playwright Chromium; `QUIRE_TEST_CHROMIUM`
can select an existing compatible executable. No install or dependency delta
was needed. UI-only fixtures may test rendering/state; they cannot establish
durable acknowledgments, ACLs, actual compiler/PDF/Git behavior or provider
integration. This fixture uses real services but these shared tests do not
claim panel, WebSocket convergence, PDF generation or external-provider acceptance.

## Complete U-row allocation

These scenario IDs are the downstream acceptance assignments, not passed claims.
All 30 primary rows whose Owner includes U are allocated below. Cross-cutting
Q03/Q04/Q06/Q08/Q11/Q13/Q15 remain integrated transport/assembly/verification
obligations. Assembly connects producer panels and the parent performs final QA.

| Matrix ID | Producer allocation | Scenario IDs / required observable |
| --- | --- | --- |
| A01 | source | T03-A01 syntax, completion, theme |
| A02 | source | T03-A02 Code Check and all suppression scopes |
| A03 | visual + source | T03-A03 shared document and unknown-source round trip |
| A04 | tools | T03-A04 tree keyboard navigation; T20-A04 splitter keyboard/drag integration |
| A05 | source | T03-A05 current-file heading outline |
| A06 | source | T03-A06 case/regex/word/selection find and replace |
| A08 | source | T03-A08 documented shortcuts and Mac completion |
| A09 | source | T03-A09 persisted Vim/Emacs emulation |
| A10 | source | T03-A10 persisted font size/family/line height |
| A11 | tools + visual + source | T03-A11 symbols/package hints and editable math in both modes |
| A13 | visual | T03-A13/T07-A13 tables, TSV and source preservation |
| A15 | visual + tools | T03-A15/T04-A15/T07-A15 real figures, captions/labels/width/package insertion |
| A16 | visual + tools | T03-A16 single-image PNG paste and actual preview |
| A21 | source + tools | T03-A21 independent locale/dictionary/spell/custom-word persistence |
| A26 | source + visual | T03-A26/T04-A26 non-BMP edits and surrogate boundaries |
| A27 | source | T03-A27/T20-A27 actual label completion, truthful glyph limits |
| C10 | pdf | T09-C10/T20-C10 real pages/zoom/presentation/two viewers/five layouts |
| C12 | source + pdf | T09-C12 source-search scope, no false PDF-search claim |
| C16 | pdf | T08-C16 actual optimization/draft advice without invented quota |
| C28 | tools | T03-C28/T18-C28 installed opt-in Pyodide execution and generated-file approval |
| A60b | source + tools + pdf | T03-A60b/T05-A60b/T20-A60b mobile/browser/offline/Labs/URL boundaries |
| D01 | source + visual + tools + pdf + review; later assistant adapter | T03-D01/T05-D01/T07-D01/T09-D01/T20-D01 workspace; T17-D01 assistant later |
| D02 | git; remote adapter integration later | T11-D02/T12-D02/T20-D02 actual staging/hunks/branches/commit/gate/clone/diffs; T16-D02 configured remotes |
| D03 | later assistant adapter phase | T17-D03/T20-D03 Ask/Agent/context/approval/provenance/accepted-change commits |
| D04 | review | T06-D04/T20-D04 timeline/filter/labels/compare/download/restore |
| D06 | tools + source; provider adapter integration later | T03-D06/T13-D06/T20-D06 search/symbols/local bibliography; T16-D06 remote references |
| D10 | review + source | T06-D10/T20-D10 tracked source, individual/bulk decisions and threads |
| D11 | pdf; later assistant adapter for AI fix | T08-D11/T20-D11 diagnostics/logs/artifacts/cache/last-good PDF; T17-D11 logged-error assistance |
| D13 | pdf | T10-D13/T20-D13 actual revision PDF comparison and downloaded diff |
| D20 | review + git | T05-D20/T14-D20/T20-D20 invite/roles/links/revoke/transfer/Git sharing/focus |

## Verification, artifacts and cleanup

Portable commands from the repository root:

```sh
bun test tests/ui-editor/shared
bun node_modules/typescript/bin/tsc --noEmit -p tests/ui-editor/tsconfig.json
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings apps/web/src/features/editor/shared tests/ui-editor/shared
```

Final owned `bash_8`: exit 0; **23 tests pass, 0 fail, 37 assertions, 47.59s**.
Strict TypeScript and type-aware lint both exit 0. Final receipt:
`EDITOR_FINAL_RECEIPT tests=0 types=0 lint=0`. Shared production/test directory
diagnostics were clean. The preceding `bash_7` also passed tests/types/lint/diff.

Retained evidence: `tests/ui-editor/shared/evidence/verification.txt`,
`projects-1440.png`, `projects-390.png`. The screenshots were visually inspected:
real seeded project/owner data is visible at 1440x900 and 390x844 viewports
(full-page captures), without blank or overlapping output. They show the
existing project screen, not a claimed finished editor.

Real-service cases prove session-client hydration, authorized project/source
reads, outsider denial, an exact pre-subscribed committed file mutation and an
anonymous share-scoped follow-up document read. Unit cases prove presentation
state and read-only/route behavior. No sleeps or polling were added.

Earlier failed receipts are retained, not suppressed: Vite port-zero selection,
missing SQL declaration inclusion/header contract, Bun/Playwright cookie URL,
four local lint findings and the server's old singular share URL. Each was fixed
at its own seam; foundation owns the header and emitted-link corrections.
No code/test failure remains in the final run.

Final fixture disposal awaited browser contexts/browser, app worker/realtime/
runtime, Vite, both owned HTTP listeners and temporary root. Closure receipt:
API `127.0.0.1:36731`, web `127.0.0.1:46065`,
`/tmp/quire-ui-editor-tlfIvS`; these are closed resources, not reusable services.
Every owned command has a terminal result. The readiness subscription had no
addressable terminal session at cleanup. No unrelated process was stopped.

Post-write review: modules each own one named responsibility; the largest is
152 pure lines. HTTP/route boundaries parse existing schemas; variants are
exhaustive. No any/casts/non-null assertions, suppressions, duplicate queues,
defensive layers, one-use abstractions, parameter bloat, negative flags or
redundant production verification were added. Errors propagate; logging is
limited to fixture evidence. Direct regressions cover shared runtime behavior;
interfaces receive strict static checks, not fake panel implementations.
The chosen boundary is injected native DTOs plus one transport-owned document,
not a new global client/store. External adapters and assistant implementation
remain required in their later phase.
