# P2O backup and isolated recovery

Owner: `st_01a17c2e`. Date: October 27, 2026. Status: COMPLETE.

The assigned backup implementation, native and real scale recovery checks,
authenticated restore drill, strict checks, and exact owned cleanup are
complete. Root admission integration is accepted separately in
`p2o-backup-integration.md`; its owner has released composition to the parent/X
integrator. This handoff does not claim whole-product acceptance.

## Delivered behavior

- O041 registers policy GET/PUT, create, list, verify and isolated restore.
  Current operator authority, mutation CSRF/origin, 15-minute fresh auth,
  optimistic policy version/If-Match, and durable idempotency are enforced.
  Create rechecks operator authority after draining admitted writers.
- `quire-full-recovery-v1` contains every application SQL table, original
  migration receipts, all cataloged blobs, every Git object including hidden
  history and unreachable staging objects, refs, review/history/ACL data,
  settings, deployment configuration and the original instance key.
- Snapshot SQL is read transactionally while the real all-writer host holds
  exclusion. Blob/repository I/O occurs outside SQLite transactions. No live
  WAL file is copied. Pending source/review/Git journals, active compile work
  and other outstanding operations are rejected; only the current backup's
  own durable operation is exempt.
- Each file has a digest/length and the manifest has a domain-separated
  Ed25519 signature. The signer is independently provisioned and never
  archived. Verification checks pinned signer and original instance authority,
  complete inventory, digests, SQL catalogs and real Git index-pack/fsck.
  Configuration-only exports, missing keys, changed signers, corrupt blobs
  and even a re-signed invalid Git pack fail verification.
- Restore exclusively creates a new private direct-child target and requires
  `RESTORE <backup UUID> TO <target>`. Existing directories, symlinks,
  traversal and configured/nonfresh database state are rejected. Only exact
  migration-seeded defaults may precede restoration.
- Same-dialect recovery preserves original migration timestamps/hashes.
  Cross-dialect recovery uses explicit target variants and retains the source
  ledger in the recovery receipt. Branch leases expire without resetting fence
  history. Worker/controller authority expires, source PIDs are not adopted,
  and controller generation/accounting survive. Captured in-flight backup
  operations become explicitly interrupted in the isolated target.
- Daily UTC schedules use the injected current clock and durable slot keys.
  Scheduled backups are verified before retention. Retention accepts 1 through
  36,500 days and deletes only expired, recorded, verified, signed archives
  whose exact path/digest/ID belong to the configured root.

The existing overview and core operation/download ownership were not replaced.
Backup operation results expose metadata, not downloadable instance keys.

## Exports and integration

`services/operations/backups/index.ts` exports:

```ts
register(context: ModuleContext): void;
migrations; // readonly O041 SQLite/PostgreSQL pair
configureBackups(context: Pick<BackupContext, "db">, host: BackupHost): void;
createBackup(context: BackupContext, id?: Id,
  authorize?: () => Promise<void>): Promise<{
    manifest: Manifest; destination: string; manifestDigest: Digest;
  }>;
verifyBackup(path: string, trustedKey: Uint8Array,
  trustedSigner: KeyObject): Promise<VerifiedBackup>;
restoreBackup(context: BackupContext, input: {
  archive: string; target: string; confirmation: string;
}): Promise<RestoreResult>;
restoreConfirmation(id: string, target: string): string;
runScheduledBackup(context: ModuleContext, operatorId: string):
  Promise<Operation | null>;
loadBackupSigner(path: string, create: boolean): Promise<KeyObject>;
```

`VerifiedBackup` and `RestoreResult` above describe the inferred return shapes,
not additional named exports: verification returns the readonly manifest, SQL
image, configuration, verified key and manifest digest; restore returns the
destination and detailed authority/migration/category receipt. Public types
`BackupHost`, `BackupContext` and `Manifest`, plus `BackupError`, are exported.

`BackupHost` supplies real `exclusive(work)`, an isolated
`openFresh(target, originalKey)` factory, independent `signingKey`, deployment
configuration, `backupRoot` and `restoreRoot`. Production/scale signer and
shared scale archive-root wiring are implemented by the root owner, not a
boolean quiescence assertion. Scale requires the same durable shared
filesystem on every API, through `QUIRE_BACKUP_ROOT` or host injection.
Equal path strings on private API disks are not shared storage.

