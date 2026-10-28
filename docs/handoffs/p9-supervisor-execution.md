# P9 supervisor execution extensions: FINAL

October 27, 2026. Owner: `st_01a17e6f`.

**PASS for the four concrete supervisor extensions below. Configured all-role
installation integration remains the separate `st_01a17e71` gate.**

The final delta run on project-local **Bun 1.4.4 (38afee6c8)** passed **8 tests,
68 assertions, 0 failures in 119.05 seconds**, exit 0. Strict TypeScript and
type-aware deny-warning lint then exited 0. The affected existing lost-helper
and prepared-child-death cases also passed. Historical P7 FINAL documents and
evidence were preserved; their wholesale baseline suite was not repeated.

`p9-supervisor-execution.evidence.json` records the 27 final source fingerprints,
the final owned unit/container/image/root manifests, and verification results.
All 27 fingerprints matched after the run. Independent exact cleanup checks
confirmed 31 units unloaded, 8 containers absent, the generated image absent,
and 10 recorded roots absent, including three earlier failed-run remnants.
Docker absence was checked against a live daemon, not inferred from connection
failure. The PostgreSQL fixture additionally verified its S3 volume/listener
cleanup. No unrelated service, image, data root, or host policy was changed.

## Authenticated owned executions

`execution-client.ts`, `execution-model.ts`, `execution-protocol.ts`,
`execution-broker.ts`, `execution-source.ts`, `execution-recipes.ts`,
`execution-docker.ts`, and `execution-runner.ts` provide the concrete execution
transport and lifecycle. The additive `002-supervisor-executions` migration in
`execution-ledger.ts` persists launch ownership and prepared failure evidence;
it does not rewrite the original control migration.

The controller authenticates the live role by kernel peer identity, its actual
owned invocation, token MAC, epoch, generation, and binding. Requests select
signed release profiles and parsed recipes, never caller argv, executable
paths, arbitrary environment maps, or a forwarded manager connection. A
request ID is idempotent only for identical request bytes from the same parent.

Source trees must be canonical descendants of the generation work directory.
The controller rejects links and special files, bounds bytes and entries,
checks the source digest, and copies the complete source into its private
read-only execution tree. Output is bounded to 64 MiB stdout and 8 MiB stderr.
Profile and global concurrency, wall time, memory, process count, and temporary
workspace limits are enforced by the actual runner, systemd, and backend.

Docker creation records a unique owned name and labels before the side effect,
then records the full container ID before start. Start acknowledgement follows
the real Docker start result. Logs and exit code come from Docker logs/wait;
CLI disappearance alone never proves container termination. Stop and restart
reconciliation verify exact container ownership, exit, removal, and cgroup
absence before returning stopped authority. A lost controller leaves the
missing payload report missing and records interruption on reconciliation.

Environment builds use one owned builder container, pinned approved package
syntax, and the configured mirror policy. A font-only build needs no network.
A successful build publishes its observed immutable image ID; subsequent
requests can select that ID only through the installation-owned build record
and an allowed current signed profile. The real build and derived-image
confinement probe passed. Package downloading was not part of this delta proof.

### Exact integration API

```ts
// execution-client.ts
createInstallationExecutionClient(session: ControlledRoleSession): InstallationExecutionClient;
describeExecutionSource(path: string, maximumBytes: number): Promise<ExecutionSource>;

// execution-model.ts
client.start({ requestId, profileId, work, limits }): Promise<OwnedExecution>;
client.inspect(id): Promise<ExecutionSnapshot>;
handle.id;
handle.started: Promise<ExecutionSnapshot>;
handle.exited: Promise<ExecutionExit>;
handle.read("stdout" | "stderr", offset, maximumBytes?): Promise<ExecutionChunk>;
handle.stop(): Promise<ExecutionExit>;
handle.release(): Promise<void>;

// execution-runner.ts: dispatch before constructing an application role
serveInstallationExecution(session: ControlledRoleSession): Promise<void>;

// Exported by the signed application release for backend "worker"
prepareInstallationWorker(binding, request): Promise<ControlledLifecycle>;
```

`ExecutionSource` above denotes the parsed `{ path, digest }` shape. The
exported schemas/types in `execution-model.ts` are the machine contract.
`ExecutionExit.code` may be null: callers must honor `interrupted` and
`canceled`, rather than treating an absent payload outcome as successful.
`started` resolves only after the payload/worker activation acknowledgement.
Read output before releasing its private files.

