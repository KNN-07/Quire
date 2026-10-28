# P1S application integration

Owner: st_01a17ba5. October 27, 2026. Status: COMPLETE for assigned integration,
checks, retained evidence and cleanup. Native CLI is Bun 1.3.14.
The independent verifier owns final combined full-native/scale acceptance.

## Exported boundaries

`apps/server/src/composition.ts` retains `modules: readonly ServiceModule[]`
and the nine accepted modules, router, HTTP DTO fields and WebSocket dispatch.
Its changed application boundary is:

```ts
createApplication(options?: {
  readonly config?: RuntimeConfig;
  readonly modules?: readonly ServiceModule[];
  readonly createAdapters?: RuntimeOptions["createAdapters"];
}): Promise<{
  runtime: Runtime;
  websocket: WebSocketHandler<RealtimeSocketData>;
  fetch(request: Request): Promise<Response>;
  start(): Promise<void>;
  handle(request: Request, server: Server<RealtimeSocketData>): Promise<Response | undefined>;
  close(): Promise<void>;
}>;
```

Native remains default. Scale selects the actual factory below, never SQLite.
Health awaits `SELECT 1` and reports the injected dialect; the unchanged health
payload shape now permits `"postgres"` as well as native `"sqlite"`.
`close` awaits compiler shutdown, review disposal and runtime closure.

From `apps/server/src/scale.ts`:

```ts
type ScaleConfig = {
  postgresUrl: string; redisUrl: string; namespace: string;
  repositoryUrl: string; repositoryToken: string;
  endpoint: string; bucket: string; region: string;
  accessKeyId: string; secretAccessKey: string; reconcileMs: number;
};
loadScaleConfig(env?: NodeJS.ProcessEnv): ScaleConfig;
createScaleAdapters(config: RuntimeConfig, clock: Clock,
  settings?: ScaleConfig): Promise<RuntimeAdapters>;
class PostgresBranchCoordinator implements BranchCoordinator {
  constructor(uow: UnitOfWork, clock: Clock);
  acquire(scope: Scope, owner: string, ttlMs: number): Promise<BranchLease | null>;
  renew(lease: BranchLease, ttlMs: number): Promise<BranchLease>;
  release(lease: BranchLease): Promise<void>;
  assert(tx: Transaction, lease: BranchLease): Promise<void>;
  subscribe(listener: (scope: Scope) => void): () => void;
  close(): Promise<void>;
}
```

The raw SQL issuer is used only behind the singleton repository service queue.
Every API receives `RemoteBranchCoordinator` and `RemoteRepositoryService`.
Redis callbacks are installed before connect. Each API has its own durable
event cursor, catches up on notifications/readiness, reconciles SQL periodically,
and explicitly reconnects Redis. Failed post-commit notifications are logged,
not reported as failed mutations. Initial connection failure rejects startup.
Shutdown drains advisory publications/reconciliation before closing PostgreSQL.
The existing portable SQL event implementation is reused with actual PostgreSQL;
its historical class name `SqliteEventPort` does not select a SQLite backend.

From `apps/server/src/repository-main.ts`:
`repositoryMain(env?: NodeJS.ProcessEnv): Promise<void>`. This role alone owns
the durable Git volume and exclusive flock. APIs have separate local directories.
Scale compilation uses actual remote worker OS processes, not local API pumps.
`bun run build` retains the API bundle and adds repository/worker bundles.
Operator environment and commands are in `deploy/portable/README.md`.

Common `RepositoryService` and `LocalRepositoryService` now expose:

```ts
exportNamed(projectId: Id): Promise<Uint8Array>;
importPack(projectId: Id, pack: Uint8Array): Promise<void>;
```

Native named export holds the finalized-read/admission gate through extraction
into a physically separate named-only repository. Import validates a non-thin
pack in quarantine and imports immutable objects without refs. Native
`repositoryGit` normalizes Bun 1.3.14's actual pipe result to `Uint8Array`;
the regression checks runtime identity, not just its TypeScript annotation.

## Migration, seed and offline transfer

`scripts/migrate.ts` exports `migrate(): Promise<void>`. It applies foundation
and module migration arrays without registering producers or contacting Git.
The real scale harness runs this exact CLI before starting the repository role.
No original SQLite SQL/digest was changed. PostgreSQL uses explicit variants.

`seed(runtime: Runtime, password?: string): Promise<{
  readonly createdUsers: number; readonly password: string | null;
}>` retains its development-only policy and original data. Both profiles now
import the actual seed pack, publish named/history refs with a current lease,
and finalize SQL plus repository journal in one supplied transaction.

Declared offline integration subtree: `apps/server/src/transfer.ts`, invoked
only by the explicit `QUIRE_TRANSFER_SOURCE=... bun scripts/migrate.ts --quiesced`
operator flow:

```ts
transferQuiesced(source: Runtime, target: Runtime, quiesced: boolean): Promise<{
  tables: Record<string, number>; blobs: number; repositories: number;
  nativeMigrations: readonly Record<string, unknown>[];
}>;
```

