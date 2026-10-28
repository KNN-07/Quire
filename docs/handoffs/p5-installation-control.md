# P5 installation control: FINAL

Date: October 27, 2026.
Owner: control/contracts task `st_01a17df8`.
Decision: `docs/architecture/installation-authority.md`.

## Delivered boundary

Concrete independent SQLite persistence is implemented in
`services/operations/installation/control-store.ts`, with its own
`001-installation-control` migration in `control-migrations.ts`. It never
opens application SQL, accepts a ModuleContext, writes application
`operations`, or opens an application backup/restore target.

`model.ts` exports parsed installation/binding/receipt/execution schemas and
the production authority/storage/client contracts. `protocol.ts` implements
canonical request digests and installation-scoped HMAC-authenticated command
envelopes. `legacy-import.ts` defines exact original-row schemas and the
application-source transaction boundary. The early contract publication is
`docs/evidence/p5-installation-control/contracts.md`.

The singleton installation persists identity, protocol version, complete
role/unit/activator inventory and digest, supervisor epoch, monotonic
generation, mode, owning operation, committed release/data binding, and
successful sequence/version floor. SQLite uses `synchronous=FULL` and
immediate transactions. Explicit provisioning exclusively creates a private
new file; reopening uses `create:false` and rejects missing, uninitialized,
corrupt, incomplete, mismatched-identity or mismatched-migration authority.
It never repairs such authority into an open state.

Reopening first transactionally changes claimed running work or an installing
installation to `recovery_required`. Queued/unclaimed jobs remain queued.
Existing errors such as `ROLLBACK_FAILED` are preserved. A controller must
hold its real OS singleton lock before opening this store. This class does
not acquire that lock and is not an executable controller.

## Exact exported APIs

These interfaces are exported from `model.ts`; IDs, instants and digests use
the existing contracts brands.

```ts
interface UpdateClient {
  releases(): Promise<readonly Release[]>;
  create(request: ReservedUpdateCommand): Promise<Operation>;
  get(id: Id): Promise<UpdateOperationRow | null>;
  list(query: UpdateOperationQuery): Promise<readonly UpdateOperationRow[]>;
}
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
```

`StoppedInstallation` and `PreparedInstallation` are abstract classes with
protected constructors and private runtime fields. A real driver can subclass
them after its own checks; JSON cannot be parsed into those capabilities.
No subclass, public capability factory, supervisor, stopped-process verifier,
filesystem switch, SQL rebind, or service-manager adapter is implemented here.

The concrete persistence API is synchronous:

```ts
class ControlStore {
  static provision(path: string, input: InstallationState): ControlStore;
  static open(path: string, installationId: string, epoch: Id, at: Instant): ControlStore;
  state(): InstallationState;
  receipt(id: Id): ControlReceipt | null;
  existing(input: ReservedUpdateCommand): ControlReceipt | null;
  accept(input: ReservedUpdateCommand, release: AcceptedRelease, at: Instant): ControlReceipt;
  get(id: Id): UpdateOperationRow | null;
  list(input: UpdateOperationQuery): readonly UpdateOperationRow[];
  nextAt(): Instant | null;
  claimDue(at: Instant): ControlReceipt | null;
  progress(id: Id, phase: ControlReceipt["phase"], progress: number, at: Instant): void;
  inhibit(id: Id, at: Instant): InstallationState;
  recovery(id: Id, patch: Pick<RecoveryRecord,
    "candidate" | "backup" | "originalMigrationLedger" | "restoreResult">, at: Instant): void;
  requireRecovery(id: Id, errorCode: string, at: Instant): void;
  beginRecovery(command: AuthenticatedControlCommand, at: Instant): InstallationState;
  finishUnchanged(id: Id, errorCode: string, resultBytes: string, at: Instant): Operation;
  executionIntent(identity: ExecutionIdentity, at: Instant): ExecutionRecord;
  acknowledgeExecution(id: Id, event: "started" | "exited",
    at: Instant, resultBytes?: string | null): void;
  executions(): readonly ExecutionRecord[];
  recordStopped(id: Id, evidence: StoppedEvidence, at: Instant): void;
  recordIntent(input: Omit<ExecutionIntent,
    "outcome" | "resultBytes" | "completedAt">): ExecutionIntent;
  intent(id: Id): ExecutionIntent | null;
  intents(operationId: Id): readonly ExecutionIntent[];
  recordResult(id: Id, outcome: "succeeded" | "failed", resultBytes: string, at: Instant): void;
  commit(input: LedgerCommit): Operation;
  legacyImport(sourceId: string): LegacyCopyCheckpoint | null;
  copyLegacy(input: LegacySnapshot, at: Instant): LegacyCopyCheckpoint;
  confirmLegacyRemoval(input: LegacyRemovalResult, at: Instant): LegacyCopyCheckpoint;
  close(): void;
  [Symbol.dispose](): void;
}
```

