# P2X configured merchant billing

Owner: `st_01a17c79`. October 27, 2026.

**Status: COMPLETE within the assigned billing boundary.** Working configurable
Stripe REST implementation, direct protocol fixtures, governance compatibility,
negative cases, terminal evidence and owned cleanup are delivered. This accepts
the A52b/D05 backend adapter portion and T19 billing fixture behavior, not a
browser-screen acceptance or a live Stripe transaction. Parent composition
remains the integration owner's responsibility.

## Exact assembly contract and exports

Public entrypoint: `services/adapters/billing/index.ts`.

```ts
export const stripeBillingContribution: AdapterContribution;
export function createBillingModules(options?: {
  readonly http?: SafeHttpClient;
}): {
  readonly merchant: ServiceModule;
  readonly portal: ServiceModule;
};
export const migrations: readonly Migration[];
```

Add `stripeBillingContribution` to the existing single
`createAdapterModules({ contributions })` factory; do not construct another
shared adapter registry. Add `createBillingModules().merchant` and `.portal`
to the parent-owned runtime modules, alongside existing identity/governance,
shared adapter/provider administration and common operation-status modules.

- Merchant: `067-x-billing`, **lane A**, order 67, migration `067-x-billing`.
- Portal: `068-x-billing-portal`, **lane X**, order 68.
- Merchant provider configuration kind: `stripe-billing`.
- Provider webhook URL suffix: `/api/webhooks/billing/stripe`.

**Concrete foundation contract delta: none.** Existing async SQL,
`UnitOfWork.run`, supplied transaction executors, `registerTransport`, encrypted
provider configurations, blob references and event ports suffice. The required
parent delta is composition only: one contribution and two modules. No missing
port was hidden behind a cast or optional compatibility shim.

Owned `services/accounts/governance/billing.ts` additionally exports:

```ts
installBillingCatalog(context: ModuleContext, catalog: BillingCatalogHook): void;
installBillingDetails(context: ModuleContext, hook: BillingDetailsHook): void;
updateBillingDetails(context: TransactionContext,
  input: BillingDetailsInput, principal: Principal): Promise<BillingAccount>;
```

`BillingCatalogHook`, `BillingDetailsHook`, and `BillingDetailsInput` are exported
types from that file. Their factories are per-runtime WeakMap entries keyed by
the actual service registry; reopened runtimes get fresh registrations. Existing
`billingAccount`, `ensureBillingAccount`, `recordBillingTransition`,
`applyBillingTransition`, and `fresh` remain in use. Existing public catalog,
account, details and invoice-list endpoints are not double-registered.

Drain admitted HTTP handlers before closing shared adapters and runtime. Billing
starts no background scheduler or process and owns no persistent factory
resource. In-flight HTTP calls are bounded by the shared HTTP deadline; do not
close SQL beneath admitted requests.

## Observable flows and authority

The configured catalog retrieves real merchant Price amounts/currencies and
supports fixed per-unit licensed monthly/yearly prices. Unsupported price
contracts fail explicitly. Without configuration, the public catalog stays
`{ configured: false, plans: [] }` and governance stays manual/unbilled.
No price or paid subscription is invented.

Preview calls Stripe's invoice-preview API and persists an actor/org/billing
version/config-version-bound ten-minute quote. Initial customer creation is
idempotent and does not purchase anything. Checkout creates a real hosted
subscription Checkout URL for a new subscription; the customer must explicitly
open and complete it. Existing subscription confirmation applies the selected
price/seats using the preview's proration timestamp, `always_invoice`, and
`pending_if_incomplete`. Plan and period must agree. Provider API success alone
never activates local paid state.

Payment-method changes use the actual configured Billing Portal. Cancellation
supports immediate and period-end requests; authoritative signed reconciliation
drives local state. Invoice events retrieve actual provider invoice records and
PDF bytes; the exact bounded bytes are content-addressed and registered with
the runtime blob inventory before transactional references. Organization-scoped
invoice download returns those bytes, not a generated placeholder.

Configured invoice details synchronize customer email, address line and invoice
tax display outside SQL, then commit local details, receipt, audit and event
under current authority. The existing untyped `taxId` is an invoice display
field, not a claim of typed legal tax registration; use the hosted portal for
legal tax IDs and full structured addresses. Merchant display limits are
explicit errors (140 tax characters, 200 address characters).

Every organization billing operation requires current Admin/operator authority,
fresh authentication, and existing mutation origin/CSRF checks. Publication
rechecks live session/account/operator/membership state with the supplied SQL
transaction executor. Quote ownership, version/config changes, occupied seats
and expired quotes are denied. Existing licensed-membership counts are used;
neither failed billing nor cancellation destroys project data or invents a
commercial gate.

## Signed reconciliation and durable ordering

The raw transport bypasses the normal JSON parser, preserving exact signed
bytes. It verifies HMAC-SHA256 `Stripe-Signature` in constant time, permits two
configured signing secrets during rotation, enforces a five-minute delivery
timestamp tolerance and bounds the raw body to one MiB. Duplicate event IDs are
accepted only for identical freshly verified bytes; changed payloads conflict.

Stripe event snapshots are not treated as ordered revisions. A durable SQL
claim/generation serializes organization preparation outside transactions.
After that admission, reconciliation retrieves the current provider
subscription/invoice. Publication rechecks the claim/expiry/generation,
configuration and customer/org/subscription binding. An expired writer cannot
publish after takeover. Old and equal-time event snapshots cannot roll back
capacity because their snapshot values never drive billing transitions.

`recordBillingTransition` runs with null actor only for verified provider work
inside the receipt transaction. Seat guards, billing/subscription/invoice
projection, audit, digest receipt and event outbox are atomic. Unchanged
projection does not advance the billing counter. Invalid capacity rolls back
the receipt, allowing a corrected delivery to reconcile later.

