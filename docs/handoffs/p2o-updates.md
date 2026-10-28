# P2O signed updates handoff

Owner: `st_01a17c33`. October 27, 2026.
Status: **assigned module implemented and sandbox verified; production root
safety/lifecycle integration remains explicitly required**. No production host
was updated. All checks and owned cleanup below are terminal.

## Delivered behavior and exports

`services/operations/updates/index.ts` exports:

- `migrations`: additive `070-o-updates`, original SQLite SQL untouched and an
  explicit PostgreSQL variant.
- `register(context)`: O routes in an unconfigured, fail-closed state.
- `registerUpdates(context, options): UpdateService | null` and
  `updateModule(options): ServiceModule`.
- `UpdateService`, `UpdateOptions`, `UpdateConfig`, `UpdateError`,
  `OwnedInstaller`, `UpdateSafety`, `SignedRelease`, `BackupReceipt`.
- `startScheduler`, `systemUpdateTimer`, `UpdateTimer`.

The actual `releasesList` route reads an operator-configured pinned-Ed25519
feed, verifies exact signed bytes, and reports queued schedule state.
`updateCreate` requires operator/CSRF/fresh authentication, accepts only release
id/time/security-only policy, enforces explicit maintenance windows, and writes
real queued operations. Existing operationGet/download remain untouched.

The workflow verifies the feed again at execution, enforces increasing signed
sequence and version, validates exact package length/SHA-256 and safe regular
file paths, stages only in a pre-provisioned marked root, takes an exclusive
install lock, quiesces through the mandatory host boundary, requires a current
verified backup, and calls isolated migration preflight before live migration.
Files/directories are synced before atomic symlink activation. Health checks
must succeed before the version floor and success receipt commit together.

Migration/health failure restores the prior target and verified backup.
Rollback failure retains quiescence and the lock, persists recovery-required
state, and requires exact operator recovery confirmation. An interrupted job is
never silently stolen or presumed healthy. Prior and failed candidate releases
are retained rather than deleted. Idempotent retries preserve the original
receipt even if feed service becomes unavailable.

`scripts/ops/update.ts` is a read-only `list`/`validate` command, with exits
0/1/2 for completed validation/failure/usage. Operator instructions and the
package/feed formats are in `docs/runbooks/updates.md`.

## Concrete parent integration boundary

The exclusive write scope excludes root composition, runtime/shared contracts,
compiler and backup ownership. No fictional production adapter was supplied.
The parent-message tool rejected both delivery attempts with
`invalid_arguments / unknown_cause`, so this file carries the concrete request.

Root must register the O module/migrations exactly once, configure the real
feed/trust key and dedicated install prefix, and preserve the returned service.
Start `startScheduler(service, onError)` only on the designated installation
host; await its `close()` before runtime storage closes. Do not start separate
updaters against independent per-API local installation roots.

`UpdateOptions` requires the following actual host boundary:

```ts
interface UpdateSafety {
  quiesce(): Promise<{ readonly release: () => Promise<void> }>;
  backup(): Promise<{
    readonly id: string;
    readonly manifestDigest: Digest;
    readonly verifiedAt: Instant;
  }>;
  preflight(release: SignedRelease): Promise<void>;
  migrate(release: SignedRelease): Promise<void>;
  rollback(backup: BackupReceipt): Promise<void>;
  healthcheck(release: SignedRelease): Promise<void>;
}
```

`Digest` and `Instant` are the existing contracts' branded types, parsed by the
exported receipt schema internally. Quiescence must close distributed mutation
admission and drain HTTP, realtime, repository, compiler and adapters, not
merely set editor readonly. The full verified backup must be created while
held. Preflight must run against an isolated restored target. Migration,
rollback and executable healthcheck must target the configured installation.
The backup owner's callback-shaped `BackupHost.exclusive` needs a real bridge
to this retained release-shaped gate; blindly wrapping it in a resolved Promise
would drop exclusion too early. If rollback restores the control database,
root must reconnect its actual SQL adapters before operation receipt writes.

