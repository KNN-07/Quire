# P7 systemd supervisor and controller IPC: FINAL

October 27, 2026. Recovery owner: `st_01a17e6f`.

**PASS for the concrete supervisor, authenticated local transport, prepared
host, and tested native/PostgreSQL storage adapters. Configured all-role
installation integration is a separate gate owned by `st_01a17e71`.**

The existing pending run completed on project-local **Bun 1.4.4 (38afee6c8)**:
**7 passed, 0 failed, 83 assertions, 127.78 seconds, exit 0**. Its preceding
strict TypeScript and type-aware deny-warning lint commands also exited 0.
The run was recovered, not duplicated after the parent requested its result.
Exact owned cleanup and all 17 final source fingerprints were then checked
with exit 0. This FINAL file was written after those checks and evidence files.

## Delivered implementation

`services/operations/installation/systemd-authority.ts` implements the existing
`InstallationAuthority`, using the independently verified `ControlStore`.
It acquires the controller lock before opening the ledger with a fresh epoch,
checks its actual configured controller service, and reconciles old owned
invocations before exposing the launch socket. The ledger preserves interrupted
state, receipts, successful floors, and explicit recovery requirements.

Ordinary launch inhibition is durable before stop requests. The driver owns
an exact bounded role/unit/activator inventory and a separate helper slot.
It observes actual systemd job completion, recursively inspects owned cgroups,
and requires whole-cohort absence before issuing a process-local stopped
capability. Pending launchers are covered by their owned units even before
application construction. Unknown containers or execution units are rejected,
not treated as stopped because their parent CLI exited.

Launch permits are issued only to the kernel-authenticated caller in the
actual owned unit invocation. Attestation includes UID, PID, process start
time, executable path and digest, command line, cgroup membership, invocation
ID, controller binding, kill mode and restart policy. Launch token, epoch,
generation, role and release/data binding are controller-derived. Neither
JSON nor environment strings construct stopped/prepared authority.

Real bwrap mount/PID isolation hides control state and host `/run`, mounts
control sockets read-only, keeps release/launcher files read-only, and exposes
only the configured writable data roots. This does not rely on the ineffective
user-manager `InaccessiblePaths` settings observed during the earlier probe.
No host systemd or namespace configuration was repaired.

The prepared barrier uses actual release-owned factories backed by the FINAL
prepared runtime/application APIs. Private readiness checks actual schema,
entrypoint digest and live invocation identity; the storage host separately
checks declared release assets, SQL/storage identity, blob reads and repository
authority. Every configured slot must prepare. Commit reattests those live
processes before the existing atomic receipt/floor/binding/open transaction,
then activates them with their exact token/epoch/generation. A dead prepared
child leaves recovery required. A crash after commit preserves the committed
receipt/floor and starts fresh processes rather than rerunning migration.

Maintenance runs in an owned systemd helper. Exact helper input intent is
durable before execution; result bytes and acknowledged exit follow actual
completion and cgroup absence. A completed helper failure produces the
existing `ReportedUpdateFailure` evidence. A lost helper leaves its result
missing and the gate closed. Request deadlines are transport bounds, not
leases that reopen maintenance.

## Concrete authority and configuration contracts

Exports are available directly from their named files; no application main or
composition file was edited by this lane.

```ts
// driver-config.ts
SystemdDriverConfigSchema;
type SystemdDriverConfig;
validateDriverConfig(input: unknown): Promise<SystemdDriverConfig>;
loadDriverConfig(path: string): Promise<SystemdDriverConfig>;

// systemd-authority.ts
SystemdInstallationAuthority.open(
  config: unknown, controlPath?: string,
): Promise<SystemdInstallationAuthority>;

authority.config; // SystemdDriverConfig
authority.store;  // the actual controller-only ControlStore
authority.status(): InstallationState;
authority.startCommittedRoles(): Promise<void>;
authority.capabilities(): Promise<InstallationCapabilities>;
authority.stopForUpdate(operationId: Id): Promise<StoppedInstallation>;
authority.assertStopped(stopped: StoppedInstallation): Promise<void>;
authority.withStopped<T>(stopped: StoppedInstallation,
  work: () => Promise<T>): Promise<T>;
authority.prepare(input: PrepareInstallation): Promise<PreparedInstallation>;
authority.commit(input: InstallationCommit): Promise<Operation>;
authority.recover(input: RecoveryRequest): Promise<Operation>;
authority.close(): Promise<void>;
```

