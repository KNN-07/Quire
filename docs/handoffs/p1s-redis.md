# P1S Redis transport

Owner: st_01a17b3e, October 27, 2026. Status: COMPLETE for assigned advisory
transports. Native Bun 1.3.14: 2 real Redis tests pass, 22 assertions, strict
owned TypeScript and type-aware lint exit 0. Consumes the frozen
`p1s-contract.md` Scope/ScopeSchema only; no sibling adapter exports consumed.

Exported from `services/operations/storage/redis/index.ts`:

```ts
type RedisTransportState = "disconnected" | "connecting" | "ready" | "closed";
type RedisTransportOptions = {
  readonly url: string;
  readonly namespace: string;
  readonly connectionTimeoutMs?: number;
};
class RedisNotificationTransport {
  constructor(options: RedisTransportOptions);
  get state(): RedisTransportState;
  subscribeEvents(listener: () => void): () => void;
  subscribeLeases(listener: (scope: Scope) => void): () => void;
  subscribeState(listener: (state: RedisTransportState) => void): () => void;
  connect(): Promise<void>;
  publishEvents(): Promise<void>;
  publishLease(scope: Scope): Promise<void>;
  close(): Promise<void>;
}
```

Register callbacks before `await connect()`. Every ready transition means both
subscription acknowledgments arrived and requires durable SQL event catch-up.
The owner explicitly calls `connect()` after a disconnected transition; there
is no hidden reconnect timer or offline publish queue. Concurrent calls coalesce.
Startup connection failure rejects; outage publishes reject. A committed SQL
mutation must not be rolled back/reported uncommitted because its advisory
notification failed. Periodic SQL reconciliation remains the event owner's job.

Both event and lease messages use actual Redis Pub/Sub on namespace-scoped
channels. Lease payload is only Scope, not ownership, TTL, or fence. Publish
lease wakes after successful authoritative acquisition, renewal or release.
SQL owns all durable replay, event ordering, fencing and lease validation.
No migrations or shared contracts changed. Composition owns reconnect policy
and shutdown ordering (stop domain producers, then close transport).

## Wire and lifecycle details

Channel names are `${namespace}:events` and `${namespace}:leases`; configure
the same unique deployment namespace on every participating process. Events
carry the literal `wake`, never an event sequence or event payload. Lease
notifications carry validated serialized Scope only. Unknown event messages,
invalid JSON, invalid scope IDs/branches and extra lease authority fields are
ignored. Unsubscribe functions remove their callbacks synchronously.

`state` starts disconnected; `connect()` emits connecting, then ready after
TCP/TLS, optional AUTH/SELECT, PING and both subscription acknowledgments.
A broken socket on either connection disposes both and emits disconnected.
`connect()` can then recreate them; callbacks survive reconnection. No
notification delivery during outage is promised. `close()` emits closed,
rejects pending admission, drains admission/socket close events and clears
callbacks; subsequent connects, publishes and new subscriptions reject.

`redis://` and `rediss://` URLs support percent-encoded username/password and
an optional database path. TLS uses system certificate verification, with
no disable-verification switch. Live TLS endpoint/certificate provisioning
was not exercised. `connectionTimeoutMs` defaults to 5,000 and bounds
connection/command response deadlines, not an idle-connection heartbeat.
Consumers should use their SQL reconciliation policy to detect missed wakes
and choose when to reconnect; this transport intentionally has no hidden
automatic retry loop. Synchronous callbacks must return without throwing.

Native Bun 1.3.14 RedisClient panicked twice during owned probes. Production
therefore uses a small RESP2 TCP/TLS client over Node-compatible sockets,
not an eval-only API, a new package dependency, or a fake scale transport.
The parser buffers fragmented replies and handles Pub/Sub arrays, simple
strings, bulk strings, integers, nulls and Redis errors. Its internal
`wire.ts` export is not a composition port:

```ts
type Reply = string | number | null | Error | readonly Reply[];
class RedisWire {
  constructor(url: URL, timeoutMs: number);
  onclose: (() => void) | null;
  onmessage: ((channel: string, message: string) => void) | null;
  readonly closed: Promise<void>;
  connect(): Promise<void>;
  command(parts: readonly string[]): Promise<Reply>;
  close(): void;
}
```

## Checks and evidence

All final commands ran with native Bun 1.3.14 and have terminal exit 0:

```sh
bun test tests/operations/storage/redis
bun node_modules/typescript/bin/tsc --noEmit -p tests/operations/storage/redis/tsconfig.json
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings services/operations/storage/redis tests/operations/storage/redis
git diff --check -- services/operations/storage/redis tests/operations/storage/redis docs/handoffs/p1s-redis.md docs/evidence/p1s-redis
```

The real Redis suite passed **2 tests, 0 failures, 22 assertions, 2.44 seconds**.
It verifies acknowledged readiness and concurrent connection admission,
cross-client event and lease delivery, malformed message rejection, namespace
isolation, unsubscribe, actual server stop/restart on a stable endpoint,
both clients' observable disconnect barriers, failed outage publishes,
explicit reconnect and fresh ready signal, post-reconnect delivery,
idempotent disposal, closed-state rejection and Redis-observed zero remaining
adapter clients. A separate owned real Redis case verifies NOAUTH failure,
close during admission, encoded ACL credentials, database selection and
authenticated notification delivery. No fixed sleeps or skipped tests exist.
Owned production/test LSP diagnostics also reported zero errors.

Exact final output, previous failures and cleanup receipts are in
`docs/evidence/p1s-redis/verification.md`. No passed check was rerun without
changed input. Whole-repository/domain integration gates belong to root.

## Dependencies and cleanup

No unresolved dependency blocks this adapter. The SQL event/coordinator owner
must attach the notification callbacks, publish after successful SQL commits,
catch up on each ready transition and periodically reconcile durable state.
Root composition must provide the deployment Redis URL/namespace, reconnect
policy and shutdown ordering. The two-API durable replay/fencing acceptance
belongs to those owners; this transport does not claim to verify SQL behavior.

Final owned containers removed with attach children exited:
`quire-p1s-redis-5ddd6d63-0acf-45fe-b6b1-53a6b0598ae7` (port 33439) and
`quire-p1s-redis-48a15ba0-65ac-4b0a-a1db-b095aa2de36d` (port 41847).
Earlier failed-run containers were also removed, including the explicit
post-crash removal. Final `docker ps --all --format "{{.Names}}" --filter
name=quire-p1s-redis-` returned no rows. No owned temporary root, listener,
Redis data volume or subprocess remains. The downloaded Redis image is
retained as a shared dependency cache. No commit, push, baseline SQL/digest,
public DTO, original input or out-of-scope source edit was made.