Merchant intent is durable before dispatch. Same-key retries return the saved
operation; changed input conflicts. Uncertain external completion remains
running and is never automatically redispatched. A pending Checkout reservation
blocks a different-key repeated purchase. Matching signed current state completes
uncertain checkout/cancel receipts atomically. Common operation rows contain
sanitized status/org metadata, while hosted URLs and customer results remain
behind the fresh-admin billing routes.

## Migrations and preservation

New migration `067-x-billing` adds:

```text
billing_merchant_bindings
billing_merchant_quotes
billing_merchant_receipts
billing_merchant_documents
```

The migration exports explicit SQLite STRICT and PostgreSQL TEXT/INTEGER
variants. Exact authored SHA-256:

- SQLite: `41e842affd86b64bc4e1d31a3edee055bc900012880a1b0eb2358fcd4a8fbeb2`
- PostgreSQL: `dd4db40faa7bfc8581620773fda3420a7c3f03d92b8a2c76cf0d985324f0a11f`

Original SQLite SQL was not edited. The five original foundation migration
files compare byte-identical to accepted commit `3fe3a23` (exit 0), and native
reopen preserves every applied migration ID/digest/timestamp. The new PostgreSQL
variant has **not** been executed against a live PostgreSQL service here;
accepted P1S verification is not relabeled as verification of this new migration.

## Exact terminal checks and evidence

Native runtime: **Bun 1.3.14** (`0d9b296a`).

| Command / check | Terminal result | Evidence |
| --- | --- | --- |
| `bun test tests/adapters/billing tests/accounts/governance/billing.test.ts` | Exit 0; 26 pass, 0 fail, 90 assertions, 4 files, 28.09 s | `docs/evidence/p2x-billing/native-final.log` |
| `./node_modules/.bin/tsc -p tests/adapters/billing/tsconfig.json` | Exit 0 | `static-final.log` |
| `./node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/billing tests/adapters/billing services/accounts/governance/billing.ts` | Exit 0; no warnings | `static-final.log` |
| LSP diagnostics on owned production/tests and governance billing | Zero diagnostics | `static-final.log` |
| Pure-LOC and exact migration hashes/original-SQL comparison | Exit 0; largest owned source 164 pure LOC | `migrations.log` |
| Owned process/root cleanup after terminal checks | Exit 0; no matching processes or billing temp roots | `cleanup-final.log` |

Paths without a full prefix in the table are under
`docs/evidence/p2x-billing/`. Earlier honest failed checkpoints and their fixes
are in `history.md`. Expected negative-path logs contain request IDs/codes only.
No failing test was skipped, deleted, weakened or suppressed.

The stateful HTTP fixture validates bearer credentials, pinned API version,
actual form contracts, price/period/item/proration fields, customer binding,
provider idempotency and error paths. It can create a session and lose the
response, then reconcile its signed completion without redispatch. Tests drive
actual ephemeral application/provider HTTP listeners, native persistence and
encrypted configuration. They cover duplicate/reordered events, stale writer
takeover, role revocation during outside-SQL preparation, seats-in-use rollback,
signature forgery/expiry/body replacement, quote ownership/config/expiry,
portal, both cancellation modes, exact provider PDF bytes and native reopen.
Barriers are subscribed before triggers and have bounded failure timeouts;
there are no fixed test sleeps.

Architectural review: each file owns one merchant protocol/registration,
quote, serialization, detail synchronization, projection or receipt concern.
All changed source files are below 200 pure LOC. External/SQL values are parsed
at boundaries, subscription status mapping is exhaustive, no type escape hatch,
redundant proven-value defense, negative-form flag or suppression was added.
Registration functions are module boundaries; shared helpers serve the multiple
billing workflows. Existing logging practice is retained; API keys and signing
secrets never enter receipts/results/logs.

## External prerequisites and remaining integration

Exact setup and recovery instructions are in
`services/adapters/billing/README.md`. Supply an actual merchant API key,
one/two endpoint signing secrets, operator-owned recurring Price IDs and an
active Billing Portal configuration ID using the existing operator provider
PUT route. Its secret JSON is encrypted under the runtime secret key. Configure
the real HTTPS Stripe endpoint, accessible HTTPS webhook and synchronized clock.
No SDK/CLI tool is required. Snapshot event selection and API version are
documented precisely in the README.

No merchant credentials were supplied; no real Stripe sandbox/live call,
purchase or paid external write was performed or claimed. The fixture's
success is not live third-party evidence. Typed legal tax management and
payment collection occur only in the real configured provider's explicit
customer flow. For an unresolved network/crash reservation, inspect the real
provider using the retained operation/idempotency key and reconcile it before
allowing another purchase; never blindly repeat a potentially paid write.

Parent must wire the contribution/two modules into its owned composition and
perform whole-app/scale/browser acceptance. No shared port implementation is
blocked. U editor files, root configuration/dependency graph and all unrelated
services remain outside this lane's edits.

Official primary sources and consultation date are retained in
`docs/evidence/p2x-billing/sources.md`: invoice preview, Checkout, subscription
updates, raw signed webhooks, Basil item-level periods, and customer updates,
all retrieved from Stripe on October 27, 2026. Context7 was unavailable in this
child; direct official documentation was used. The pinned
`2025-06-30.basil` contract is not a claim of the latest Stripe API version.

Terminal checks ended before this handoff was written. All owned fixture
listeners, runtime/repository handles, barriers and temp roots are closed.
No browser/container/volume was created; unrelated 5173/3001 listeners and shared
Docker images were untouched. No workspace commit/push or nested agent was used.
