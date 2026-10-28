# P1S PostgreSQL storage

Owner: `st_01a17b3c`. October 27, 2026. Status: assigned implementation and
verification complete. Native Bun 1.3.14: eight tests pass; owned strict
TypeScript and type-aware lint exit 0. This accepts the adapter, not the complete
scale application or unfinished foundation PostgreSQL migrations.

## Factory boundary

Exported from `services/operations/storage/postgres/index.ts`:

```ts
type PostgresOptions = {
  readonly url: string;
  readonly maxConnections?: number;
};
type PostgresStorage = {
  readonly db: SqlExecutor;
  readonly uow: UnitOfWork;
  close(): Promise<void>;
};
createPostgresStorage(options: PostgresOptions): Promise<PostgresStorage>;
postgresPlaceholders(sql: string, parameterCount: number): string;
```

The factory opens a real Bun 1.3.14 PostgreSQL pool and probes connectivity.
It accepts only `postgres:`/`postgresql:` URLs. Its returned `db`/`uow` implement
the frozen `p1s-contract.md` interfaces. It does not assemble the other scale
ports. Composition owns those ports and must stop workers/transports before
awaiting `close()`. Close rejects new work, drains admitted operations and
transactions, then closes the pool; repeated close calls share completion.

Transactions reserve one pool connection through BEGIN, callback operations,
COMMIT/ROLLBACK and release. Unrelated root work uses another pool connection,
never the transaction connection. Root SQL, nested UOW and close from the same
factory's callback reject `ROOT_SQL_IN_TRANSACTION`. The callback executor expires
on callback completion and admitted statements drain before commit/rollback.
Caught driver errors still cause rollback, preventing PostgreSQL's aborted
transaction COMMIT from looking successful.

The lexer replaces only bare `?` markers with `$n`, checks exact arity and
preserves strings, quoted identifiers, E strings, tagged/untagged dollar quotes,
line comments and nested block comments. Use `??` for literal question-mark
operators in parameterized SQL (`??`, `??|`, `??&`). Native `$n` markers are
rejected. `exec` is unparameterized, verbatim multi-statement SQL; it does not
lex or rewrite dialect syntax.

The driver uses bigint decoding; safe bigint results become numbers and unsafe
ones fail `SQL_INTEGER_UNSAFE`. Binary results become Uint8Array copies.
String values remain strings, including arbitrary-precision PostgreSQL NUMERIC;
numeric counters should use integer/BIGINT SQL. Timestamp Date values become ISO
strings. `run.changes`/`execute` use the driver's affected-row count.

## Migrations and dependencies

Consume runtime's existing `migrateDatabase(uow, migrations)`. The adapter's
`tx.lock` uses transaction-held PostgreSQL advisory locks on stable text hashes.
The migration runner holds `quire:schema-migrations` before table creation,
digest checks and DDL; it hashes the selected explicit `postgres` variant.
No migration SQL is translated and no SQLite SQL/digest has been edited.

Open root-owned dependency: foundation PostgreSQL variants 001-005 and their
foundation export wiring, documented in `p1s-contract.md`. Domain owners provide
their own PostgreSQL variants. This adapter cannot make incomplete variants
scale-ready. Root integration owns complete foundation/domain gates and runtime
factory composition; this task does not edit runtime or sibling migrations.

## Verification and resources

Evidence and terminal receipts are retained under `docs/evidence/p1s-postgres/`:
`final-tests.log`, `intermediate-results.md` and `cleanup.md`.

Final real test command (requires a disposable PostgreSQL URL with permission
to create/drop a uniquely named test database):

```sh
QUIRE_TEST_POSTGRES_URL=postgres://USER:PASSWORD@HOST:PORT/DATABASE \
  bun test tests/operations/storage/postgres
```

Exit 0: **8 pass, 0 fail, 35 Bun expectations, 2 files, 434 ms**, plus Node
assertions. Proves safe numeric/binary parameter/result types, real schema
validation, connection reservation across awaits, root read/write isolation
through rollback, ambient root/nested rejection, expired transaction rejection,
successful reuse after SQL failure, independent-pool concurrent migration
serialization, selected-variant fingerprints, unchanged applied rows/timestamps,
changed SQL rejection, missing dialect rejection, atomic DDL/bookkeeping rollback
and shutdown draining.

Strict command:
`bun node_modules/typescript/bin/tsc --noEmit -p tests/operations/storage/postgres/tsconfig.json`
exited 0. Type-aware lint:
`bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings services/operations/storage/postgres tests/operations/storage/postgres`
exited 0. Final test LSP had no diagnostics; adapter LSP freshness timed out,
so real strict compiler/lint receipts are the decisive gates. Owned
`git diff --check` exited 0. Whole-repository and complete domain/foundation
scale gates belong to root integration and were not run here.

The first real test run timed out because a Bun promise matcher synchronously
blocked the test barrier; Node `rejects` corrected it. Initial strict checks
also exposed nullable assertion inference, non-thenable matcher awaits and an
unsafe generic assertion. All were corrected without suppressing diagnostics;
intermediate receipts remain visible. No passed check was rerun without a
subsequent source/test change.

Owned test resource: container `quire-p1s-postgres-st01a17b3c`,
label `quire.owner=st_01a17b3c`, image `postgres:17-alpine`,
ephemeral loopback port `32900`. It is disposable test-only PostgreSQL, with
no existing database, listener, volume or user data consumed.
Cleanup session `bash_17` exited 0 after graceful stop and `docker rm -v`,
then checked absence of the exact container and anonymous volume. Its listener
is gone. No resource or asynchronous check remains pending.

The repository ignores `docs/evidence/` and `*.log`; requested evidence is
retained on disk and needs explicit inclusion by root if committed. No commit,
push, root config/runtime/SQL edit, sibling edit or dependency change was made.