Use the default `<controlRoot>/control.sqlite` in production composition.
Control storage and its lock belong exclusively to this stable controller,
outside application generations, archives and replaceable releases.
`recover` consumes the state already advanced by authenticated
`ControlStore.beginRecovery`; the existing `UpdateService.recover` performs
that transition. It is not an unauthenticated administrative shortcut.

Configuration contains:

```ts
{
  driver: "systemd-local-v1",
  installationId,
  controlRoot, socketRoot, applicationRoot, userRuntimeDir,
  controllerUnit, helperUnit,
  roles: [{ role, unit, activators }],
  maintenanceRoots: string[],
  maintenanceSecrets: string[],
  launcher: { executable, executableDigest, script, scriptDigest },
  requestBytes, requestTimeoutMs
}
```

Roots must be canonical and private. Unit names use the exact
`quire-<installationId>-` prefix, without duplicates. There are at most
128 role slots and 16 activators per slot. List roles in drain order; start
order is reversed. The controller must itself be the main process of its
configured user service with control-group termination. Launcher files are
canonical, hash-pinned, non-group/world-writable standalone artifacts.
Maintenance secrets are explicit private files below `<controlRoot>/secrets/`,
not the ledger or controller lock.

The transport default is 262,144 bytes, bounded to at most 1,048,576 bytes;
request deadlines default to 30 seconds and cannot exceed 120 seconds.
Listeners cap concurrent connections at 32. Capabilities reject
`UPDATES_LAUNCHER_UNAVAILABLE` until every configured slot has actually joined,
activated, and passed private readiness. Missing restore configuration remains
`UPDATES_RESTORE_UNAVAILABLE`. Compose and Helm return
`UPDATES_DEPLOYMENT_UNSUPPORTED`.

## Controller IPC and prepared entrypoints

```ts
// controller-server.ts
startControllerServer({
  path, authority, credentials, service,
}): Promise<{ close(): Promise<void> }>;

createUnixUpdateTransport(socketPath: string): {
  send(envelope: ControlEnvelope): Promise<unknown>;
};

connectControlledRole(socketPath: string): Promise<ControlledRoleSession>;
servePreparedRole(
  session: ControlledRoleSession, lifecycle: ControlledLifecycle,
): Promise<void>;

interface ControlledLifecycle {
  check(): Promise<unknown>;
  activate(): Promise<unknown>;
  dispose(): Promise<void>;
}
```

The control path is exactly `<socketRoot>/control.sock`; the authority owns
`<socketRoot>/roles.sock`. Credentials are
`{credential: ControlCredential, role: string | null}[]`. API credentials name
their actual attested role; operator credentials use `role: null`. The service
is the existing `UpdateClient` plus
`recover(AuthenticatedControlCommand): Promise<Operation>`. Pass the concrete
UpdateService in integration, and keep its scheduler solely in the controller.

Frames must be bounded canonical JSON. The existing HMAC authenticates all
command bytes; malformed/noncanonical frames, changed MAC/request identity,
unknown commands and unowned live callers are denied. The API channel cannot
status or recover. A fresh Unix connection is owned and closed for each update
client request. Role channels remain invocation-bound and own their prepared
lifecycle; SIGTERM/SIGINT close admission and dispose the real lifecycle.