`ReservedUpdateCommand` is `{installationId, operationId, actorId, key,
requestDigest, request: {releaseId, at, autoSecurity}}`. `requestDigest(request)`
is SHA-256 of canonical JSON. Exact retries compare every command input and
return the original receipt, including after interruption/terminal completion.
Changed request, reserved operation ID, actor/key collision, or digest fails.
Call `existing` before any feed request; acceptance itself also checks replay
before release validation. No feed is fetched by the store.

`UpdateOperationRow` is `{actorId, operation, createdAt, updatedAt}`. List
queries accept optional actorId/kind/status/cursor and required limit 1..100.
Cursor is exclusive descending operation ID. Application routes retain
identity, operator, CSRF, fresh-auth and visibility checks.

`ExecutionIdentity` contains ID, installation, owning operation or null,
epoch, generation, role, purpose, exact unit/invocation ID and container IDs.
`executionIntent` persists before launch. Ordinary identities must match the
stored role inventory and open generation. Start/exit acknowledgments are
separate; pending invocations count as unsettled. A maintenance exit without a
result persists recovery rather than claiming reported migration failure.
Stopped-cohort rows require the matching inventory digest and exact recorded
execution set with all exits acknowledged. These rows are evidence records
from a trusted future controller, not proof that an actual cgroup is empty,
and never produce a `StoppedInstallation`.

`ExecutionIntent` contains ID, operation, epoch, generation, kind, exact
inputBytes, createdAt, nullable outcome/resultBytes/completedAt. Kinds are
stage/stop/reconcile/backup/preflight/migration/activation/restore/health.
Migration requires the stored backup and original migration ledger first.
Migration/activation intent IDs are recorded in recovery metadata before
the caller performs the side effect. Replayed results must match exactly.

`LedgerCommit` contains operationId, supervisorEpoch, generation, binding,
healthIntentId, outcome, errorCode, resultBytes, successfulFloor and at.
Successful health intent input must be canonical JSON of that exact binding.
Current-generation missing results and nonprepared surviving invocations
block commit. Receipt/result bytes, binding, floor and open mode commit
together. A successful floor must increase both sequence and version and
match the accepted manifest/package identity. A failure preserves the floor;
after live-migration intent it requires a recorded restore to a new data
generation. Without live-migration intent it must retain the exact prior
binding. External fresh-target identity/emptiness proof remains the real
storage driver's responsibility.

`beginRecovery` accepts only an authenticated operator-channel recover
command matching installation/operation/epoch/generation. It advances the
generation before recovery helpers can be launched. A repeated/stale command
fails. Old interrupted intents retain their absent results; explicit recovery
can produce a terminal failed receipt after new health without inventing an
old helper outcome. An interrupted operation cannot advance the successful
floor.

## Authentication and legacy import

