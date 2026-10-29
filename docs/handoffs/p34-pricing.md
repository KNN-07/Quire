# P34 pricing comparison and billing continuation

Date: October 28, 2026. Owner: `st_01a1823f`. Status: FINAL.

## Result

Pricing now preserves all six source comparison groups and all 23 feature
rows: Writing & compile, Collaboration, Git & integrations, AI assistant,
Groups & security, and Support. Local capabilities are qualified by
installation, provider and access policy. Operator plan entitlements are
explicitly unspecified because the real catalog publishes no such metadata.
No sample price, trial, discount, seat cap, retention promise or AI allowance
was promoted into a commercial claim.

Configured monthly and annual cards carry their actual catalog ID and
period into `/settings/billing?plan=...&period=...`. Existing authenticated
users continue directly; unauthenticated users use the existing same-origin
sign-in `returnTo`. Billing validates both values against its freshly read
catalog. Unknown, missing, mismatched-period and unconfigured selections
show an unavailable-state message and do not silently choose another plan.
The user can explicitly choose a currently published alternative.

The selected plan populates the native organization billing form. Preview
uses the chosen plan's actual period, current billing version and explicit
seat count. Changing the form clears an existing quote. Checkout remains a
separate explicit action and keeps the accepted P6 `checkoutDestination`
validator and webhook reconciliation semantics unchanged.

## Verification

Project-local Bun 1.4.4:

```sh
QUIRE_TEST_CHROMIUM=/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  ./node_modules/.bin/bun test tests/ui-product/marketing/pricing
./node_modules/.bin/tsc --noEmit -p tests/ui-product/marketing/pricing/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  apps/web/src/features/marketing/pricing.tsx \
  apps/web/src/features/marketing/pricing-selection.ts \
  apps/web/src/features/marketing/pricing-comparison.ts \
  apps/web/src/features/account/billing.tsx \
  tests/ui-product/marketing/pricing
./node_modules/.bin/bun test tests/ui-product/account/checkout/navigation.test.ts
```

The full pricing target passes in one run: **3 pass, 0 fail, 64 assertions,
65.28 seconds, exit 0**. Strict type-aware deny-warning lint exits 0.
The unchanged accepted destination tests pass: **2 pass, 0 fail,
19 assertions, exit 0**. Scoped `git diff --check` exits 0.

**Superseded static finding:** the first scoped strict tsc passed with exit 0.
The original final run exited 2 solely on a concurrently added onboarding producer:
`services/accounts/identity/onboarding.ts:44:34`, TS2322, `unknown` is not
assignable to the typed onboarding draft. That original failed output remains
unchanged in `acceptance.log`. After the onboarding producer used
`OnboardingChoicesSchema.parse(body.choices)`, the parent reran only
`tsc --noEmit -p tests/ui-product/marketing/pricing/tsconfig.json`.
The separate `parent-types.log` receipt records **P34_PRICING_TSC_EXIT=0**,
the onboarding source hash and the unchanged scoped config hash.
Parent monitor `mon_4VM7KQSCYZWVFK5D` / `bash_399` completed with exit 0.
This receipt supersedes the type exception; pricing/browser tests were not
rerun and no P34 production source was changed for this correction.

The native mounted browser proof uses the real seeded application, actual
session/CSRF, encrypted operator merchant configuration, actual catalog,
organization billing/preview/checkout services, the canonical local Stripe
protocol fixture and an owned HTTPS hosted landing. No successful
application API response is mocked and no browser response is fulfilled.
All browser egress is loopback-only; no vendor request or real charge occurs.

