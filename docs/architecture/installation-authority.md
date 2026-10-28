# Installation authority for configured signed updates

Decision date: October 27, 2026. Required application runtime: Bun 1.4.4.
Status: implementation decision, not implementation or acceptance evidence.
Owner of this decision: parent/F, with O owning the controller implementation.

## Decision

Use a separately supervised installation controller, with its own durable
control database, and an explicit stop-all / maintain / prepare / restart
protocol. The controller is not an API module or a compiler worker. It is not
part of the application release that it replaces. Only this controller runs
the signed-update scheduler and owns activation, recovery, and role launch
permissions.

Below, "supervisor" means this stable controller process; systemd supervises
that process independently of the application. `UpdateService` and its
scheduler execute in the controller. Migration, preflight, restore, and
candidate-health work execute in separately tracked helper invocations.
Helpers do not open control SQLite: the controller records their intents,
results, and exits. Killing the controller is the strongest updater-crash
case; killing an installation helper must also retain closure.

The first supported deployment driver is **`systemd-local-v1`**: one Linux
host, one explicitly selected systemd user manager, one installation-owned
set of role units and execution units, and one local durable control root.
It supports both SQLite/native data and PostgreSQL/Redis/S3 data when every
Quire writer and worker is in that host's managed cohort. External stores
need not be on that host. It does not manage arbitrary remote hosts.

The existing Compose and Helm deployments are not supported signed-install
targets under this driver. Their running application files come from images,
not the controller's local `current` symlink, and their role lifecycle is not
owned by this systemd manager. Configuration of those deployments must fail
`UPDATES_DEPLOYMENT_UNSUPPORTED`, not pretend an unconfigured updater passes
configured acceptance. There is no generic shell-command driver, automatic
Docker-socket mount into APIs, inferred kubeconfig, or assumed cluster RBAC.
Supporting multi-host/container orchestration is a separate driver delivery
with its own process-fencing, image-activation, and restore proof.

This chooses the second alternative in `docs/handoffs/p2o-integration.md`.
A durable fence checked on every admission could also work, but it would
change the ownership of PostgreSQL reserved sessions, repository tickets,
storage handles, and every restoration path. It would still require a
solution for old processes with old database handles. Stopping and replacing
the complete writer cohort is the smaller coherent change to the current
runtime and fresh-target restore contracts. Keep `MutationAdmission` and its
existing native/PostgreSQL backup semantics; do not relabel callback-scoped
locks as crash-retained installation authority.

## Source findings that determine the design

The following are observations of the current source, not inferred acceptance:

* `packages/runtime/src/native-admission.ts` owns two flock descriptions.
  `services/operations/storage/postgres/admission.ts` owns two advisory locks
  on reserved PostgreSQL sessions. Either process/session can disappear.
  `LocalMutationAdmission.exclusive()` releases in `finally`.
* `services/operations/updates/service.ts` keeps `retainedGate` in memory.
  `.update-lock` in `installer.ts` excludes another updater, not HTTP, Git,
  realtime, compiler, or adapter mutations.
* The updater writes stage paths, backup metadata, phases, the successful
  version floor, and `operations` receipts through its captured application
  `context.db`/`context.uow`, including after `safety.rollback()`.
  `recover()` currently releases its gate before its final receipt write.
* `services/operations/backups/database.ts:assertSettled` rejects every
  queued/running application operation except the exact current backup.
  An application `operations` row for a running update therefore prevents
  that update's own real backup. Its omission from the small updater fixture
  is not proof that the production composition works.
* `backups/restore.ts` deliberately restores into a fresh target and closes
  that target. It rejects the live data directory, verifies original migration
  evidence, expires restored worker/branch authority, and has no live rebind
  API. Default composition restores scale archives into isolated SQLite,
  which is useful for drills but is not PostgreSQL production rollback.
* `createRuntime()` migrates and registers modules before returning.
  Registration can recover journals and write data. The compiler creates its
  reaper during registration; Dropbox registration can start recovery work.
  `createRuntime()` also dispatches events before return. Merely postponing
  `app.start()` is insufficient to prepare a quiet candidate.
* `scripts/ops/install.ts` currently installs `release/`, `data/`, and an
  unmanaged launcher. It does not provision `.quire-update-root`,
  `releases/`, `current`, a controller, or supervised role units.

The handoffs `p2o-updates.md`, `p2o-backup-integration.md`, and
`p2o-deployment.md` remain historical evidence. This decision does not rewrite
their original migration bytes or extend their recorded test claims.

## Invariants

1. **Independent authority.** Update commands, receipts, version floors,
   role inventory, recovery state, and release/data bindings are in control
   storage outside every application backup, restore target, and release
   directory. Replacing application SQL never replaces this authority.
2. **One launch owner.** Every application entry point, including migration,
   SSH, repository, worker-controller, and transient execution roles, runs
   through a controller-authorized launcher. Authorization is tied to the
   exact systemd unit invocation, role, installation, and generation, not a
   reusable environment boolean.
3. **No maintenance before actual stop.** Backup, live migration, pointer
   changes, and restore require a stopped-cohort receipt. That receipt means
   no ordinary role invocation, Git child, execution unit, or tracked
   container remains capable of writing. A stop request, lost heartbeat,
   expired PostgreSQL session, dead parent PID, or empty application lease
   table is not sufficient.