```ts
function canonicalJson(value: unknown): string;
function controlDigest(bytes: string | Uint8Array): Digest;
function requestDigest(request: ReservedUpdateCommand["request"]): Digest;
function signControlCommand(
  input: Omit<ControlEnvelope, "mac">, credential: ControlCredential,
): ControlEnvelope;
class AuthenticatedControlCommand {
  static authenticate(input: unknown, credential: ControlCredential,
    now: Instant, maxAgeMs?: number): AuthenticatedControlCommand;
  readonly envelope: ControlEnvelope;
  get channel(): "api" | "operator";
}
interface LegacyImportSource {
  snapshot(): Promise<LegacySnapshot>;
  removeCopied(checkpoint: LegacyCopyCheckpoint): Promise<LegacyRemovalResult>;
}
```

The wire envelope binds protocol version, installation ID, credential ID,
request ID, issuedAt and complete parsed command under HMAC-SHA256. Credentials
require at least 32 secret bytes and are resolved by the trusted host, never
from caller-supplied channel claims. Default maximum age is 30 seconds;
future/stale requests fail. API credentials cannot status or recover.
The command union is submit/get/list/releases/status/recover. There is no
API command that stops units or changes a binding. Socket peer authentication,
credential provisioning and actual transport are downstream host work.

Legacy snapshots contain sourceId, installationId, dataIdentity,
migrationLedgerBytes and rowsBytes. Original `update_jobs`, matching complete
`operations`, and floor row values are parsed; embedded release/result/backup
strings and original migration ledger bytes are retained exactly in the
snapshot. Copy atomically creates control receipts, raises the successful
floor, records interrupted work, and commits the digest/copy checkpoint.
Repeated copy must match the complete snapshot bytes. A conflict rolls back
every projected row and floor change. Ambiguous legacy migrating/switched/
recovery-required phases conservatively retain a live-migration marker.

The application migration owner implements `removeCopied`: in one application
transaction, compare exact source identities/rows/ledger, reserve command keys,
delete only copied job/operation/floor rows, and persist a source tombstone.
Only then pass its `{sourceId, digest, receiptBytes}` to
`confirmLegacyRemoval`. Source tombstones allow retry after source deletion
and before control acknowledgement. This lane implements both durable control
checkpoints and tests a real SQLite source transaction; it does not supply or
enable a production application-source adapter or alter application migrations.
Original `070-o-updates` SQL and IDs remain untouched.

## Acceptance scope

This delivery proves control persistence and protocol consistency, not
configured updater acceptance. The real host still supplies OS ownership,
manager/cgroup observation, launch permits, stopped/prepared subclasses,
fresh restore inspection, authenticated socket transport and executable health.
The update owner moves its orchestration onto this store and implements the
application reservation/import transaction. The composition owner consumes
`UpdateClient` only after those capabilities exist.

No systemd work, source-install conversion, production installation, commit,
root dependency changes, restore implementation changes, or producer changes
were made here. The two misrouted restore-identity messages were explicitly
rescinded; their implementation remains with the restore owner.

Actual commands, results and selected before/after state are recorded under
`docs/evidence/p5-installation-control/`. That evidence directory is already
ignored by the repository's existing `.gitignore`; it was not changed.

## Verified result

The final single Bun 1.4.4 run passed all 18 tests across four test files,
with 148 assertions and exit code 0. The owned strict TypeScript project and
scoped type-aware lint with denied warnings both exited 0. The evidence
script exited 0 and recorded the exact temporary root absent after cleanup.
`checks.txt` records the commands and observations; `state-transitions.json`
retains actual selected identity/generation/mode/floor/receipt fields.

Tests use real independent SQLite files, reopen and transaction failure
injection, two real concurrent accepting processes with IPC event barriers,
and real source copy/remove/tombstone transactions. They also establish that
an old missing migration result stays missing through explicit recovery
rather than being fabricated into a reported helper result.

The fixture's stopped/health/result strings are explicitly ledger test data,
not executed host attestation. No production source-removal adapter, runtime
binding switch, configured supervisor acceptance, or real application health
is inferred from those tests. No full-repository checks were run. Original
producer evidence remains unchanged.