The stable launcher must branch on `session.permit.task` before ordinary role
construction. Worker requests contain only `workerId` and `environmentIds`;
the signed profile supplies `workerRole`, and the release factory supplies
the real coordinator, credentials, environment checks, and worker lifecycle.
The worker-controller/remote-worker application integration is not claimed as
an independently accepted all-role deployment by this handoff.

Driver configuration adds `execution: { root, dockerSocket?, maximumConcurrent? }`.
The root must be private and below the control root; concurrency is at most 16.
Signed `installation-roles.json` assets declare `executionProfiles`, including
allowed parent roles, work kinds, backend, immutable Docker image where used,
limits, profile concurrency, and optional worker role/mirrors. Missing or
unauthorized configuration fails closed.

### Native namespace boundary

The real host rejected nested bwrap user namespaces. The supported native
path therefore runs only the digest-pinned, fixed-code execution monitor
outside the application-role namespace; that monitor creates the full native
bwrap payload confinement once. It never runs caller argv or constructs an
application factory in this branch. Application and worker roles retain their
hidden control root and host `/run`. Docker monitors retain their restricted
mount namespace and only their explicit backend socket. This is a trusted
supervisor monitor boundary, not a claim that the native monitor itself lacks
host authority. No host namespace configuration was repaired.

## PostgreSQL generation runtime roots

`role-mounts.ts` derives the PostgreSQL runtime root from
`dirname(data.applicationSecretRef)`, independently of the Git volume. It
requires private canonical directories, rejects control/release/socket/Git
overlap, and exposes only the runtime root to ordinary roles. Only the signed
repository role also gets the Git volume writable. Credential files are
canonical private single-link files mounted read-only; a credential beneath
the control root additionally requires the explicit role-specific
`roleSecrets: [{ role, files }]` configuration.

Fresh-target checks reject a runtime root shared with a retained generation
or another proposed fresh target, by path overlap and filesystem identity.
The real PostgreSQL namespace case connected to PostgreSQL, wrote work/mail/
cache/backup/restore files in the runtime root, could not read control state
or overwrite its credential, and left the actual Git store empty. It also
rejected missing secret authorization, Git overlap, and generation-root reuse.

## Completed prepared-health failures

`reportPreparedFailure(session, "construction" | "check", error)` records an
authenticated report with the exact binding digest. It is usable only by a
prepared invocation. The controller retains the report, drains the actual
prepared cohort, checks its stopped evidence, and only then records
`CompletedHealthFailure` with the health intent, exact result bytes, drained
execution identities, and stop-evidence bytes/digest.

This becomes the existing `ReportedUpdateFailure` evidence consumed by the
updater seam documented in `p9-updater-prepared-health.md`. The real signed
candidate passed preflight, migrated live data, failed a real private health
read, and automatically restored into a distinct original-release generation.
The failed receipt was preserved, the successful floor stayed at 1.0.0/1,
and the candidate-only table was absent from the restored store.

Missing helper outcomes and dead prepared children still require explicit
recovery. The old helper-death fixture was narrowly updated to pause its
intended backup helper only; its old blanket pause also blocked the newly
introduced real recovery health helper. The missing-result assertions remain
intact and the affected case passed in 18.54 seconds.

## Stopped backup compiler reconciliation

After real stopped authority, the maintenance host constructs the actual
compiler service on the stopped binding and invokes
`quiesceCompilerJobs(service, { dispatch: "deferred" })` inside the backup
producer boundary before export. It uses the compiler-owned seam documented
in `p9-compiler-deferred-quiescence.md`; no settled-state guard was removed.

The real case queued two jobs, acquired a real worker lease, then verified
cancellation in the archive, increased fencing tokens, deleted leases, and
persisted cancellation outbox events that remained undispatched. A separate
unsettled adapter operation still made the next backup fail with
`BACKUP_RECOVERY_REQUIRED`.

## Reproduce the scoped checks

```sh
./node_modules/.bin/bun test tests/operations/installation/supervisor-execution
./node_modules/.bin/bun ./node_modules/typescript/bin/tsc --noEmit \
  -p tests/operations/installation/supervisor-execution-tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/operations/installation/{execution-*,role-mounts,prepared-failure,systemd-authority,driver-config,controller-server,prepared-storage-host,storage,control-store}.ts \
  tests/operations/installation/supervisor-execution \
  tests/operations/installation/supervisor-launcher.ts
```

The real fixture needs the user systemd manager, bwrap, Docker, the existing
`quire-p2o-environments:st_01a17c2c` compiler image, and the local PostgreSQL/
Redis/MinIO fixture images. It does not install or repair these prerequisites.
The full historical P7 suite and the configured all-role native/PostgreSQL
installation acceptance suite were not rerun or relabeled by this lane.