```ts
// prepared-storage-host.ts
serveReleaseRole(session: ControlledRoleSession): Promise<void>;
serveStorageHelper(session: ControlledRoleSession): Promise<void>;
serveControlledRuntime(session: ControlledRoleSession,
  config: RuntimeConfig, options: RuntimeOptions): Promise<void>;
```

The stable launcher obtains the permit before importing application code or
opening storage. It chooses `serveReleaseRole` for ordinary/prepared purposes
and `serveStorageHelper` for maintenance. The selected release entrypoint
exports:

```ts
prepareInstallationRole(
  binding: InstallationBinding, role: string,
): Promise<ControlledLifecycle>;
```

The native proof's factory constructs the actual FINAL
`createApplication({startup: "prepared"})`. `serveControlledRuntime` instead
uses the actual FINAL `createRuntime(..., {startup: "prepared"})`, enforces
profile/native-directory binding, and supplies the entrypoint digest with
runtime readiness. Custom/scale role adapters still require the explicit
FINAL `prepareAdapters` contract; an eager factory is not assumed inert.

Each signed release must contain `installation-runtime.json`:

```ts
{
  migrations: { id: string, sql: string, postgres?: string }[],
  assets: { path: string, digest: Digest }[]
}
```

Assets must include the entrypoint. Integration's signed-package producer
must supply the complete required migration/asset inventory and actual
role factories. This delivery does not relabel fixture release metadata as
an end-to-end signed-feed/package installation proof.

## Concrete storage host

```ts
// storage.ts
new InstallationStorageHost(authority, policy); // binds itself to authority

type StoragePolicy = {
  archiveRoot: string;
  restoreRoot: string;
  signerPath: string;
  retained: readonly InstallationBinding[];
  freshTargets: readonly InstallationBinding[];
};

host.capabilities(): Promise<{ inventoryDigest: Digest; verified: true }>;
host.backup(stopped: StoppedInstallation): Promise<VerifiedInstallationBackup>;
host.preflight(input: InstallationPreflight): Promise<MigrationEvidence>;
host.migrate(input: InstallationMigration): Promise<MigrationEvidence>;
host.restore(input: InstallationRestore): Promise<RestoredBinding>;
host.checkBinding(stopped: StoppedInstallation,
  binding: InstallationBinding): Promise<void>;
host.recover(stopped: StoppedInstallation): Promise<Operation>;
```

Native adapters open the exact existing SQLite/blob/Git generation without
ordinary module registration. PostgreSQL adapters read explicit secret
references, verify the actual cluster system identifier and database OID,
open S3, and own a real authenticated local repository service for the
maintenance invocation. Database identity is
`<cluster-system-id>:<database-oid>`, never a URL-derived label. Real Redis
connect/subscription readiness is probed without starting reconciliation.
The PostgreSQL/repository admission pairing is the concrete reserved-session
exclusive plus repository exclusive, not a resolved exclusion callback.

Backup uses the real full signed archive implementation. Restoration uses
the verified `inspectRestoreTarget`/`restoreBackupToTarget` APIs and their
actual handle-bound identity tokens. It compares the completed backup ID and
manifest digest to the exact recorded archive and reconciles command keys.
The complete retained set includes provisioned bindings, committed/recovery
bindings, and durable claims for every previously selected target.

Targets are explicitly pre-provisioned, original-dialect, migration-seeded,
empty and physically distinct, with the original application secret. Two
unclaimed targets are required for configured preflight plus rollback.
Claims are durable before import; failed/old targets are retained, not deleted.
Signer type, archive/restore write authority, schema, actual storage identities,
empty blob/Git targets and original secret identity are probed. Capability
evidence is not a promise that external infrastructure can never fail, nor
does every `capabilities()` call destructively restore an archive.

