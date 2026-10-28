# Lead notes for portable integration

These are concrete assembly requirements observed in current code, not new
claims of completed scale behavior. The integration node owns the indicated
root files.

## One instance key across API directories

`packages/runtime/src/config.ts` already supports `QUIRE_SECRET_KEY`: a
64-character lowercase hex value decoded to 32 bytes. Production startup
requires it; development otherwise reads or creates `dataDir/secret.key`.
No additional runtime API is needed.

Every API process for one database must receive the same instance key, even
when each has a separate local directory. Local-to-scale migration must
preserve the original key for credentials and existing sessions. Verify a
session and CSRF-authenticated mutation across the two API processes, rather
than checking login independently on each process. Do not print the key in
evidence or generate a different key per replica.

## Bootstrap and repository ownership

The repository handoff requires branch fence acquisition to go through the
repository service queue. Integration must use its remote coordinator, not
call the underlying PostgreSQL coordinator's acquire directly. Transactional
assertion/finalization still uses the caller's PostgreSQL transaction.

Schema migration must be runnable before repository-service/API startup.
Do not introduce a cycle where the migration command registers a source
service that needs the repository role before that role's schema exists.
`migrateDatabase` and the module migration arrays are available independently
of handler registration.

`scripts/seed.ts` still contains direct local Git initialization. Its async SQL
conversion alone does not make it a scale seed. Either port initialization to
the repository/blob boundaries or use the explicit quiesced native-to-scale
transfer before serving the scale application. Do not treat Git files under
one API's local directory as shared repository state.

Verify existing seeded source/history and named Git objects from the second
API, not only a newly created project. Preserve object IDs, SQL receipts,
permanent tombstones, blob hashes and keys; reconcile intents before serving.

## Schema and tooling notes

All six foundation PostgreSQL variants are now implemented and actually
verified; see `p1s-foundation-postgres.md`. The diagnostic SQL identifier
`"column"` must be quoted, and PostgreSQL results must preserve safe numeric
values for BIGINT fields.

Use `docker stop --timeout`, not the deprecated `--time` spelling, when
cleaning owned fixtures. Never remove shared cached images or another lane's
containers.
