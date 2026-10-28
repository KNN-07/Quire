# Full recovery backups

Source ZIP, account export and configuration export are not recovery backups.
Full backups use `quire-full-recovery-v1`, contain every SQL table including
review comments, permanent tombstones, ACLs, settings, HTTP receipts, original
migration receipts and fencing history; all cataloged blob bytes including
compiler outputs; every Git object (also unreachable staging objects), named
and hidden refs; deployment configuration; and the original instance key.

The manifest records each file's SHA-256 and length and is Ed25519 signed
under an independent operator signing key with a format-specific domain separator.
Verification requires both the independently retained original instance key
and a pinned signing public key. The private signing key is NOT archived and
must not appear in the deployment configuration export. Retain it separately;
the included instance key must never serve as archive signing authority.
Do not derive trust from keys inside an untrusted archive. Losing the original
key prevents full recovery, including existing session/CSRF and encrypted
provider authority. These archives contain secrets, are not encrypted by this
format, and belong on operator-protected encrypted storage with 0700 roots and
0600 files. Do not publish complete archives with application evidence.

## Admission and consistent capture

Root assembly registers O module `041-o-backups`, its explicit SQLite/PostgreSQL
migration pair, and calls `configureBackups(runtime, host)`. `BackupHost`
provides `backupRoot`, `restoreRoot`, `configuration`, `exclusive(work)` and
`openFresh(target, originalKey)`, plus the independent `signingKey` KeyObject.

Production and scale require `QUIRE_BACKUP_SIGNING_KEY_FILE` or an injected
independent signer. Scale also
requires an absolute `QUIRE_BACKUP_ROOT` backed by the same durable shared
filesystem on every API; equal paths on separate private disks are insufficient.
Native defaults to `dataDir/backups`. Both roots remain owner-only directories.
The root integration's native, distributed and cross-API proof is recorded in
`docs/handoffs/p2o-backup-integration.md`.

`exclusive` must close admission and await **all** active HTTP, realtime, Git,
compiler and adapter writers across every source role before the callback.
Hold admission closed until callback settlement. An operator assertion,
editor-readonly setting, paused queue or SQLite WAL-file copy is not exclusion.
Root `runtime.admission.writer`/`exclusive` wraps whole native writer
operations and supplies the distributed scale boundary. Missing maintenance host
fails with `BACKUP_QUIESCENCE_REQUIRED`. Root integration owns distributed
admission, role shutdown/drain and the scheduler lifecycle.

Under exclusion, export uses one real SQL transaction to read the complete
table catalog and values, then reads immutable blob and repository ports
outside the transaction. It never awaits remote Git or S3 inside SQLite's
transaction. It rejects unfinished source/review/Git journals and active
compiler jobs. Recover those through normal source recovery or explicitly
finish/cancel jobs before retrying; backup does not discard them.
Only the currently creating backup's own operation is exempt. A prior
interrupted backup blocks a new snapshot until its creator finishes or an
operator explicitly repairs it offline after confirming that creator exited;
the service never guesses that another live operation is stale.

All objects are read through `RepositoryService.objects`, encoded as a standard
non-delta Git pack, and verified using real `git index-pack --strict` and
`git fsck --full --strict`. Named-only Git export is intentionally not reused.
Pack format reference: <https://git-scm.com/docs/gitformat-pack>.
SQLite logical transaction semantics: <https://www.sqlite.org/lang_transaction.html>.
PostgreSQL locking reference: <https://www.postgresql.org/docs/current/explicit-locking.html>.

## Operator API

The existing registered contracts are:

- `GET/PUT /api/admin/backups/policy`
- `POST/GET /api/admin/backups`
- `POST /api/admin/backups/:id/verify`
- `POST /api/admin/backups/:id/restore`

All require current operator authority; mutations also require same-origin
CSRF and login within 15 minutes. Policy PUT checks `If-Match: "vN"` against
`expectedVersion: N`. Create, verify and restore require Idempotency-Key.
Backup content is immutable at `expectedVersion: 0`. Job results use existing
operation records; core operation polling/download registrations remain owned
by core. No public operation download exposes the instance key.

