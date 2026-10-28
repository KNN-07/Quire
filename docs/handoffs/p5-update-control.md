# P5 update control: FINAL

Date: October 27, 2026.
Owner: updater task `st_01a17e17`.
Decision: `docs/architecture/installation-authority.md`.
Inputs: FINAL `p5-installation-control.md` and its concrete exports.

## Delivered result

`UpdateService` is controller-side orchestration. It takes the actual
independent `ControlStore`, typed installation authority/storage, clock and
live actor authorization dependency; it never receives an application
`ModuleContext`. All execution receipts, schedule reads, claims, stage
paths/entrypoint, phase/progress, backup/original ledger, recovery and
successful floor use that control store. There is no application
queued/running update mirror and no `retainedGate` or `UpdateSafety`.

The existing signed feed, expiration, origin, signature, package hash/size,
path/entrypoint, owned-root, version floor and maintenance-window checks
remain. The verified package entrypoint is retained in the staged result and
candidate release binding. Replay checks precede capability checks and feed
access, so accepted commands remain readable/replayable offline after restart.
Execution rechecks that the scheduling actor is an active operator before
inhibiting or stopping the old installation.

The controller persists launch inhibition before requesting stop. External
side effects have durable intents before execution and results afterward.
Backup/migration/activation/restore run only through the supplied stopped
authority; the control ledger also requires stopped evidence before their
intents. Backup identity and exact original ledger precede live-migration
intent. Reported failure restores to a distinct data generation and prepares
the prior binding before a failed terminal commit. A rejected/lost helper
without a proven result persists recovery and retains its absent result.
Nothing in `finally` reopens the installation.

Authority `commit` owns the atomic binding/floor/receipt/open transaction.
The updater verifies the resulting control receipt and binding, and never
rolls back an already terminal/open generation if acknowledgment was lost.
The filesystem updater lock is removed only after an open terminal result,
including authenticated recovery; it is not installation authority.

## Exact public contracts

IDs, instants and digests are the existing contract brands. `UpdateClient`,
`ReservedUpdateCommand`, `UpdateOperationRow` and `UpdateOperationQuery` are
re-exported from the FINAL `installation/model.ts`, not competing types.

```ts
interface UpdateClient {
  releases(): Promise<readonly Release[]>;
  create(request: ReservedUpdateCommand): Promise<Operation>;
  get(id: Id): Promise<UpdateOperationRow | null>;
  list(query: UpdateOperationQuery): Promise<readonly UpdateOperationRow[]>;
}
// ReservedUpdateCommand:
// { installationId, operationId, actorId, key, requestDigest,
//   request: { releaseId, at, autoSecurity } }
// UpdateOperationRow: { actorId, operation, createdAt, updatedAt }
// UpdateOperationQuery:
// { actorId?, kind?, status?, cursor?, limit: number } (limit 1..100)
// Cursor is exclusive descending operation ID.

interface UpdateApiOptions {
  readonly installationId: string;
  readonly client: UpdateClient;
}
function registerUpdates(
  context: ModuleContext, options?: UpdateApiOptions,
): UpdateClient | null;
function updateModule(options?: UpdateApiOptions): ServiceModule;

interface UpdateTransport {
  send(envelope: ControlEnvelope): Promise<unknown>;
}
function createUpdateClient(
  credential: ControlCredential, clock: Clock, transport: UpdateTransport,
): UpdateClient;

interface UpdateOptions {
  readonly config: UpdateConfig;
  readonly control: ControlStore;
  readonly authority: InstallationAuthority;
  readonly storage: InstallationStorage;
  readonly clock: Clock;
  readonly authorizeActor: (actorId: Id) => Promise<void>;
}
class UpdateService implements UpdateClient {
  constructor(options: UpdateOptions);
  readonly options: UpdateOptions;
  readonly config: UpdateConfig;
  readonly store: UpdateStore;
  readonly installer: OwnedInstaller;
  releases(): Promise<readonly Release[]>;
  create(input: ReservedUpdateCommand): Promise<Operation>;
  get(id: Id): Promise<UpdateOperationRow | null>;
  list(query: UpdateOperationQuery): Promise<readonly UpdateOperationRow[]>;
  subscribe(listener: () => void): () => void;
  nextAt(): Promise<string | null>;
  tick(): Promise<void>;
  recover(command: AuthenticatedControlCommand): Promise<Operation>;
  close(): Promise<void>;
}
class ReportedUpdateFailure extends UpdateError {
  constructor(code: string, evidence: MigrationEvidence);
  readonly evidence: MigrationEvidence;
}

function reserveUpdateCommand(
  uow: UnitOfWork, installationId: string, actorId: Id, key: string,
  request: ReservedUpdateCommand["request"],
): Promise<ReservedUpdateCommand>;
function reconcileCommandKeys(
  uow: UnitOfWork, commands: readonly ReservedUpdateCommand[],
): Promise<void>;

interface LegacySourceIdentity {
  readonly sourceId: string;
  readonly installationId: string;
  readonly dataIdentity: string;
}
class ApplicationLegacySource implements LegacyImportSource {
  constructor(uow: UnitOfWork, identity: LegacySourceIdentity);
  snapshot(): Promise<LegacySnapshot>;
  removeCopied(checkpoint: LegacyCopyCheckpoint): Promise<LegacyRemovalResult>;
}
function importLegacyUpdates(
  source: LegacyImportSource, control: ControlStore, clock: Clock,
): Promise<LegacyCopyCheckpoint>;

interface UpdateTimer {
  at(instant: string, callback: () => Promise<void>): () => void;
}
function startScheduler(
  service: UpdateService, onError: (error: unknown) => void, timer?: UpdateTimer,
): { readonly close: () => Promise<void> };
```

