# P1S review and collaboration

Owner: `st_01a17b7c`. October 27, 2026. Status: COMPLETE for the owned migration.
Native CLI: Bun 1.3.14. Native and real PostgreSQL runs each passed 35 tests,
zero failures, 200 expectations across 18 files. Strict owned TypeScript,
type-aware lint and owned whitespace checks exited 0. Whole-application and
two-API scale acceptance remain root-owned.

## Exported consumer boundary

Exports from `services/core/review/index.ts`:

```ts
register(context: ModuleContext): Promise<void>;
dispose(context: Pick<ModuleContext, "db">): Promise<void>;
const migrations: readonly Migration[];

class RealtimeService extends DocumentUpdates implements RealtimePort {
  constructor(context: ModuleContext);
  readonly handlers: RealtimePort["handlers"];
  upgrade(request: Request, server: Server<RealtimeSocketData>): Promise<Response | undefined>;
  dispose(): Promise<void>;
}
```

Composition must await both, stopping transports/history capture before closing
runtime adapters. `RealtimeService` retains its inherited
`update(request: Request, scope: Scope, message:
Extract<RealtimeClientMessage, { readonly type: "update" }>)` returning
`Promise<RealtimeServerMessage>`. Public HTTP and realtime DTOs are unchanged.

Internal readers now return promises: `ReviewStore.scope`, `thread`,
`threadDto`, `suggestion`, `changed`, and all history capture/record readers.
`withTransaction(tx: Transaction)` returns the corresponding bound
`ReviewStore`, `ReviewMutations`, or `HistoryStore`, never a captured root
executor. `ReviewMutations.mutate<T>` takes
`work: (store: ReviewMutations) => Promise<T>`.
Route registration helpers remain synchronous except
`registerHistory(context: ModuleContext, store: HistoryStore):
Promise<() => Promise<void>>`; `registerEvents(context: ModuleContext,
store: ReviewStore): () => Promise<void>`.

Recovery signatures:

```ts
finishDecisions(store: ReviewMutations): Promise<void>;
finishRestores(store: HistoryStore, currentLease?: BranchLease): Promise<void>;
recoverReview(store: HistoryStore, plan: RestorePlan): Promise<void>;
reanchor(store: HistoryStore, scope: Scope,
  position: z.infer<typeof anchorPosition>): Promise<Anchor | null>;
acceptance(store: ReviewMutations, plan: DecisionPlan,
  edits: readonly ProposedEdit[]): Promise<SourceFinalization>;
```

## Transactions, decisions and behavior

Acceptance uses the frozen base `SourceFinalization` descriptor for selected-edit
CAS, suggestion counters, notification DML, decision receipt, intent deletion and
review events. The source writer commits these with its source receipt, state,
repository finalization and source events. There is no post-source acceptance
transaction. Notifications retain preferences, recipient authorization, dedupe
receipts, in-app events and email digest items in that descriptor.

Durable reservations in `review_decision_intents` replace `decisionTail`.
Preparation under `quire:accounts` rejects a competing decision on the same
suggestion with `DECISION_BUSY`. The stored original edits and descriptor make
retry digests stable. Startup resumes prepared acceptance even if the process
stopped before source preparation. Existing pre-portability decision intents
retain their legacy recovery path; newly prepared acceptance never uses it.
Conflicts retain all-or-nothing source application and exact divergent statuses.

Metadata mutations acquire `quire:accounts`, assert the supplied branch lease,
recheck the persisted session, current role and applicable policy, and use
transaction-bound stores. Recovery uses current branch leases. SQL callbacks do
not perform blob, Git, password or network I/O. Event dispatch follows commit.
All SQL is awaited; there are no synchronous statements or `.local` UOW calls.

The original 32-test P1 behavior remains: durable update-before-ack and replay,
client sequence conflicts/gaps, Yjs convergence, exact reconnect epochs, partial
suggestion selection, reviewer/viewer denial, permanent comment tombstones,
anonymous credential scope and live token revocation, history ZIP/compare/labels
and windows, author counters, policies, notification preferences and digests.
Session tests subscribe WS/SSE before actual revocation and distinguish retained,
removed, unrelated, anonymous and later-created sessions, including wildcard
replay. Transport disposal now drains admitted async delivery/refresh work.

