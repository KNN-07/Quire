# P1S repository service

Owner: st_01a17b48. October 27, 2026. Status: assigned implementation and
verification and cleanup complete. Native Bun 1.3.14:
5 real Git/PostgreSQL tests pass, 19 Bun expectations; strict TypeScript,
type-aware lint and owned whitespace checks exit 0. This accepts the repository
boundary, not the complete scale application or Git-service HA.

Integration decision: the repository role is one Linux service with exclusive
ownership of a durable volume. All API processes call its authenticated HTTP
boundary. New branch fences must be issued through that same service queue,
not by calling the underlying PostgreSQL coordinator's acquire directly.
The server accepts the authoritative BranchCoordinator as a dependency;
the remote coordinator delegates acquire/renew/release to the server and
asserts against PostgreSQL inside the caller's transaction. Git commands never
run inside SQL transactions. Client finalization joins the caller's SQL
transaction, rather than attempting a transaction over HTTP.

## Exported composition signatures

From `services/operations/repository/index.ts`:

```ts
type RepositoryDependencies = {
  readonly db: SqlExecutor;
  readonly uow: UnitOfWork;
  readonly branches: BranchCoordinator;
  readonly clock: Clock;
};
type RepositoryServerOptions = RepositoryDependencies & {
  readonly volume: string;
  readonly token: string;
  readonly hostname?: string;
  readonly port?: number;
  readonly gitCommand?: readonly string[];
};
type RepositoryServer = {
  readonly url: string;
  close(): Promise<void>;
};
startRepositoryServer(options: RepositoryServerOptions): Promise<RepositoryServer>;
type RepositoryClientOptions = {
  readonly url: string;
  readonly token: string;
  readonly clock: Clock;
};
class RemoteRepositoryService implements RepositoryService {
  constructor(options: RepositoryClientOptions);
  initialize(projectId: Id): Promise<void>;
  objects(projectId: Id, args: readonly string[], input?: Uint8Array): Promise<Uint8Array>;
  read(projectId: Id, args: readonly string[]): Promise<Uint8Array>;
  publish(intent: RepositoryIntent): Promise<void>;
  recover(id: Id, lease: BranchLease): Promise<void>;
  finalize(tx: Transaction, id: Id, lease: BranchLease): Promise<void>;
  assertReadable(projectId: Id): Promise<void>;
  exportNamed(projectId: Id): Promise<Uint8Array>;
  importPack(projectId: Id, pack: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
class RemoteBranchCoordinator implements BranchCoordinator {
  constructor(options: RepositoryClientOptions);
  acquire(scope: Scope, owner: string, ttlMs: number): Promise<BranchLease | null>;
  renew(lease: BranchLease, ttlMs: number): Promise<BranchLease>;
  release(lease: BranchLease): Promise<void>;
  assert(tx: Transaction, lease: BranchLease): Promise<void>;
  subscribe(listener: (scope: Scope) => void): () => void;
  close(): Promise<void>;
}
assertRepositoryFence(tx: Transaction, lease: BranchLease, clock: Clock): Promise<void>;
finalizeRepositoryIntent(tx: Transaction, id: Id, lease: BranchLease, clock: Clock): Promise<void>;
```

The server dependency `branches` must be the raw authoritative coordinator,
not its own remote proxy. The queue holds through subprocess exit and serializes
lease takeover, reconciliation, CAS, and finalized reads. A durable pending
intent blocks successors. Existing migration 006 owns the journal and leases;
no migration or shared contract changes were made. Tests use real PostgreSQL
with the matching lease/journal schema and independent pools, never SQLite.

The client `finalize` performs SQL directly on the supplied transaction.
It does not call the server, commit independently, perform Git I/O or capture a
root database connection. Domain authorization, expected source revision,
receipt, source mutation and event insertion must join that same transaction.
Recovery adopts the new fence before reconciling actual refs; a stale owner's
finalization fails. Conflicts remain durably blocked, not silently discarded.

## Service, volume and transport

Linux `flock` and Git must be installed in the singleton role. `volume` is an
exclusive persistent mount; the service creates `.repository-owner.lock` and
`<project UUID>.git` there. The flock open file description is inherited by each
Git child, retaining exclusion even if the service loses its own descriptor.
No automatic failover or Git HA is claimed. Restart remounts the same volume,
then APIs acquire current leases and recover pending PostgreSQL intents.
Do not delete the lock file to bypass an active owner.

