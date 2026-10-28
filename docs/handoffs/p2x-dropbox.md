# P2X Dropbox synchronization

Owner: `st_01a17c78`. October 27, 2026.
**Status: COMPLETE within the assigned Dropbox adapter boundary.**
Native Bun 1.3.14 terminal tests, strict typing and type-aware lint pass.
No live Dropbox account success or complete application assembly is claimed.

Capability IDs: **I43, P13, X-DROPBOX**. Read contracts include implementation
plan sections 3 and 7-10, feature matrix, accepted P1S verification, final
`p2x-base.md`, actual asynchronous runtime/SQL ports and real core source APIs.
Editor U and shared foundation/composition files were not edited.

## Public exports and assembly

Entrypoint: `services/adapters/dropbox/index.ts`.

Value exports: `createDropboxIntegration`, `migrations`, `DropboxApi`,
`DropboxError`, `dropboxEndpoints`, `DropboxPolicies`, `DropboxScheduler`.
Type exports: `DropboxOptions`, `DropboxEndpoints`, `TickSource`.

```ts
type DropboxOptions = {
  readonly appKey?: string;
  readonly appFolder?: "Apps/Quire";
  readonly endpoints?: DropboxEndpoints;
};
type DropboxEndpoints = {
  readonly rpc: string;
  readonly content: string;
  readonly authorization: string;
  readonly token: string;
};
type TickSource = {
  readonly subscribe: (listener: () => void) => () => void;
};
```

`createDropboxIntegration(options?: DropboxOptions)` returns `contribution`,
`module`, `policies`, `scheduler`, and `recoveryFailures`.
Include its contribution in `createAdapterModules({ contributions })` and
its module in runtime modules after the shared adapter factory.
Create a fresh integration/factory on each runtime construction.
Module `064-x-dropbox`, lane X, order 64, supplies migrations and awaits startup
recovery. Inspect `recoveryFailures`; denied/revoked/busy work stays journaled.
No background timer starts implicitly.

`DropboxPolicies.set({ actorId, scope: { kind: "organization" | "project",
id }, enabled, expectedVersion }): Promise<number>` authorizes the current
organization administrator or project owner, respectively.
`assert(actorId, projectId, executor?)` uses the provided executor for fenced
publication. Organization deny wins over project allow. Mutations include
redacted native audit entries and transactional policy events.

`DropboxScheduler.start(ticks?: TickSource): void`,
`pump(): Promise<readonly { readonly grantId: string; readonly error: unknown }[]>`,
and `close(): Promise<void>` expose controlled-clock lifecycle.
`lastFailures` and `lastFailure` expose scheduled errors. Scheduling uses
15-minute due times, one-minute default ticks, coalesced pumps and runtime
background admission; token refresh precedes expired-grant scheduled work.
Stop HTTP admission, await shared factory `close()`, then runtime `close()`.

Full setup/action/recovery documentation:
`services/adapters/dropbox/README.md`.

## Observable behavior

The production adapter uses real Dropbox OAuth/HTTP v2, shared encrypted
runtime secrets, actor-owned grants, idempotency receipts and durable claims.
It supports `initialSync`, `sync` and project `disconnect` through shared grant
actions. Shared connection deletion actually revokes the bearer token.

API root already means **Apps/Quire** for App Folder grants; projects occupy
stable UUID directories. Recursive pagination uses actual provider cursors.
Reset performs a full rescan. Source PDFs remain source assets; opt-in generated
artifacts are separately labeled under `.quire-generated/<job-id>/`.
That namespace is outbound-only and never imported as source.

Adds/edits/deletes change real persisted source, Yjs document materialization,
blob references and Git checkpoints through `prepareSource` and
`finalizePreparedSources`. HTTP/Git preparation occurs outside SQL transactions.
Publication uses the supplied transaction executor and shared grant/config/ACL
fences. Source, cursor, baseline, result receipt and events commit together.

Uploads use add or strict revision-conditional update, without autorename.
Deletes require `parent_rev`. Downloads pin the exact revision and verify
identity/content hash. Concurrent edit/delete conflicts preserve both sides
through actual source copies, and rename conflicts include explicit path
metadata. Required-main deletion does not silently destroy the project.
Archived projects are outbound-only; held inbound edits apply after unarchive.
Trash rejects synchronization. Late policy denial or grant clearing fences
source/cursor publication.

Mutation intent precedes remote dispatch; complete prepared source/state
precedes Git publication. Restart reconciles uncertain uploads without duplicate
writes and restores prepared source plus the original operation receipt.
Pre-Git stale preparation becomes explicit recovery source copies rather than
overwriting newer local bytes. The actual repository contract permits only one
unfinished publication per project: normal core writers cannot advance a branch
after that publication exists. An externally inconsistent stale published
checkpoint fails explicitly with its journal retained.

HTTP 429 stores Retry-After independently of committed success cursors.
No fixed test sleep, silent provider overwrite, provider-only source success,
type suppression or missing-port cast is used.