`createUpdateClient` requires an API-channel credential, signs the concrete
installation-scoped envelope and parses every returned result. The host
supplies the private authenticated socket transport and owns its resource
lifetime; the published `UpdateClient` has no invented close method. The
controller authenticates that envelope with the existing installation
protocol before dispatching to its client methods.

`registerUpdates` retains identity/operator checks, CSRF verification and the
15-minute fresh-session requirement before key reservation or forwarding.
Browser actor IDs are never authority. The default registers the endpoints
once, returns an empty release list and rejects mutation with
`UPDATES_UNCONFIGURED`; it starts no controller or scheduler.

## Completed failure versus interruption

The installation storage interface returns successful `MigrationEvidence`
but has no failed-helper outcome type. The updater therefore exports
`ReportedUpdateFailure` in its owned model. A future host adapter may throw
this only after observing and recording its actual helper result and exit.
The updater verifies the exact execution identity, owning operation,
installation, supervisor epoch, generation, helper purpose, acknowledged
start/exit and result bytes against the control ledger before recording a
failed intent and attempting automatic rollback.

Every other rejected maintenance call is interruption: the intent result
stays absent, the installation becomes `recovery_required`, and no automatic
rollback or reopen is inferred. A claimed completed failure with no matching
durable exit/result is rejected as `UPDATE_HELPER_RESULT_UNPROVEN`.
This is an explicit host-adapter API delta, not a claim that stored strings
prove actual cgroup/process termination.

`recover` consumes only the exact authenticated operator envelope through
`ControlStore.beginRecovery`, which advances the generation before the host
launches recovery work. API credentials cannot recover. The host performs
recovery through the concrete authority interface and commits the failed
terminal receipt; old interrupted intent results remain missing.

## Application reservation and legacy import

`071-o-update-command-keys` is additive, with explicit SQLite/PostgreSQL SQL.
Original `070-o-updates` SQL and ID remain unchanged. The new reservation
table contains only `(actor_id, request_key, operation_id, request_digest)`;
it has no status, phase, result or floor. Insert and key-changing operation
triggers reject cross-table key reuse. PostgreSQL insert triggers and the
reservation helper take the same actor/key transaction advisory lock;
SQLite's immediate writer transaction serializes the checks. Reservation
rows are immutable through UPDATE.

A crash after reservation is not a scheduled update. Retry returns the same
reserved operation ID and completes control acceptance; changed request
digests fail. The controller checks the complete original command on replay.
`reconcileCommandKeys` atomically restores exact control identities before
host reopening. Missing actors, conflicting other-kind keys, changed request
digests or operation identities block reconciliation; it never creates users.

