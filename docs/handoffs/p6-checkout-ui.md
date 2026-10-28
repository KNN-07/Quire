# P6 account hosted checkout consumer

Owner: `st_01a17e22`. Date: October 27, 2026. Status: FINAL.

## Result

`billing.tsx` no longer discards the actual checkout operation result.
Succeeded new-checkout results follow their server-provided hosted HTTPS
destination with the existing account `location.assign` navigation pattern.
Subscription updates stay on the account page and retain explicit
unconfirmed-payment / awaiting-provider-webhook feedback. Initiating or
returning from checkout never changes the local subscription to paid/active.

Project-local Bun 1.4.4 acceptance: **8 tests, 0 failures, 89 assertions,
61.73 seconds**, exit 0. Scoped strict TypeScript and type-aware oxlint both
exit 0. All resources are closed.

## Owned changes

- `apps/web/src/features/account/billing.tsx`: consume the checkout result,
  navigate only to a validated hosted destination, and retain reconciliation
  feedback for results that await a provider webhook.
- `apps/web/src/features/account/billing-navigation.ts`: parse the real
  result alternatives at the nullable-record contract boundary. Only
  `billing.checkout` / `succeeded` can navigate. New checkout requires
  `checkoutId`, `url`, and `reconciliation: "awaiting_webhook"`; existing
  subscription update uses `subscriptionId` and the same reconciliation
  marker. HTTPS without embedded credentials is required; no provider host
  or personal billing support is invented.
- `tests/ui-product/account/checkout/{navigation.test.ts,browser.test.ts,fixture.ts,tsconfig.json}`:
  focused parser and actual-browser regressions plus scoped strict checking.
- This handoff and `docs/evidence/p6-checkout-ui/`.

No backend, shared contract, root dependency/harness, account integration
producer, parent editor, identity/auth/security/shared account component, or
CSS file was edited. No commits, global installs, external account operations,
or actual payments were made.

## Actual service and browser evidence

The browser loads the production account route through the existing
same-origin application fixture, authenticates with real server sessions and
CSRF, configures encrypted merchant settings through the actual operator API,
and previews/requests checkout through the real billing HTTP endpoints.

The existing canonical Stripe protocol fixture checks authentication,
configured prices, customer creation, invoice preview, checkout fields,
subscription update fields, and webhook signatures. An owned loopback
merchant bridge changes only the hosted checkout destination in the fixture
provider's session response to an actual TLS listener. There is no successful
application-response interception and no static Stripe URL in the consumer.
Browser egress is restricted to loopback. Self-signed TLS acceptance is scoped
to the test browser context; production URL validation is not relaxed.

| Case | Observed result |
| --- | --- |
| New purchase | Real preview returns 3000 USD minor units for two monthly seats. Actual checkout API returns HTTP 202, `checkoutId: "cs_fixture"`, and `https://127.0.0.1:37355/checkout/cs_fixture?session=opaque-fixture`. Chromium performs a real GET to that exact TLS destination. |
| Return without payment | Hosted page explicitly records no payment, then links to the actual provider-request `success_url`. Account is identical before checkout, after landing, and after return: `status: "unbilled"`, `planId: null`, `seats: 0`, `version: 0`. |
| Existing subscription | A signed local provider webhook establishes the existing monthly two-seat subscription. Actual annual three-seat update returns only `{subscriptionId: "sub_fixture", reconciliation: "awaiting_webhook"}`. No navigation/extra landing occurs. The account remains monthly/two seats/version 1 until another webhook; provider proration timestamps match preview and `payment_behavior` remains `pending_if_incomplete`. |
| Expired quote | Fixture setup expires the real persisted quote. Checkout returns HTTP 409 `BILLING_QUOTE_EXPIRED`; actual error remains visible, no navigation, no provider dispatch. |
| Stale account version | A real billing-details PATCH advances the version after preview. Checkout returns HTTP 409 `VERSION_CONFLICT`; actual error remains visible and no provider dispatch occurs. |
| Revoked session | Real logout after preview causes HTTP 401 `UNAUTHENTICATED`; the account page displays the actual denial without navigating or dispatching to the provider. |
| Unsafe provider destination | Actual service returns a succeeded operation containing the fixture's HTTP variant. The consumer refuses navigation, displays an unconfirmed-payment error, leaves account data identical, and reaches no hosted landing. |
| Missing merchant configuration | Actual catalog/configuration state hides preview/checkout controls; account remains unbilled and no provider request occurs. |
| Nullable/non-navigation operation results | Unit coverage confirms null results, running/queued/failed/timeout/canceled operations and unrelated operation kinds cannot navigate. Unsupported result shapes, relative URLs, JavaScript URLs and credential-bearing HTTPS URLs are rejected. |