4. **Crash closure.** The controller commits launch inhibition before it
   starts stopping roles. Inhibition is never released by process death,
   expiry, failed rollback, or a `finally` block. If the installer/helper is
   killed after quiescence, ordinary roles are already stopped. A role that
   tries to restart cannot pass the durable launch gate. A child that
   survives a stop prevents maintenance from beginning.
5. **Fresh binding.** No previously constructed application `Runtime`,
   `ModuleContext`, SQL pool, blob store, repository client, event cursor, or
   worker controller survives a release/data switch. Rebinding means fresh
   processes built from a committed binding, not assigning `context.db`.
6. **One commit point.** A successful receipt, increased signed-release
   floor, committed binding, and normal-launch permission commit together
   in control storage, after backup, migration, and closed-ingress health
   verification. Normal producers are enabled only after that transaction.
7. **Recovery cannot lower authority.** Restoring an older application
   database cannot lower the successful version/sequence floor, reuse an
   update idempotency key, erase an interrupted job, or grant an old process
   permission. Failed candidates and prior targets remain retained.
8. **No broad backup exception.** All existing `assertSettled` application
   operation checks remain effective. Update execution receipts are absent
   from the application `operations` table.

There is a deliberate distinction between closing and stopped. Existing work
may finish while the supervisor drains/stops the old cohort; no snapshot or
installation mutation is allowed yet. A crash at this point leaves the launch
gate closed and requires recovery, but cannot expose a half-migrated database
because migration has not started. After the stopped receipt, there are no
ordinary surviving writers to rely on a dead updater's locks.

## Control storage and installation layout

Use a dedicated SQLite database owned only by the controller, even when the
application uses PostgreSQL. APIs use an authenticated local control socket;
they never open this database and never get service-manager authority.
The controller's database has its own migration ledger and durable
transactions (`synchronous=FULL`). Its singleton OS lock prevents two live
controllers opening the same installation. The OS lock is process exclusion,
not the persistent launch decision.

An installation provisioned for this driver has these separate roots:

```text
<prefix>/controller/                  stable controller binary and protocol
<prefix>/control/control.sqlite       independent control ledger
<prefix>/control/controller.lock      single live controller
<prefix>/control/installation.json    operator-owned identity and role inventory
<prefix>/app/.quire-update-root       exact installation ID
<prefix>/app/releases/<release>/      immutable candidate/prior executables
<prefix>/app/current                  relative release symlink
<prefix>/data/generations/<id>/       native application generations
<prefix>/archives/                    verified full recovery archives
```

All paths are canonical, privately owned, and distinct. Neither control state
nor controller executable may be beneath an application generation, archive
restore target, or replaceable release. The socket may be under the user's
runtime directory; its disappearance never means maintenance ended. Control
storage is local durable storage, not SQLite on a shared multi-host filesystem.
Application credentials cannot write the control ledger or replace its launch
configuration. Ordinary role units must make the control directory
inaccessible and the release/controller directories read-only, while exposing
only their role-scoped control socket credential. Shared Unix UID/private
directory modes alone do not provide that separation. The operator provisions
the required unit sandboxing; capability checks reject a host that cannot
enforce it. Provision a separate control backup/export procedure: an
application archive alone cannot reconstruct release floors or clear a gate.
Missing/corrupt control storage stops launches; it is not initialized to open.

Control migrations start with an independent `001-installation-control`
ledger, not an application `schema_migrations` entry. Required records:

| Record | Required durable fields |
| --- | --- |
| installation | installation ID, protocol version, monotonic generation, mode (`open`, `installing`, `recovery_required`), owning operation ID, committed release target, data binding, highest successful sequence/version |
| update command/operation | stable operation ID, actor ID, original idempotency key, canonical request digest, complete request, signed manifest/package identity, schedule, progress, phase, error, exact result, timestamps |
| update recovery | prior/candidate release targets, prior/candidate data bindings, verified backup ID/digest/path, migration intent, activation intent, original migration ledger, restore result, last completed step |
| execution | supervisor epoch, exact unit invocation/container identities, role, generation, permitted purpose, start/exit acknowledgments, stopped-cohort evidence |
| legacy import | source installation/data identity, original rows, row-set digest, copy/remove checkpoints |

`recovery_required` persists after a failed rollback or observed installer
death. On controller restart, any nonterminal installation marked `installing`
is first changed transactionally to `recovery_required`; no work or role
launch precedes that write. A controller must not resume an interrupted
installation automatically just because it can acquire `controller.lock`.
An interrupted claimed command in `validating` or `staged` also enters
`recovery_required`, even if launch inhibition had not yet been committed:
it is not silently reclaimed. Recovery can verify and retain the untouched
prior binding when no live-migration intent exists.
Queued jobs that never acquired installation authority may remain queued.

Record intent before each external side effect and its result afterward.
Filesystem symlink replacement and SQL transactions are not one atomic
transaction. A crash between them is resolved from the recorded prior and
candidate identities under the still-closed gate, never from a guess that
whatever `current` points to must be healthy.

## Update receipt separation, idempotency, and HTTP visibility

`UpdateStore` must receive a control-store connection, not `ModuleContext`.
Every current direct SQL access in `UpdateService` moves behind that store:
`releases()` schedule lookup, `nextAt()`, stage paths, backup receipt, phase,
`ROLLBACK_FAILED` details, recovery lookup, `finish()`, and atomic `succeed()`.
The application connection is never the update receipt authority, even before
rollback. There is no mirrored queued/running update `operations` row.

