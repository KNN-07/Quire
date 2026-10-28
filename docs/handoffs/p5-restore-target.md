# P5 fresh-target restore

October 27, 2026. Owner: `st_01a17df9`. **FINAL: PASS for the
fresh-target importer foundation.** Configured installation, supervisor,
launch inhibition, binding promotion and rollback acceptance are separate
increments in `docs/architecture/installation-authority.md`.

## Exported API

These exports are available from `services/operations/backups/index.ts`:

```ts
inspectRestoreTarget(target: BackupContext): Promise<RestoreTargetIdentity>

restoreBackupToTarget(
  context: BackupContext,
  input: {
    readonly archive: string;
    readonly target: BackupContext;
    readonly identity: RestoreTargetIdentity;
    readonly retained: readonly RestoreTargetIdentity[];
  },
): Promise<{
  receipt: {
    backupId: Id;
    manifestDigest: Digest;
    sourceDialect: "sqlite" | "postgres";
    targetDialect: "sqlite" | "postgres";
    originalMigrations: DatabaseImage["tables"][number]["rows"] | undefined;
    authority: Digest;
    restoredAt: Instant;
    tables: Manifest["tables"];
    repositories: number;
    interruptedBackupOperations: readonly Id[];
    expiredWorkerIds: readonly Id[];
    workerControllerGeneration: number | null;
  };
  configuration: Awaited<ReturnType<typeof verifyBackup>>["configuration"];
}>
```

`RestoreTargetIdentity` is also exported. Its diagnostic fields describe:

* SQLite: actual file path, host machine ID, device and inode.
* PostgreSQL: connected cluster system identifier, current database OID and
  name, all identifier numbers returned as text.
* Disk blobs: actual root path, host/device/inode and emptiness.
* S3: credential-free canonical authority endpoint, bucket and actual
  empty-bucket result.
* Git: actual volume path, host/device/inode and emptiness.

The type is structurally readable, but only the exact objects issued by
`inspectRestoreTarget` are accepted as tokens. A private WeakMap retains
separate inspected values, the issuing context, and the exact SQL/UoW/blob/
repository/branch handles. Authoritative comparisons use that private record,
not caller-visible fields. Copied, reconstructed or other-target tokens fail.
Tokens are process-local, are not JSON receipts, and are not locks.

`context` is the exact source context inspected for the source token. It must
have its existing `configureBackups` host installed, supplying the independently
trusted archive signer. Inspection can precede closing source/retained
resources; importing uses the source's trusted key, host and clock, not its
database connection. The target is re-inspected immediately before import.

## Inventory, authority and resource ownership

The installation controller must derive the **complete durable retained-binding
inventory under stopped authority**, inspect its actual opened stores, and
supply those issued tokens in `retained`. The primitive verifies issuance,
source inclusion and distinction from every supplied binding. It cannot prove
that an arbitrary caller's subset is complete. The future host must maintain
stopped authority and exclusive target provisioning across inspection/import;
this API does not establish cohort closure or process fencing.
The trusted target factory must construct a coherent `BackupContext`: its UoW,
branch coordinator and repository server must use its target SQL authority.
Tokens bind those handle objects but do not attest arbitrary injected method
implementations or reconstruct that factory relationship. The supplied real
fixtures construct each SQL/UoW/admission pair and repository server together.

Before any import write, the primitive verifies the signed full archive,
exact target/token handle binding, current target identity, source inclusion,
resource distinction, original dialect, original secret, empty blob/Git
storage, exact SQL table inventory, pristine migration-seeded rows and original
migration digests. All existing `account_project_benefits` fresh-default
conditions remain byte-for-byte unchanged, including the exact deployment
payload, version, timestamp and scope checks.

Database, blob and Git authority must differ from every supplied retained
binding. Native paths are canonicalized and compared by host/device/inode and
path overlap, including aliases and cross-component overlap. Local storage
must be owned by the current Unix user inside private directories. Remote Git
identity is authenticated, derived server-side from the actual owned volume,
and verifies that the held ownership lock still names its current file.
The Git target and each retained Git identity must report the same machine ID;
the controller separately validates its installation host/cohort inventory.

For this first same-host implementation, S3 endpoints must have the same
canonical authority spelling and bucket names must differ. Different endpoint
aliases are ambiguous and fail closed, even if both URLs reach the same
service. Empty-bucket inspection lists actual keys; empty Git inspection
rejects repositories/other entries, allowing only the remote service's own
`.repository-owner.lock`. Unknown blob/repository adapters fail closed instead
of accepting detached identity strings or caller callbacks.

PostgreSQL inspection queries
`pg_catalog.pg_control_system().system_identifier::text` and the actual
`pg_catalog.pg_database` row for `pg_catalog.current_database()`, with OID cast
to text. The maintenance connection requires EXECUTE on
`pg_catalog.pg_control_system()` and access to that catalog query. If an
operator revokes EXECUTE, an explicit grant to the maintenance role is
required. The test demonstrates rejection with EXECUTE revoked; there is no
URL-derived identity or SQLite fallback. No implicit superuser provisioning
is performed by the primitive.

