# Backup integration contract history (resolved)

Backup owner: `st_01a17c2e`. Parent delivery through `thread_send` failed twice
with `invalid_arguments / unknown_cause`; this file records the concrete need.

Final reconciliation: `docs/handoffs/p2o-backup-integration.md` now releases the
root integration and records passing native/distributed/archive gates. Shared
scale archive roots, independent atomic signing, compiler quiescence and the
producer lifetime hooks are implemented and verified there. The requests below
are historical, not open blockers. X now owns host composition; this lane does
not edit root files.

Latest reconciliation: the root owner has now normalized native Git stdin with
`Buffer.from`, switched composition to the owned atomic `loadBackupSigner`,
removed its duplicate loader, required a shared configured scale signer, and
materialized actual deployment settings including the default S3 region.
Those requests below are historical/resolved, not current blockers. The backup
suite is being rerun against the corrected root. Root admission's final
cross-role/compiler/history evidence remains with `st_01a17c42` and the parent.

Backup production code is now frozen for the final gates (except fixes required
by a failing check). Do not wait for a final handoff to run root admission proof.

The final scale assembly issue was concrete: composition initially defaulted
`backupRoot` to each API's private `dataDir/backups`. SQL backup records are
shared, so a backup created on API A fails the owned-path check on API B, and
losing A's private directory loses the archive. Require an explicitly configured
shared durable destination for scale (for example `QUIRE_BACKUP_ROOT` or
`options.backups.backupRoot`), and document its shared-volume requirement.
Materialize that root in policy responses. Native may retain its local default.
The source PostgreSQL/S3/repository profile and shared signing key alone do not
make per-API backup files shared. Root ownership includes this assembly choice;
the backup lane must not weaken its path-ownership check to accept arbitrary
recorded destinations. A cross-API create/verify check with an actual shared
owned directory is the relevant regression; the root owner's final cross-API
test now provides that proof, including deletion of API A's private directory.

Root integration is now assigned by the parent to `st_01a17c42`.
Root composition must inject a real maintenance host, not an operator assertion:

```ts
interface BackupHost {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  openFresh(target: string, originalKey: Uint8Array): Promise<Runtime>;
  readonly configuration: Readonly<Record<string, string>>;
  readonly signingKey: KeyObject;
  readonly backupRoot: string;
  readonly restoreRoot: string;
}
```

`exclusive` closes mutation admission and drains existing HTTP, realtime,
compiler, adapter and repository work across every API/worker using the source
storage. It holds exclusion until the callback completes, including failures.
An editor-readonly setting is insufficient. Backup admission without this hook
fails closed. The assigned backup directory cannot edit the root runtime,
composition, shared contracts or sibling repository implementation.

The current repository port exports only named ancestry. Complete recovery
needs hidden refs and unreachable staged objects. The backup lane can use
existing `objects(cat-file --batch-all-objects)` plus per-object reads to export
all objects, and restore through `importPack`/journaled ref publication.
This avoids changing public source-export behavior. Root quiescence remains
necessary before those calls and before SQL export.

Root composition also needs the backup `register` and `migrations` exports
added as O module 041. Existing O overview and core operationGet/download must
remain registered exactly once.

Current code exports `configureBackups(context, host)` from
`services/operations/backups/index.ts`; it keys the host by `context.db`.
Roots must be real private directories (0700), not symlinks. `openFresh`
receives an already exclusively-created directory containing the original
0600 `secret.key`. Open fresh migrated adapters without domain module
registration side effects; domain startup belongs after complete restoration.
Never share live PostgreSQL/S3/repository resources merely because the API
directory differs. Native restore may recover a scale archive to isolated
SQLite/blob/Git storage while retaining source migration receipts separately.

Backup control authentication writes `sessions.last_seen_at` before requesting
exclusive maintenance. Concurrent control requests and scheduler SQL must not
be unrestricted bypasses while another backup owns maintenance. The
backup fixtures now use the actual `runtime.admission` hook. The earlier
backup-local gate was removed once the root-owned implementation landed.
CLI `scripts/ops/backup.ts` creates the ordinary application and consumes its
injected host; it does not accept a false `--quiesced` assertion.

Signing contract correction: `signingKey` is an independently provisioned,
persistent Ed25519 private `node:crypto` KeyObject. Never include its private
bytes in `configuration` or the archive. The original instance key IS archived,
so it cannot also authenticate that archive. Local setup may create a separate
0600 PKCS8 signer outside the backup artifacts; production should load an
operator-controlled signer. Keep the corresponding public key pinned outside
the archive across host restarts. `verifyBackup(path, originalInstanceKey,
trustedSigner)` accepts either this private KeyObject or its public KeyObject.
The manifest carries a public SPKI fingerprint; `manifest.sig` is the Ed25519
signature over domain-separated manifest bytes.

Root can reuse the owned exported helper instead of duplicating provisioning:

```ts
signingKey: options.backups?.signingKey ??
  await loadBackupSigner(
    process.env["QUIRE_BACKUP_SIGNING_KEY_FILE"] ?? join(config.dataDir, "backup-signing.pem"),
    !config.production && config.profile === "local")
```

It uses exclusive 0600 creation, rejects symlinks/public permissions and only
accepts Ed25519. Production requires the separately provisioned file.
Every scale API must use the same independently provisioned signer, just as
they share the original instance authority; never generate one per API's
private directory. The suggested env field is a PEM file path, not secret bytes.
Composition now supplies this signing contract; the initial missing-field
strict error was resolved by the integration owner.

`configuration` must preserve actual deployment settings, not `{}`. For the
ordinary root factory capture configured `QUIRE_*` variables (except
`QUIRE_BACKUP_SIGNING_*`, whose independent private material must never enter
an archive); runtime core settings are already captured separately. Scale
creation now rejects missing PostgreSQL, Redis URL/namespace, repository
URL/token, S3 endpoint/bucket/region/access-key/secret-key fields by their
documented `QUIRE_*` names. Defaults such as S3 region must be materialized.
The fixture supplies these from its actual provisioned ports, not fake values.

Historical root integration feedback (resolved): composition initially called
`@quire/runtime.loadBackupSigningKey`, which duplicates the owned helper.
Its current `open(path, "wx")` publishes the filename before writing PEM bytes,
so a competing startup may parse an empty/partial key. Please either consume
the owned atomic helper from composition and remove the duplicate runtime
loader, or port atomic staged-file/link publication into the root-owned loader
and tell this lane to retire its duplicate. Also require a shared configured
signer in scale even outside production. Current root `configuration: {}` is
incomplete; scale capture correctly rejects it rather than claiming recovery.

Historical native input failure observed before the landed normalization:
20 tests passed (including real scale roundtrip); policy fixture seeding failed
before entering backup with:

```text
TypeError: The "chunk" argument must be of type string, Buffer, TypedArray, or DataView.
Received an instance of ArrayBuffer
at packages/runtime/src/repository-process.ts:24:33
at packages/runtime/src/repository.ts:178:10
```

The earlier root subprocess helper called `child.stdin?.end(input)`. Normalize the
binary boundary with `input === undefined ? undefined : Buffer.from(input)`.
The seed obtains its binary input from native Bun `Response.bytes()`; the
normalization preserves both Uint8Array and the observed ArrayBuffer bytes.
Do not patch individual backup callers or weaken the recovery test.
The full failing log is retained as `docs/evidence/p2o-backup/actual-admission-first.log`.