## Migration preservation

Additive migration `064-x-dropbox` creates `dropbox_sync`,
`dropbox_journal`, `dropbox_policies`, and `dropbox_retries`.
SQLite uses STRICT tables; PostgreSQL has an explicit authored variant.
Exact exported SQL SHA-256:

- SQLite: `644e3ec772c665630ca0097e5f245d8cc64910d533c442f667cd7e9299d98d14`
- PostgreSQL: `69f26fcc6350c6e4e0ecd61e9153a93ac763e570d5713774f2d9912089040695`

No original SQL, applied digest, original input or shared file was edited.
The restart regression retains every existing migration row, including digest
and applied timestamp, byte-for-value. This task did not execute its new
PostgreSQL variant against a real PostgreSQL instance; accepted P1S storage
verification is not claimed as execution of this new adapter migration.

## Terminal checks and retained evidence

All paths below are under `docs/evidence/p2x-dropbox/`.

| Command | Terminal result | Evidence |
| --- | --- | --- |
| `bun test tests/adapters/dropbox` | Exit 0; 39 pass, 0 fail, 95 expectations, 8 files, 38.09 s | `native-final.log` |
| `./node_modules/.bin/tsc -p tests/adapters/dropbox/tsconfig.json` | Exit 0 | `static-final.log` |
| `./node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/dropbox tests/adapters/dropbox` | Exit 0 | `static-final.log` |
| Owned diagnostics | 13 implementation + 12 test files, 0 errors | `static-final.log` |
| Native migration digest/Git probe | Exit 0; Git 2.53.0 | `static-final.log` |
| Owned process/temp/whitespace probe | Exit 0; no test process or shared fixture temp roots remain | `cleanup-final.log` |

The local API fixture validates real OAuth code/redirect/PKCE, scoped tokens,
refresh/revocation, paginated cursors/reset, upload hash/CAS and conditional
delete. Error and concurrency barriers exercise rate limits, uncertain writes,
concurrent edits/deletes, SQL rollback, stale preparation, restart, archive,
policy denial, grant revocation, generated opt-in and binary/Unicode source.
The generated-output fixture tests forwarding actual persisted artifact bytes;
it does not claim a new compiler/PDF-generation verification.

Expected `request.failed` codes from deliberate provider, publication and grant
failures remain in the raw passing log. Historical failed checkpoints and their
root fixes are recorded in `contract-delta.md`; tests were not deleted, skipped
or weakened to obtain the final passing run.

Post-write review: all owned TypeScript files are below 200 pure lines; largest
is synchronization at 169 (`size-final.log`). Files have single responsibilities,
provider inputs parse at boundaries, tagged variants dispatch exhaustively, and
there are no escapes, speculative null layers, suppression comments, negative
flags or new logging framework. Shared helpers have actual multiple callers;
larger domain units isolate protocol/merge/recovery responsibility. Signatures
stay within three parameters; workspace/state and transport dependencies are
grouped explicitly. No production post-delete verification was added. Direct
regressions exercise the behavior through real HTTP and persisted core source.

## Concrete parent delta and external prerequisites

The current shared `PolicySchema` has no Dropbox field. This adapter therefore
exports the authorized durable `DropboxPolicies` boundary instead of casting a
new field or reinterpreting AI/sharing policy. **Parent integration must expose
that setter through its chosen typed organization/project administration
surface, or supply the equivalent shared policy contract.** The direct deny-wins
behavior itself is implemented and tested. Shared factory/module composition
is also parent-owned. No root dependency or foundation change is required by
this implementation.

Two parent `thread_send` attempts failed with `unknown_cause` and
`The delivery this send continues is not one the sender received.`
`contract-delta.md` retains the exact reporting failure. This handoff is the
concrete integration delta; successful live message delivery is not claimed.

Live external gates: a Quire-owned Dropbox scoped App Folder registration
named Quire, app key, encrypted operator-configured app secret, exact registered
public callback URI, applicable Dropbox production approval and explicit user
OAuth consent for its app folder. Git CLI must be installed; the runtime supplies
its existing encrypted-secret key. Missing configuration/tools are reported
exactly as unconfigured. Default shared HTTP request/response bound is 8 MiB.
No real credentials were supplied and no live/paid external account write was
performed. Local fixture success is not live Dropbox success.

Official primary documentation consulted October 27, 2026 (Context7 unavailable,
so fetched directly from Dropbox):

- https://developers.dropbox.com/oauth-guide
- https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/list-folder.md
- https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/list-folder-continue.md
- https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/download.md
- https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/upload.md
- https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/delete-v-2.md
- https://www.dropbox.com/developers/reference/content-hash

The final handoff was written only after terminal checks and cleanup ended.
All owned fixture listeners, runtimes/repositories and temporary roots closed.
No browser/container was created; shared Docker images and 5173/3001 were
untouched. No workspace commit/push or nested agent was used.
