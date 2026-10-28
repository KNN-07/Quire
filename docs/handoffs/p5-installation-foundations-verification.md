# P5 installation foundations verification: FINAL

October 27, 2026. Independent verifier: `st_01a17e3d`.

**PASS for receipt/control and fresh-target foundations. Configured supervisor
acceptance is not passed or claimed.** The independently executed focused
checks passed 73 tests in two disjoint runs: the original 71 cases, then two
new branch-fence cases after discovering that existing whole-database
comparisons exclude `branch_leases`. No existing case was rerun. There were
409 `expect()` calls and zero test failures. All owned strict types and
type-aware deny-warning lint checks exited 0.

## Inputs and evidence

Read `docs/architecture/installation-authority.md` in full, the actual control,
protocol, updater, reservation, legacy-import and restore implementation, relevant
storage/coordination code, actual test fixtures, and these required handoffs:

| Required handoff | Verdict |
| --- | --- |
| `docs/handoffs/p5-installation-control.md` | PASS: explicitly FINAL |
| `docs/handoffs/p5-update-control.md` | PASS: explicitly FINAL |
| `docs/handoffs/p5-restore-target.md` | PASS: explicitly FINAL |

The selected binary was `./node_modules/.bin/bun`, observed as
`1.4.4+38afee6c8`; the test runner reports `v1.4.4 (38afee6c8)`. The agent
kernel/global runtime was not substituted. Before/after SHA-256 measurements
of 102 paths were identical. The subsequently added fence test was separately
measured before and after its run. These measurements cover the changed
foundation surfaces and selected transitive runtime/storage fixtures, not an
immutable snapshot of the entire shared repository.

Independent artifacts are in `docs/evidence/p5-installation-foundations/`:
`inputs-before.json`, `inputs-after.json`, `test-output.txt`,
`static-output.txt`, `verification.json`, `fence-output.txt`, `fence-input.json`,
`commands.txt` and `cleanup.txt`. Original producer evidence was read, not
rewritten. In particular, the restore producer's retained source hashes agree
with the independently measured restore implementation and identity probes.

## Verdict per architecture invariant

The foundation verdict judges only this increment's implemented portion.
The separate configured verdict prevents ledger fixtures from being counted
as process-manager, launch-permit or prepared-application proof. A downstream
FAIL means the required proof is absent, not that a fake driver should replace it.

| Invariant | Foundation verdict and actual evidence | Configured acceptance verdict / missing proof |
| --- | --- | --- |
| 1. Independent authority | PASS. Independent real SQLite, its own `001-installation-control` ledger, FULL synchronous writes, durable receipts/floor/bindings; actual older application archive imported into a distinct native target leaves control receipt/floor unchanged. | FAIL downstream: actual canonical installation layout, singleton OS lock and role sandbox denial of direct control-file access remain host work. |
| 2. One launch owner | PASS for the contract portion only: inventory/epoch/generation/exact invocation schemas, denied stale/closed ordinary execution records, installation-scoped HMAC and operator/API channel separation. | FAIL downstream: no production launcher or systemd driver implements these contracts. Direct entrypoint denial and ownership of all transient invocations are unproved. |
| 3. No maintenance before actual stop | PASS for ledger ordering: pending execution records prevent stopped evidence; stopped evidence precedes maintenance intents; backup/original ledger precede migration intent. | FAIL downstream: fixture stopped strings do not observe empty cgroups, Git children or containers. Actual stop is not established by this increment. |
| 4. Crash closure | PASS for durable interruption semantics: claimed validating/staged and installing state reopen as `recovery_required`; queued work stays queued; missing helper results remain missing; wrong recovery generation/identity is denied; no finally-path reopen. | FAIL downstream: no actual controller/helper SIGKILL and launcher/restart-denial proof. Callback/flock/advisory-lock survival is not claimed. |
| 5. Fresh binding | PASS for importer foundations: actual native and PostgreSQL/S3/remote-Git imports target distinct original-dialect stores, reject shared/nonempty/aliased targets and preserve source data; caller-owned handles remain usable. | FAIL downstream: no release/data promotion or replacement of every old Runtime/pool/blob/repository/event/worker process has been executed. |
| 6. One commit point | PASS for control transaction semantics: real SQLite abort triggers prove receipt, floor, binding and open mode roll back together; successful retry commits them together; health must name the exact binding. | FAIL downstream: ledger health records are fixtures, not closed-ingress application readiness or activation of actual prepared roles. |
| 7. Recovery cannot lower authority | PASS for persistence/key/import semantics: restored older application has no new reservation, control receipt/floor survive, exact keys reconcile, downgrade and cross-kind reuse fail; raw legacy bytes/checkpoints survive both import crash gaps; native/PostgreSQL branch fences remain monotonic. | FAIL downstream: launch permits for old processes, complete retained-binding inventory and real recovery orchestration still need host proof. |
| 8. No broad backup exception | PASS. Real full-application backup succeeds with a running control-only update and no application update mirror; independently inserted running adapter and legacy update rows each still reject with `BACKUP_RECOVERY_REQUIRED`, unchanged. `assertSettled` is unchanged by this verification. | PASS for the structural backup rule. Combining it with an actual stopped installation remains part of configured acceptance. |

