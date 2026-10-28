# Configured Dropbox synchronization

Capability IDs: **I43, P13, X-DROPBOX**. The implementation uses actual Dropbox
HTTP v2 endpoints, shared encrypted OAuth grants/receipts, current core ACLs,
adapter-owned Dropbox deny policy, real source blobs and prepared Git checkpoints.
No SDK or external process beyond the core Git CLI is required.

## Assembly

Create a fresh integration and shared factory for each runtime:

```ts
const dropbox = createDropboxIntegration({
  appKey: operatorDropboxAppKey,
  appFolder: "Apps/Quire",
});
const adapters = createAdapterModules({
  contributions: [dropbox.contribution],
});
// Include adapters.connections, adapters.providers, dropbox.module after core.
// Check dropbox.recoveryFailures after runtime construction.
dropbox.scheduler.start(); // Explicit opt-in; no implicit background timer.
// Stop HTTP admission, then await adapters.close(), then runtime.close().
```

Entrypoint: `services/adapters/dropbox/index.ts`. Value exports:
`createDropboxIntegration`, `migrations`, `DropboxApi`, `DropboxError`,
`dropboxEndpoints`, `DropboxPolicies`, `DropboxScheduler`. Type exports:
`DropboxOptions`, `DropboxEndpoints`, `TickSource`.

`createDropboxIntegration(options?: DropboxOptions)` returns `contribution`,
`module`, `policies`, `scheduler`, and `recoveryFailures`. Module
`064-x-dropbox`, lane X, order 64, supplies the new migrations and performs
bounded startup reconciliation. The shared factory must register first.

`DropboxOptions` has optional `appKey`, `appFolder: "Apps/Quire"`, and trusted
composition-only `endpoints`. Production endpoints default to Dropbox's official
authorization, token, RPC and content hosts. Operator HTTP input cannot replace
these endpoints. The configured provider base URL must have the RPC origin.

## Operator and user configuration

Register a single Quire-owned scoped Dropbox app, **App Folder** access, named
**Quire**. Obtain its app key and secret. Configure the public callback exactly:
`<QUIRE_PUBLIC_URL>/api/connections/dropbox/callback`. Dropbox app approval or
production status may be needed for the intended user population.

Provide the app key in trusted composition. Store the app secret through the
existing operator `PUT /api/admin/providers/dropbox` route, with
`baseUrl: "https://api.dropboxapi.com"`, current `policy`, `expectedVersion`
and matching `If-Match`. The runtime encrypts the secret under its existing
operator key. Do not place tokens in project files or logs.

Users use shared `POST /api/connections/dropbox/start`, complete the real
Dropbox authorization redirect, and receive an encrypted server-side grant.
Authorization requests S256 PKCE, state and offline access. Minimum scopes:
`files.metadata.read files.content.read files.content.write`.

Missing operator configuration, app key, app secret, App Folder confirmation,
incorrect API origin or missing Git CLI is reported as `unconfigured` with
the exact missing prerequisite. A configured app is not a connected account.
No live account or third-party success is inferred from local tests.

## Actions and persistent outcomes

Use existing `POST /api/connections/:grant/actions`, `Idempotency-Key`,
`expectedVersion`, `projectId` and `expectedCursor`.

- `initialSync`: owner-only project enrollment and first reconciliation.
- `sync`: owner-only reconciliation of an enrolled project.
- `disconnect`: stop that project's schedule without deleting either source
  tree or revoking other project bindings. Pending recovery must finish first.
- Shared `DELETE /api/connections/:grant` actually revokes the bearer token
  and clears grant ciphertext, affecting all its project bindings.

Sync parameters are `{ branch?: string, generatedOutput?: boolean }`.
The default branch is the project's current default. Branch changes require a
project disconnect/re-enrollment. Shared cursors are action-specific: the first
`sync` action has `expectedCursor: null` even after `initialSync`. Later actions
use the matching action's committed cursor. The provider cursor itself is
durable in `dropbox_sync` and crosses action boundaries correctly.

Dropbox's App Folder API root already maps to `Apps/Quire`; do not prepend that
prefix to API requests. Each project uses its stable UUID directory. Project
title changes do not silently rename Dropbox directories.

The merger compares local blob digest, provider revision and stable provider
file ID. Uploads use add or revision-conditional update, strict conflicts and
disabled autorename. Deletes use `parent_rev`; folders are never blindly
deleted remotely. Downloads pin `rev:` and verify provider identity, revision
and Dropbox's 4-MiB-block content hash. The shared HTTP transport bounds each
request/response to 8 MiB by default and enforces TLS/egress policy.