The existing application-wide `UNIQUE(actor_id,idempotency_key)` behavior
needs explicit preservation across this separation. Add an additive
application migration, with SQLite and PostgreSQL variants, for
`o_update_command_keys(actor_id, request_key, operation_id, request_digest)`.
This is a command-key reservation, with no operation status, phase, result,
release floor, or execution authority. It is not an update receipt.

* A new request first reserves its key/operation ID in an application
  transaction after the existing operator, CSRF, and fresh-auth checks.
  It then submits that exact identity and request to the control socket.
  A duplicate reservation must match all request inputs.
* New insert triggers on `operations` and `o_update_command_keys` prevent
  the same actor/key being used in the other table. In PostgreSQL both
  triggers take the same transaction advisory lock derived from actor/key
  before checking the other table; SQLite's writer transaction serializes
  the check. Keep the original `operations` uniqueness constraint.
* The controller atomically accepts one command per installation/actor/key,
  validates the complete request, and persists the queued receipt before
  acknowledging. It checks an existing receipt before fetching the feed.
  Identical retries return its original operation ID/result even if the
  feed is now unavailable. Different request bodies return
  `IDEMPOTENCY_CONFLICT`.
* A crash after key reservation but before control acceptance is a reserved
  command, not a scheduled update. Retrying finishes submission using the
  same operation ID. Do not report success from the reservation alone.
  A crash after acceptance but before the HTTP response is resolved by
  the controller's idempotent receipt.
* Restore reconciliation reconstructs missing key reservations from control
  receipts before normal roles reopen. It never resurrects deleted users or
  grants operator status; a missing actor or conflicting reservation blocks
  reopening for explicit recovery. The normal update rollback snapshot is
  taken after reservation and therefore includes the requesting actor/key.

Update routes retain identity/CSRF/fresh-auth in the application. A trusted
control client forwards only authenticated commands; neither an arbitrary
actor ID supplied by a browser nor socket network reachability is authority.
Use installation-scoped API credentials on the private socket, separate
from the operator recovery channel. The API credential can submit/read
commands, not stop units, change bindings, or recover installations.
At execution, while the old application is still available, recheck that
the scheduling actor is still an active operator. Never recreate an identity
service with a control database in place of application SQL.

`services/operations/tasks/index.ts` must compose application and update
operation readers. `operationGet` resolves by ID; `operationsList` merges
authorized rows from both sources with the existing ID ordering, kind/status
filters, page limit, and cursor semantics. Preserve actor ownership and
current identity authorization; installation receipts are operator-only.
Do not create a second registration of the same endpoint. Download authority
remains the existing core implementation; an update receipt has no fabricated
download blob. During maintenance public APIs can be unavailable; local
operator `status` reads control storage through the supervisor.

This resolves the backup conflict structurally. `createBackup()` sees no
running update in application `operations`; `assertSettled()` still rejects
an actual running adapter operation, unfinished journal, or unrelated backup.
Do not pass the update ID as `activeBackupId`, fake a succeeded operation,
skip a table, or allow every `kind='update'` row.

### Existing installation migration

Bootstrap the new controller under an operator-arranged all-role stop.
Copy the existing `update_jobs`, matching `operations`, and
`update_install_state` records into control storage, preserving IDs, request
keys, phase/result bytes, and the maximum successful floor. Commit and verify
the import row-set digest before deleting the copied update job/operation/
floor rows from the application in one transaction. Populate command-key
reservations in that transaction. Keep the original `070-o-updates` tables
and SQL bytes as historical schema; do not edit or reuse that migration ID.

The cross-database import is resumable from its two checkpoints: repeated copy
must match exactly, and source removal is allowed only against the committed
matching import. Any pre-existing interrupted update becomes
`recovery_required`; bootstrap never interprets it as successful.
Import old recovery receipts before accepting a newly restored legacy
application archive as a live binding, and repeat the same conflict checks.
The raw legacy rows and original migration ledger stay in the control import
receipt even after source removal.

The baseline release must support this control/launch protocol before
automatic updates are enabled. Converting the unmanaged `release/` install
layout is an explicit stopped bootstrap operation, not a blind in-place rename
by the first scheduled update. Provisioning does not automatically enable
daemons or use the working source checkout as an installation.

## Native supervision: concrete authority

Provision `quire-install-<installId>.service` for the stable controller and
installation-specific service units for API instances, singleton repository,
SSH bridge, worker controller, and configured standalone workers. Include
their activators (socket/timer units) in the installation inventory.
The selected systemd user manager must remain available across unattended
operation; the operator provisions its startup/lingering policy explicitly.

Ordinary units use `BindsTo=` and `After=` on the controller unit, and
`KillMode=control-group` with final termination enabled. These settings are
grounded in `systemd.unit(5)` and `systemd.kill(5)`: loss of the bound unit
stops dependents, and stopping a unit terminates its remaining cgroup
processes. They do not prove that a stop has already completed. The driver
subscribes to manager job/unit changes and verifies the relevant cgroups are
empty before recording a stopped receipt.

The stable `role-launcher` is the `ExecStart` program. Before any application
module import that can initialize storage, it asks the supervisor for a launch
permit for its actual unit invocation ID. Permit issuance and closing the
launch gate share the supervisor's serialized control transaction. Every
already-issued or pending invocation is included in stop/drain. Consequently,
a launcher paused after approval cannot slip past closure: its entire
invocation is stopped before maintenance. A standalone `ExecCondition`
reading a file would have a check/exec race and is not the mechanism.