## Migrations

`023-k-review-history` has an explicit PostgreSQL variant. Its original SQLite
SQL is byte-identical to the owned pre-edit source; SHA-256:
`764ac9e8fee251d64c7e024b9f2260c79deff756fbb6371a53906d61a90d0cad`.
No foundation migration or applied digest/timestamp was edited.

New `023-k-review-portable` adds unique explicit `history_versions.history_order`.
Its SQLite-only backfill preserves original snapshot rowid order; new allocation
uses the transaction-held `quire:review-history` key. Timeline reads use the
explicit value, never rowid. PostgreSQL has authored BIGINT/window backfill SQL.
Local-to-scale transfer must copy the already-backfilled order, not recreate it.
Suggestion creation/recovery supplies `edit_order`; reads use the foundation
006 explicit-order column. Camel-case SQL aliases are quoted.

## Checks and evidence

Final native command:
`bun test tests/core/review tests/integration/collaboration.test.ts tests/integration/review-history.test.ts`
exited 0: **35 pass, 0 fail, 200 expectations, 18 files, 22.47 seconds**.
The same command with `QUIRE_REVIEW_POSTGRES_URL` set to the owned disposable
PostgreSQL instance exited 0: **35 pass, 0 fail, 200 expectations, 57.38 seconds**.
Each PostgreSQL domain fixture uses its own actual database, real PostgreSQL
executor/transactions, native Git/disk blobs and SQL-backed event delivery.
The dedicated native migration-backfill test deliberately uses in-memory SQLite.
This is neither a SQLite fallback nor a claim to Redis/S3/two-API acceptance.

Three added regressions prove exact native order backfill/reopen, durable
reservation and replay across independent runtimes, and a deterministic
finalization crash after status/receipt/source writes but before event commit.
The crash test uses subscribed real WS/SSE, verifies complete rollback and
restart recovery with exactly one review/source event set. Barriers subscribe
before actions and have bounded deadlines; no fixed test sleep was introduced.

`node_modules/.bin/tsc --project tests/core/review/tsconfig.json --noEmit --pretty false`
and `oxlint --type-aware --deny-warnings` over owned production/tests and the two
integration files exited 0. Owned `git diff --check` exited 0. Production LSP
reported zero diagnostics. Initial mechanical-conversion and test-inference
failures were corrected without suppressions; details remain in
`docs/evidence/p1s-review/intermediate-results.md`.

Evidence: `native-final.log`, `postgres-final.log` (terminal tail explicitly
identified), `static-final.log`, `cleanup.log`, and `intermediate-results.md`
under `docs/evidence/p1s-review/`. The repository ignores evidence/log files;
they are retained on disk for the root to include explicitly if desired.

## Dependencies and cleanup

Consumed and verified: `p1s-contract.md`, `p1s-accounts.md`,
`p1s-core-base.md`, and `p1s-postgres.md`. Review consumes base's
`applyEdits(actorId, scope, edits, key, finalization?)` and `SourceFinalization`,
plus the verified `sourceFinalization` validator exported by
`services/core/base/source-finalization.ts`. Accounts notification helpers receive
the actual transaction context, and their business lock convention is preserved.

No owned blocker remains. Root integration must await the changed lifecycle
exports and run whole-repository gates after sibling migrations. The initial
global compiler diagnostic run exposed still-unconverted sibling consumers
(for example `services/core/git/journal.ts` using `.local`); no sibling was
edited and no whole-repository success is claimed. Redis, S3, repository-service
topology, two OS processes and local-to-scale transfer acceptance remain the
named root/integration responsibilities, not unfinished owned checks.

Every fixture closed its listener, review transports/history tasks and adapters,
then removed its unique `/tmp/quire-p1s-review-*` root. The post-run root glob
was empty and PostgreSQL had zero remaining `quire_review_%` databases.
Container `quire-p1s-review-st01a17b7c-1a388085`, loopback port `32917`, and its
anonymous volume were removed; terminal cleanup receipts are retained.
The readiness log subscriber reached its deadline after observing readiness
and exited 143; it did not terminate PostgreSQL. All test/static/cleanup
subscriptions have terminal receipts. No commit/push, nested agent, unrelated
cleanup, original-input edit or out-of-scope write was made.
