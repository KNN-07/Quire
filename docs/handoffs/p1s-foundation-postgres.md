# Foundation PostgreSQL variants

Owner: lead F follow-up, October 27, 2026. This closes the five baseline
variants left to F by `p1s-contract.md`; it does not change any SQLite SQL.

## Implementation

`foundationMigrations()` now supplies explicit PostgreSQL SQL for all six
foundation IDs. Files are `001-f-identity.postgres.sql` through
`005-f-governance.postgres.sql`, plus the existing portable 006 variant.
There is no runtime SQL translator.

The variants preserve the existing table/column and foreign-key graph:

- Organizations precede users; the invitation/project foreign key is installed
  after projects exist.
- The three SQLite NOCASE email columns use `citext`. Migration credentials
  need permission to create that extension in the database.
- SQLite integer-width fields use `BIGINT`, binary columns use `BYTEA`, and
  the operations progress field uses `DOUBLE PRECISION`.
- Events and audit identities accept explicit values. The transactional
  `event_counter`, not sequence allocation, remains the ordering authority for
  `EventPort.record`.
- The compiler's PostgreSQL SQL must quote the identifier `"column"` when
  inserting or naming the diagnostic column. Its result key remains `column`.

## Real database proof

The standalone check is:

```sh
QUIRE_FOUNDATION_CONTAINER=<ready-owned-quire-container> \
  bun tests/integration/portable/foundation-postgres.ts
```

It creates and removes its own randomly named database inside an already-ready
test container. It does not touch a pre-existing application database.

An actual PostgreSQL **17.10** instance passed the complete six-variant DDL
transaction and matched the native SQLite schema on **75 tables, 583 columns
and 99 foreign-key edges**. It also proved case-insensitive lookup/uniqueness,
the forward invitation foreign key, binary bytes, a 4 GiB integer value,
double-precision progress and generated audit identity. The owned test
database was removed.

The pinned image used for that run was
`postgres@sha256:dc17045ccfd343b49600570ea734b9c4991cf1c3f3302e67df51e3b402dd55c4`,
with no published port and `--network none`. The owned `--rm` container
`quire-foundation-51828dde` was stopped successfully after checks. Docker
reported the deprecated `--time` spelling; future cleanup uses `--timeout`.

## Native regression update

The original existing-data reopen/hash test passed unchanged. The
missing-dialect test previously used foundation 001 as its intentionally
missing variant. Since 001 is now implemented, that test now constructs
`{id, sql}` without a PostgreSQL variant; it still requires the same missing
dialect failure and verifies no fallback. All three native migration tests
pass; targeted strict TypeScript and type-aware lint exited 0.

Module-specific PostgreSQL migrations, driver result conversion, distributed
coordination and the two-process acceptance gate remain their assigned
owners' work. This report does not claim those later gates passed.