The caller opens, owns, closes and retains **all** supplied resources.
`restoreBackupToTarget` closes nothing, deletes nothing, changes no active
binding and writes no local receipt files. It returns the actual completed
restore receipt and archived configuration for independent control storage.
Archived configuration is historical data, can contain credentials, and must
not replace the new target's provisioned binding. On an import failure the
caller retains the partial target, records the actual failure and keeps launch
inhibition; this primitive does not roll back or clean up caller resources.

## Public restore compatibility

`restoreBackup(context, { archive, target, confirmation })` and
`restoreConfirmation(id, target)` retain their original exports, arguments,
return shape and behavior. `restore.ts` re-exports their implementation from
`restore-target.ts`. The public wrapper still requires exact confirmation,
the configured private direct-child restore root, exclusive directory
creation, a distinct data directory/database object and the original key.
It writes its secret, recovery/configuration receipt or failure marker and
closes only the target it opened.

Both paths use the same original database/blob/Git importer. Original
migration receipts, keys and branch fences survive; worker/branch execution
authority expires, source PIDs are not adopted, and archived in-flight backup
receipts become `RESTORE_INTERRUPTED_BACKUP` only in the restored target.
`database.ts:assertSettled`, application migration SQL/IDs and backup producer
checks were not edited.

The public isolated drill still permits an explicitly supplied alternate
dialect factory, retaining source migration evidence while checking every
target dialect migration ID. Its receipt records both dialects. The new
installation primitive rejects dialect conversion and requires the original
dialect; a PostgreSQL restoration is real PostgreSQL.

## Changed paths

The original write boundary covers `backups/{restore,restore-target}.ts`,
`backups/index.ts` exports, `tests/operations/backups/restore-target*.ts`, this
handoff and `docs/evidence/p5-restore-target/`.

The parent explicitly expanded that boundary for read-only concrete probes:
`packages/runtime/src/repository.ts`,
`services/operations/storage/s3/index.ts`, and
`services/operations/repository/{client,server}.ts`. Those changes add only
identity/emptiness inspection, including authenticated
`POST /v1/restore-identity`; admission and locking semantics are unchanged.
No runtime composition, controller, updater, application migration, package,
backup producer or concurrent benefits/editor files were changed.

## Verification and evidence

Runtime: project-local **Bun 1.4.4 (38afee6c8)**.

```sh
./node_modules/.bin/bun test tests/operations/backups/restore-target*.ts \
  tests/operations/backups/pristine.test.ts \
  tests/operations/backups/benefits-fresh.test.ts \
  tests/operations/backups/jobs.test.ts
```

Final single run: **20 passed, 0 failed, 73 expectations, 84.56 seconds,
exit 0**. Strict `tsc --noEmit -p tests/operations/backups/tsconfig.json`
and type-aware `oxlint --deny-warnings` for every changed TypeScript path
also exited 0. Full commands, final terminal output and source SHA-256 inputs
are recorded under `docs/evidence/p5-restore-target/`.

The new positive tests compare all 109 application tables except the
intentionally changed branch leases, immutable blob bytes, complete exported
Git packs/refs, original migration rows and source snapshots. Target handles
remain usable after return. The PostgreSQL test provisions actual PostgreSQL
17, Redis 7.4, MinIO and separately owned authenticated repository servers.
Its original-dialect PostgreSQL archive restores from database OID `16384` to
OID `18110` in cluster `7701376190602825762`, from bucket `restore-source`
to `restore-target`, and to a distinct Git volume.

Negative cases cover structurally copied/forged tokens, tokens bound to another
opened target, omitted source evidence, an explicitly retained target,
wrong keys, second SQLite handles and a symlink alias of the source, a second
PostgreSQL connection to the source database, independent S3 clients for the
same bucket, an independent authenticated client to the same Git volume,
S3 endpoint aliases, stale inspection, nonempty blobs/Git, private-directory
violations, configured SQL state, unexpected schema and migration mismatches.
They preserve the source SQL/Git snapshots and leave fresh target SQL unimported.
The authenticated identity route rejects an unauthenticated request with 401.
The existing pristine/jobs cases independently cover worker generation/fence
history, source process receipts and interrupted backup receipt recovery.
All nine existing benefits negatives remain passing unchanged.

An earlier new privilege-negative fixture incorrectly assumed this image's
default EXECUTE policy denied `pg_control_system()`. Its 19-pass/1-fail run
is not passing evidence. The corrected test explicitly revokes PUBLIC EXECUTE
and proves the resulting real permission error fails closed. An accidentally
duplicated early regression watcher was cancelled, is not counted as evidence,
and its exact owned leftover root was identified from its process output and
removed after its process tree exited.

Final fixture cleanup verifies owned PostgreSQL/Redis containers are absent,
MinIO container/volume are absent, repository servers and SQL resources close,
attached container processes exit, and exact temporary roots are removed.
The recorded container exit 137 values are intentional force-removal cleanup,
not test failures. No production services, real user data, global tools or
commits were changed.
