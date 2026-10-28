# P1S operator overview

Owner: st_01a17b59. October 27, 2026. Status: implementation and assigned
verification complete; owned container removed. Not scale application acceptance.

`services/operations/overview/index.ts` exports:

```ts
register(context: ModuleContext): void;
adapterTopology(context: Pick<ModuleContext, "db" | "blobs" | "repositories">):
  { role: string; backend: string; state: string }[];
```

No new runtime contract is required. Topology uses injected SQL dialect and
actual DiskBlobStore/S3BlobStore/LocalRepositoryService/RemoteRepositoryService
identity; unfamiliar adapters are explicitly custom. These are actual adapter
identities, not labels inferred from `QUIRE_PROFILE`. SQL totals await the
portable executor and quote camelCase aliases. The blob-byte SUM is cast to
BIGINT, avoiding PostgreSQL NUMERIC/string output while retaining adapter
safe-number validation. No PRAGMA, local filesystem
probe, worker fabrication, or scale-profile-to-SQLite fallback remains.
Blob/repository configuration is not reported as provider readiness.
Database ready follows the successful real totals query. SQLite is reported
without an unprobed journal-mode assertion. Compilation is unconfigured when
absent and degraded when registered because worker readiness is not probed;
the reason retains the real available-environment count. AI remains
unconfigured absent a provider probe even if its service is registered.
Projects/realtime retain their existing service-registration capability
semantics. No workers, replicas, Redis availability or external providers are
invented. API reports the actual Bun version.

Consumes verified `p1s-contract.md`, `p1s-accounts.md`, `p1s-postgres.md`,
`p1s-s3.md` and `p1s-repository.md` exports. Repository's named handoff now
describes implemented exports with its own final verification/cleanup pending;
overview only identifies its real client and makes no remote health assertion.

## Migrations and preserved behavior

No overview migrations exist or were added. No SQLite SQL/digest, original
input or public HTTP DTO changed. Operator access still uses the actual
identity principal before totals; ordinary and anonymous readers remain
forbidden/unauthenticated. Counts still exclude deleted users/projects and
sum persisted blob bytes and queued/running jobs. The native runtime/listener
now closes asynchronously in the owned test, including a failed setup path.

## Checks and retained evidence

Native Bun 1.3.14:

```sh
QUIRE_TEST_POSTGRES_URL=<owned-disposable-postgres-server> bun test tests/operations/overview
bun node_modules/typescript/bin/tsc --noEmit -p tests/operations/overview/tsconfig.json
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings services/operations/overview tests/operations/overview
```

Final suite: **2 pass, 0 fail, 27 expectations, 2.66 seconds**, exit 0.
Strict owned source/test TypeScript and type-aware lint both exit 0.
Initial LSP requests were clean; final freshness requests timed out, so the
actual compiler is the recorded type gate. No whole-repository type/build
claim is made. `docs/evidence/p1s-overview/verification.md` records the initial
fixture failure, actual PostgreSQL aggregate failure, fixes and terminal
receipts rather than hiding intermediate failures.

The native test uses real HTTP authentication and verifies operator 200,
ordinary user 403, anonymous 401, active-user filtering and nonzero queue
counts. The scale-factory test runs real PostgreSQL migrations and identity,
injects the actual S3 and remote-repository clients, and deletes the local blob
directory before reading the overview. Their deliberately unavailable endpoint
proves configured metadata is not a claim of remote health. No fake PostgreSQL,
SQLite fallback, skipped test or fixed test sleep was used.

## Remaining integration dependencies

Root owns deployed scale factory/composition, Redis advisory integration,
provider credentials/availability probes, repository singleton startup,
worker lifecycle and whole-repository gates. This overview does not test
S3 object traffic, Git RPC traffic, distributed replay or scale acceptance.
Adapter/domain owners retain those real-service checks in their named handoffs.
Future wrapped adapters appear explicitly as custom unless their identity is
reported through a future shared metadata contract; no such contract was
invented here.

## Cleanup

Each test awaits runtime shutdown, and the native HTTP listener is stopped.
Each unique temporary fixture root is removed by its awaited async disposer.
Every PostgreSQL attempt drops its randomly named database, including failures;
the final receipt names `quire_overview_08a603dbc683417b81e0194d55c7b0df`.
The owned container `quire-p1s-overview-st01a17b59` and its anonymous volumes
were removed with `docker rm --force --volumes`, terminal exit 0
(`OVERVIEW_CONTAINER_REMOVE_EXIT=0`). No shared container or data was touched.
No commit, push, nested agent, dependency installation or out-of-scope edit
was made. Final absence and whitespace receipts are retained in the evidence.
The repository currently ignores `docs/evidence/p1s-overview/`; integration
must explicitly include that evidence when commits are authorized.
