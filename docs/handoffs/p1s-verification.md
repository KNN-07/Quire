# Independent P1S verification

Owner: `st_01a17bc1`. October 27, 2026. Status: COMPLETE.
The assigned native and real scale acceptance gates pass on final producer
inputs with native Bun 1.3.14. This accepts the portable-storage boundary,
not the complete product or a highly available Git service.

## Final commands and terminal results

The final native command was:

```sh
bun test tests/contract tests/core tests/accounts tests/compiler \
  tests/integration/collaboration.test.ts tests/integration/git.test.ts \
  tests/integration/review-history.test.ts tests/integration/p1 \
  tests/operations/overview/overview.test.ts
```

It terminated **exit 0: 400 pass, 0 fail, 1,330 expectations, 111 files,
327.98 seconds**. Every native integration test is included; the three portable
integration files are covered separately below, rather than executed twice.

The exact final real scale command from `p1s-integrate.md` and `package.json`
was:

```sh
bun run test:scale
```

It expands to:

```sh
bun test tests/integration/portable/assembly.test.ts \
  tests/integration/portable/seed.test.ts \
  tests/integration/portable/transfer-preflight.test.ts
```

It terminated **exit 0: 3 pass, 0 fail, 3 files, 265.23 seconds**.
This was this verifier's own complete run, not an adapter-only test or a
substitution of the integrator's passing assembly log.

| Independent gate | Terminal result | Evidence under `docs/evidence/p1s-verification/` |
| --- | --- | --- |
| Full native command above | Exit 0 | `native-final.log` |
| Exact combined scale command above | Exit 0 | `scale-final.log` |
| `bun run typecheck` | Exit 0 | `typecheck-final.log` |
| `bun run lint` | Exit 0, type-aware, deny warnings | `lint-final.log` |
| `bun run build` | Exit 0, web/API/repository/worker bundles | `build-final.log` |
| Owned real PostgreSQL event regression | Exit 0, 1 pass/0 fail | `postgres-events.log` |
| Twelve baseline migration definitions | Exit 0, byte-identical | `migrations.log` |
| Live scale migration ledger | Exit 0, all 16 selected PostgreSQL digests match | `scale-migrations.log` |
| Owned strict TypeScript/type-aware lint | Both exit 0 | `owned-final.log` |
| Final input comparison | Exit 0, identical | `input-comparison.log` |
| Owned cleanup auditor | Exit 0 | `cleanup-final.log` |

The pre-existing Vite warning remains: the web JavaScript chunk is 530.74 kB,
over the 500 kB advisory threshold. No warning or diagnostic was suppressed.
Redis connection errors during the deliberate outage and injected native
rollback errors remain in the raw logs; their asserted recovery paths pass.

The before/after production, test, tooling and root-config fingerprint is
`060462821387952f1be6cbb4cbf1576087ba06ebc0de57dbd7be26a93392b697`.
Generated build outputs and SQLite WAL/SHM sidecars are excluded; source and
tests are not. No changing producer input invalidated the final gates.

## Actual topology and observed behavior

`live-final-api-processes.log`, `topology-final-observer.log` and
`live-service-mounts.log` retain actual process, image, mount, socket and port
evidence. The assembly used:

- PostgreSQL 17.10, image
  `sha256:dc17045ccfd343b49600570ea734b9c4991cf1c3f3302e67df51e3b402dd55c4`,
  loopback port 32945.
- Actual Redis 7.4 image
  `sha256:6ba19c50b56777f5c11c58eff8ddb69d0d5f27ba131cffb63f180ccfd43c66af`,
  stable loopback port 39285, actually stopped and restarted.
- Authenticated MinIO/S3 image
  `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`,
  loopback port 32946, with its own actual data volume.
- Singleton repository process PID 3924442 and separate API OS processes
  3924539 / 3927522, followed by recovery API 3930698. Their fixture-local
  directories are distinct `api-a`, `api-b`, and `api-c-recovery` under
  `/tmp/quire-p1s-integrate-UOvd7Z`; canonical Git belongs to its repository role.