All writers/workers must already be stopped. The command requires a fresh
target and the original instance key, rejects unfinished source/named/review/
repository work and active jobs, and preserves SQL receipts, tombstones,
explicit orders/counters, verified blobs and all original Git objects/refs.
It preserves the larger native/target branch fence with expired ownership.
Configured native keys without a local key file use the actual runtime-held
key; an existing original file is still checked against the target key.
Target migration fingerprints remain selected-dialect PostgreSQL fingerprints;
the unchanged native migration ledger is emitted in the transfer receipt.
There is no online/retry transfer protocol or automatic enable-serving step.

## Verification and remaining dependencies

Final producer-input root checks all exit 0: `bun run typecheck`, `bun run lint`
and `bun run build`. Their `*-producers-final.log` receipts are retained.
The existing Vite chunk-size warning remains. Earlier temporary producer lint
and owned type/lint findings were corrected without suppression.
`bun run test:scale` now names the actual three portable suites, not the P0
placeholder; its combined final invocation belongs to independent verification.

Native assembly: 66 pass, 0 fail, 160 expectations, including genuine PDFs,
restart/Unicode, Viewer denial and 176 implemented / 69 deferred contracts.
Native quarantine/bundle and actual Uint8Array regressions pass.
Fresh scale seed, stable Redis stop/start plus a new factory, real schema-only
CLI startup and offline-transfer preflight all pass against owned real services.
The latest bootstrap/preflight command has 2 pass, 0 fail, exit 0, 10 seconds.

Previous full runs passed native session/CSRF reuse across APIs, original
receipt/tombstone preservation, exact S3/history bytes, cross-instance SSE/HTTP
revocation, Redis-outage catch-up without duplicate sequence, and actual
SIGSTOP/takeover/SIGCONT fencing. Test-only errors were a missing history branch,
Docker's reassigned dynamic Redis port, and expiry of only the source lease
rather than the separate dead HTTP-receipt lease. All are corrected without
changing producer behavior; all failed-run resources were cleaned.

The fourth run also passed startup recovery, exact replay and one source event;
its test-only compile revision error was corrected by reading the HTTP revision.
The final full command `bun test tests/integration/portable/assembly.test.ts`
exits 0: **1 pass, 0 fail, 248.91 seconds**, with every assigned failure case.
It holds the first remote worker's actual source request at an explicit barrier,
checks the real worker ID and expired lease, and verifies a distinct replacement
on the other API publishes a genuine 41,496-byte PDF. No fixed test sleeps, skipped tests,
fake adapters or API-local compiler pump satisfy these assertions.

Retained artifact:
`docs/evidence/p1s-integrate/scale-output-9ae3763b-72e5-44c8-835f-a0d81bff4a20.pdf`,
SHA-256 `95301043bfe1ef2bf5da594cdbbcc9844a65e4dd6ac9dd66d74bfb1cbefe3877`.
The original 453-byte history main source remains SHA-256
`392c2b10d1f883ac1a73ca0f77efe11c044a71a8e979877ca8df405d8b0f12ab`.
Exact commands/exits and honest intermediate failures remain in
`docs/evidence/p1s-integrate/verification.md` and its logs.

All current named P1S handoffs were read, including final `p1s-git.md`,
VERIFIED `p1s-source-composition.md` and the independent `p1s-verify.md`.
No unresolved owned dependency remains. The VERIFIED prepare/batch-finalize
boundary passed 74 base/project/file tests and 257 assertions, with strict/lint
clean. Final Git producer receipts, consumed rather than rerun:

- `bun test tests/core/git tests/integration/git.test.ts`: exit 0, 28 pass,
  0 fail, 132 expectations, 65.12 seconds; actual CLI clone/fetch/push,
  confinement-backed staged compilation, branches/merge, journal rollback/
  recovery, credentials and hidden-object protection.
- Final Viewer transport: exit 0, 2 pass, 0 fail, 10 expectations, 1.84 seconds,
  including initial Viewer clone/fetch and mutation denial.
- Final Git strict TypeScript and type-aware lint: exit 0; owned fixture-root
  absence and whitespace receipts pass. Full evidence is
  `docs/evidence/p1s-git/verification.md`.

This node has edited no base/Git business code or prematurely finalized a
producer journal. The independent combined full-native/scale gate remains
its owner's final acceptance responsibility, not an omitted integration check.

## Cleanup

Every run removed its exact API/worker/repository processes, listeners,
containers/anonymous volumes, S3 volume and temporary roots before terminal exit.
The final successful topology was `/tmp/quire-p1s-integrate-4yzOQm`; API PIDs
3825526 / 3827238 / 3830150, PostgreSQL/Redis suffix
`b2d6e35a-4e41-470e-859d-756cc85a592f`, S3
`quire-p1s-s3-cdb1c3b0-8fa7-4c69-bd64-c1d72ddbf39c`.
Final read-only inventory and scoped whitespace check exit 0 with
`P1S_INTEGRATE_FINAL_RESOURCES_ABSENT` in `cleanup-final.log`.
No assigned asynchronous check remains; the obsolete dependency watch was
already absent. No workspace commit/push, nested agent, baseline SQLite SQL,
original input, product UI/router file or shared cached image was changed.
Evidence is ignored by existing Git rules and is retained on disk for explicit
inclusion only when commits are authorized.