`ApplicationLegacySource` requires operator-arranged all-role stop and
host-verified source identities. It snapshots complete original updater
rows, preserving embedded release/backup/result strings and original
migration ledger values. Removal compares the full committed snapshot and
digest, deletes only copied job/operation/floor records, reserves their
original keys and writes a source tombstone in one application transaction.
A reservation or tombstone failure rolls every deletion back.

The tombstone retains the original snapshot and exact removal receipt.
Retry after deletion but before control acknowledgment returns that same
snapshot/receipt. Corrupt digest, source identity, rows, original migration
ledger or removal receipt fails rather than guessing that deletion completed.
`importLegacyUpdates` coordinates the actual copy/remove/confirm checkpoints.
Interrupted legacy work remains recovery-required in independent control.

## Composition seam and acceptance scope

The inspected `services/operations/index.ts` still registers the honest
unconfigured updater. `apps/server/src/composition.ts` has no configured
updater option; neither file was edited. Existing default composition has
no changed typing requirement. A configured integrator must inject
`UpdateApiOptions.client` exactly once and merge its `get`/`list` results in
the existing tasks reader, preserving operator visibility and ownership.
Old `new UpdateService(context, {config, safety})` construction is gone.
API code must not construct this service or start its scheduler.

The real host must own the OS singleton lock before opening `ControlStore`
and supply real `InstallationAuthority`/`InstallationStorage` implementations,
process-manager observation, fresh-target factories and authenticated socket
transport. Unsupported deployment/restore errors reject before acceptance.
There is no service-manager driver, no-op fallback, launch-permit mechanism,
production installation or configured native/scale acceptance in this lane.

The fixture labels stopped/prepared subclasses and execution rows as
ledger-contract test data. It uses real independent/application SQLite,
transactions, signed loopback feeds, digest-checked packages, executable
child health and distinct fresh SQLite rollback generations. Simulated role
inventory is not systemd/cgroup evidence. The PostgreSQL test uses a uniquely
named disposable local container for real application key/migration conflicts;
it does not claim configured scale rollback. Existing accepted producer,
installation-control and fresh-target restore evidence remains untouched.

## Verification and retained evidence

The final single Bun 1.4.4 focused run passed **46 tests, 189 assertions,
0 failures**, exit 0. Owned strict TypeScript and scoped type-aware
deny-warning lint both exited 0. No global suite or typecheck was rerun.

```text
./node_modules/.bin/bun test tests/operations/updates
./node_modules/.bin/bun ./node_modules/typescript/bin/tsc --noEmit -p tests/operations/updates/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings services/operations/updates tests/operations/updates
./node_modules/.bin/bun tests/operations/updates/evidence.ts
```

`docs/evidence/p5-update-control/checks.txt` preserves the final checks.
`state-transitions.json` contains actual successful and failed/fresh-restored
receipt/binding/floor/intent fields and empty application update rows.
The evidence command exited 0, ran the read-only operator validator with
the project Bun executable and asserted each exact temporary root absent
after cleanup. Its raw receipt is retained in `third-checks.txt`.

`first-checks.txt`, `second-checks.txt` and `third-checks.txt` retain all
initial adaptation failures, not overwritten green output: opaque-capability
serialization, strict backup metadata projection, fixture signing/byte
comparison, lint issues and PostgreSQL result-array metadata comparison.
All were fixed without type assertions/casts, suppressions, skipped tests or
weakened conflict behavior. Final PostgreSQL database/container cleanup
names and successful deletion receipts are in `checks.txt`.
The final cleanup scan found one directory left by the first run's early
unhandled test rejection. Its exact fixture control records were inspected
and retained before deleting only `/tmp/quire-updates-9ysVWr`. The corrected
event barrier handles an early run rejection; `cleanup.txt` records the
inspection, exact deletion and absence of remaining updater test directories
or labeled PostgreSQL containers.

Tests cover real SQLite reopen and durable floor/offline replay, reservation
before acceptance, actor/key conflicts in both dialects including concurrent
inserts, exact authenticated recovery, preserved missing helper results,
byte-verified legacy copy/removal interruption and transactional failure,
corrupt checkpoints, actual signature/package rejection, scheduled event
barriers and control-before-maintenance ordering.
