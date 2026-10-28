# Configured Stripe merchant billing

The default remains manual/unbilled with an empty catalog. No prices, customer
charges, or subscriptions are seeded. This implementation uses Stripe's REST
API, pinned to `2025-06-30.basil`, through the shared bounded, DNS-pinned
`SafeHttpClient`. No Stripe executable or SDK dependency is required.

## Assembly

```ts
import { createBillingModules, stripeBillingContribution } from "./services/adapters/billing";
import { createAdapterModules } from "./services/adapters/shared";

const adapters = createAdapterModules({
  contributions: [stripeBillingContribution /* other actual contributions */],
});
const billing = createBillingModules();
// Include existing identity, governance, and the common operation-status module.
// Include adapters.connections, adapters.providers, billing.merchant, billing.portal.
// Close adapters before runtime.close(); billing starts no scheduler or resources.
```

`billing.merchant` is A-lane module `067-x-billing` (order 67); it registers only
previously unregistered preview/checkout/cancel/invoice-download/webhook routes.
`billing.portal` is X-lane module `068-x-billing-portal` (order 68).
The existing governance catalog/details registrations remain single registrations;
per-runtime hooks supply their configured behavior. Fresh factories are required
on runtime reopen. The parent owns server composition; this lane does not edit it.

## Operator configuration

Use an authenticated operator session, current CSRF token, and same-origin
request to `PUT /api/admin/providers/stripe-billing`:

```json
{
  "baseUrl": "https://api.stripe.com",
  "expectedVersion": 0,
  "secret": "{\"apiKey\":\"sk_test_REPLACE\",\"webhookSecrets\":[\"whsec_REPLACE\"],\"prices\":[{\"id\":\"price_REPLACE\",\"name\":\"Your merchant plan\"}],\"portalConfiguration\":\"bpc_REPLACE\"}",
  "policy": {
    "compileSeconds": 180, "writableMembers": null, "historyDays": null,
    "trackChanges": true, "chat": true, "ai": "off", "aiDailyUses": 50,
    "sharing": "named", "anonymousRead": false, "anonymousEdit": false
  }
}
```

Send `If-Match: "0"` for initial configuration, or the actual current version
on later updates. The full `secret` is encrypted by the existing runtime
`QUIRE_SECRET_KEY` envelope, never returned by configuration reads. Keep that
key with backups. Each webhook secret is a real endpoint signing secret, not
the Stripe API key; two secrets permit overlapping rotation. Missing/invalid
secret fields produce explicit configuration errors. Provider readiness means
configuration is present; `POST /api/admin/providers/stripe-billing/test`
with `{ "expectedVersion": N }` performs the real read-only `/v1/account` probe.

Create fixed, per-unit, licensed recurring Stripe prices with interval
`month` or `year`, interval count 1, integer minor-unit amounts, and no quantity
transform. Catalog amounts/currencies come from actual retrieved prices.
Tiered, metered, mixed-item, multi-interval subscriptions are rejected, not
silently flattened into seat prices. Use a dedicated merchant account and
Quire-created customers. Changing to an unrelated Stripe account does not
transfer existing provider objects; migrate/reconcile these explicitly.

Create an active Stripe Billing Portal configuration and supply its `bpc_` ID.
Enable payment-method and legal billing/tax detail management there. Price/seat
changes should go through Quire previews and checkout so the local occupancy
check runs; do not enable unrestricted subscription quantity edits in the
portal. Already-authorized external dashboard changes still reconcile through
the same seat guard.

## Customer operations

All organization billing mutations and invoice downloads require current Admin
authority (or current operator authority) and authentication less than 15 minutes
old. Mutations additionally require existing origin/CSRF validation.

- `GET /api/billing/catalog`: public catalog; unconfigured returns no plans.
- `POST /api/organizations/:o/billing/preview`: `{ planId, seats, period,
  expectedVersion }`, with `Idempotency-Key`. Retrieves Stripe's invoice preview
  and stores a ten-minute actor/org/version/config-bound quote. Initial customer
  creation is idempotent and is not a purchase.
- `POST .../billing/checkout`: `{ quoteId, expectedVersion }`, with
  `Idempotency-Key`. For a new subscription, returns an operation containing
  the actual hosted Checkout URL; the user must open and explicitly complete it.
  For an existing subscription, explicit quote confirmation updates the item,
  preserves the preview's proration timestamp, uses `always_invoice` and
  `pending_if_incomplete`. A quote is a provider invoice estimate; final hosted
  Checkout shows the payable amount before payment. Provider-side tax, credit,
  discount, or currency changes can alter an estimate.
