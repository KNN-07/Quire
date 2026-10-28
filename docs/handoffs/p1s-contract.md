# P1S portable storage contract

Owner: `st_01a17b13`. October 27, 2026. Status: COMPLETE for the assigned
portable contracts and native adapters, including lead review closure.

Lead F follow-up: the baseline PostgreSQL variants previously left to
integration are now implemented and wired. See `p1s-foundation-postgres.md`
for actual PostgreSQL schema/value parity and unchanged native migration
checks. All six foundation IDs have explicit PostgreSQL SQL. Compiler SQL
must quote the diagnostic identifier `"column"`; integer-width fields use
BIGINT and the existing NOCASE email fields use CITEXT.
Native Bun 1.3.14: 19 tests pass,
strict owned TypeScript and type-aware lint exit 0. Consumers can now migrate
against these signatures. No whole-repository success is claimed while they
retain synchronous SQL.

## Frozen SQL surface

Exported from both `@quire/contracts` and `@quire/runtime`:

```ts
type SqlDialect = "sqlite" | "postgres";
type SqlValue = string | number | bigint | boolean | Uint8Array | null;
type SqlResult = { readonly changes: number };
interface SqlExecutor {
  readonly dialect: SqlDialect;
  get<T = Record<string, unknown>>(sql: string, parameters?: readonly SqlValue[]): Promise<T | null>;
  all<T = Record<string, unknown>>(sql: string, parameters?: readonly SqlValue[]): Promise<readonly T[]>;
  run(sql: string, parameters?: readonly SqlValue[]): Promise<SqlResult>;
  exec(sql: string): Promise<void>;
  execute(sql: string, parameters?: readonly SqlValue[]): Promise<number>;
  query<T extends z.ZodType>(sql: string, parameters: readonly SqlValue[],
    row: T): Promise<readonly z.output<T>[]>;
}
interface Transaction extends SqlExecutor {
  readonly transaction: true;
  lock(key: string): Promise<void>;
}
interface UnitOfWork {
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
type Migration = { readonly id: string; readonly sql: string; readonly postgres?: string };
```

Use `?` positional placeholders. Root `get/all/run/exec/execute/query` share
the native transaction queue. `tx` bypasses that queue and expires when its
callback ends. A root operation or nested `uow.run` from the callback fails
`ROOT_SQL_IN_TRANSACTION` rather than joining the transaction or deadlocking.
Helpers must require the callback's `Transaction` for writes, locks, event
recording and finalization; pure readers may accept `SqlExecutor`. Do not
capture `context.db` in a transaction helper. No `.local`, synchronous
statement object, native `Database`, implicit last-insert row ID, or detached
transaction operation remains in the production context.

`get/all` retain caller-supplied row types; use `query(..., rowSchema)` at
untrusted row boundaries. SQL aliases must be quoted when camelCase is needed.
`run.changes` is the affected-row count. Use `RETURNING` for generated values.
PostgreSQL adapters must return safe numeric counters and binary Uint8Arrays,
not driver bigint strings. `lock` means transaction-held aggregate exclusion;
acquire stable sorted business keys before event allocation. SQLite already
holds its writer lock. Blob/Git/password/network work belongs outside SQL.

Migrations: `foundationMigrations(): Promise<readonly Migration[]>`,
`migrationSql(migration: Migration, dialect: SqlDialect): string`,
`migrateDatabase(uow: UnitOfWork, migrations: readonly Migration[]): Promise<void>`.
`sql` is the byte-identical original SQLite variant. PostgreSQL is explicit
`postgres`; missing variants fail `MIGRATION_DIALECT_MISSING`. Startup holds
`tx.lock("quire:schema-migrations")` across digest checks and DDL. The selected
variant is hashed, and applied digests/timestamps are never rewritten.

`006-f-portable` adds the transactional event counter, branch leases,
repository intent journal and `suggestion_edits.edit_order`. Native backfill
preserves per-suggestion rowid order. Every new edit insert must supply
`edit_order`; every edit replay/order query must use it, not rowid. Original
001-005 SQL is unchanged. The 006 PostgreSQL variant assumes fresh tables;
local-to-scale transfer must copy the already-backfilled explicit order.
**F foundation follow-up completed:** the lead authored and wired explicit
001-005 PostgreSQL variants and verified all six against real PostgreSQL.
See `p1s-foundation-postgres.md` for schema parity and native hash/reopen proof.
Original SQLite files/digests remain unchanged.
O consumes the completed variants through `RuntimeOptions.foundation` or the
updated foundation export and must not edit out-of-scope foundation SQL.
Domain owners supply variants for their own later migration IDs. Foundation
schema proof is not complete application-scale acceptance.

## Events and lifecycle

`PendingEvent<T>` remains the topic-discriminated typed payload. Runtime exports:

