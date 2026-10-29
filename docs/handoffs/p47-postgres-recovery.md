# P47 PostgreSQL deleted-project recovery

October 28, 2026. FINAL parent acceptance for the missing P24 PostgreSQL route
case, not a new whole-scale or browser acceptance claim.

Added `tests/core/base/admin-recovery-postgres.test.ts` alongside the existing
native recovery tests. It uses a real disposable PostgreSQL 17 container, the
existing PostgreSQL adapter fixture and real loopback HTTP routes. Git, blob
storage and event delivery use the existing local fixture adapters; this does
not claim Redis/S3 or multi-host recovery.

## Observed behavior

Owner deletion revokes the existing share token. Operator-only deleted-project
listing returns the current version. Ordinary-owner restore and a request
without CSRF fail with 403. A PostgreSQL trigger deliberately rejects the
recovery audit write: HTTP 500 leaves both recovery and its success receipt
uncommitted. Removing that injected failure allows the same request to recover
the project. Replaying it after runtime restart succeeds once.

The retained file rows, snapshot rows, project membership and actual source
text match before deletion. The project version advances once and exactly one
recovery audit entry exists. The old share token remains denied, the owner can
read, and operator status alone grants no project read access. Demoting the
operator prevents replay of the previously successful restore request.

## Evidence and correction history

`docs/evidence/p47-postgres-recovery/complete-requests.log` retains cwd, literal
command, UTC start/end, equal pre/post hashes of the test, recovery route and
both fixture helpers, and `P47_TEST_EXIT=0`. The actual command was:

```sh
./node_modules/.bin/bun test tests/core/base/admin-recovery-postgres.test.ts
```

It passed one case with 22 assertions in 11.11 seconds, ending at
16:37:07Z. Monitor `mon_FZB7TPNWYKYB4899` / `bash_429` completed exit 0.
The logged `PostgresError: owned recovery audit failure` is the intentional
transaction rollback probe, not an unhandled test failure.

Two earlier failures remain in `acceptance.log` and `current-version.log`.
Both were new-test setup errors: using the pre-link project version for
deletion, then omitting the required idempotency key from denial requests.
Neither required a production change. The first log also records a mistyped
source hash path; the final receipt hashes the actual `admin-recovery.ts`.

`static-final.log` records the final test hash, scoped TypeScript check and
type-aware deny-warning lint with `P47_STATIC_EXIT=0`:

```sh
./node_modules/.bin/tsc --noEmit -p tests/core/base/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings tests/core/base/admin-recovery-postgres.test.ts
```

Monitor `mon_7S54MGTSNAGDHGYR` / `bash_430` completed exit 0.
The language server initially reported no diagnostics but timed out after
the fixture corrections; the final compiler check supplies fresh diagnostics.
No production source changed, so production builds and prior native/browser
recovery checks were not replayed.

## Cleanup and self-review

The fixture awaited HTTP/runtime closure and dropped its isolated database
before stopping/removing the container. Parent independently observed no
container matches for all three attempts:

- `quire-recovery-pg-e04d0e86-cc49-4045-9593-50effb4c1e4d`
- `quire-recovery-pg-3f271e5e-0c11-4af8-94ad-020e67fb56db`
- `quire-recovery-pg-6204e83c-6d63-4636-aea2-bec73a05f522`

The successful root `/tmp/quire-p1s-core-base-dWQEne` is absent and its
PostgreSQL listener `127.0.0.1:33144` refuses connections.

The new test has one responsibility: PostgreSQL recovery transaction and
authority preservation. It reuses real route/adapter fixtures, parses route
responses through contracts, uses no type escapes or sleeps, and subscribes
to the database readiness output before proceeding. Its injected failure can
detect an incorrectly committed recovery or replay receipt. Actual user data,
port 5173 and unrelated infrastructure were untouched.