- `POST .../billing/portal`: `{ expectedVersion }`, with `Idempotency-Key`;
  returns the actual payment-method/customer portal URL.
- `PATCH .../billing/details`: existing local contract `{ invoiceEmail, taxId,
  address, expectedVersion }`. Configured customers are updated outside SQL,
  then details/audit/operation receipt commit under the current authority fence.
  Address is the supplied address line (max 200 characters). The existing
  untyped tax ID is an invoice display field (max 140 characters), **not**
  a claimed legal Stripe tax-id registration or exemption. Use the portal for
  typed legal tax IDs and complete structured addresses.
- `POST .../billing/cancel`: `{ atPeriodEnd, expectedVersion }`, with
  `Idempotency-Key`; schedules nonrenewal or cancels immediately at Stripe.
  Local subscription status changes only after verified reconciliation.
- `GET .../billing/invoices` and `GET .../billing/invoices/:id/download`:
  persisted provider invoices and exact provider PDF bytes. No document means
  `BILLING_DOCUMENT_MISSING`, not a fabricated invoice.

Seat assignment counts come from real current licensed organization members.
Capacity below occupancy is rejected during preview, confirmation, and
transactional reconciliation. A rejected webhook has no receipt and can be
retried once seats are unassigned; local capacity is never silently truncated.
Ordinary project policy is not changed into a commercial feature gate.

## Verified webhook endpoint

Register snapshot events in Stripe Workbench with API version
`2025-06-30.basil` at:

```text
https://YOUR_QUIRE_ORIGIN/api/webhooks/billing/stripe
```

Select:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.finalized
invoice.paid
invoice.payment_failed
invoice.voided
invoice.marked_uncollectible
```

Use the signing secret for this exact endpoint. HTTPS/public reachability and
the Stripe merchant account are external prerequisites. The normal JSON parser
is bypassed with a transport handler: HMAC-SHA256 verification uses the exact
raw bytes and `Stripe-Signature`, constant-time comparison, a five-minute
timestamp tolerance, and a one-MiB request bound. Delivery timestamp, not event
creation time, controls replay tolerance. Clock synchronization is required.

Event snapshots are not ordered. After acquiring a durable organization claim,
the adapter retrieves the current Stripe subscription/invoice. SQL publication
rechecks claim generation/expiry, configuration version, customer/org binding,
and seat capacity. A resumed expired writer cannot publish over a newer claim.
Projection, subscription/invoice rows, raw-body receipt digest, audit, blob
references and policy events commit atomically. Duplicate event IDs return
success only for identical verified bytes. Old/equal-time snapshots cannot
replace current state because their contents do not drive billing transitions.
Unknown correctly signed event types are acknowledged with a receipt only.

## Failure and recovery

Provider I/O never runs inside a SQL transaction. Merchant operation intent
persists before dispatch. Same-key retries return the stored operation and
different input conflicts. An uncertain external completion remains `running`
and is not automatically reissued (Stripe's idempotency retention is finite).
The common operations table contains only sanitized status/org metadata; URLs,
customer fields and full results remain in fresh-admin billing receipts.

An unknown pending Checkout reservation blocks another purchase, even under a
different request key. A known Checkout session blocks another until its actual
expiry. A verified completed-session webhook binds the real subscription.
For a network failure/crash with a `pending:` reservation, an operator must
inspect Stripe using the retained `quire-<operation UUID>` idempotency key and
reconcile the real session before clearing the reservation. Do not blindly
retry or infer payment success from an API timeout. Existing-subscription
changes and cancellations likewise rely on signed authoritative webhooks;
matching signed state completes their uncertain operation receipts atomically.
There is no automatic background purchase retry.

## Verification

```sh
bun test tests/adapters/billing tests/accounts/governance/billing.test.ts
./node_modules/.bin/tsc -p tests/adapters/billing/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/billing tests/adapters/billing services/accounts/governance/billing.ts
```

Local protocol fixtures exercise real HTTP requests, encrypted configuration,
native SQL transactions, provider authentication/form payloads/idempotency,
signed raw webhooks and actual invoice-byte transport. They are not evidence
of a real Stripe sandbox or live payment. No external credentials or payment
authorization were supplied for this task.