The new migrations are `041-o-backups.sql` and
`041-o-backups.postgres.sql`. This lane changed no original migration bytes,
shared package, dependency manifest/lock, root composition or original input.

Operator commands and exact safety assumptions are in
`docs/runbooks/recovery.md`. The scheduler entry is:

```sh
bun scripts/ops/backup.ts --action scheduled --operator <operator UUID>
```

The deployment's service timer invokes it; this task did not install a real
timer or deploy a service. The default isolated target is native local storage;
the tested factory boundary also supports fresh PostgreSQL/S3/repository targets.

## Terminal verification

All owned application/test commands used native Bun **1.3.14**.
Evidence is under `docs/evidence/p2o-backup/`.

| Command/check | Terminal result | Evidence |
| --- | --- | --- |
| `bun test tests/operations/backups` followed by scoped strict and type-aware lint | Exit 0; **28 pass, 0 fail, 51 assertions, 8 files, 55.44 s** | `final-acceptance.log` |
| `bun scripts/ops/restore-drill.ts --fixture complete` | Exit 0 | `complete-drill.log`, `drill.json` |
| Rich complete-fixture actual scale roundtrip | Exit 0; 1 pass, 10 assertions | `complete-scale.log` |
| `bun node_modules/typescript/bin/tsc --noEmit -p tests/operations/backups/tsconfig.json` | Exit 0 | `final-acceptance.log` |
| `bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings services/operations/backups scripts/ops/backup.ts scripts/ops/restore-drill.ts tests/operations/backups` | Exit 0 | `final-acceptance.log` |
| Owned LSP diagnostics | No errors | Recorded tool receipts |
| `bun tests/operations/backups/cleanup-evidence.ts`, followed by strict/lint | Exit 0; zero residue | `final-cleanup.log`, `cleanup.json` |

The full scale test used actual PostgreSQL, Redis, authenticated MinIO and a
singleton Git process. It transferred a populated native instance to scale,
read the real compiled PDF directly through a fresh S3 adapter, backed up the
scale instance, and restored it to isolated native storage. All **104** tables
were compared, with explicit selected-dialect/fence semantics; nonempty comments,
tombstones, history, HTTP receipts, ACLs, blobs, keys and Git data survived.

The native drill additionally reopens identity services, reuses the original
cookie and CSRF token, replays the original thread-create receipt without
creating a new thread, and recompiles restored source through the actual
confined worker. Both PDFs have equal extracted text. Source expectations are
captured under the same exclusion as backup, before legitimate startup outbox
replay can change delivery counters.

Expected `BACKUP_MAINTENANCE` rejection from a concurrent scale reconciliation
wake remains visible in raw logs. It did not fail the checks and was not hidden.
Earlier failures and their fixes are recorded in `history.md` and retained
failure logs: syntax/types, fixture shutdown, startup outbox replay, the native
binary-input boundary, migration-seeded defaults and retention write/read
validation. No test was skipped, weakened or suppressed.

## Retained artifacts

The retained native drill backup ID is
`883e23fd-c2c4-45e9-97e7-0e2c891c161c`.

- `restored-output.pdf`: **90,004 bytes**, SHA-256
  `854cf27ea1913ec601ae86166a35227d849af21a620c2f4c7642fa4cebc63a4c`.
- `restored-recompiled-output.pdf`: **90,004 bytes**, SHA-256
  `aa29cc8e8e2243cf9c83f5df3bd49cd5899cbd98a95752fdb098adada2637c3f`.
- `manifest.json`, `manifest.sig`, `signing-public.pem`,
  `recovery-receipt.json` and `drill.json` retain public verification,
  migration and category evidence.

The cleanup auditor verifies the retained manifest signature/public fingerprint,
both actual PDF lengths/hashes, and the original PDF's manifest membership.
The public evidence is not itself a complete recovery archive: secret-bearing
fixture archives and private keys were deliberately removed.

## Exact cleanup and review

