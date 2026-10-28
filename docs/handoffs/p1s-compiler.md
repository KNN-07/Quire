# P1S compiler

Owner: `st_01a17b7b`. October 27, 2026. Status: COMPLETE for the assigned
compiler conversion and checks. Native CLI is Bun 1.3.14.

## Integration exports

`services/compiler/index.ts` retains:

```ts
register(context: ModuleContext): Promise<void>;
startWorker(context: Pick<ModuleContext, "services">): Promise<void>;
stopWorker(context: Pick<ModuleContext, "services">): Promise<void>;
const migrations: readonly Migration[];
```

`register` still probes the actual confined native environment, registers
HTTP/worker routes, provides `compiler`, and starts only the lease reaper.
Native composition explicitly invokes `startWorker`. With the real scale
configuration, `startWorker` does not start a local pump; compilation is
performed by the exported `runRemoteWorker` / `workerMain` processes.
Composition must await `stopWorker` before awaiting runtime closure.
It stops the timer, aborts local tools and pending comparisons, and drains
active jobs and tracked work before returning.

The existing `CompilerService implements CompilePort` signatures remain:

```ts
constructor(context: ModuleContext, environment: Environment);
enqueue(actorId: Id, request: CompileRequest, key: string): Promise<CompileJob>;
get(actorId: Id, id: Id): Promise<CompileJob>;
cancel(actorId: Id, id: Id, expectedVersion?: number): Promise<void>;
limits(id: Id, db?: SqlExecutor): Promise<Limits>;
start(): Promise<void>;
stop(): Promise<void>;
pump(): Promise<void>;
runJob(id: Id, preview?: boolean): Promise<void>;
waitJob(id: Id): Promise<void>;
publishPreview(tx: Transaction, id: Id): Promise<void>;
task<T>(promise: Promise<T>): Promise<T>;
execute(id: Id, signal: AbortSignal, preview?: boolean): Promise<void>;
transition(job: CompileJob, finalize?: (tx: Transaction) => Promise<void>,
  verify?: (tx: Transaction) => Promise<void>): Promise<void>;
```

The HTTP cancellation route supplies `expectedVersion`; its comparison is
inside the cancellation transaction. `runJob` is native-only and rejects
scale callers with `REMOTE_WORKER_REQUIRED`. `waitJob` subscribes before
reading durable status, has a bounded deadline, and is interrupted by stop.
PDF comparison queues its pinned historical jobs for actual remote workers
in scale mode, rather than launching an independent local API compiler.

`CompilerLeases` retains `constructor(service: CompilerService)`,
`bearer(): string`, `capability(id: Id, fence: Fence): string`, and
`authorize(request: Request): void`; its storage methods are now:

```ts
type Fence = { readonly attempt: number; readonly fencingToken: number };
fence(id: Id, fence: Fence, request?: Request, tx?: Transaction): Promise<void>;
reap(): Promise<void>;
lease(workerId: Id, environmentIds: readonly Id[]): Promise<WorkerLease | null>;
heartbeat(id: Id, fence: Fence): Promise<void>;
```

`CompilerStore` is exported from `services/compiler/store.ts`:

```ts
constructor(context: ModuleContext, db?: SqlExecutor);
withTransaction(tx: Transaction): CompilerStore;
raw(id: Id): Promise<{
  id: string; actor_id: string; snapshot_id: string; environment_id: string;
  settings_json: string; status: string; queued_at: string;
  started_at: string | null; finished_at: string | null;
  elapsed_ms: number | null; failure_code: string | null;
  worker_id: string | null; attempt: number; fencing_token: number; version: number;
}>;
snapshot(id: string): Promise<Snapshot>;
get(id: Id): Promise<CompileJob>;
settings(id: Id): Promise<CompileSettings>;
save(tx: Transaction, job: CompileJob): Promise<void>;
changed(tx: Transaction, job: CompileJob): Promise<void>;
artifact(input: {
  readonly jobId: Id; readonly name: string; readonly bytes: Uint8Array;
  readonly kind: Artifact["kind"]; readonly mime: string;
}, verify?: (tx: Transaction) => Promise<void>): Promise<Artifact>;
artifactById(id: Id): Promise<Artifact>;
```

Trusted store writers and `publishPreview` join the supplied transaction;
callers acquire `tx.lock("quire:compiler")` first. `save` is SQL-only and
does not implicitly record/dispatch events. Record `changed(tx, job)` last,
after all business writes, then dispatch after commit. Artifact upload puts
real bytes outside SQL, then acquires the compiler lock and invokes the
transaction-bound verifier before immutable artifact lookup/reference/insert.
No root executor is captured inside a transaction-bound store reader.

Other exports and HTTP DTOs are unchanged:
`nativeEnvironmentId`, `probeEnvironment`, `defaultLimits`,
`runRemoteWorker(options: WorkerOptions): Promise<void>`, and
`workerMain(env?: NodeJS.ProcessEnv): Promise<void>`.
`WorkerOptions` remains `{readonly baseUrl:string; readonly bearer:string;
readonly workerId:Id; readonly environmentIds:readonly Id[];
readonly signal:AbortSignal}`. The existing native CLI signal handlers and
configuration validation are unchanged.

## Persistence and ownership

