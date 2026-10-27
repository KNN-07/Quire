# Portable storage and scale coordination

Decision checkpoint: October 27, 2026. This is implementation direction for
the next phase, not a claim that the scale profile works.

## Why the phase is required

The design plan requires PostgreSQL, Redis and S3 in the scale profile, with
two API processes, durable replay and fenced failover. Current
`packages/runtime/src/context.ts` exposes Bun's SQLite `Database`,
`LocalUnitOfWork` and `LocalEventPort`. Scale startup correctly rejects the
profile with `PROFILE_UNAVAILABLE`.

An independent read-only assessment found 483 SQL query calls across 62 of
91 service files, 77 synchronous transaction calls across 33 files, and no
production consumer of the existing asynchronous `UnitOfWork.run`. Its census
also identified SQLite conflict syntax, JSON functions, implicit rowids,
NOCASE comparisons, camelCase aliases and a SQLite trigger. The lead read the
runtime contracts and representative consumers and confirmed the decisive
synchronous dependency.

Adding PostgreSQL/S3 clients alone would leave these services bound to
SQLite. Neither a blocking synchronous PostgreSQL shim nor a second copy of
every domain service is the chosen solution.

## Contract and invariants

Production consumers will use one asynchronous SQL executor and
transaction-bound `UnitOfWork.run`. Public HTTP DTOs remain stable.

- A transaction callback receives its executor. Helpers accept that executor
  or a transaction-bound store; they must not fall back to a captured root
  database connection.
- SQLite retains WAL, foreign keys and FULL durability. Root operations share
  a queue with transactions so unrelated requests cannot accidentally execute
  inside an open asynchronous transaction. Transaction-bound operations bypass
  that queue. Blob, Git, hashing and network work stay outside SQL transactions.
- PostgreSQL reserves one connection per transaction. Aggregate locks and CAS
  protect idempotency, tokens, last-operator protection, seats, ACLs and worker
  claims that previously relied on SQLite's single writer.
- Startup, recovery, event delivery and shutdown become awaitable. Local
  adapter handles may remain available to explicitly local tooling/tests, not
  production domain implementations.
- Existing SQLite migration strings and digests remain immutable. Add
  explicit PostgreSQL variants under the same logical migration IDs, with
  selected-dialect digests and serialized startup migration execution.
- Use a narrowly tested placeholder lexer if needed, not a general SQL
  regular-expression translator. Author dialect-specific conflict/JSON/search
  statements, case-insensitive uniqueness, trigger equivalents and foreign-key
  creation order. Quote case-sensitive aliases and check numeric conversion.
- Replace implicit rowid ordering with explicit columns. Existing local data,
  including suggestion edit order, needs a tested backfill.

## Distributed ownership

One project branch has one current writer. Its lease includes owner, expiry
and a monotonically increasing PostgreSQL-issued fence. Redis supplies actual
acquisition/renewal notification; PostgreSQL remains the fencing authority.
Preparation and finalization validate current ownership, fence, expected
revision and authorization. Intents retain the fence, and recovery acquires
ownership before reconciling them.

Local Git directories are not shared merely because metadata moved to
PostgreSQL. The selected scale boundary is a repository service on a durable
volume, reached by both API processes. Local mode keeps direct Git execution.
This is an explicitly reported singleton Git role, not Git-service HA.

The repository service serializes fence admission, journal recovery and ref
CAS. It rejects stale work at execution, holds successors while an earlier
Git subprocess has an uncertain result, and exposes only finalized intents.
A lease check followed by an unconstrained `git update-ref` is insufficient.

Review acceptance must finalize the selected edit statuses, source receipt and
review/source events atomically. Keep the existing crash-recovery intent
semantics and permanent comment tombstones. A process-local decision queue is
not distributed coordination.

## Events, compilation and blobs

Events and outbox entries remain transactional. Redis wakes each API to catch
up from durable PostgreSQL rows; each API has its own cursor and reconciles
after a notification outage. Preserve authorization and subscribe-before-replay.

The current `seq > cursor` protocol requires commit-ordered visibility.
Ordinary PostgreSQL sequence allocation alone does not provide that order.
Use a transactional counter row held through commit, acquired after business
locks with events appended last. Verify an intentionally inverted pair of
transaction completions.

Compiler job claims, heartbeats, artifact references and completion enforce
their fences inside the relevant transaction. Scale APIs do not each start a
local compiler pump; use the actual remote-worker process and replacement
protocol.

The existing `BlobStore` contract remains. S3 PUT/GET uses authenticated
content-addressed objects, finishes upload before SQL references, and verifies
SHA-256 on reads. Test the chosen compatible endpoint with actual bytes,
history and artifacts across API/worker replacement.

Changing `QUIRE_PROFILE` is not migration. Local-to-scale transfer quiesces
writers, copies SQL in dependency order, uploads verified blobs, transfers Git
repositories and keys, preserves receipts/tombstones, reconciles intents and
only then enables serving.

## Phase ownership

Do not overlap conversion with active P1 ownership. First finish P1 integration
and verification, then start a new phase-scoped DAG:

1. F freezes asynchronous executor, transaction, migration, event, branch-lease
   and repository-service contracts, plus native adapter regression fixtures.
2. A converts accounts/governance stores and transactional invariants. O starts
   real PostgreSQL/Redis/S3 and repository-service adapters in its own paths.
3. K-base converts source/access and publishes asynchronous writer/recovery
   signatures after A's public dependencies are ready.
4. Review, catalog and compiler convert in disjoint subtrees; Git follows
   compiler/base readiness because its real compile-before-commit tests depend
   on both.
5. F composes factories and lifecycle. An independent verification node runs
   native and scale acceptance before new X implementations depend on them.

No intermediate cross-module migration is committed as a falsely buildable
increment. Preserve the passing P1 baseline and publish verified boundaries.
Exact node scopes and dependencies are frozen in the phase definition before
it starts.

## Acceptance

Run the same domain behavior against native SQLite and real PostgreSQL.
Then use two API OS processes with separate local directories to prove:
stale-writer pause/takeover/resume, deterministic crash-point recovery, Redis
outage catch-up, cross-instance revocation, S3/history retrieval and compile
worker replacement. Tests use explicit barriers/events, not sleeps.

This storage phase does not silently satisfy all deployment requirements.
Helm installation, SSH, bounded autoscaling, air-gap operation, backup/update
drills and applicable hardware verification remain explicit later gates.
