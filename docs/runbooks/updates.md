# Signed releases and controlled updates

Updates are disabled until the operator configures a release feed, pinned
Ed25519 public key, dedicated installation root, maintenance interval, and the
real recovery/quiescence adapter. No built-in latest version or vendor URL is
invented. Never point the updater at the source checkout or a system directory.

## Configuration and release format

`UpdateConfig` parses the following operator-owned JSON (replace every example
value with deployment configuration). `currentSequence` is the minimum accepted
release sequence; durable successful installation state overrides the initial
version. Preserve that state when moving the installation.

```json
{
  "feedUrl": "https://releases.example.invalid/quire/feed.json",
  "trustKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
  "installRoot": "/srv/quire-owned-install",
  "installId": "quire-instance",
  "currentVersion": "1.0.0",
  "currentSequence": 1,
  "schemaVersion": 6,
  "window": {
    "start": "2026-10-27T20:00:00.000Z",
    "end": "2026-10-27T21:00:00.000Z"
  },
  "allowLoopbackHttp": false
}
```

The provisioned root must be a real directory, contain the regular operator
marker `.quire-update-root` whose exact bytes equal `installId`, contain the
real directory `releases`, and have `current` as a relative symlink to an
existing real directory `releases/<safe-name>`. Provisioning the root and an
initial release is an operator deployment step, not an updater side effect.
The updater stages into this root only and never deletes prior releases.

The feed envelope is `{ "payload": "<base64>", "signature": "<base64>" }`.
Sign the exact decoded payload bytes with Ed25519, not a reserialized object.
The decoded payload is `{ "expiresAt": "<ISO instant>", "releases": [...] }`.
Each release contains:

```json
{
  "id": "b12cbf15-7018-4a1d-a4bd-aa235322605d",
  "version": "2.0.0",
  "sequence": 2,
  "security": true,
  "notes": "Operator release notes",
  "expiresAt": "2026-10-28T00:00:00.000Z",
  "compatibleSchema": [6],
  "packageUrl": "https://releases.example.invalid/quire/package.json",
  "packageDigest": "<64 lowercase hexadecimal SHA-256 characters>",
  "packageBytes": 1234
}
```

Version numbers are three nonnegative numeric components; sequence and version
must both increase. HTTP is allowed only for explicitly configured literal
loopback fixtures. Package URLs must share the configured feed origin; URL
credentials, fragments, and redirects are rejected. Packages are bounded at
256 MiB, feeds at 4 MB, with 30-second request/body deadlines and no retries.
Expiry is checked at discovery and again at installation. The signed manifest
must still appear unchanged in the current feed when the job executes.

The digest covers exact package bytes. The package JSON is
`{format:1,entrypoint:"bin/quire",files:[{path:"bin/quire",data:"<base64>",executable:true}]}`.
Only regular files are supported. Absolute paths, traversal, duplicate paths,
symlinks, and absent/nonexecutable entrypoints fail validation. The format does
not execute archive hooks or installation scripts. The configured safety
adapter performs migration preflight, migration and health verification.

## Validate and schedule

```sh
bun scripts/ops/update.ts list /path/to/operator-config.json
bun scripts/ops/update.ts validate /path/to/operator-config.json
```

These commands only read the signed feed/packages; they do not install. Exit 0
means validation completed, 1 means validation failed, and 2 means invalid CLI
arguments. A signing key's private half must never be put in API configuration.

An operator uses `GET /api/admin/releases`, then submits
`POST /api/admin/updates` with `{releaseId,at,autoSecurity}` and an idempotency
key. Mutation requires a current operator session, same-origin CSRF validation,
and authentication no older than 15 minutes. `autoSecurity:true` only admits a
signed security release; it never selects an arbitrary future release or URL.
The response is the durable queued operation; existing operationGet and
operationsList expose its actual phase progress, error and final receipt.
The accepted time must fall inside the configured half-open maintenance
interval. An overdue job fails rather than silently updating after it closes.

Root composition registers `migrations` and calls
`registerUpdates(context,{config,safety})`. It starts
`startScheduler(service,onError)` and awaits scheduler `close()` before closing
runtime storage. Run the scheduler on the designated installation host, not on
every API replica with a different local filesystem. An injected `UpdateTimer` supports controlled-clock tests;
production uses an exact next-deadline timer. Only one pending update is
admitted; SQL aggregate locking, persisted claim state and an exclusive
filesystem lock protect installation. The caller must provide an error sink
for scheduler errors.

## Safety and recovery

The safety adapter must close mutation admission and drain HTTP, realtime,
repository and compiler work across all deployment roles. Its quiescence gate
remains held while a full verified backup is created, migration preflight runs
against an isolated restored target, live migration executes, the atomic
`current` symlink switch occurs, and the new executable passes health checks.
An editor-readonly flag or a caller's assertion is not a quiescence adapter.
The backup receipt is persisted before migration. The installation receipt
records previous/staged paths, backup digest/id, release id/version and rollback.

On migration or health failure, the old symlink is restored and the verified
backup is restored before admission reopens. A failed candidate remains under
its unique release directory for diagnosis; it can never replace the prior
version merely by existing. After success, the prior version remains available
and the durable sequence floor prevents replay/downgrade.

If rollback fails, the operation remains running with `ROLLBACK_FAILED` and
`recovery_required` phase. Admission and the lock are deliberately retained.
After stopping competing schedulers and investigating the backup, an operator
may invoke `service.recover(operationId, "recover <installId> <operationId>")`
through a trusted maintenance host. Generic `yes` is rejected. Recovery restores
the prior target and the recorded verified backup, writes an interrupted-update
receipt, releases its matching lock and reopens admission only after success.
A process crash also requires this explicit recovery; startup never steals a
lock or assumes that an interrupted migration completed. Do not delete a lock
to force an installation.

Root must bridge the backup boundary and installer boundary using actual
database/blob/repository recovery, and must arrange adapter reconnection if
rollback restores the control database. This lane does not pretend an
unconfigured host supports safe live updates.

## Verification

```sh
bun test tests/operations/updates
bun x tsc --noEmit -p tests/operations/updates/tsconfig.json
bun x oxlint --type-aware --deny-warnings services/operations/updates scripts/ops/update.ts tests/operations/updates
bun tests/operations/updates/postgres-check.ts <owned-disposable-postgres-url>
bun tests/operations/updates/evidence.ts
```

Tests use owned `quire-updates-*` temporary roots, fresh signing keys, ephemeral
loopback HTTP listeners, a real built Bun executable bundle and actual SQLite
backup/restore. No system installation, source checkout installation, deployment
or external release server is modified.

The PostgreSQL command creates and drops its own `quire_updates_<random>` database
on the explicitly supplied disposable server. It validates the real PostgreSQL
control-plane adapter, not a full distributed backup or S3 recovery deployment.
The evidence command prints actual accepted/rollback receipts and signed
artifacts, exercises the read-only CLI, then disposes both fixture roots.