The health response reports PostgreSQL, the actual PostgreSQL executor is
constructed, and API-local blob/Git directories are removed before successful
remote reads. Runtime startup rejects a scale SQLite adapter. The historical
`SqliteEventPort` class operates on the supplied PostgreSQL executor; its name
is not a SQLite fallback. Compiler `start`, `pump`, and `runJob` explicitly
exclude local execution in scale.

The complete scale run proves:

- Offline native transfer preserves the original session/key/CSRF authority,
  three HTTP receipts, permanent tombstone, named head and immutable history.
  Seven verified blobs and all 16 native migration receipts are retained.
- The second API reads the original 453-byte history source from S3, SHA-256
  `392c2b10d1f883ac1a73ca0f77efe11c044a71a8e979877ca8df405d8b0f12ab`.
- Cross-instance session revocation closes a subscribed stream and denies the
  revoked cookie while retaining the requesting session.
- Redis outage SQL catch-up delivers sequence 14 once; restart reconnects and
  later events arrive without losing committed mutations.
- Actual SIGSTOP/takeover/SIGCONT rejects the resumed stale writer.
- A subscribed publication barrier permits an actual API SIGKILL after Git
  publication. Recovery expires both captured dead leases, finalizes source and
  receipt on startup, clears pending journals and emits exactly one source event.
- The first actual remote worker is held at its source-request barrier, then
  stopped. The real lease reaper records WORKER_LEASE_EXPIRED; a distinct worker
  through the other API produces the successful PDF with no error diagnostics.
  The downloaded PDF is 41,496 bytes, SHA-256
  `4e5adc54e30f0d50a3c439c4b342c901e1d887d907fa92c24ad399da7757ed35`.
  The exact producer-owned fixture retains its generated artifact at
  `docs/evidence/p1s-integrate/scale-output-d745f7f3-e532-4b11-9d49-17f1f9c6f1b9.pdf`.
- Fresh remote seed is idempotent and survives real Redis restart/new factory.
  Offline transfer preflight rejects pending named work and missing quiescence,
  and supports the actual configured runtime-held instance key.

No fixed test sleep, skipped assertion, fake scale profile or SQLite scale
fallback was used. Event barriers are installed before their triggering action.

## Exported boundaries and migrations

`exported-signatures-final.log` contains the actual TypeScript-checker signature
inventory for eighteen current implementation modules, not copied handoff claims.
Important exact entrypoints are:

```ts
createRuntime(config: RuntimeConfig, options?: RuntimeOptions): Promise<Runtime>;
createScaleAdapters(_config: RuntimeConfig, clock: Clock,
  settings?: ScaleConfig): Promise<RuntimeAdapters>;
loadScaleConfig(env?: NodeJS.ProcessEnv): ScaleConfig;
createPostgresStorage(options: PostgresOptions): Promise<PostgresStorage>;
startRepositoryServer(options: RepositoryServerOptions): Promise<RepositoryServer>;
transferQuiesced(source: Runtime, target: Runtime, quiesced: boolean): Promise<{
  tables: Record<string, number>; blobs: number; repositories: number;
  nativeMigrations: readonly Record<string, unknown>[];
}>;
```

Runtime SQL is asynchronous: `get<T> -> Promise<T|null>`,
`all<T> -> Promise<readonly T[]>`, `run -> Promise<SqlResult>`,
`exec -> Promise<void>`, `execute -> Promise<number>` and schema-checked
`query<T> -> Promise<readonly z.output<T>[]>`.
`UnitOfWork.run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>`;
`Transaction.lock(key: string): Promise<void>`. Callers pass the supplied
transaction executor; root access inside a callback rejects rather than joining it.

The common repository boundary includes exact
`exportNamed(projectId: Id): Promise<Uint8Array>` and
`importPack(projectId: Id, pack: Uint8Array): Promise<void>`.
Composed Git/source uses
`prepareSource(input: SourcePreparation): Promise<SourceIntent>` and
`finalizePreparedSources(tx: Transaction, input: PreparedSources):
Promise<readonly PendingEvent[]>`. One durable repository publication binds all
prepared checkpoints; named metadata, source, receipts and deferred events
finalize in one caller-owned SQL transaction.

