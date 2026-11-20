# Signed releases and controlled updates

Controlled updates require a configured [installation controller](installation.md),
an operator-owned release feed, a pinned Ed25519 public key, a dedicated
installation root, a maintenance interval, and provisioned recovery targets.
There is no built-in release source. Never point the updater at the source
checkout or a system directory.

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
not execute archive hooks or installation scripts. The installation controller
supervises migration preflight, live migration and health verification.

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

The controller on the designated installation host is the sole owner of the
update service and scheduler. APIs submit authorized requests through the
controller client; they do not run their own schedulers. Follow the
[installation runbook](installation.md) for host configuration, role bindings,
and preflight and rollback targets.

## Safety and recovery

The controller closes mutation admission and proves managed roles are stopped
before maintenance. Admission stays closed through backup and verification,
migration preflight against an isolated restored target, live migration, an
atomic `current` symlink switch, and health verification. The verified backup
receipt is persisted before live migration.

For a proven reported failure during installation, the controller can roll
back automatically. If live migration intent was recorded, rollback first
restores the verified backup to a separately provisioned fresh target. Without
that intent, it uses the prior data binding without restoring the backup.
An ambiguous or interrupted maintenance attempt, or a failed rollback, instead
requires explicit recovery; admission stays closed. After a successful update,
the prior release is retained and the durable sequence floor prevents
replay or downgrade.

Use the pinned stable bundle and the operator credential for this installation
to inspect the authoritative operation receipt. When it reports that recovery
is required, investigate the recorded failure before sending the exact
installation and operation IDs back to the controller:

```sh
<bun-1.4.4> <stable-installation.js> status <socket-root> <operator-credential.json>
<bun-1.4.4> <stable-installation.js> recover <socket-root> <operator-credential.json> <installation-id> <operation-id>
```

See [controller and operator commands](installation.md#controller-and-operator-commands).
The command authenticates to the operator socket and binds recovery to the
current supervisor epoch and generation. Recovery restores to a fresh target
only if live migration intent was recorded; it reopens admission only after
completion is proven. Confirm the terminal receipt and open state with
`status`. Restarting the controller or deleting a lock is not recovery.

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