The launcher supplies the resolved committed release and data generation,
not a caller-chosen path. It fails closed if the controller is absent, the
generation differs, the invocation is unregistered, or maintenance is closed.
All entrypoints also validate the launch binding before `prepareData`,
`openDatabase`, migrations, repository volume ownership, or worker startup.
Direct source/development invocations remain development-only and cannot
access an installation marked as controller-owned without a permit.

Transient worker/compiler/environment units currently launched through
`systemd-run --user` must be registered with installation identity before
they can start and bound to the same controller. Existing names such as
`quire-worker-<uuid>` are not a sufficient ownership inventory.
Use installation-scoped names and retain exact invocation identities.
Launch/stop requests go through the supervisor's role-scoped execution
protocol; ordinary APIs do not acquire unrestricted access to the user
manager. Existing direct `systemd-run` launch helpers must use that protocol
when attached to a controlled installation.
Docker execution children, when enabled, must carry installation/operation
labels and be explicitly stopped and observed exited; the systemd CLI
process's exit is not container exit. The worker host/control driver needs
that explicitly provisioned Docker authority. APIs do not receive it.

Prefer graceful shutdown through the existing close hooks. If a unit needs
forced termination, record that fact and inspect settled application state
before proceeding. An unfinished source/adapter journal still fails backup;
forced termination does not license clearing it. Never signal a PID copied
from restored SQL: use the manager's owned invocation identity.

The updater execution helper, preflight helper, restore helper, and prepared
candidate processes are separately identified maintenance invocations.
They use the same controller binding and cgroup termination rules.
They are stopped/drained too before a retry or rollback. Killing the updater
may leave an OS child briefly running; it does not let ordinary role launches
resume, and recovery cannot manipulate its target until that child is gone.
The stable supervisor may restart after its own crash, but the persisted
mode still requires exact operator recovery.

## Lifecycle and rollback

1. In `open`, authenticate and reserve a scheduled command. Only the
   independent controller scheduler claims it. Reverify feed/signature,
   expiry, signed sequence/version, package bytes/hash, schema compatibility,
   owned installation root, and the maintenance window.
2. Stage and sync the candidate using the existing package/path checks.
   Persist the verified package entrypoint as well as prior/staged targets;
   the current service does not yet carry the entrypoint into its host hooks.
   The package must be complete and runnable with the provisioned Bun 1.4.4,
   with no network package installation during activation.
3. Transactionally set `mode=installing`, attach the operation, advance the
   supervisor generation, and inhibit ordinary launches. Stop activators,
   producer/worker roles, APIs/SSH, then repository roles, allowing dependent
   cleanup while its storage/repository authority still exists. Observe
   actual completion of every ordinary invocation and execution child.
4. Reconcile the stopped source under a controller-owned maintenance runtime.
   Fence queued/remote compiler work using the actual compiler quiescence
   implementation. If journals/operations are not settled, do not migrate.
   This is a failure requiring their real recovery, not an automatic blanket
   status rewrite.
5. Create and verify a full signed archive with the existing backup code.
   The supplied `BackupHost.exclusive` validates the supervisor's stopped
   generation and acquires the actual runtime admission exclusive for the
   callback. It is not `work => work()` or a resolved Promise masquerading
   as retained exclusion. Persist the backup identity/digest and original
   migration ledger in independent control storage before proceeding.
6. Restore that archive to an isolated fresh target using the **prior**
   release's exact migration inventory. Run the candidate's real migration
   entrypoint against the isolated target. Run executable/schema/data health
   checks there. Preflight failure does not touch the live binding.
7. Persist live-migration intent before launching the actual candidate
   migration against the stopped live data. Close the maintenance runtime's
   SQL/blob/repository/event handles before launching a migration process or
   changing its storage binding. Wait for the process and all its children.
8. Activate the candidate release symlink durably, recording its result.
   Start new candidate roles in **prepared** mode under a maintenance permit.
   All public HTTP, WebSocket, SSE, Git, SSH, and worker endpoints reject
   ordinary callers or remain unbound. Background/outbound producers remain
   unstarted. The supervisor can use an invocation-bound private readiness
   channel, not a public bypass header.
9. Verify actual candidate executable identity, Bun version, original plus
   candidate migration digests, SQL connectivity, blob reads, repository
   authority, required static assets, and each configured role's prepared
   readiness. Observe failures through real processes, not injected booleans.
10. In one control transaction commit the successful receipt, increased
    floor, release/data binding, and `mode=open` for the new generation.
    Only then tell prepared roles to accept ordinary traffic and start their
    producers. An old generation cannot consume that activation message.

Preparing an application requires a small explicit lifecycle seam:
`createApplication({ startup: "prepared" })` constructs the real application
but defers event dispatch and every producer until `start()`. Move the
compiler reaper from registration into that lifecycle; defer Dropbox's
external recovery to adapter activation; keep history/journal registration
work local and controlled. The runtime's prepared option defers its initial
`events.dispatch()` and any registration-time dispatch call: records remain
durable, but listener delivery/outbox dispatch begins only at activation.
Do not merely skip the final `createRuntime()` call while allowing an earlier
registration to dispatch. Scale reconciliation must remain inactive until
that dispatch/activation. An adapter that requires outbound work to register must
be split at that boundary, not run covertly during health verification.
Prepared role transport wrappers must reject direct calls as well as ingress
traffic. Worker controllers validate configuration while prepared but cannot
start workers/reconcile until activation. Health probes do not need provider
secrets beyond the installation's already configured services.

