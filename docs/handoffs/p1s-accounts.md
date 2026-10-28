# P1S accounts

Owner: `st_01a17b3b`. October 27, 2026. Status: COMPLETE for the owned conversion.
Native Bun 1.3.14. One retained native integration case and test-inclusive
typecheck remain blocked on explicitly unconverted sibling consumers; no
whole-repository or scale acceptance is claimed.

## Frozen consumer boundary

Identity/governance registration remains `register(context: ModuleContext): void`.
Identity ports retain the runtime's asynchronous `IdentityPort` and `PolicyPort`.
Public HTTP DTOs are unchanged.

Governance exports `TransactionContext = Omit<ModuleContext, "db"> & {
readonly db: Transaction }`. Pass `{ ...context, db: tx }` from the actual
`uow.run(async tx => ...)` callback, never the captured root context.

Transaction-owned exports, now asynchronous:

```ts
enqueueNotification(context: TransactionContext, input: NotificationInput): Promise<Id | null>;
ensureBillingAccount(context: TransactionContext, organizationId: Id, email: string): Promise<BillingAccount>;
recordBillingTransition(context: TransactionContext, input: BillingTransition & { readonly actorId: Id | null }): Promise<BillingAccount>;
transferProjects(context: TransactionContext, input: { readonly from: Id; readonly to: Id; readonly projectId?: Id }): Promise<void>;
revokeSessions(context: TransactionContext, userId: Id): Promise<void>;
```

These helpers acquire the stable transaction-held business key `quire:accounts`.
Acquire this key before recording any events in a producer that calls them.
No helper dispatches events inside its caller's transaction.

Root/read exports:

```ts
notificationPreferences(context: ModuleContext, userId: Id): Promise<NotificationPreferences>;
billingAccount(context: ModuleContext, organizationId: Id): Promise<BillingAccount>;
editorState(context: ModuleContext): Promise<{ closed: boolean; message: string; version: number }>;
requireEditorOpen(context: ModuleContext): Promise<void>;
flushNotificationDigests(context: ModuleContext): Promise<number>;
applyBillingTransition(context: ModuleContext, principal: Principal, input: BillingTransition): Promise<BillingAccount>;
transitionManaged(context: ModuleContext, principal: Principal, input: ManagedLifecycleCommand): Promise<void>;
reconcileInstitutionEligibility(context: ModuleContext): Promise<number>;
```

Read helpers use the executor on the supplied context, so transaction consumers
must pass their bound context. Transaction-owning exports must be invoked
outside an existing transaction.

`AuthProviderCapability.read: () => Capability | Promise<Capability>` now
supports persisted asynchronous adapter capability reads.

Unchanged identity exports:

```ts
intersectPolicy(left: Policy, right: Policy): Policy;
registerAuthProviderCapability(context: Pick<ModuleContext, "services">, provider: AuthProviderCapability): void;
const sessionCookie: "quire_session";
const defaultPreferences: Preferences;
const migrations: readonly Migration[]; // exported separately by each module
```

`AuthProviderCapability` is `{readonly id: string; readonly label: string;
readonly read: () => Capability | Promise<Capability>}`. Identity continues
to re-export runtime `IdentityPort`, `PolicyPort`, and `Principal`.
The native operator-only mailbox tooling remains synchronous:
`readLocalMail(dataDir: string): {id: string; recipient: string; subject: string;
body: string; status: string; created_at: string}[]`.

The governance input types remain:

```ts
type NotificationInput = {
  readonly userId: Id; readonly kind: string; readonly resourceId: Id;
  readonly projectId?: Id; readonly dedupeKey: string;
  readonly mail: { readonly subject: string; readonly body: string; readonly digestAt?: string };
};
type BillingTransition =
  Pick<BillingAccount, "planId" | "period" | "seats" | "status" | "renewsAt"> &
  { readonly organizationId: Id; readonly expectedVersion: number;
    readonly provider?: BillingAccount["provider"] };
type ManagedLifecycleCommand = {
  readonly organizationId: Id; readonly userId: Id; readonly expectedVersion: number;
} & (
  { readonly action: "lapse" | "recover" } |
  { readonly action: "advance"; readonly transferTo: Id;
    readonly lapseDays?: number; readonly deletionDays?: number }
);
```

## Transaction and behavior receipts