Preflight really imports the archive into an isolated target, runs candidate
migrations, closes migration handles, constructs and checks each actual
candidate role factory in prepared mode, disposes it, and checks storage.
Live migration runs separately against the stopped source. Recovery after
live migration imports the original archive into another fresh generation,
durably restores the release pointer, prepares prior roles and commits the
failed recovery receipt without lowering the floor. Recovery before live
migration verifies the untouched prior binding instead of inventing a restore.

Two additive driver-only ControlStore methods register actual observed exits:
`acknowledgeRecoveredExit(id, at)` preserves an older interrupted helper's
missing result after explicit recovery advanced the generation;
`acknowledgeReplacedRoleExit(id, at)` handles old-epoch prepared roles whose
operation already committed. Existing receipt/floor transactions and the
parent's additive ascending/descending query contract remain intact.

## Real proof and acceptance boundary

The seven cases prove:

1. Canonical bounded frames, actual Unix peer identity, exact HMAC bytes,
   changed request/MAC denial and oversized/noncanonical frame rejection.
2. Explicit unsupported Compose/Helm capability rejection.
3. Two actual systemd API slots stop as a cohort, an unrelated owned unit
   retains its invocation, a real full archive restores to a distinct native
   target, prepared roles reopen only after commit, and successful floor
   `2 / 2.0.0` plus its receipt survive controller death.
4. Actual isolated preflight does not alter source schema; actual live
   migration adds its test schema/data; controller death retains closure;
   exact operator recovery imports the original archive into a fresh native
   generation with original migration rows and floor `1 / 1.0.0`.
5. A real maintenance helper is killed at a subscribed IPC boundary.
   Its cgroup empties, controller restart remains closed, and authenticated
   recovery records its exit while retaining the missing helper result.
6. A prepared child dies before commit. Commit is denied, recovery persists
   across controller restart, stale-generation recovery is denied, ordinary
   launch is denied while closed, and the exact operator command recovers.
7. The concrete host performs original-dialect PostgreSQL/S3/owned Git
   backup/restore and Redis readiness with actual identity checks, preserving
   source data and comparing the fixture's tables except intentionally expired
   branch authority. Wrong database identity is rejected.

The final PostgreSQL cluster was `7701419391353151522`, with source database
OID `16384` and target OID `18138`, separate `restore-source`/`restore-target`
S3 buckets, and distinct owned Git volumes. This is real PostgreSQL restoration,
not SQLite labeled as scale. Its adapter proof is separate from a configured
all-role PostgreSQL systemd installation.

Integration `st_01a17e71` must still adopt the approved launcher before every
public runtime/storage entrypoint, bind every API/repository/SSH/worker and
execution slot, provide the real scale prepared role factories and signed
package metadata, compose the UpdateService/client/scheduler/task reader,
and run configured native/all-role scale acceptance. Unregistered execution
units or Docker children need explicit supported ownership rather than an
assumption of coverage. No production install or public listener was enabled.

## Evidence, scope and cleanup

`docs/evidence/p7-supervisor/` contains the exact command chain and exit evidence
in `checks.txt`, recovered output in `test-output.txt`, exact post-run ownership
checks in `cleanup.txt`, final verified `inputs.sha256`, implementation
iterations, and the earlier callable contract publication. Provisioning notes
are in `deploy/installation/README.md`.

All 20 final-run user units are absent; all five final private roots, three
owned containers and the MinIO volume are absent. Tests checked actual cgroup
emptiness before clearing units, and the scale fixture verified listener
removal. Earlier failed attempts and their exact cleanup are recorded, not
counted as passing evidence.

Changes are confined to the new installation driver/IPC/storage helpers,
two additive ControlStore exit-registration methods, supervisor tests and
their strict config, deployment notes, and this handoff/evidence. Original
control migrations, protocol, application migrations, backup importer,
updater orchestration, prepared runtime, application mains/composition,
root dependencies, frozen benefits and concurrent UI work were not changed
by this lane. No original suite was rerun, no commit or global upgrade was
created, no unrelated unit/container was cleaned, and FastShort PID 1143097 /
port 5173 were not touched.