Before step 10, a reported migration/health failure stops every prepared/maintenance invocation,
reinstates the previous executable, and restores the verified archive into a
**new** application generation. It never copies a SQLite file over an open
connection. The prior release prepares against the restored generation,
checks readiness, and the controller writes a failed-but-rolled-back receipt
and reopens only after those checks. If no live migration intent exists,
recovery can retain the untouched old data after verifying it; it must not
claim that a restore was performed.

That automatic rollback is for a reported, completed migration/health failure.
Unexpected helper death or loss of the controlling process is instead an
interruption: stop remaining maintenance invocations, persist
`recovery_required`, and await the exact operator recovery command. A killed
process's missing result is not a reported successful or failed migration.

If rollback or readiness fails, persist `recovery_required` and the actual
failure in control storage. Keep both prior and failed targets and every
archive needed for recovery. Do not call `gate.release()` in `finally`.
`recover <installId> <operationId>` is an exact operator command on the
trusted control channel. Recovery checks the matching operation/lock,
stops and drains residual maintenance invocations, verifies the recorded
backup when live migration was attempted, performs the same fresh restore
and prior-role preparation (or verifies untouched prior data before migration),
commits
the terminal recovery receipt, then reopens. Generic `yes` and deleting
`.update-lock` cannot reopen the installation.

Step 10 is also the boundary beyond which automatic data rollback is
forbidden: new user writes may exist. A later service/producer failure is a
deployment incident, not permission to restore the pre-update snapshot.
Retain the committed floor and receipt and report the incident separately.
A crash after that atomic commit but before every activation notification
can finish activation for the committed healthy generation; it must not
reexecute migration or create a second receipt.

## PostgreSQL/scale binding and restore

For `systemd-local-v1` scale, the operator must provision all of:

* The exact local unit inventory for every API, the singleton TLS repository,
  SSH bridge, worker controller, and execution worker. No API on another
  host or independently auto-restarting container may write these stores.
* Application PostgreSQL credentials and a separate maintenance provisioning
  role allowed to create the owned fresh restore database (or a preallocated
  demonstrably empty database). The driver has no implicit superuser role.
* Explicit S3 endpoint/region and credentials authorized for an owned fresh
  restore bucket, or a pre-provisioned empty bucket. The current `S3BlobStore`
  has no per-generation prefix, so a fictional prefix option is not enough.
* Installation-owned fresh Git volume directories, repository TLS credentials,
  the independent backup signer, the original application secret, shared
  archive storage, and a fresh Redis namespace for each promoted restoration.
* Enough space and authority to retain old databases/buckets/volumes until
  a separate operator retention action; rollback does not drop them.

The data binding is a single control record containing native data generation
or the complete PostgreSQL database, S3 bucket, repository volume/endpoint,
Redis namespace, and secret references. Secrets are references to
operator-provisioned files, not plaintext response fields. Promote the
binding only while all roles are stopped. Restart every role with that exact
binding. PostgreSQL pools, reserved sessions/admission tickets, Redis cursors,
repository ownership, and API-local directories are all new.

Factor the existing restore importer into a fresh-target primitive accepting
an explicitly opened and ownership-verified target. Keep the current public
`restoreBackup` isolated-target API unchanged. The installation host's
PostgreSQL fresh-target factory opens real PostgreSQL storage, S3 storage,
and an isolated singleton repository, with the prior migration set and no
normal producer registration. It must prove the target database/bucket/Git
volume differ from every live/retained source identity before importing.
Do not disguise the current SQLite drill as a scale rollback.

The existing import handling for original migrations, branch fences, worker
leases, and interrupted backup receipts remains in use. Preserve migration
digests for the original dialect; explicitly record any dialect conversion
in a drill, but production update rollback remains in its original dialect.
Reconcile external update key reservations after import. Control SQLite never
closes or changes merely because the application PostgreSQL database changes.
No write after rollback uses the old `ModuleContext`.

A scale configuration that cannot prove the complete local writer inventory,
fresh-target authority, or shared archive access fails capability validation
before accepting a schedule. For existing Compose/Helm or multi-host scale,
the missing fact is the operator's real orchestration/restore authority and
its concrete driver, not another URL value. A future driver must specify
namespaces/workloads/replica inventories, reconciler inhibition, process
termination or storage fencing on unreachable nodes, signed image identity,
all-store promotion, and restart proof. Pod deletion acknowledgments or
scaling a workload to zero are not proof that an unreachable old writer
cannot reach PostgreSQL/S3/Git.

## Writer and receipt trace

These paths retain their existing operation admission while running. During
installation they are covered by process replacement, not a new promise that
their old flock/advisory lock survived a crash.