All twelve original SQLite definitions equal accepted commit `3fe3a23`,
including exact whitespace. Native reopen tests retain applied hashes/timestamps
and original data. Additive portability IDs are `006-f-portable`,
`026-k-base-portable-intents`, `023-k-review-portable` and `031-c-portable`.
Explicit suggestion/history/compile ordering is backfilled and retained.
The live PostgreSQL ledger independently matches all sixteen authored selected
variants; its digests are intentionally distinct from native SQL digests.
No original SQLite SQL, HTTP DTO or original input was edited by this verifier.

The owned actual PostgreSQL regression separately proves uncommitted-event
visibility blocking, inverted transaction order, event/counter/outbox rollback,
and independent dispatch cursors. Native tests retain Yjs/replay/authorization,
permanent tombstones, atomic selected-review acceptance, HTTP crash receipts,
real clone/fetch/push and hidden-object isolation, first-Viewer initialization
without mutation rights, staged-only compilation, sandbox confinement, genuine
PDFs, corrected diagnostics, and persisted operator-only overview totals.
The accepted registry remains 176 implemented / 69 explicitly deferred.

## Reconciliation, dependencies and cleanup

The initial native runs failed honestly: 398 pass/2 fail, then 400 pass/1 fail.
The native pipe type, immutable-blob branch preparation and initial-Viewer
authorization findings were fixed by their owners. The six-test repaired seam
run passed; final whole native acceptance subsequently passed once on final
inputs. `history.md`, both original logs and initial static failures are retained.
No failed test was deleted, weakened, skipped or relabeled as a clean full run.

All named P1S handoffs were read, including final Git/integration and the verified
source-composition follow-up; actual code and service behavior were checked.
There is no unresolved dependency blocking this assigned verification.
This does not independently rerun every domain's entire PostgreSQL suite, or
accept Git-service HA, Helm/SSH, autoscaling, air-gap, backup/update/hardware
drills, later product/browser surfaces or the 69 deferred endpoints.

`cleanup-final.log` independently verifies absence of **16 exact owned
containers, three captured assembly volumes, 280 logged fixture roots and all
three assembly API PIDs**, including earlier failed-run resources.
Fixture teardown also verifies S3 volume/listener removal and awaits worker,
repository and adapter shutdown. Final listener/process inventory exits 0.
The service observer was stopped after collection; obsolete dependency watches
were already absent. Every assigned run has a terminal receipt; no owned
check, process, listener, container or temporary root remains pending.

Owned additions are read-only audit scripts, one real PostgreSQL regression,
strict/lint configuration, evidence and the two named verification handoffs.
No production/producer-test edit, dependency installation, nested agent,
workspace commit/push or unrelated resource cleanup was performed.
Existing Git rules ignore evidence; it remains on disk for explicit inclusion
when the parent is authorized to commit.

### Baseline fixture follow-up

The parent-found `tests/fixtures/portable-baseline.sqlite.fixture` is the retained
foundation/contract artifact, not cleanup waste. Its capture explicitly
checkpointed before copying and closed both handles. Four consuming test paths
copy it before opening; the compiler migration test reads the original readonly
and calls `close(true)` on its successful path. That compiler close is not in
`finally`, a residual query-exception cleanup gap; the passed process has ended
and no active fixture handle was found.

The independent `baseline-audit.log` now proves that the **main file alone**
opens with integrity/FK checks clean, all twelve exact original migration
receipts/timestamps, six users, seven files and six document states. Its
970,752-byte SHA-256 remains
`da1fc434ef3330025daea10e3deaf671343ba31cf2c4b0ae668207b8256b8940`.
No baseline bytes remain only in WAL: the original WAL was zero bytes.

After an empty active-handle probe and unchanged-hash check, SQLite itself
checkpointed with `busy=0, log=0, checkpointed=0` and retired the inactive
WAL/SHM on strict close. Neither sidecar was manually unlinked. Both are absent,
the original main hash/size/mtime/inode are unchanged, and the one audit-copy root
is removed. `baseline-audit.log`, `baseline-cleanup.log` and `baseline-static.log`
have terminal exit 0. Full ownership/consumer references and the exception-path
limitation are in `docs/evidence/p1s-verification/baseline-ownership.md`.
The retained main fixture is the artifact to keep; generated sidecars are not.
No producer code/test or root input changed, and no full suite was repeated.
