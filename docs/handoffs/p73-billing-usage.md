# P73 billing usage

Implementation is integrated. The lead imported and spread
`billingUsageEndpoints` from `packages/contracts/src/routes-billing-usage.ts`
in the lead-owned registry. Registration lives in AI routes.

Organization billing only is the elected scope. Actor daily receipts are
independent of the selected organization billing account. Project limits require
explicit authorized project selection. Purchase does not reset daily receipts.
Reference prices, speed multipliers and aggregate budgets are not copied.

## Behavior and scope

`services/adapters/ai/billing-usage.ts` reads the current server UTC day from
`ai_usage`; dispatched and reserved receipts count, refunded receipts do not.
The next UTC midnight is explicit. The browser schedules a refresh relative to
the server observation timestamp, so a client clock mismatch cannot create a
refresh loop.

The selected organization remains exclusively the merchant/account lifecycle
scope. Usage project selection is independent and authorized against its default
branch. Without a selected project the allowance is explicitly unknown.
AI limits come from the same admission authorization as Ask requests, including
configuration, consent, confidentiality and current intersected policy. Null
AI policy uses admission's existing 50 fallback, not an invented unlimited tier.
An unavailable AI scope shows its denial and no numeric allowance.

Writable collaborator limits come from owner benefits with project ceilings;
assigned and effective counts exclude owner/viewer rows. Null writable capacity
is explicitly Unlimited; zero remains zero. Compile seconds are the invoking
actor's project policy allowance per job, with the worker/execution cap caveat.
No daily compile budget, organization-wide collaborator aggregate or speed
multiplier is asserted.

The original D05 source Usage section was inspected. Its three information
dimensions are retained as actual scoped observations. Decorative percentages,
example prices, plan upgrades and speed claims are omitted because they are not
native receipt or policy facts.

## Evidence

Actual composed application, SQLite/Git storage, configured local AI HTTP
protocol provider, authenticated Chromium and native API run admission generated
one dispatched receipt. The billing UI displayed **1 of 7**, Unlimited writable
capacity and its 180-second actor/project compile policy. Reload preserved the
receipt. A current-policy change followed by Refresh usage displayed **1 of 0**
and writable capacity **0**.

Inspected `docs/evidence/p73-billing-usage/usage-1440.png` and `usage-390.png`:
both show the settled real billing screen, readable usage and organization
subscription sections, no blank/overlapping output and no horizontal overflow.
Mobile uses the existing stacked settings navigation.

The backend regression covers actual nonzero generation, route schema equality,
reserved/refunded ledger rows, unauthorized-project 404, no-selection unknown
scope, zero and unlimited ceilings, restart persistence, one millisecond before
and exactly at UTC midnight, and AI-off allowance unavailable.

Commands:

```
./node_modules/.bin/bun test --timeout 120000 ./tests/adapters/ai/billing-usage.test.ts
./node_modules/.bin/bun test --timeout 180000 ./tests/ui-product/account/billing-usage.test.ts ./tests/ui-product/account/checkout
./node_modules/.bin/tsc -p tests/ui-product/account/billing-usage.tsconfig.json --noEmit
```

The first attempts correctly exposed a missing registry integration, a test
expecting 403 instead of the established privacy-preserving 404, and a branded
Instant return type mismatch. All were corrected; they are not current product
acceptance findings. Final command outcomes are recorded below.

Live merchant acceptance remains separate. The configured checkout suite uses
the owned Stripe protocol and hosted TLS fixtures; it does not establish a real
merchant payment, live webhook delivery or purchased entitlement.

Fixtures own unique temporary data directories and ephemeral ports and dispose
their browsers, web/API servers, adapters and data roots. No user service,
credentials, data, or port 5173 is changed. No commits were created.

## Final outcomes

- Daily receipt regression: **1 pass, 0 fail, 15 assertions**, exit 0.
- Actual browser plus existing checkout suite: **9 pass, 0 fail, 96 assertions**,
  exit 0. Includes real hosted TLS navigation and unchanged unconfirmed billing,
  existing subscription update, expired/stale/session denials, unsafe destination
  rejection, and unconfigured billing.
- Scoped `tsc -p tests/ui-product/account/billing-usage.tsconfig.json --noEmit`:
  exit 0.
- Scoped type-aware oxlint on both billing components, backend read/route,
  dedicated contract and both new tests: exit 0, no diagnostics.
- `git diff --check`: exit 0.
- Composed browser fixture cleanup logged its owned temporary root removed.

The earlier integrated typecheck reported the now-corrected branded Instant
mismatch. The final scoped check includes the actual application/backend/test
imports and is clean; a new whole-repository typecheck was not repeated because
other tracks continue changing the shared tree.