| Surface and actual path | Normal admission and required installation coverage |
| --- | --- |
| HTTP, including internal worker routes: `runtime/src/router.ts`, `deploy/runtime/server.ts` | Whole handler uses `admission.writer`; backup/SSE have the documented exceptions. Stop all API invocations; prepared transport admits only private readiness. `server.ts` must gate before WebSocket upgrade as well as router dispatch. |
| Realtime/history: `core/review/realtime.ts`, `history.ts` | Messages use writer admission; refresh, presence and history follow-up use background admission. Await `disposeReview` and actual process exit. Deferred events in prepared mode cannot schedule these before activation. |
| SSE/events: `runtime/src/events.ts`, `apps/server/src/scale.ts` | Event replay/outbox SQL uses storage admission; Redis catch-up is a role-owned producer. Stop its host and discard its cursor. No old SSE listener survives a promoted binding. |
| Native SQL and Git: `runtime/src/sqlite.ts`, `repository.ts`, `repository-process.ts` | SQL queue and repository operations are admitted; Git inherits the writer fd through actual exit. Both parent and Git child must be gone before the stopped receipt. Replacing a path while either lives is forbidden. |
| PostgreSQL SQL: `storage/postgres/index.ts`, `admission.ts` | SQL and transactions use the owning reserved session. Kill/restart closes every application session; a later pool cannot recreate an old role permit. Session locks alone remain insufficient. |
| Remote Git: `repository/client.ts`, `server.ts`, `admission.ts`, `process.ts` | RPC carries a live PG ticket; repository admission drains actual Git work; the volume owner fd can outlive the repository parent. Stop the singleton and observe Git exit/volume ownership release. No acceptance based only on API connection loss. |
| SSH: `scripts/ops/ssh.ts`, `operations/ssh/runtime.ts`, `core/git/session.ts` | Whole Git session is a writer; the bridge constructs a separate runtime and can recover journals at startup. Include bridge/forced-session invocations and their activators in the cohort and gate before runtime creation. |
| Compiler: `compiler/service.ts`, `quiescence.ts`, `worker-routes.ts` | Whole local jobs/background pumps are admitted; remote callback storage is fenced through HTTP. Stop workers and API callbacks; fence outstanding jobs before the backup. Move registration reaper into activation. |
| Worker controller: `scripts/ops/workers.ts`, `operations/workers/controller.ts`, `process.ts` | Reconcile and exit cleanup use background admission; children can be separate systemd units. Stop controller launches first, then its exact child units and cleanup. SQL lease/PID rows never substitute for process proof. |
| Environment/compiler execution: `operations/environments/lifecycle.ts`, `workers/compiler/sandbox.ts`, Docker execution helpers | Await supervised environment work and its execution units/containers. No surviving container may publish via a reopened API using a restored lease; restored authority is expired and old worker generation is denied. |
| Adapters: `adapters/index.ts`, `shared/operations.ts`, AI/Dropbox/references/delivery | Aggregate ticks and asynchronous work use background/writer admission, including error/cleanup writes. Await actual aggregate close, stop the host, and defer outbound/recovery producers in prepared mode. Already completed external effects are not undone by database rollback. |
| Update receipts: `updates/service.ts`, `store.ts` | All nine current classes of update SQL access move to the independent store. No old application transaction is retained across backup/migration/restore. API visibility is a read composition, not a queued/running application mirror. |
| Schema/startup: `runtime/src/context.ts`, `scripts/migrate.ts`, role entrypoints | Guard before any database creation/migration/registration. A stopped API alone does not exclude an independently launched migration command. |

## Exact interfaces and ownership deltas

Names below specify implementation boundaries; they are not existing exports.
Use the existing branded IDs/digests/instants and parsed boundary schemas.

```ts
// services/operations/installation/model.ts
interface InstallationAuthority {
  capabilities(): Promise<InstallationCapabilities>;
  stopForUpdate(operationId: Id): Promise<StoppedInstallation>;
  withStopped<T>(
    stopped: StoppedInstallation,
    work: () => Promise<T>,
  ): Promise<T>;
  prepare(input: PrepareInstallation): Promise<PreparedInstallation>;
  commit(input: InstallationCommit): Promise<Operation>;
  recover(input: RecoveryRequest): Promise<Operation>;
}

// StoppedInstallation is bound to installId, operationId, supervisor epoch,
// generation, and exact stopped invocation identities. It is not forgeable
// from request JSON and is never a generic release() callback.
// PrepareInstallation names the release, data binding, stopped authority,
// and expected executable/schema identities.
// InstallationCommit contains the prepared authority and terminal receipt;
// successful installs additionally advance the signed sequence/version floor.

// services/operations/updates/client.ts -- API-visible subset
interface UpdateClient {
  releases(): Promise<readonly Release[]>;
  create(request: ReservedUpdateCommand): Promise<Operation>;
  get(id: Id): Promise<UpdateOperationRow | null>;
  list(query: UpdateOperationQuery): Promise<readonly UpdateOperationRow[]>;
}

// services/operations/installation/storage.ts -- host-maintenance subset
interface InstallationStorage {
  backup(stopped: StoppedInstallation): Promise<VerifiedInstallationBackup>;
  preflight(input: InstallationPreflight): Promise<MigrationEvidence>;
  migrate(input: InstallationMigration): Promise<MigrationEvidence>;
  restore(input: InstallationRestore): Promise<RestoredBinding>;
}
```

`capabilities()` returns the concrete driver, installation identity, complete
role inventory digest, supported application dialect, and validated fresh
restore capability. An unsupported deployment returns a specific error, not
`true` from injected callbacks. `withStopped` checks live supervisor ownership,
durable closed mode, generation, and actual owned execution membership.
Only explicit `commit` after prepared health can reopen. A separate internal
controller API issues per-invocation launch/prepare/activate permits; the API
update credential cannot call it.