Every compiler claim/mutation uses the transaction-held
`quire:compiler` lock in both dialects. Claims additionally require an
affected-row count of one from queued-status CAS. Attempt/fence, lease,
worker assignment and running event commit together. Heartbeats recheck
job/worker/attempt/fence/expiry and extend the lease in one transaction.
Reaping and cancellation invalidate the fence and clear worker/lease
state atomically. Expired attempts retain the accepted
`WORKER_LEASE_EXPIRED` failed-job behavior; a new compile is a new job.

Completion validates immutable source/PDF bytes outside SQL, then rechecks
the receipt and current fence inside its final transaction. It commits the
job, diagnostics, selected artifact set, preview, cache, worker state,
lease removal, receipt and event together. Identical replay returns the
original version; changed keys/bodies fail. Cancellation during either blob
upload or source validation cannot be bypassed by a late publication.

Remote successful completion now populates the same generated cache.
Lease admission can satisfy a clean=false cache hit from already-durable
artifact references without rerunning tools, cloning identities/diagnostics
for the new job. Clean requests clear only their branch's generated cache.
Historical comparison requests persist preview=false; they never displace
the current preview, including later preview selection. Preview ordering
still prioritizes source revision, queued timestamp, then creation order.

The `030-c-compiler` SQLite `sql` variant is byte-identical to the accepted migration.
Its explicit PostgreSQL variant is added under the same ID.
Additive `031-c-portable` adds `compiler_requests.preview/cache_key`,
`compile_jobs.queue_order`, and `compiler_queue_counter`. Native backfill
copies original rowid into the explicit order. PostgreSQL backfills existing
rows by queued timestamp and ID. New jobs allocate explicit order under
the compiler transaction lock. Local-to-scale transfer must copy this
already-backfilled order and counter; it must not regenerate it.
Diagnostic SQL quotes `"column"` and case-sensitive DTO aliases.

Native `build`, sandbox/cgroup confinement, archive limits, actual TeX
engines/helpers, partial PDF/log artifacts, corrected timestamp diagnostics,
SyncTeX and rendered PDF comparison are preserved. No synthetic PDF,
unsandboxed path, fallback adapter, package change or baseline migration
rewrite was introduced.

## Dependencies and scope

Read and consumed `p1s-contract.md`, `p1s-accounts.md`,
`p1s-core-base.md`, `p1s-postgres.md` and
`p1s-foundation-postgres.md`, plus the requested architecture/plan,
`p1-integration.md`, `p1-acceptance.md` and prior compiler handoff.
The shared async executors/events and actual base/identity exports were
verified in source and exercised by compiler HTTP tests.

The PostgreSQL domain fixture uses the real O adapter, SQL event delivery,
native repository/blob ports and confined tools. It is not a scale profile
factory and does not claim Redis/S3/two-API acceptance. F/O own complete
scale adapter composition, cross-API event wakeups and repository service
routing. F owns whole-repository gates; consumers of these compiler
internals must await the new readers and pass their actual transaction.
No sibling files were edited or errors suppressed.

## Checks and cleanup

Initial native suite: 49 pass, 0 fail, 142 expectations, 12 files,
203.95 seconds, exit 0. Expanded final command `bun test tests/compiler`
exited 0: **52 pass, 0 fail, 141 Bun expectations plus Node assertions,
14 files, 211.65 seconds**. It includes native migration/backfill and accepted
baseline reopen, all actual confined engines/helpers/tagged PDF/MathML,
PDF/diagnostic/SyncTeX/cache behavior, the separate worker CLI, and portable
transactional regressions.

Real PostgreSQL domain check passed, including 11 actual migrations,
concurrent admission/claims, stale attempt/expiry, cancellation during
upload/completion, failed-publication rollback, completion replay,
diagnostic aliases and remote cache reuse. Its unique database was dropped.
The deliberately injected event error is expected rollback evidence.

Initial strict parsing failed on a method-placement mistake; the next
strict run passed. Expanded strict initially found one test-only union
narrowing error; corrected strict passed. Initial PostgreSQL verification
compared full envelopes instead of their machine-consumed data and failed
on distinct request IDs; the corrected real check passed. Initial lint
found five owned issues, corrected without suppression. Final strict
`bun node_modules/typescript/bin/tsc --noEmit -p tests/compiler/tsconfig.json`
and `bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings
services/compiler workers/compiler tests/compiler` both exited 0.
Owned LSP diagnostics and scoped `git diff --check` are clean.

Evidence is retained under `docs/evidence/p1s-compiler/`, including genuine
PDFs/previews, full native/PostgreSQL output and intermediate failures.
The existing ignore rules omit evidence/logs from ordinary Git add;
integration must explicitly include them when commits are authorized.
No commit/push was made. The real PostgreSQL 17.10 test container
`quire-p1s-compiler-st01a17b7b` used loopback port `32916` and the existing
`postgres:17-alpine` image
`sha256:dc17045ccfd343b49600570ea734b9c4991cf1c3f3302e67df51e3b402dd55c4`.
Both randomly named databases were dropped. The first post-stop inspection
raced Docker's automatic removal and exited 1 while the stopped container
was `removing`; the subscribed final check exited 0 after confirming both
container and anonymous volume absent. Its loopback listener is gone.

`resources-cleanup.log` confirms no compiler fixture/migration/baseline roots,
owned PostgreSQL listener or compiler CLI process remains. Fixtures awaited
worker/server/adapter shutdown and removed their unique roots. Every assigned
check has a terminal receipt and no owned asynchronous work remains pending.
There is no unresolved owned blocker. Whole-repository and real multi-API
scale acceptance remain the explicit F/O integration gates above.