Actual SQL, callbacks, store helpers, notifications and every session/privacy
event now await the supplied executor. Password hashing/verification and avatar
uploads remain outside SQL. The identity store's writers require `Transaction`;
its readers accept an explicitly supplied `SqlExecutor`. Persisted rate buckets
use an atomic upsert/returning statement in their own transaction, with budget
rejection after commit so failed attempts remain counted.

All account-domain mutations and trusted producer helpers use the same
transaction-held `quire:accounts` business lock. This is intentionally coarse,
portable exclusion, not process-local coordination. It protects receipt lookup
and insert, email claims, token use, operator/admin counts, membership allocation,
and billing capacity decisions. Helpers accept a transaction-typed context;
they do not recover a captured root executor or open nested transactions.
Events are recorded with `record(tx,event)` and dispatch follows commit.

Concurrent tests cover token/idempotency/operator/admin decisions and retain
the existing real seat-allocation race. They also found a genuine managed
lapse omission: concurrent lapses previously suspended both remaining
operators. That path now checks the last-operator invariant under the same
lock. Native failure-before and passing-after evidence is retained.

Explicit `lower(...)` predicates preserve case-insensitive primary/secondary
addresses across both dialects, including mixed-case pending-token invalidation
and private mailbox cleanup. SQLite JSON extraction and PostgreSQL JSONB
extraction are authored alternatives, not runtime SQL regex rewriting.
Portable `ON CONFLICT DO NOTHING`, explicit nullable text casts and escaped
case-insensitive search replace native-only statements. Public counters,
CSRF/origin checks, preferences, policies, audit redaction, privacy, local
mail status, session events and HTTP DTOs retain their accepted behavior.

## Migrations and dependencies

Explicit PostgreSQL variants are authored inline for `010-a-identity-local`
and `011-a-governance-local`; original SQLite SQL remains unchanged.
The governance PostgreSQL variant includes the deferred-private-content
tombstone trigger as a PL/pgSQL trigger function. Identity's PostgreSQL variant
adds unique `lower(primary_email)` and `lower(email)` indexes to preserve the
native NOCASE uniqueness guarantee.

F owns the foundation PostgreSQL variants listed in `p1s-contract.md`.
Real PostgreSQL cross-service acceptance follows integration. K consumers must
await the exports above and use transaction-bound contexts; no synchronous shim
or sibling edits are supplied here.

The exact retained native blocker is `services/core/base/store.ts:22` calling
`.query(sql).all(...)` during source recovery at `source.ts:125`. It prevents
the core-composed membership/project-isolation test from reaching its assertions.
The test remains enabled. The test-inclusive strict compiler still reports
unconverted sibling imports, including core and overview; final counts are zero owned
diagnostics and 538 total dependency diagnostics.

F's `apps/server/src/composition.ts` application `close()` currently invokes
`runtime.close()` without awaiting it. The owned identity composition fixture
explicitly awaits that runtime as well, so owned checks clean their resources.
F must finish the production lifecycle migration. `IdentityPort`/`PolicyPort`
remain root-oriented async service ports: transaction consumers must not invoke
their root-backed SQL methods inside another SQL callback. No undocumented
transaction-aware port overload was invented.

## Verification

- Full native command `bun test tests/accounts`: **96 pass, 1 retained sibling
  startup failure, 343 expectations, 97 tests, 38.83 seconds**, exit 1.
- After strict row-type corrections, affected native files: **17 pass, 0 fail,
  63 expectations, 7.44 seconds**, exit 0.
- Strict owned production TypeScript: exit 0. Strict owned source/test report:
  zero owned diagnostics, exit 2 solely for the temporary sibling graph.
- Owned type-aware lint with `--deny-warnings`: exit 0. Production LSP: zero
  diagnostics across 21 files. Owned `git diff --check`: exit 0.
- Original SQLite digests and every accepted-baseline user/migration receipt
  survive reopening through the converted modules.

Exact commands, terminal outputs, intermediate failures and cleanup receipts
are under `docs/evidence/p1s-accounts/`; start with `verification.md`.
That directory is ignored by the existing repository rules and needs explicit
inclusion by the integration owner when commits are authorized.

All owned check monitors terminated. Unique fixture roots and loopback
listeners were closed/removed, including the identified first-run failed
legacy fixture. No container, persistent worker, commit or push was created.