| Case | Observed result |
| --- | --- |
| Configured catalog | Annual default renders the actual annual amount; monthly switch renders the actual monthly plan. Both cards populate their exact native billing selection. |
| Source comparison | All six groups and 23 rows render without fabricated commercial terms. |
| Native annual preview | `price_year`, `period: "year"`, two seats; actual quote is 30000 USD minor units. |
| Before explicit checkout | No hosted landing or provider checkout-session dispatch occurs on navigation or preview. |
| Explicit Request checkout | Actual API returns HTTP 202; original quote ID and billing version are sent. Chromium reaches `https://127.0.0.1:35723/checkout/cs_fixture?session=opaque-fixture`, recorded by the real owned TLS listener. |
| Payment authority | Persisted billing remains identical: unbilled, no plan, zero seats, version 0. Navigation is not payment success. |
| Unavailable selections | Unknown plan and annual-ID/month-period mismatch leave the plan control blank, with no quote or checkout control. Pure tests also cover missing ID/period and removed/unconfigured catalog. |
| Unauthorized organization | The real server rejects another organization's preview with HTTP 403 `FORBIDDEN`; existing authorization is unchanged. |
| Auth return | After clearing cookies, choosing the annual plan goes through actual password sign-in and returns to the exact annual billing selection. |
| Unconfigured catalog | All comparison groups remain; no paid continuation, preview, checkout or merchant dispatch is offered. |

The existing P6 full checkout suite was not replayed. Its unchanged accepted
quote expiry, stale-version, session revocation, unsafe destination,
subscription-update and signed-webhook boundaries remain documented in
`docs/handoffs/p6-checkout-ui.md`.

## Evidence and cleanup

Packet: `docs/evidence/p34-pricing/`.

- `acceptance.log`: complete final native and static output with raw exit
  markers. SHA-256:
  `c90477f6d99b1a6f79fe630f27d203c0bd643bf7e4ad244543243a8488621e57`.
- `static.log`: the earlier scoped tsc/lint exits 0.
- `parent-types.log`: independent parent strict typecheck exit 0 after the
  onboarding producer correction; supersedes the historical type exception
  in `acceptance.log` without replacing that original failed log.
- `source-provenance.md`: source hashes, immutable design source, catalog
  contract, accepted checkout reuse and exact auth seam.
- `cleanup.json`: independent connection-refusal checks for all ten final
  fixture listeners and absence of both owned data directories.
- Retained initial import/config and Chromium post-navigation response-body
  observation failures. The final test observes the actual HTTP status,
  exact quote request and actual hosted navigation/receipt instead of
  rereading a body Chromium has discarded. No sleeps or timing retries.
- Four `configured-{1440,390}-{light,dark}.png`, four matching
  `unconfigured-*`, four `selected-billing-*`, plus unavailable-selection
  and unconfigured-billing captures. All 14 captures have
  `scrollWidth <= innerWidth`. All desktop/mobile light/dark comparison
  and changed billing combinations were visually inspected; none is blank,
  overlapping or horizontally overflowing.

Final configured resources were removed from
`/tmp/quire-ui-integrations-3b4Qc6`; closed ports:
`36077`, `37369`, `37837`, `41017`, `35723`.
Unconfigured resources were removed from
`/tmp/quire-ui-integrations-kfqVwQ`; closed ports:
`43849`, `39443`, `35479`, `37085`, `42269`.
All owned log monitors were stopped. Browsers, contexts, adapter runtimes,
Vite/API, merchant bridge, canonical provider and hosted TLS listeners are
disposed by the unchanged fixture's async resource stack.

## Boundaries and integration seam

Personal subscriptions, live vendor payments and per-plan entitlements
remain explicitly unimplemented/unpublished boundaries, not deferred P34
implementations. Provider webhook reconciliation remains payment authority.
No backend, contracts, auth, onboarding, settings shell, global matrix,
original input or source/editor/installation file was edited. No commit
was created.

New-account registration continuation belongs to the onboarding lane.
At inspection, `auth.tsx` SignUp's create/verify/StartingPoint destinations
drop `returnTo`; that exact seam was reported before any out-of-scope edit.
Preserving a pricing selection across **new** registration requires that
lane to carry an already validated same-origin return path through its
existing registration, verification and start steps. Existing-account
sign-in continuation is implemented and natively proved here.
Independent signup-return and import work remains pending in the onboarding
lane; the clean typecheck receipt does not establish those behaviors.
The destination contract is exactly
`/settings/billing?plan=<catalog-plan-id>&period=<month|year>`.
A newly authenticated user without an organization may retain that intent
while seeing the honest unavailable organization-billing state. That state
is distinct from this lane's eligible-organization quote/explicit-checkout
proof and must remain distinct in the combined verifier.