The checkout request's original `quoteId` and `expectedVersion` are asserted
against the actual preview/account values. Existing quote amount/expiry,
optimistic version and server denial behavior are retained.

The event-driven tests subscribe to HTTP responses and main-frame navigation
before clicking. Rendered-state waits use the shared bounded MutationObserver,
not sleeps or polling. Initial validation caught test-only response rereading
after navigation, an overly exact implicit-select label, and one shadowed
test-local name. Those were corrected; no assertion/test was skipped, weakened
or retried to obtain the passing run.

## Exact checks and evidence

Executed from `/home/norman/Repos/Quire`:

```sh
QUIRE_TEST_CHROMIUM=/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  ./node_modules/.bin/bun test tests/ui-product/account/checkout
./node_modules/.bin/tsc --noEmit -p tests/ui-product/account/checkout/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  apps/web/src/features/account/billing.tsx \
  apps/web/src/features/account/billing-navigation.ts \
  tests/ui-product/account/checkout
git diff --check -- apps/web/src/features/account/billing.tsx
```

All exit 0. LSP diagnostics on the component, helper and checkout test
directory were also clean. Existing unrelated tests were not modified.
Repository-wide tests/build were not run for this scoped consumer change;
the actual Vite account bundle was exercised in Chromium.

Evidence packet: `docs/evidence/p6-checkout-ui/`.

- `acceptance-observed.log`: captured passing-run HTTP/action/operation,
  reconciliation, capture, resource-disposal and final test-output segments.
  SHA-256:
  `249231257f07f21b6ab3a49fd404e325fc074c6afbe1a2edffdbdc8b8e23f371`.
- `static-and-cleanup.log`: exact static commands/exits and post-disposal
  listener/directory checks. SHA-256:
  `5f48488fbd58cb241fb9cbab695f78e49ab902fe210908ac09bd3a2ac1cccd37`.
- `source-provenance.md`: exact before/after source hashes, immutable input
  hashes, design-source provenance, actual service contracts and reuse
  boundaries. Design discovery, billing/settings/reset templates and FINAL
  P3 connections handoff hashes remained identical.
- Visually inspected `quote-{1440,390}.png`,
  `subscription-awaiting-webhook-{1440,390}.png`,
  `hosted-landing-390.png`, `unsafe-destination-1440.png`,
  and `unconfigured-390.png`. Captures also retain returned-unconfirmed,
  expired/version/session denials. All captured widths have
  `document.documentElement.scrollWidth <= innerWidth`.

The existing settings shell, panel, primary action, fields and notice tokens
remain intact. Desktop and mobile feedback is readable without overlap or
horizontal overflow; long account pages retain normal document scrolling.
The hosted landing is deliberately plain fixture content, not a provider UI
replica.

## Exact owned cleanup

Async disposal closed browser contexts/browsers, adapter lifecycle/runtime,
same-origin API and Vite listeners/processes, merchant bridge, canonical
provider listener and hosted TLS listener. Tests record browser disconnected,
no page errors, and all three data directories absent. Independent TCP probes
confirmed all 15 owned listeners below refused connections afterward.

| Fixture | Removed data directory | Closed ports: web, API, merchant bridge, provider, hosted TLS |
| --- | --- | --- |
| Main checkout/update/denials | `/tmp/quire-ui-integrations-CNxMV4` | `41983`, `44795`, `43427`, `44817`, `37355` |
| Unsafe destination | `/tmp/quire-ui-integrations-j31PLi` | `37767`, `45459`, `39569`, `41937`, `38199` |
| Unconfigured | `/tmp/quire-ui-integrations-80BSTt` | `38497`, `33805`, `45659`, `34881`, `32837` |

No matching owned `web-server.mjs` process remained. Other sessions' processes
and worktree changes were left untouched.

## Boundaries

This proves the real local provider protocol, checkout operation consumption,
TLS browser destination/return, and unchanged unconfirmed subscription
semantics. It does **not** prove a live Stripe charge, live merchant account,
external checkout UI, or payment completion. Signed provider webhook
reconciliation remains the authority. There are no deferred P6 consumer
requirements.