Replace the callback-shaped production `UpdateSafety` contract with these
host capabilities. `UpdateService` becomes controller-side orchestration with
control store, clock, installer, authority, and storage dependencies; it no
longer captures an application `ModuleContext`. The small fixture contract
may be changed with its tests, but it must not remain the production fallback.
`startScheduler` exists only in the controller process. API composition
registers an `UpdateClient` and retains only that client's close lifetime.

| Owner | Exact paths and delta |
| --- | --- |
| O updates | `services/operations/updates/{service,store,model,index,scheduler,installer}.ts`; add `client.ts`, command-key migration/reservation helpers. Move all execution state off application SQL; retain signature/package validation; remove `retainedGate`; preserve one module registration. |
| O controller | New `services/operations/installation/{model,control-store,control-migrations,controller,protocol,storage}.ts`. Own durable state machine, command transport, legacy import, atomic floor/receipt/binding commit and recovery. |
| Deployment/controller host | New `deploy/runtime/installation-{main,launcher,systemd,storage}.ts` and installation unit templates. Own real process-manager stop/exit evidence, local launch permits, maintenance children, private prepared health and native/scale binding factories. |
| Backup/storage owner | `services/operations/backups/restore.ts` and new `restore-target.ts`; expose the verified fresh-target import primitive without broadening the public live-restore API. Keep `database.ts:assertSettled` strict. |
| F parent | `packages/runtime/src/{context,config,events}.ts`, `apps/server/src/{main,repository-main,scale}.ts`, `scripts/migrate.ts`. Enforce controller-owned launch binding before storage; support prepared runtime event lifecycle; rebuild all adapters on new process/binding. Do not change lock/ticket semantics. |
| Existing O integrator (`st_01a17dd5`) | `apps/server/src/composition.ts`, `services/operations/index.ts`, `services/operations/tasks/index.ts`, and its host helpers. Inject the client once, merge receipt reads, expose prepared/start/close lifecycle, keep the controller scheduler out of API startup. |
| Compiler/adapter owners | `services/compiler/{index,service}.ts`, `services/adapters/{index.ts,dropbox/index.ts}`, plus concrete registration producers found by their checks. Defer reaper/outbound recovery until activation; preserve drain/close and existing role boundaries. |
| Worker/execution owners | `scripts/ops/{workers,ssh}.ts`, `workers/compiler/{main,sandbox,docker}.ts`, `services/operations/{workers/process,environments/process}.ts` as applicable. Register exact execution identities with the supervisor, guard entrypoints, and retain full actual-exit semantics. |
| Deployment installer | `scripts/ops/install.ts`, `deploy/runtime/{server,entrypoint}.ts`, `docs/runbooks/{deployment,updates}.md`. Provision separate roots and protocol-compatible baseline; prepared transport gate; explicit unsupported Compose/Helm update capability. No automatic production activation. |

## Disjoint implementation increments

These are ordered delivery increments, not permission to count a partial
configuration as finished. Each lane owns only its listed files until an
explicit parent merge. Existing O composition work can continue independently.

1. **Control contract and receipt storage.** O controller adds only the new
   `services/operations/installation/` contract/store/protocol files and
   `tests/operations/installation/control-*`. O updates then adapts its own
   update files and tests to those exports. Establish replay/conflict,
   interrupted-state, import, and atomic success semantics with real SQLite.
   Do not enable the API client until the host capability exists.
2. **Fresh-target restore primitive.** Backup owner changes only its restore
   implementation and backup tests; retains public isolated restore
   behavior and migration evidence. It lands independently of composition.
3. **Supervisor and native binding.** Deployment/controller owner adds the
   new installation host files/unit templates and native process proofs,
   then updates `install.ts`. This increment supplies a real
   `systemd-local-v1` authority, not test-only callbacks.
4. **Launch and prepared lifecycle.** Parent/F owns runtime/entrypoint
   changes; compiler/adapter and worker owners change only their named
   producer/launcher paths. This is the mandatory cohort-closure increment.
   The integrator consumes the exported prepared lifecycle after it lands,
   rather than concurrently rewriting those files.
5. **O integration.** The existing O integrator alone edits composition,
   operational module wiring, task readers, and its host helpers. Its input
   contract is `UpdateClient`, prepared/start/close lifecycle, and validated
   host capability. It adds real configured native route/scheduler/update/
   rollback proof. No second API scheduler or Promise gate bridge.
6. **Single-host PostgreSQL scale.** Controller-host owner supplies the
   explicit PostgreSQL/S3/fresh-repository factory and tests against owned
   disposable services. Until that passes, a scale binding returns
   `UPDATES_RESTORE_UNAVAILABLE`. Compose/Helm remain explicitly unsupported
   by this driver; absence of a container orchestration driver is not a
   completed scale acceptance case.

Only the named architecture document was changed for this decision. This
table assigns future work; it does not authorize overwriting another lane's
concurrent edits.

## Falsifiable acceptance and locally executable proof

The proof uses real processes and stores. Register IPC/process-manager/event
barriers before triggering each action; inject a stop at a durable phase
boundary, not a fixed sleep. A test driver controls when a real migration or
health helper continues, then sends an actual `SIGKILL`. Assert database rows,
Git refs, blob digests, unit invocation exits, launch denials, and control
receipts. A resolved callback or injected `held=true` is not evidence.

