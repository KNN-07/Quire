# P2U editor sharing, review and history - FINAL

October 27, 2026. Implemented and verified on native Bun 1.3.14.

This handoff covers the editor review producer only: D04, D10, D20 and the
review-facing C31-C40 workflows. It does not claim editor assembly, the later
external adapter/AI assistant implementation, provider integrations, the
parent's separate cursor-presence throttle regression, or whole-transport
acceptance.

## Ownership and inputs

Authored paths:

- `apps/web/src/features/editor/review/**`
- `tests/ui-editor/review/**`
- `docs/handoffs/p2u-review.md`

Consumed without sibling edits:

- `apps/web/src/features/editor/shared/**`
- `apps/web/src/features/editor/transport/**`
- the injected `EditorClient`
- `endpoints.suggestionsList` and the existing access/review/history routes
- shared UI primitives and global Quire tokens

The original HTML, research archive, root manifests, application router, shared
contracts, backend services and sibling producer directories were not edited.
No dependency delta, commit or push was made.

## Public exports

Production entry: `apps/web/src/features/editor/review/index.ts`.

```ts
export function ReviewPanel(props: ReviewPanelProps): React.JSX.Element;

export function createAnchor(
  document: EditorDocument,
  selection: SourceSelection,
): Anchor;

export function resolveAnchor(
  document: EditorDocument,
  anchor: Anchor,
): {
  readonly from: number;
  readonly to: number;
  readonly location: SourceLocation;
} | null;

export type ProjectEventSubscription = {
  readonly promise: Promise<void>;
  readonly dispose: () => void;
};

export function subscribeProjectEvents(input: {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly topics: ReadonlySet<Event["topic"]>;
  readonly onOpen?: () => void;
  readonly onEvent: (event: Event) => void;
}): ProjectEventSubscription;
```

`ReviewPanel` consumes the frozen `ReviewPanelProps` contract and renders the
requested `"review" | "history" | "share" | "chat"` view. Assembly continues to
own the editor shell and routes.

## Implemented behavior

### Sharing and access - D20, C32-C33, C39-C40

- Named Editor, Reviewer and Viewer invitations.
- Pending invitation display, resend and revocation.
- Member role changes, removal and ownership transfer.
- Lesser-role Reviewer/Editor access requests with owner accept/decline.
- Viewer authority remains unchanged before an accepted request.
- Off, anonymous Viewer and authenticated Editor link modes; Reviewer links are
  intentionally absent.
- One-time link display/copy and real link revocation.
- Anonymous link read succeeds only while the link remains live.
- Named membership survives link revocation.
- Git sharing navigation.
- Project/organization sharing policy errors are reported by the real server.
- Owner and Viewer sessions observe actual access state; server checks remain
  authoritative.

### Anchored comments and moderation - D10, C31, C34

- Yjs relative-position anchors from the live `EditorDocument`.
- Exact quote and epoch resolution; stale epochs do not silently rebind.
- Open/resolved/all filters and source navigation.
- Thread creation, reply, comment-author edit/delete, resolve, reopen and
  resolved-thread deletion.
- Permanent tombstone behavior is preserved by backend restore; the UI states
  this boundary.
- Comments are disabled while transport is connecting, offline, closed or in
  recovery.
- Viewer writes are denied by the real server, not only hidden in the UI.

### Persisted tracked proposals - D10, C35

- `endpoints.suggestionsList` is the authoritative proposal read path.
- Branch, current-file/project-overview and
  all/pending/accepted/rejected/conflict filters.
- Full suggestion DTOs remain visible when one edit matches a filter.
- Reviewer proposal creation never mutates raw source.
- Per-edit, selected and all accept/reject decisions.
- Proposal state refresh on `review.changed`.
- Branch authority and proposal refresh on `tree.changed`.
- Proposals appear live in a separate Owner session and survive full reload.
- Real exact-before divergence returns and renders `conflict`.
- Conflict state survives reload and renders at desktop and mobile widths.

### Project chat - C36

- Named Viewer/Reviewer/Editor/Owner chat when current policy permits.
- Chronological persisted messages and live second-session updates.
- Anonymous readers cannot chat.
- Policy-disabled and offline/recovery-disabled states are explicit.
- Assistant chat is not conflated with project chat.

### History and restore - D04, C37-C38

- Immutable timeline, labels-only filter, authors and accessibility state.
- Label add/remove with the returned history aggregate version.
- Exact changed-file and before/after comparison.
- Comparison copy and real source ZIP download.
- Full-version and file-only restore.
- Deleted-file recovery while unrelated files are preserved.
- Restore creates a new revision/epoch.
- A second live editor observes epoch recovery.
- Permanent comment tombstones are not resurrected.
- Admission/replay correction was reverified on the final input: no
  `ADMISSION_EXPIRED` remained.

## Focused verification receipts

All commands ran from `/home/norman/Repos/Quire`.

### Persisted proposal completion

```sh
bun test tests/ui-editor/review/suggestions.browser.test.ts
```