```ts
interface EventPort {
  record<T extends EventTopic>(tx: Transaction, event: PendingEvent<T>): Promise<Event>;
  read(seq: number, options?: { readonly aggregateId?: Id; readonly limit?: number }): Promise<readonly Event[]>;
  subscribe(listener: (event: Event) => void): () => void;
  dispatch(): Promise<void>;
  close(): Promise<void>;
}
```

Replace `append(db,event)` with `await record(tx,event)`, `after` with
`await read`, and await dispatch after commit, never inside a transaction.
The counter row is updated transactionally before inserting the explicit
event seq and outbox row. Append events last, after all business locks.
A rollback restores the counter as well as event/outbox. Each event adapter
has its own replay cursor; `published_at` never suppresses another process.
Subscribe before replay, authorize each delivered event, and dispose on close.
Scale notification/catch-up belongs to O's adapter.

`Runtime.db: SqlExecutor`, `uow: UnitOfWork`, `events: EventPort`,
`branches: BranchCoordinator`, `repositories: RepositoryService`,
`close(): Promise<void>`. Module registration remains awaitable.
`RuntimeAdapters` contains those five ports, `blobs: BlobStore` and
`close(): Promise<void>`. `createLocalAdapters(config: RuntimeConfig,
clock: Clock): Promise<RuntimeAdapters>` creates only real native adapters.
`createRuntime(config: RuntimeConfig, options?: RuntimeOptions): Promise<Runtime>`
accepts optional `clock`, `modules`, `foundation: readonly Migration[]`,
and `createAdapters(config: RuntimeConfig, clock: Clock): Promise<RuntimeAdapters>`.
Scale without a factory, or with a SQLite factory, fails explicitly.
The factory's close must drain work and release its resources; application
composition must stop workers/transports before awaiting runtime close.

`referenceBlob(tx: Transaction, blob: {readonly digest: Digest; readonly bytes: number},
clock: Clock): Promise<void>` records only already-uploaded blobs.
`openDatabase(dataDir: string): Database` is native tooling only.
`new SqliteExecutor(native: Database)` and `new SqliteUnitOfWork(native: Database)`
share one queue per native handle. `SqliteExecutor.close(): Promise<void>`
drains admitted work and rejects newly submitted work.
Every native prepared statement is finalized in its operation's `finally`.
Native 1.3.14's cached/evicted statements otherwise leave a zombie connection:
a regression reproduced a missing table when copying only the DB after close.
The adapter owns statement lifetime and uses strict `native.close(true)`.

## Branch and repository boundaries

Exported from contracts:

```ts
type BranchLease = {
  readonly scope: Scope; readonly owner: string;
  readonly fence: number; readonly expiresAt: Instant;
};
interface BranchCoordinator {
  acquire(scope: Scope, owner: string, ttlMs: number): Promise<BranchLease | null>;
  renew(lease: BranchLease, ttlMs: number): Promise<BranchLease>;
  release(lease: BranchLease): Promise<void>;
  assert(tx: Transaction, lease: BranchLease): Promise<void>;
  subscribe(listener: (scope: Scope) => void): () => void;
  close(): Promise<void>;
}
type RepositoryRefUpdate = {
  readonly ref: string; readonly expected: GitOid | null; readonly next: GitOid | null;
};
type RepositoryIntent = {
  readonly id: Id; readonly lease: BranchLease; readonly updates: readonly RepositoryRefUpdate[];
};
type RepositoryIntentState = "prepared" | "published" | "finalized" | "conflicted";
interface RepositoryService {
  initialize(projectId: Id): Promise<void>;
  objects(projectId: Id, args: readonly string[], input?: Uint8Array): Promise<Uint8Array>;
  read(projectId: Id, args: readonly string[]): Promise<Uint8Array>;
  publish(intent: RepositoryIntent): Promise<void>;
  recover(id: Id, lease: BranchLease): Promise<void>;
  finalize(tx: Transaction, id: Id, lease: BranchLease): Promise<void>;
  assertReadable(projectId: Id): Promise<void>;
  close(): Promise<void>;
}
```

The local coordinator persists monotonically increasing fences and checks the
clock inside the transaction. Release retains the fence history. Renewal and
finalization reject an expired/replaced owner. Wake-ups are advisory.
The native repository serializes admission/recovery/ref CAS per durable path
and keeps the gate held until each Git child has exited. Its durable unfinished
journal blocks successors and reads until reconciliation/finalization.
Issuing a new native branch fence uses that same repository gate, while renewal
retains the current fence. Thus takeover cannot overtake an uncertain earlier
Git subprocess. Ref CAS also rechecks the lease immediately before execution.
Recover under a new lease; never complete a stale owner's SQL finalization.
Prepare/finalize source authorization and expected revision in the same SQL
transactions as their source intent and this journal transition.