`service.recover(id, "recover <installId> <id>")` is a trusted-host maintenance
method, not an unauthenticated recovery HTTP route. Stop competing schedulers
before invoking it. Generic `yes` is not accepted. The root must retain
maintenance authority after a process crash and on rollback failure.

Until these hooks are wired, `register(context)` returns no signed releases
and update submission fails `UPDATES_UNCONFIGURED`; the product is not claimed
production-update-ready.

## Terminal commands and results

Native Bun was executed: **1.3.14**, not inferred from PATH.

```sh
bun x tsc --noEmit -p tests/operations/updates/tsconfig.json &&
bun x oxlint --type-aware --deny-warnings services/operations/updates scripts/ops/update.ts tests/operations/updates &&
bun test tests/operations/updates
```

Final combined **exit 0**, compiler/lint clean, **29 pass, 0 fail, 82
expectations, 4 files, 11.05 seconds**. Final language-server diagnostics have
zero errors in owned production/CLI/tests. All source files are below 200 pure
LOC (largest: fixture 165; service 162; installer 82).

`bun tests/operations/updates/postgres-check.ts
postgres://postgres:updates-fixture-only@127.0.0.1:32951/postgres`:
**exit 0**. Real PostgreSQL control-plane migration, async transaction claim,
idempotency, signed executable install and durable replay rejection passed.
The test created and dropped only
`quire_updates_862143c54dac424b89775de01438defd`. This is not a claim of complete
distributed backup/S3 recovery acceptance.

`bun tests/operations/updates/evidence.ts`: **exit 0**. It also executed the
actual CLI `validate` command, **exit 0**, against its owned operator config.
Acceptance and failed-migration rollback receipts and the actual signed
payload/public key/package are retained in `docs/evidence/p2o-updates/`.
That directory's README records exact commands, terminal summaries, receipt
ids, package digest and cleanup. No private signing key is retained.

## Exact owned cleanup

All native fixtures closed actual HTTP listeners, SQL/runtime/repository/event
resources and application SQLite handles before removing their own
`quire-updates-*` roots. The evidence command explicitly disposed
`/tmp/quire-updates-tmy6he` and `/tmp/quire-updates-wtRMRL`, including executable
staging, backups and operator config. The PostgreSQL checker closed all SQL
pools and its native fixture before dropping its own database.

`docker stop quire-updates-pg-st01a17c33` completed **exit 0**.
The owned `--rm` container
`ebb0e314e12b3deb866fdd87b186343887c22a00fd52764b3e12f0cdfc7fe839`
and anonymous volume
`33c90923cc4957f997ea471214c9c5ecbdee3f3770897a7b69742624d79bd398`
were removed by Docker's exit contract. Its loopback port `32951` was released;
the attached readiness monitor terminated exit 0 after PostgreSQL's clean
shutdown. No host mount, shared container or shared volume was touched.
The already-present pinned PostgreSQL image remains unchanged.

No system/user production installation, current source checkout installation,
real deployment, external posting, commit or push occurred. No writes crossed
the assigned lane/test/script/docs/evidence scope.

## Mandatory architectural review

Each file owns one responsibility: boundary models, signed downloads,
installation filesystem, SQL job state, update orchestration, scheduling,
routes, or CLI validation. Untrusted JSON is parsed at its boundary and
machine identifiers retain existing branded contracts. No tagged domain union
was added, and no unchecked cast, `any`, non-null assertion, suppression,
invented fallback or extra logging layer was introduced. The one shared
directory-sync helper has multiple real callers. Behavior is tested through
the actual router, signed HTTP fixture, executable and real SQL/backup restore;
tests do not pin prose. Functions have at most three parameters, operations
are checked rather than guessed successful, and names describe positive
concepts. No post-delete verification or unrelated cleanup was added.