Restore requires `target` to be a direct child name of the configured restore
root and an exact user-entered confirmation:

```text
RESTORE <backup UUID> TO <target>
```

`openFresh` must provision isolated database, blob namespace/bucket and repository
volume, not merely a separate API directory pointing at live scale storage.
It must preserve the original key and migrate the exact supported schema set.
Every pre-existing target directory, even an empty one, is rejected.
Only untouched migration-seeded counter and worker-policy defaults may already
exist. Configured domain rows or changed original migration hashes are rejected.
Live in-place restore is deliberately unavailable. Failed isolated targets
retain `recovery-failed.json` for diagnosis; they are never silently overwritten.

Cross-profile restore applies explicit target-dialect migrations, preserves the
source receipt in `recovery-receipt.json`, and retains target-dialect migration
digests. Same-profile restore preserves original applied migration timestamps.
Dead lease ownership expires; fencing numbers are preserved or increased by
the restore's journaled publication. Restore never reinstates a stale owner's
authority. Recovered configuration is retained, not blindly applied to network
destinations or credentials.
The snapshot can contain its own not-yet-finished backup operation. Restore
explicitly marks only those in-flight backup jobs and replay receipts failed
with `RESTORE_INTERRUPTED_BACKUP`, records their IDs in the restore receipt,
and never resumes their old filesystem destinations. Original signed source
rows remain in the archive; completed HTTP receipts are unchanged.
Worker/controller leases also expire, preserving their fencing generation.
Restored worker records are offline and old source PIDs are cleared; no source
process is adopted or signaled. Those changes are recorded in the restore
receipt. Durable worker policy and accounting remain intact.

## Schedule and retention

Supported policy schedules are `disabled` or `minute hour * * *` in UTC.
`runScheduledBackup(context, enrolledOperatorId)` evaluates the injected current
clock and deduplicates the latest due daily slot with durable idempotency.
It does not run a wall-clock polling timer inside a request. The role scheduler
must call it through the same maintenance host. Enabling a schedule catches up
the latest due slot once, not every missed day.

Retention only visits successful verified backup rows older than the configured
day cutoff. It verifies the original signature, recorded manifest digest,
archive ID and canonical owned path before removal. It never glob-deletes a
directory, touches unrecorded archives, follows symlinks or removes an
unverified recovery copy. Retention accepts 1 through 36,500 days.
The scheduled runner verifies its newly created archive before retention.
Install the scheduler as the deployment's ordinary private service timer,
running once per minute; SQL idempotency makes duplicate invocations safe:

```sh
bun scripts/ops/backup.ts --action scheduled --operator <enrolled-operator-UUID>
```

This command evaluates policy time itself; the service timer must not substitute
its local timezone for the UTC policy. No schedule executes unless the operator
has installed this timer (or the root role calls `runScheduledBackup`).

## Commands and drill

With root host integration configured:

```sh
bun scripts/ops/backup.ts --action create
bun scripts/ops/backup.ts --action verify --archive /private/backups/<id>
bun scripts/ops/backup.ts --action restore --archive /private/backups/<id> \
  --target isolated-drill --confirmation 'RESTORE <id> TO isolated-drill'
```

The self-contained acceptance drill creates only `quire-p2o-backup-*` temporary
resources, performs a real confined native compile, backs up, verifies, restores
and compares all durable categories plus original cookie/CSRF and PDF bytes.
It then recompiles from the restored source through the actual confined worker
and compares extracted PDF text (timestamps can change binary PDF metadata):

```sh
bun test tests/operations/backups
bun scripts/ops/restore-drill.ts --fixture complete
bun node_modules/typescript/bin/tsc --noEmit -p tests/operations/backups/tsconfig.json
```

Scale tests provision actual task-owned PostgreSQL, Redis, authenticated MinIO
and singleton Git repository roles on loopback; Docker must actually execute.
The drill retains only a signed manifest, public verification key, receipt, category report and actual compiled
PDF under `docs/evidence/p2o-backup`. Signing keys and complete secret-bearing
archives remain inside the owned sandbox and are removed by its teardown.
Record terminal exits and exact resource cleanup before accepting a drill.