No foundation failure was observed in the tested scope. The configured FAIL
entries are explicit next-stage gates, not deferred foundation implementations.

## Concrete observations

The new `foundation-acceptance/durability.test.ts` uses the real full seeded
application and signed archive importer, not the updater fixture's miniature
`documents` database. It archives before reservation, accepts a control
command, confirms real backup succeeds while its control receipt is running,
and confirms both unrelated adapter work and a legacy running update still block
backup. It then imports the older archive into a new application target, reopens
control SQLite, checks the exact successful receipt and floor `2 / 2.0.0`,
rejects downgrade, reconstructs the exact missing reservation, and rejects
other-kind key reuse in the restored application.

Observed durable operation ID: `c9bf4bd7-e5d9-412c-889d-6b541238252f`.
The old application archive was
`69f6de1c-a4ec-4452-88c0-064b9537f22e`, digest
`82497cb432ab5ff1340fb312a0cd09256ed3555d313836fdd169b7d529f104f5`.
This test's stopped/health records come from `controlFixture`; they prove
ledger persistence only. It does not promote a live binding.

The existing restore-target cases independently executed against current
111-table data, including the additive command reservation/tombstone tables.
They compare all tables except intentionally changed branch lease rows,
immutable blob bytes, full exported Git packs/refs, original migration rows
and source snapshots. The new fence cases cover that excluded branch surface
directly: both native and real PostgreSQL imports retain fence `41`, expire
the archived owner, reject its old lease, issue fence `42` for a fresh owner,
and leave the source owner/fence/expiry unchanged. The pristine restore cases
also retain worker-controller generation `41`, expire worker authority and
clear adopted source PIDs only in the target.

The original-dialect PostgreSQL proof used cluster
`7701390007624925218`, source database OID `16384` and target OID `18138`;
bucket `restore-source` became distinct bucket `restore-target` at the same
actual MinIO authority, with distinct authenticated owned Git volumes. It
was not a SQLite rollback labeled as PostgreSQL. Redis was an owned fixture
service, not proof of activated cross-role cursor rebinding.

Negative imports covered source database through a second connection, native
symlink aliases, shared S3 bucket and Git volume via independent clients,
nonempty storage, forged/copied/stale/wrong-handle identity tokens,
missing source/retained identity, wrong secret, schema/migration mismatch,
nonprivate native storage, S3 endpoint aliases and denied PostgreSQL
`pg_control_system()` privilege. Data was not overwritten on these rejections.
The catalog privilege was deliberately revoked in an owned fixture; no
operator privilege policy is inferred from a default container role.

Legacy verification executed both concrete `ApplicationLegacySource`
transactions and independent control copy transactions. Raw release JSON,
backup JSON, result bytes, operation IDs/keys and original migration ledger
values survive. Changed source/progress/ledger or corrupt checkpoints block
removal; an injected tombstone transaction failure rolls deletions and
reservations back together. Restart/retry covers copy-before-remove and
remove-before-control-acknowledgment gaps. Interrupted legacy migration remains
recovery-required. No original `070-o-updates` ID/SQL was edited by this lane;
`071-o-update-command-keys` is additive. The tests compare the actual original
ledger before/after import and restore; this is not a historical source-control
audit of every pre-existing untracked migration file.

Real PostgreSQL and SQLite reservation cases cover both cross-kind insert
directions, key reassignment and concurrent competing inserts. Missing actors
block atomic reconciliation without recreating users. A reserved-but-unaccepted
command is not reported as queued. Accepted retry is resolved before feed
access and works offline. Real concurrent control processes use IPC subscriptions
before their accept action; scheduled and backup ordering tests use explicit
event barriers, not sleeps.

## Exact next-stage interfaces

The host must take a real OS singleton lock before
`ControlStore.open(path, installationId, epoch, at)` and hold it through close.
This class does not acquire that lock. It must explicitly provision fresh
authority with `ControlStore.provision`; absent/corrupt authority must never
be replaced with newly open authority during normal startup.

Production interfaces already exported by
`services/operations/installation/model.ts` are:

```ts
interface InstallationAuthority {
  capabilities(): Promise<InstallationCapabilities>;
  stopForUpdate(operationId: Id): Promise<StoppedInstallation>;
  withStopped<T>(stopped: StoppedInstallation, work: () => Promise<T>): Promise<T>;
  prepare(input: PrepareInstallation): Promise<PreparedInstallation>;
  commit(input: InstallationCommit): Promise<Operation>;
  recover(input: RecoveryRequest): Promise<Operation>;
}
interface InstallationStorage {
  backup(stopped: StoppedInstallation): Promise<VerifiedInstallationBackup>;
  preflight(input: InstallationPreflight): Promise<MigrationEvidence>;
  migrate(input: InstallationMigration): Promise<MigrationEvidence>;
  restore(input: InstallationRestore): Promise<RestoredBinding>;
}
interface UpdateClient {
  releases(): Promise<readonly Release[]>;
  create(request: ReservedUpdateCommand): Promise<Operation>;
  get(id: Id): Promise<UpdateOperationRow | null>;
  list(query: UpdateOperationQuery): Promise<readonly UpdateOperationRow[]>;
}
```