| Case | Required observation |
| --- | --- |
| Two API/realtime writers, active Git child, adapter work, and compiler work | Stop begins with new launches inhibited; work either drains or its full owned process exits. No backup/migration marker appears until every ordinary writer and child is gone. |
| Hold a Git child after killing its API/repository parent | Stopped receipt is unavailable while the child retains source/volume authority. Neither a lost PG ticket nor parent exit allows migration. |
| Kill updater after verified backup, during live migration, after symlink switch, and during candidate health | Previously ordinary roles remain stopped. Direct launcher/API/repository/worker restart attempts fail. Control state survives and requires exact recovery. No new source revision/ref/blob publication is accepted. |
| Kill controller instead of updater | Bound application/maintenance units stop; restart first persists `recovery_required` for an interrupted install. Ordinary launch permission does not arise from released OS locks. |
| Kill while old cohort is still stopping | No backup or migration has begun; launch inhibition survives. Recovery reobserves actual remaining processes before it touches data. |
| Kill migration/restore parent while its child still runs | Recovery cannot restore, promote, or restart until the exact helper cgroup/container is empty. |
| Wrong/generic recovery confirmation or unrelated `.update-lock` removal | Recovery is rejected and the gate remains closed; a matching filesystem lock alone cannot reopen. |
| Actual migration failure followed by successful rollback | Original source, SQL content, Git refs, secret authority, and archive digest are preserved in a fresh data generation; prior executable prepares successfully; failure receipt is readable from control storage. |
| Restore failure, corrupt archive, or prior-role health failure | `recovery_required` and original/rollback errors persist across both updater and controller restart. No release in `finally`. |
| SQLite generation replacement / PostgreSQL database replacement | Old processes and handles are gone; new roles report the new binding/generation. Post-rollback phase/final receipts still update the original control database, never the abandoned application database. |
| Pending application adapter operation | Real backup still rejects `BACKUP_RECOVERY_REQUIRED`. A queued/running update exists only in control storage and does not cause that rejection by itself. |
| Update key reserved but not submitted; accepted but HTTP reply lost | Retry uses one operation ID; no false queued receipt before acceptance; changed request and cross-kind key reuse conflict. |
| Restored older application copy | The control floor and update receipts survive; missing key reservations reconcile before start; replay/downgrade remains rejected even if feed is offline. |
| Crash in legacy import between copy and source removal | Reimport matches raw row digest and removes only the proven copy; no receipt loss, duplicate command, or changed original migration digest. |
| Concurrent controller/scheduler | Only the owned controller lock/process can execute; a second API or controller cannot claim another installer authority. |
| Prepared candidate direct HTTP/WebSocket/SSH/worker calls and adapter tick | Ordinary work is denied and no outbound producer runs before the atomic commit. Private readiness reaches the actual candidate executable and real target stores. |
| Crash after atomic success/open commit before activation messages | Restart uses the committed generation and original receipt; no second migration, automatic rollback, or floor regression. |
| Scale stop/provisioning capability missing, wrong bucket/DB, or remote writer present | Configuration/scheduling fails before backup or installation; no SQLite fallback and no claim of configured scale success. |
| Complete local scale cohort with real PostgreSQL/Redis/S3/repository | Both API processes stop, real PostgreSQL backup restores to a distinct PostgreSQL database and fresh bucket/Git target, and both restart on the same committed binding. |

The native proof can run without production credentials: use a private
`quire-installation-*` temporary prefix, ephemeral signing keys, a loopback
signed feed, the actual provisioned Bun 1.4.4 executable, installation-specific
temporary user-manager units, and full local SQL/blob/Git data. Extend the
real fixture patterns in `tests/operations/deployment/native.test.ts` and
`tests/operations/updates/fixture.ts`; replace the latter's in-memory gate
and miniature application database for this acceptance path. Exercise the
actual production composition, controller, launcher, backup importer, and
candidate executable. Kill/restart and rollback are local operations on that
owned sandbox, not production deployment.

The PostgreSQL variant can also run locally without production credentials:
owned disposable PostgreSQL/Redis/MinIO services and the actual singleton
repository, two systemd-managed API invocations, owned databases/buckets/
volumes, and generated TLS/signing material. Existing
`tests/operations/deployment/{fixture-setup,scale-proof,shared-backup-proof}.ts`
identify reusable fixture boundaries, not proof of this new controller.
This verifies the supported single-host scale driver. It does not verify
multi-host Helm/container orchestration or external operator permissions.

Read-only prerequisite inspection for this decision found `systemctl`,
`systemd-run`, Git, Docker, and `bwrap` executables and an `XDG_RUNTIME_DIR`.
It did not test the user manager, Docker daemon, fresh-store permissions,
or run any installation proof. The agent kernel reports Bun 1.4.3 and PATH
points at the global Bun; neither is acceptable substitution for the
project/deployment Bun 1.4.4. Downstream proof must record the actual selected
binary's version before starting. If sandbox service-manager access is
unavailable, report that specific blocked process proof; do not replace it
with a fake supervisor.

No new tests, deployment, application/controller starts, production updates, global tool
changes, or passing crash claims are part of this design-only deliverable.
The irreducible deployment facts are the operator's exact managed role set,
user-manager authority/startup policy, trusted release feed/key, durable
control root, and (for scale) fresh PostgreSQL/S3/Git provisioning authority.
They cannot be derived from this repository or manufactured by an API.