Actual transaction boundary in `LocalRepositoryService.publish`: Git ref-name
validation runs outside SQL; a short `uow.run` asserts the fence and commits
the durable `prepared` journal row; `reconcile` reads/adopts state in a short
SQL transaction, then runs Git ref inspection and CAS outside SQL under the
per-repository queue; a separate fenced SQL transaction records `published`.
`finalize(tx, id, lease)` is SQL-only and joins the caller's source/receipt/event
finalization transaction. `initialize` and `objects` also run outside SQL.
There is no transaction spanning initialize/Git/CAS/advance in the current
source. The earlier `prepareCas`/`confirm` draft is superseded by the exact
`objects/read/publish/recover/finalize/assertReadable` interface above.
The lead-review regression now proves this with real Git children: each child
first obtains/releases a writer lock on the actual SQLite database from a
separate Bun process, then delegates to the actual Git binary. The probe fails
immediately if SQL spans Git. A positive control holding an actual transaction
demonstrates that detection; initialization, CAS, recovery and finalized reads
all pass outside SQL. This adds evidence without rewriting an already-separated
production path or weakening the journal/read gates.

`objects` is a trusted internal immutable-object/read-command port, not
arbitrary Git execution and not an HTTP/SSH serving boundary. Ref mutation
goes through `publish`; public serving still needs authorization, finalized
visibility and the accepted physically separate public/quarantine repositories.
This contract does not permit fetching private checkpoint objects.
`read` checks finalized visibility and executes a read command under the same
repository gate; consumers must use it instead of a separate guard/read pair.
`assertReadable` is also available for domain guards, not as a race-free
extraction operation. Read arguments are trusted internal commands; transports
must still exclude private objects using the accepted quarantine/public store.
Local Git remains a native single-process role; O must implement the real
singleton repository service admission gate for multi-API use.

Native constructors exported from runtime:
`new LocalBranchCoordinator(uow: UnitOfWork, clock: Clock, dataDir: string)`;
`new LocalRepositoryService(dataDir: string, deps: {readonly db: SqlExecutor;
readonly uow: UnitOfWork; readonly branches: BranchCoordinator; readonly clock: Clock})`;
`new SqliteEventPort(db: SqlExecutor, clock: Clock)`.

## Conversion and outstanding integration

Change `db.query<Row, Params>(sql).get(...args)` to
`await db.get<Row>(sql, args)`, `.all` to `await db.all<Row>`, `.run` to
`await db.run`; change `.uow.local(db => ...)` to `.uow.run(async tx => ...)`.
Await every transitive helper and return value. Do not put Git/blob/hash I/O
inside the newly async transaction. Replace SQLite-specific SQL explicitly.
Source/review acceptance must finalize edit statuses, receipt, source state,
repository journal and events atomically with its transaction executor.

Consumers, application composition, existing test helpers and the native
overview are deliberately unconverted dependencies. Compiler diagnostics and
the accepted native overview boundary were not edited. The migration script
already awaits application closure; seed and doctor now await portable SQL
and close. Root integration owns whole-repository gates after conversion.
This is an explicit temporary consumer type-migration dependency, not permission
to suppress errors or introduce a synchronous PostgreSQL shim. Native SQL is
queued rather than implicitly inherited through ambient request context;
transaction helpers receive their executor explicitly.

## Evidence and cleanup

Baseline capture before API edits used an extracted `3fe3a23` archive, a
unique `/tmp/quire-p1s-contract-baseline-*` root and native Bun 1.3.14.
The first physical copy was incomplete despite `integrity_check=ok`: the data
remained in WAL. The reopen regression caught this. A corrected capture from
the unchanged baseline archive checkpoints WAL and verifies all 12 migration
rows and six users in the destination, not merely file integrity. The retained
fixture is `tests/fixtures/portable-baseline.sqlite.fixture`.
`docs/evidence/p1s-contract/baseline-capture-2.log` records the complete capture.
The `.fixture` extension is intentionally not ignored; evidence needs explicit
inclusion when root commits.

Final native command `bun test tests/contract/portable` exited 0:
**19 pass, 0 fail, 66 Bun expectations, seven files, 1.78 seconds**.
It covers rollback, unrelated root read/write isolation, rejected ambient
root/nested calls, escaped executor rejection, close/drain and standalone-file
durability, existing-data hash/timestamp/row preservation, edit-order backfill,
event counter rollback/backfill/commit ordering, independent dispatch cursors,
lease takeover/restart, real Git CAS/recovery/finalized visibility and the
independent child-process proof that SQL never spans Git.

`bun node_modules/typescript/bin/tsc --noEmit -p tests/contract/portable/tsconfig.json`
exited 0. `bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings
packages/runtime packages/contracts scripts/seed.ts tests/contract/portable
tests/fixtures/capture-portable-baseline.ts tests/fixtures/repository-git-probe.ts`
exited 0. `git diff --check`
also exited 0. LSP freshness requests sometimes timed out; the actual strict
compiler and type-aware lint are the recorded gates.

Exact logs, intermediate failures, fixture digest and cleanup receipts are in
`docs/evidence/p1s-contract/verification.md` and `review-*-final.log`. Every command
has a terminal receipt. All owned fixture/extraction roots, Git children and
generated sidecars are cleaned; no listener/container was started, no user
data or sibling source was modified, and no commit/push was made.