`cleanup.json` enumerates **196 exact temporary roots**, **30 exact container
names**, and **18 captured terminal process-exit receipts**. Known and unrecorded
task-prefixed roots, containers and named volumes are absent.

Latest full-run resources were the roots
`/tmp/quire-p2o-backup-9tMWEF` and
`/tmp/quire-p2o-backup-scale-qetpTI`, PostgreSQL/Redis suffix
`25f40050-5ac0-40da-be24-3b9d9b9c0ae6`, and MinIO resource
`quire-p2o-backup-s3-923a1cc7-ab80-4589-995d-e33bd6613aa5`.
The corresponding attached clients ended with recorded exit 137 after owned
forced container removal; the repository process ended with exit 0.
Teardown awaited every tracked exit. Exact `docker rm --force --volumes`
calls removed anonymous PostgreSQL/Redis mounts; the named MinIO volume was
removed separately. The native drill root
`/tmp/quire-p2o-backup-wjtkrh` was removed after all application handles closed.
The earlier interrupted root `/tmp/quire-p2o-backup-G5qdPD` was also removed.

Completed dependency-watch IDs were already absent when explicitly closed.
No owned check, listener, container, fixture root or private signing key remains.
The root owner's isolated comparison-runtime directory is parent-owned and was
not touched.

`review.md` records the required architectural review. All 31 owned TS/SQL/JSON
files are below the size ceiling; the largest production module is 175 pure
lines. Their complete-content fingerprint is
`f931af295779fe39fc0657b9a732b1d51787f84abe9bb898f38b41001f13c6db`
(`owned-source.json`). No dependency installation, runtime pin change, real
deployment, destructive live restore, external posting, commit or push occurred.

The root handoff separately reports broader account/assistant UI EBADF
diagnostics on Bun 1.3.14. Those suites and any runtime decision remain
parent-owned; this lane neither suppressed them nor claims them resolved.
No assigned backup behavior or verification item is deferred.

## Benefits migration follow-up, October 27, 2026

After the original acceptance, the benefits owner added migration
`012-a-project-benefits`. The parent relayed the owner's confirmation that
both dialects seed exactly one `account_project_benefits` row:
`deployment/local`, minified
`{"compileSeconds":180,"writableMembers":null,"historyDays":null,"trackChanges":true}`,
version `0`, timestamp `1970-01-01T00:00:00.000Z`, with no other backfill.

`restore.ts` now permits only that exact tuple through its fresh-target check.
Changed scope, payload, version or timestamp, additional grants, and withdrawn
grants with NULL payloads remain nonfresh. No table-wide exemption was added.
Source benefit settings replace the untouched defaults during normal import.

Focused pre-fix reproduction (`bash_3`) exited 1 with
`RESTORE_TARGET_NOT_EMPTY: account_project_benefits`. After the fix, this exact
command (`bash_4`, Bun 1.3.14) exited 0:

```sh
bun test tests/operations/backups/benefits-fresh.test.ts tests/operations/backups/pristine.test.ts &&
bun node_modules/typescript/bin/tsc --noEmit -p tests/operations/backups/tsconfig.json &&
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings services/operations/backups/restore.ts tests/operations/backups/benefits-fresh.test.ts
```

Result: **13 pass, 0 fail, 26 assertions**, 52.09 seconds. The new positive test
restores configured source benefits over real migration defaults. Nine negative
variants prove target rows survive rejection and no source users are imported.
Existing pristine worker-policy and authority tests also pass. Both changed
TypeScript files have clean language-server diagnostics.

The pre-fix root `/tmp/quire-p2o-backup-XgqGky` and all 13 passing-run roots
reported cleanup: suffixes `rkb2uG`, `GF6Sgq`, `siwmH1`, `Pk3KhU`, `ugsBaE`,
`p9fnMC`, `9pAk6M`, `R3BT4y`, `tTszgo`, `rw6X8y`, `bN2bWI`, `HO43pg`,
`ZqZLTG`, each under `/tmp/quire-p2o-backup-`. No containers were started.

The parent received READY to resume its mounted browser restore regression.
No global or scale suite was rerun for this follow-up. Earlier acceptance
logs, artifact hashes, cleanup inventory and source fingerprint above remain
the historical original acceptance, not a fingerprint of this later change.