`StoppedInstallation` and `PreparedInstallation` are opaque abstract classes.
Only the real host should subclass them after observing its owned executions
and actual private candidate readiness. An execution ledger row or parsed JSON
does not construct either capability. `withStopped` must validate continuing
closed ownership and actual execution membership, not be `work => work()`.
The host must record exact invocation start/exit results and intent before
each side effect. `ControlStore.recordStopped` at
`services/operations/installation/control-store.ts:445` accepts trusted
evidence records; it does not inspect processes.

`UpdateService` takes
`{config, control, authority, storage, clock, authorizeActor}`; it takes no
application `ModuleContext`. Only the controller owns `startScheduler`.
The host storage adapter may throw exported `ReportedUpdateFailure(code,
evidence)` only for an actually observed completed helper failure whose exact
identity, start/exit and result bytes match durable control records.
An arbitrary rejected Promise is interruption, not permission for automatic
rollback. See `services/operations/updates/service.ts:131`.

The restoration seam is
`inspectRestoreTarget(target: BackupContext)` followed by
`restoreBackupToTarget(source, {archive, target, identity, retained})`,
exported by `services/operations/backups/index.ts`. Identity tokens are
process-local issued objects, not serialized attestation or locks. The caller
must derive the complete retained binding inventory under stopped authority,
open coherent real SQL/UoW/admission/blob/Git handles, exclusively provision
fresh stores, and keep writers stopped across inspection/import. The primitive
checks all supplied identities and source inclusion; it cannot discover omitted
retained bindings or validate arbitrary injected factory relationships.

The caller owns and closes every supplied handle and retains partial targets
on failure. The primitive returns `{receipt, configuration}`, closes nothing,
promotes nothing and deletes nothing. Persist its completed receipt in control
storage. Archived configuration may contain old credentials: retain it as
historical evidence, not as replacement target provisioning. Preserve original
dialect, migration set and secret. PostgreSQL inspection needs catalog/EXECUTE
privilege, S3 uses a fresh actual bucket at an unambiguous authority, and Git
uses a fresh authenticated owned volume. The public isolated `restoreBackup`
wrapper retains its existing confirmation, fresh-directory and close contract.

After import, run `reconcileCommandKeys(target.uow, controlCommands)` before
normal launch. `ReservedUpdateCommand` carries installationId, operationId,
actorId, key, requestDigest and `{releaseId, at, autoSecurity}`; do not regenerate
the operation ID. Missing actors/conflicts must block reopening.
`ApplicationLegacySource(uow, {sourceId, installationId, dataIdentity})` and
`importLegacyUpdates(source, control, clock)` require host-verified source
identity and an operator-arranged all-role stop across copy/remove/confirm.

The API integrates `registerUpdates(context, {installationId, client})` once,
using `createUpdateClient(credential, clock, transport)` with the actual private
authenticated socket transport. The client has no invented close method;
transport lifetime belongs to its host. Keep operator/identity/CSRF/fresh-auth
checks in the API and live actor authorization before execution.
API credentials cannot stop, recover or alter bindings.

The actual current `services/operations/tasks/index.ts:66` reads only
application operations in ascending ID order (`id > cursor`, `ORDER BY id`);
control `list` uses exclusive descending IDs. The integration owner must
explicitly reconcile pagination/order with the existing endpoint contract
and preserve authorized merged `get`/`list` visibility. Concatenating these
pages is not correct. This integration seam is unimplemented and was not edited.
Current operational composition remains honestly unconfigured.

## Configured gate and cleanup

The next increment must implement the real `systemd-local-v1` host, canonical
separate roots, unit sandboxing, invocation-bound launcher, full activator/role/
execution cohort stop observation, fresh native and scale factories, helper
tracking, prepared transport/producer lifecycle, binding promotion and merged
API readers. Its proof must kill actual controller/helper processes at durable
barriers, hold surviving Git/helper children, demonstrate denied restart,
perform real migration/closed-ingress health, and reopen only after atomic
commit. Neither the fixture's `verified: true` capability nor its stopped/
prepared subclasses satisfy those requirements.

No systemd manager, production install, external messages, real user data,
global tools or commit was used. No producer or concurrent benefits/editor
source was edited. Existing unrelated deployment/UI/producer suites were not
repeated. LSP diagnostics were unavailable because Biome is not installed;
the real owned strict TypeScript and lint commands supplied clean diagnostics
without installing it.

Fixture resources were closed through their exact owned disposal paths.
Observed database/container removals, S3 container/volume/listener removal,
repository server/storage close, attached-process exits and exact root absence
are retained in `cleanup.txt`. Container exit `137` is intentional force-removal
cleanup after tests, not a helper result or passing crash test. No shared
temporary directories, unrelated containers or other agents' processes were
deleted. Configured supervision remains an explicit downstream gate.
