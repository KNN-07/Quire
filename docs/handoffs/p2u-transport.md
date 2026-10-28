# P2U browser transport - FINAL

October 27, 2026. Implemented and verified on native Bun 1.3.14. The final
`p2u-contract.md` was read after its 23-test/types/lint and cleanup receipts
were published. No shared document signature changes or dependency deltas
were required.

## Public consumer API

Entry: `apps/web/src/features/editor/transport/index.ts`.

```ts
type SocketFactory = (url: URL, protocols: readonly string[]) => WebSocket;
type TransportOptions = {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly openSocket?: SocketFactory;
};
interface EditorTransport {
  readonly open: (file: FileEntry) => Promise<EditorDocument>;
  readonly reconnect: () => void;
  readonly dispose: () => Promise<void>;
}
function createEditorTransport(options: TransportOptions): EditorTransport;
class TransportError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}
```

Create one controller per project/branch workspace. `open` fetches the actual
`fileDocument` DTO and caches the same document, awareness, queue and connection
for repeated file opens. Both authoring modes consume that `EditorDocument`;
neither should create or destroy another Y.Doc or awareness owner.

The shared `getSnapshot/subscribe/replace/flush` signatures are implemented
directly. Snapshots remain stable until publication. `replace` applies validated
non-overlapping UTF-16 ranges atomically and rejects read-only edits. CodeMirror
transactions on the same Y.Doc enter the same queue. `flush(signal?)` awaits
matching acknowledgments for work present at invocation; it rejects on recovery,
closure or cancellation. Sending or receiving a broadcast is not a save receipt.

Assembly must flush or explicitly recover before disposing a controller or
changing branches; offline file/branch switches and privileged requests remain
blocked by the shared consumer contract. Keep the controller alive while
recoverable offline work is needed. Pending edits are retained in this live
document, not represented as a browser-persistent authoritative store.
After explicit editor-link admission, refresh workspace and reconnect to obtain
current effective editing access.

## Protocol and lifecycle

HTTP document/access calls use the injected typed client and each workspace's
`requestHeaders`. Named WS initialization obtains the actual session CSRF token
through that client, offers `quire` and `quire.csrf.<token>`, and uses its realtime
URL builder. Only the WS upgrade receives the scoped `share` query. Anonymous
readers do not send authenticated presence. No token enters a global client.

Each file has a UUID client sequence namespace, immutable queued update bytes,
one in-flight sequence and exact client/sequence receipt matching. Reconnect
syncs the retained state vector, then resends pending sequences in order,
including lost-ack retries. Remote-origin updates never enter the local queue.
Only an empty acknowledged queue becomes saved.

Offline source editing has a five-minute window measured from the original
disconnect; failed synchronization does not renew it. Retry uses a cancellable
one-second reconnect timer. Epoch changes, removal, authorization errors and
session revocation retain local source in recovery instead of replacing it.
Server recovery text is exposed separately when the protocol supplies it.

An abortable ky SSE stream forwards share headers, parses `EventSchema`, retains
its cursor, and refreshes effective access on access/policy invalidation.
Native EventSource/query-token workarounds are not used. Presence maps actual
server user identities into awareness, validates Yjs source-relative cursors,
coalesces updates for the server throttle and excludes self/remote echoes.

## Verification and retained evidence

Repository-root command, owned terminal `bash_13`, **exit 0**:

```sh
bun test tests/ui-editor/transport &&
bun node_modules/typescript/bin/tsc --noEmit -p tests/ui-editor/transport/tsconfig.json &&
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings \
  apps/web/src/features/editor/transport tests/ui-editor/transport
```

**10 tests passed, 0 failed, 36 assertions, 6.48 seconds.** Exact command,
terminal output, teardown markers and size audit are retained in
`tests/ui-editor/transport/evidence/final-receipt.txt`. Final LSP scans reported
zero diagnostics across five production and six test files.

Real HTTP/WS tests use persistent SQLite/blob/Git services and independent
authenticated users. They assert concurrent Unicode source/Yjs byte convergence,
durable bytes after runtime restart, lost-ack idempotent replay plus ordered
offline edits, actual Viewer wire rejection, live membership downgrade,
session/token revocation, anonymous token-only initialization without credential
leakage, epoch recovery and receiver-resolved relative presence positions.
Two direct queue tests additionally distinguish wrong-client/wrong-sequence
acks and preserve the original offline deadline with a controlled clock.
Subscriptions precede actions and have bounded failure timeouts; no sleeps or
polling make a test pass.

Earlier terminal results remain in session receipts: `bash_4` passed the initial
two convergence/retry tests; `bash_6` found local lint issues subsequently fixed;
`bash_8` found an invalid test main lacking `documentclass`, corrected to valid
TeX; `bash_10` and `bash_12` passed their expanded gates. No failure was suppressed
or test weakened. `bash_1/2/3/5/7/9/11/14` also have terminal exit-zero receipts.

## Cleanup, review and remaining ownership

Every fixture awaits controller disposal and verifies its owned native sockets
are CLOSED. Raw hostile clients use awaited async disposal. SSE readers are
cancelled, request controllers aborted, reconnect/offline/presence timers
cleared, awareness/documents destroyed, owned ephemeral listeners disposed and
all ten unique fixture roots removed. No owned process remains; shared
5173/3001 listeners were not touched.

Post-write review: files own document persistence, connection lifecycle,
presence adaptation, byte encoding or controller caching. The largest is
198 pure LOC, below the warning band. Existing schemas parse wire boundaries;
variant dispatch is exhaustive. No casts, any annotations, non-null assertions,
suppressions, redundant production checks, one-use abstractions, parameter
bloat or negative flags were introduced. Required mutable state belongs to its
single lifecycle owner. Direct regressions distinguish the implemented behavior;
logging is restricted to fixture cleanup receipts.

Authored changes are limited to the assigned transport/test paths and this
handoff. Original HTML/archive, sibling files, root dependencies and Git history
were not changed. No commit or push was made. This is transport evidence, not
assembled editor/browser acceptance: parent performs final browser QA.
External adapters and AI assistant implementation remain required later work.