The server defaults to `127.0.0.1` and an ephemeral port. Supply an explicit
hostname/port for deployment. A bearer secret of at least 32 bytes is mandatory;
comparison is constant-time. Client non-loopback URLs require HTTPS; terminate
TLS on the authenticated private service network and protect the HTTP backend.
`gitCommand` is trusted operator configuration, defaults to `["git"]`, and is
used by tests only to wrap the real executable with deterministic barriers.
It is never accepted from HTTP callers. There is no arbitrary shell RPC.
JSON boundaries validate IDs, leases, argument counts and bounded base64 input;
maximum HTTP body is 73 MiB. Close stops the listener, drains admitted work
through child exit, then releases volume ownership. Composition closes
coordinator/storage separately after service shutdown.

`RemoteBranchCoordinator.subscribe` reports local successful lease operations.
Root's scale coordinator/event integration must attach actual Redis lease
notifications for cross-process advisory wake-ups and durable SQL reconciliation.
Redis does not issue fences. Never install raw PostgreSQL `acquire` in an API
alongside this service: doing so bypasses Git's uncertain-child exclusion.

Root integration must keep the repository volume off API containers. Public
smart Git transport must retain physically separate public/quarantine stores;
the internal `objects/read` contract is trusted internal Git plumbing, not a
public Git endpoint. `read` holds the finalized-visibility gate through actual
Git execution; a separate `assertReadable`/extraction pair is not race-safe.
Unfinalized and conflicted journals block public export and reads.

`exportNamed` builds a physically separate bare repository containing only
finalized `refs/heads/*` ancestry and returns a self-contained Git bundle.
An empty repository returns zero bytes. No alternate points back to the
private store. `importPack` requires a self-contained non-thin pack; it indexes
and fscks in a temporary quarantine first, then imports immutable objects only
into the canonical repository. It never publishes refs. Callers retain the
existing per-user authorization, branch/tree/size validation and dirty-browser
checks, then use fenced `publish` and atomic SQL `finalize`. Hidden refs,
hooks and config must not be imported by the public transport.

## Dependencies, checks and evidence

Read and consumed `p1s-contract.md`, `p1s-postgres.md` and `p1s-redis.md`;
the production service consumes the frozen storage/coordinator contracts.
Real tests consume the verified PostgreSQL factory. No Redis authority or
SQLite fallback is introduced.

Root/core integration dependencies remain outside this assignment:
compose the singleton process with the real raw PostgreSQL coordinator and
private TLS routing; install both remote ports in APIs; migrate public Git
serving to named bundles/quarantined pack import; wire advisory Redis wakes;
finish complete foundation/domain migrations and whole-application gates.
The owned tests do not claim the existing core consumers are migrated or
that the entire scale profile is accepted.

Verification commands (native Bun 1.3.14):

```sh
bun node_modules/typescript/bin/tsc --noEmit -p tests/operations/repository/tsconfig.json
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings services/operations/repository tests/operations/repository
QUIRE_TEST_POSTGRES_URL=postgres://USER:PASSWORD@HOST:PORT/DATABASE bun test tests/operations/repository
```

The test URL must permit creation/deletion of owned unique test databases.
Tests spawn a real service and two independent API callers; deterministic
SIGSTOP/takeover/SIGCONT rejects stale execution. Socket barriers hold actual
Git before CAS, prove serialized takeover and failed-before/failed-after
subprocess recovery, and preserve finalized-only reads across service restart.
Further coverage checks authentication, duplicate-volume rejection, inherited
volume locks, SQL rollback/finalization, immutable pack import and actual clone
of a named bundle with private checkpoint objects physically absent.

Evidence and intermediate failures: `docs/evidence/p1s-repository/verification.md`.
Final tests: 5 pass, 0 fail, 19 Bun expectations, 6.11 seconds. All service,
caller and Git child processes, Unix/HTTP listeners and five unique test roots
closed cleanly. Cleanup exited 0 with
`REPOSITORY_OWNED_CONTAINER_VOLUME_REMOVED`: container
`quire-p1s-repository-st01a17b48`, its anonymous data volume and loopback port
32912 are gone. The readiness subscription exited 0; no asynchronous check or
owned resource remains. Evidence is retained, not removed with test roots.
No commit/push, shared contract/SQL/DTO edit or out-of-scope source edit was made.