Exit 0: **1 pass, 0 fail, 3 assertions, 44.67s**.

Observed sequence:

- `live-and-reload`
- `source-diverged`
- `conflict-rendered`
- `conflict-reloaded`
- `screenshots-written`

The focused browser test uses independent Reviewer and Owner sessions, then a
real admitted source transaction to create exact-before divergence.

### Sharing and access

```sh
bun test tests/ui-editor/review/share.browser.test.ts -t "shares with live"
bun test tests/ui-editor/review/share.browser.test.ts -t "accepts a live Viewer"
```

Final exits 0:

- Sharing/invitations/roles/links/revocation/transfer:
  **1 pass, 0 fail, 10 assertions, 68.02s**.
- Access request and pre-approval Viewer denial:
  **1 pass, 0 fail, 3 assertions, 47.32s**.

### Comments, local decisions and chat

```sh
bun test tests/ui-editor/review/review-chat.browser.test.ts
```

Exit 0: **1 pass, 0 fail, 20 assertions, 68.79s**.

This covers anchored comment persistence, author editing/deletion, reply,
moderation, selected/all decisions, actual source changes, Viewer denial,
live/persisted chat and policy-disabled chat. Persisted proposal reload/conflict
was subsequently completed by the focused test above.

### History comparison and recovery on corrected admission input

```sh
bun test tests/ui-editor/review/history.browser.test.ts
```

Exit 0: **1 pass, 0 fail, 8 assertions, 57.65s**.

Observed:

- changed-file comparison
- source ZIP download
- deleted-file recovery
- full restore
- second-session epoch recovery
- settled desktop/mobile capture
- no `ADMISSION_EXPIRED`

### Yjs anchor regressions

```sh
bun test tests/ui-editor/review/anchors.test.ts
```

Exit 0: **2 pass, 0 fail, 2 assertions**. Insertion before an anchor preserves
the selected quote; epoch replacement invalidates the old anchor.

### Static gates

```sh
bun node_modules/typescript/bin/tsc --noEmit \
  -p tests/ui-editor/review/tsconfig.production.json --pretty false
bun node_modules/typescript/bin/tsc --noEmit \
  -p tests/ui-editor/review/tsconfig.json --pretty false
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings \
  apps/web/src/features/editor/review tests/ui-editor/review
bun /home/norman/.omo/binary-runtime/5.1.48/plugin/skills/frontend/scripts/perfection/check-draft-guard.ts \
  apps/web/src/features/editor/review tests/ui-editor/review
```

All exit 0. Draft guard: **21 files clean**.

The standalone programming-skill no-excuse script targets TypeScript 7 unstable
subpaths while this repository pins TypeScript 5.9.3, so it was not used as a
substitute for the passing strict `tsc` and type-aware oxlint gates.

## Retained browser evidence

All captures are fresh after their final rendered-source changes and were
visually inspected.

- `tests/ui-editor/review/evidence/share-1440-light.png`
- `tests/ui-editor/review/evidence/share-390-dark.png`
- `tests/ui-editor/review/evidence/review-1440-light.png`
- `tests/ui-editor/review/evidence/review-390-dark.png`
- `tests/ui-editor/review/evidence/chat-1440-dark.png`
- `tests/ui-editor/review/evidence/chat-390-light.png`
- `tests/ui-editor/review/evidence/history-comparison-1440-dark.png`
- `tests/ui-editor/review/evidence/history-1440-dark.png`
- `tests/ui-editor/review/evidence/history-390-light.png`

The captures show the 620px sharing surface, single-column 390px reflow,
persisted proposal conflict, project-chat disabled state, changed/deleted file
comparison, and settled post-restore history. No final frame contains a loading
spinner, clipped primary content or the former missing-contract error.

Parent-owned final browser QA remains the independent visual acceptance gate.

## Cleanup and boundaries

- Every browser scenario used the shared same-origin `app.url` fixture:
  Node-owned Vite proxy, Bun API/realtime service, OS-assigned loopback ports.
- Browser pages, contexts and Chromium were awaited and closed.
- Event readers, realtime sockets and reconnect timers were disposed.
- API/runtime, worker, Node proxy and unique fixture roots were awaited through
  the shared `AsyncDisposableStack`.
- Final process checks found no `tests/ui-editor/review` process.
- No owned legacy `/tmp/quire-ui-review-*` root remains.
- Existing 5173/3001 listeners and unrelated processes were never stopped.
- No failure was suppressed, no test was weakened, and no fake PDF/count/result
  was introduced.

## Post-write review

Files own one responsibility: panel routing, anchors, event invalidation,
sharing, access lists, proposals, comments, chat, history or focused fixtures.
The largest production module remains below the 250 pure-line ceiling.
Boundaries use generated endpoint schemas and the injected client; no `any`,
type assertion, non-null assertion, suppression, raw untyped fetch, browser-only
authoritative proposal store or Reviewer source mutation was introduced.

External adapters and the real AI assistant remain required in their later
phase and are not claimed here.
