# MERCHANT BILLING

## OVERVIEW
Stripe merchant configuration, checkout and reconciled receipts; score 8, distinct paid operation domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Assembly | `index.ts` | `stripeBillingContribution`, `createBillingModules` |
| Merchant boundary | `contracts.ts` | `Merchant` and secret schema |
| Quotes | `quotes.ts` | Preview and checkout |
| Operation authority | `store.ts` | Binding, intent and publication |
| Provider callbacks | `webhooks.ts` | Signature and receipt verification |
| Reconciliation | `reconcile.ts` | Subscription reconciliation |
| Receipt reconciliation | `receipt-reconciliation.ts` | Receipt lifecycle |
| Account details | `details.ts` | Billing detail routes |
| Schema | `migrations.ts` | Billing state |
| Setup | `README.md` | Merchant prerequisites |

## CONVENTIONS
- Install the billing catalog through account governance.
- Default deployments remain manual and unbilled with an empty catalog.
- Merchant calls use the bounded shared HTTP client.
- The implementation uses Stripe REST without a Stripe SDK.
- Configuration parses the encrypted merchant JSON document.
- Preview and checkout require authenticated mutation verification.
- Provider account probes perform an actual `/v1/account` request.
- Verify this domain with `bun test tests/adapters/billing`.

## ANTI-PATTERNS
- Do not enable unrestricted portal subscription quantity changes.
- Seat changes must preserve Quire occupancy checks.
- Do not treat plan labels or prices as project benefit authority.
- Do not report configured merchant settings as proven interoperability.
- Never return the merchant secret document to the browser.
- Do not silently truncate membership when purchased capacity decreases.