Remote adds/edits/deletes publish actual local source through
`prepareSource`/`finalizePreparedSources`, not provider-only metadata.
Concurrent edits/deletes keep original local bytes and create deterministic
`.dropbox-conflict-*` source copies for remote bytes. A required TeX main is
never silently deleted. Local or remote rename conflicts are explicit records
containing both paths and the copy path; neither side is silently renamed over
the other. Conflict records remain an audit of the reconciliation, not a claim
that the user has chosen a winning version. Users resolve copies using ordinary
core source/file APIs; subsequent explicit edits are synchronized conditionally.

Archived projects are outbound-only. Remote edits remain pending against the
old baseline and are reconsidered when the user's project becomes active.
Trash rejects synchronization. Archive state, ACL, grant/configuration fences
and Dropbox policy are checked again before source/cursor publication.

Generated output is **off by default**. Opt-in forwards actual stored PDF,
DVI and generated artifacts from the latest successful compile job into
`.quire-generated/<job-id>/<artifact-name>`. This namespace is outbound-only
and never imported as editable source. Artifacts are immutable by job; external
modification fails explicitly instead of overwriting. PDF source assets outside
this namespace remain ordinary synchronized project files.

## Policy controls

The shared Policy DTO does not yet have a Dropbox field. This implementation
provides an explicit typed adapter policy rather than repurposing AI/sharing.

```ts
await dropbox.policies.set({
  actorId,
  scope: { kind: "project", id: projectId }, // Or organization + organization ID.
  enabled: false,
  expectedVersion: 0,
});
```

Project changes require its current owner; organization changes require its
current administrator. Active account checks, optimistic versions, redacted
`audit_entries` and `policy.changed` commit with the policy. Any applicable
organization deny wins over project allow; no row means allowed, subject to
current core ACLs and provider/grant availability. Deny is rechecked before
each outbound mutation and inside final publication.

Composition must expose this setter through its chosen typed administration
surface. This adapter does not change shared schemas or editor UI ownership.

## Recovery and scheduler lifecycle

`dropbox_journal` persists mutation intent before dispatch and the complete
prepared source/state before Git publication. A fresh process reconciles
uncertain uploads/deletes from real provider state, rather than blindly replaying
mutations. Equal content hashes acknowledge already-completed uploads.
Prepared Git/source, provider cursor, baseline, operation receipts and events
commit through supplied SQL transactions. Original receipt completion is
reconciled after a failed/crashed attempt.

If source moved after preparation but before Git publication, recovery keeps current source and imports
prepared bytes as explicit `.dropbox-recovery-*` copies, retaining the prior
input bytes in the new immutable checkpoint. It does not overwrite a newer local
branch. The repository contract permits one unfinished publication per project,
so normal core writers cannot advance a branch after that publication exists.
An externally corrupted stale branch with an already-published checkpoint fails
explicitly as `DROPBOX_RECOVERY_CONFLICT`, retaining its journal for reconciliation.

`recoveryFailures` names startup blocks such as current policy denial, revoked
credentials, unexpired durable claims or provider failures. Pending journals
remain durable and are retried by scheduler pumps after authority/lease/backoff
allows it. Current owner/grant/configuration authority is always reapplied.

`scheduler.pump()` performs recovery and due work under runtime background
admission. `start(ticks?: TickSource)` subscribes to explicit ticks (default:
one-minute unreferenced timer); due work is every 15 minutes after completion.
`TickSource.subscribe(listener)` returns its unsubscribe function, enabling
controlled-clock deterministic tests. Pumps coalesce. `close()` unsubscribes
and drains work. `lastFailures` and `lastFailure` expose scheduled errors.
Expired OAuth credentials refresh before scheduled work. Manual callers can
use the shared connection test/refresh flow before retrying an expired grant.

HTTP 429 persists Retry-After independently of success cursors. Clock advancement,
not a test sleep, permits retry. HTTP/transport uncertainty leaves the mutation
journal and old cursor intact.

## Verification

```sh
bun test tests/adapters/dropbox
./node_modules/.bin/tsc -p tests/adapters/dropbox/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/dropbox tests/adapters/dropbox
```

The stateful local API fixture validates OAuth/PKCE, token refresh/revocation,
binary body/header hashes, revision CAS, conditional delete, cursor pages/reset
and injectable errors/barriers. Tests drive real authenticated HTTP actions
and actual persisted SQLite/blob/Git source. This is not live Dropbox evidence.
