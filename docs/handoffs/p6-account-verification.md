# P6 independent account correction verification

Owner: `st_01a17e31`. Date: October 27, 2026. Status: FINAL.

## Current verdict after corrected identity verification

**Checkout: PASS. Password feedback: PASS. Identity correction: PASS.**

The superseding identity FINAL is now present and was read. Its producer
`acceptance-final.log` SHA-256 matches the supplied
`ffce71a8282dbd078f1c65b07b85e4bcda89a8579728edab86d4a6873a058534`.
Acceptance here additionally rests on a new independent identity-only run,
not that producer receipt or DAG completion:
**1 pass, 0 fail, 37 assertions, 64.96 seconds, exit 0**, Bun 1.4.4.
The original combined run's 403 failure and missing-FINAL observations remain
preserved below and in their unchanged receipts; they are superseded for
current identity acceptance, not relabeled passing.

Checkout and password tests were **not repeated**. Their passing evidence,
all 23 original captures, and the old 403 log remain byte-identical.
The new identity packet is isolated under
`docs/evidence/p6-account-verification/identity-final/`.

### Current identity claim and evidence verdicts

| Claim | New independent evidence | Verdict |
| --- | --- | --- |
| FINAL input is available | Read `docs/handoffs/p6-identity-ui.md`, status FINAL; verified its exact producer acceptance log hash before executing the corrected test. | PASS |
| Link follows returned authorization metadata | Actual Link response Location equals the browser's provider request. The real callback URI, S256 challenge, state and nonce are asserted before completing the actual local OIDC flow. No successful response is intercepted. | PASS |
| Callback returns a persisted identity with the selected security tab | Callback returned 303 to `/settings/identities`; Sign-in & SSO has `aria-current="page"`. Real identities API persisted issuer `http://127.0.0.1:40739`, subject `subject-one`, ID `e97dcfec-27a0-42cc-b473-9d2bbf91ba67`. The old initiating session returned 401. | PASS |
| Consumed callback cannot be reused | Wrong-browser binding and replay with the actual original consumed binding each returned 400 `OAUTH_STATE_INVALID`. Provider observations remained one token exchange. These are post-consumption probes, not independent pre-consumption wrong-binding/configuration coverage. | PASS for exercised cases |
| Stale unlink retains actual service denial | A competing write using the current ETag, application Origin and callback session's actual CSRF succeeded. The displayed stale unlink then returned 409 `VERSION_CONFLICT`; identity and authenticated session remained, and the conflict rendered on mobile. | PASS |
| Successful unlink does not reuse revoked sessions | After reload, actual DELETE returned 200 and the main frame navigated fully to `/sign-in`. No authenticated identities-list refresh followed. Current browser and a second session proved valid after linking both returned 401 after unlink. A fresh password session read an empty identity list. Page errors were empty. | PASS |
| Responsive workflow remains usable | All seven new full-page captures were opened and inspected; every capture asserted `scrollWidth <= innerWidth`. Linked identity, conflict and sign-in content were rendered without horizontal clipping or overlapping controls. Existing narrow provider-reason wrapping remains unchanged. | PASS within existing layout |

### Corrected input, exact command and receipts

The consumer `identities.tsx` remains SHA-256
`bbed5dbd4a546dda2c09d60ecd82b0228ce2fceda116b4c6711d88105f86eba0`.
The corrected producer test is
`cad34c5fcb99012184ceb273626160b85a30d7c4283542c41fea9d7fb53ded97`;
the initial failed test was
`ffaa375a1c72997719313e68ff3831027b7c33ab720ceb3a5db962bcd38e128c`.
Inspection confirmed actual ETag/session/Origin/CSRF use, retained consumed
browser binding for replay, and a separately valid post-link session for the
all-session revocation check. No backend policy was changed to make it pass.
The existing settings alias was read, not edited.

Executed exactly once against those corrected inputs:

```sh
QUIRE_ACCOUNT_EVIDENCE_RUN=identity-final \
QUIRE_TEST_CHROMIUM=/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  ./node_modules/.bin/bun test \
  --preload ./tests/ui-product/account/return-acceptance/evidence-preload.ts \
  tests/ui-product/account/identity-return
```

Original terminal `mon_A682K2MN14WKSQ08` / `bash_3` completed exit 0.
Its complete observed terminal output is retained in `identity-final/acceptance.log`,
SHA-256 `f392914faa387182d189eb18b1117ae6f8209b4feb7e7e8cae4c63c808f98558`.
The existing console request-array rendering abbreviates its tail; the actual
test asserts the full in-memory list contains no post-unlink identities read.
No requested-suite retry, timeout retry, or checkout/password run occurred.

The only owned code adjustment adds an optional evidence-run directory to
the screenshot destination, so new frames cannot overwrite the old ones.
Owned strict TypeScript and deny-warnings type-aware oxlint passed once for
that change; `identity-final/static.log` records
`IDENTITY_OWNED_STATIC_EXITS types=0 lint=0`, terminal exit 0.
Owned LSP diagnostics are zero. Assertions, browser actions, service responses,
provider fixtures and producer files are unchanged by this verifier.

The new before/after manifests contain 285 entries and compare identically:
both SHA-256
`d24d85c145f9f025b903ecf82a9ee93c90c25cce4bb0fbdf5038d9ddb21628af`.
They cover measured account, contract, runtime, account-service, adapter and
fixture sources plus immutable inputs and the superseding identity handoff/log.
They do not claim unrelated repository inputs were frozen.

Opened and visually inspected all seven files in
`identity-final/p6-identity-ui/`:
`unlinked-desktop.png`, `unlinked-mobile.png`, `linked-1440.png`,
`linked-390.png`, `stale-unlink-mobile.png`, `signed-out-1440.png`,
`signed-out-390.png`. Desktop is 1440px and mobile 390px. The stale notice
is visible with the retained identity; the sign-in captures show the actual
full navigation, not an authenticated list placeholder.

At October 27, 2026, 17:55:35 UTC, exact root
`/tmp/quire-ui-integrations-w321m3` was absent; runtime PID `1267821` and Vite
PID `1267871` were gone. Event-driven one-shot probes independently returned
`ECONNREFUSED` on web `44689`, API `38529` and provider `40739`.
The terminal records browser disconnection and awaited adapter/runtime/web
disposal. `identity-final/cleanup-and-hashes.md` retains these receipts and
all new and historical capture hashes. Other sessions' live editor/browser
processes and parent operator recovery files were left untouched.

Live-provider prerequisites and scope boundaries below still apply. This
closes the previously unverified unlink behavior for the real local fixture;
it does not certify live provider authorization or external consent revocation.

## Historical terminal recovery

Recovered the original sessions on October 27, 2026 at 23:38-23:39 +07:00:
`bash_8` (`mon_2YV56SA6WHVRYY0T`) is `exited_1 exit_code: 1`;
`bash_9` (`mon_DR09SY3PW46JGJ2B`) is `completed exit_code: 0`.
The retained response saying these checks were pending was intermediate.
The durable test/static receipts below were recovered, not lost, and no
suite or static gate was duplicated. DAG completion is not acceptance evidence.

At recovery, checkout FINAL exists and is unchanged. Password feedback FINAL
also physically exists and now includes its producer's own terminal recovery
note; it is not missing at this observation. Identity FINAL remains missing.
Missing identity FINAL fails the input gate; its producer's progress is
unknown, not inferred to be complete, failed, or in progress from DAG state.
The separate observed identity test failure remains a failure before unlink.

All 23 previously visually inspected captures remain byte-identical. Recovery
reconfirmed all five exact owned directories absent, all 19 known ports
refusing connections, and no owned test/browser/Vite process. Other sessions'
processes and parent operator recovery files were left untouched.
See `docs/evidence/p6-account-verification/recovery.md` for recovered handles,
current handoff hashes and exact cleanup reconciliation. Original before/after
manifests remain the historical run snapshots; the later password producer
documentation update is not silently folded into those snapshots.

## Historical initial-run verdict (superseded for identity)

**Checkout: PASS. Password feedback: PASS. Identity correction: FAIL.**
This is a completed independent verification with a reported failure, not
approval of all three corrections.

The requested combined run executed once on project-local Bun **1.4.4**:
**9 pass, 1 fail, 225 assertions, 77.17 seconds, exit 1**. All eight checkout
tests and the password browser test passed. The identity browser test
completed linking, persistence, callback return and replay checks, then
failed at `tests/ui-product/account/identity-return/identity-return.test.ts:111`:
its competing profile PATCH returned **403**, expected **200**. Neither
stale-unlink nor successful-unlink behavior was reached.

The required `docs/handoffs/p6-identity-ui.md` was missing at initial read,
before the run, and at the post-run check. Both source manifests retain the
missing-file sentinel. Missing FINAL input is independently **FAIL**, as
instructed; no producer success is inferred from source or partial execution.
`p6-checkout-ui.md`, `p6-password-feedback.md`, and `p3-connections.md` were
read and are FINAL.

## Historical combined-run claim and evidence verdicts

### Hosted checkout

| Claim | Independently observed evidence | Verdict |
| --- | --- | --- |
| Consume the actual hosted destination | Actual application checkout returned HTTP 202 with `checkoutId: "cs_fixture"`, the loopback HTTPS destination and `reconciliation: "awaiting_webhook"`. Chromium made a real GET to `https://127.0.0.1:34701/checkout/cs_fixture?session=opaque-fixture`. The preview was 3000 USD minor units for two monthly seats, and the request retained the real quote ID and account version. | PASS |
| Do not claim payment from checkout initiation or return | The hosted fixture said no payment had been made. Before checkout, at the hosted landing and after return, the persisted billing account remained `unbilled`, `planId: null`, `seats: 0`, `version: 0`. Return rendered the actual unbilled account rather than inventing completion. | PASS |
| Existing-subscription update waits for reconciliation | A signed local webhook first established monthly/two-seat/version-1 state. The requested annual/three-seat operation returned only the actual subscription ID and awaiting-webhook marker; no hosted navigation occurred. The account remained monthly/two-seat/version 1. Preview/update proration timestamps matched and provider `payment_behavior` remained `pending_if_incomplete`. Both responsive captures explicitly say payment is not confirmed. | PASS |
| Preserve validation and server denials | Real expired quote and stale account version returned 409; revoked session returned 401. Errors rendered without provider dispatch or navigation. A real succeeded operation containing an HTTP destination was rejected by the consumer, with unchanged account and no hosted landing. Unconfigured catalog hid preview/checkout. Parser tests rejected unsupported result shapes and unsafe destinations and excluded non-succeeded/unrelated operations. | PASS |

Source inspection agrees with the browser evidence:
`apps/web/src/features/account/billing.tsx:60` consumes the returned operation,
and `billing-navigation.ts:9` accepts only the succeeded checkout result
alternatives and credential-free HTTPS URLs. The real producer alternatives
are in `services/adapters/billing/quotes.ts:66`; initiation does not publish
paid subscription state. `services/adapters/billing/webhooks.ts` checks
signature/timestamp, retrieves authoritative provider state and publishes
reconciliation. A provider operation succeeding is not a payment receipt.

### Linked identity and unlink session handling

| Claim | Independently observed evidence | Verdict |
| --- | --- | --- |
| Link uses returned metadata | Before clicking Link, the test subscribed to the actual link response, provider request, callback and main-frame return. The link response Location equaled the requested authorization URL; the actual callback URI, S256 challenge, nonempty state and nonce were asserted. There was no fabricated successful application response. | PASS for observed link path |
| Callback returns persisted identity and rotates the initiating session | Actual callback returned 303 to `/settings/identities`. The real identities API returned issuer `http://127.0.0.1:40239`, subject `subject-one`, and persisted ID `e6684bdb-e4b5-4f27-b2ab-aec8f74af14a`. The browser displayed that identity at 1440px and 390px. The old initiating session returned 401. | PASS for observed return path |
| Real callback state prevents replay | Foreign context returned 400 `OAUTH_STATE_INVALID`; original-context replay returned 400. Provider token observations remained exactly one exchange. | PASS for covered callback cases |
| Stale unlink preserves denial; successful unlink does not reuse revoked sessions | The test stopped before either unlink click because its competing PATCH returned 403 at line 111. No successful-unlink navigation, authenticated-list suppression, all-session revocation, fresh-login empty list or signed-out capture was observed. | FAIL: unverified |
| FINAL producer evidence is available | `docs/handoffs/p6-identity-ui.md` was absent, including the measured post-run state. | FAIL |

The source change in `identities.tsx:44` uses
`callWithMetadata`, unwraps `.result`, reads `metadata.headers["location"]`,
and navigates there. At line 34 successful unlink navigates to `/sign-in`
instead of reloading identities with the revoked session. The actual unlink
handler in `services/adapters/identity/unlink.ts` deletes all sessions, clears
the cookie and dispatches revocation. These source facts do **not** replace
the missing browser proof for unlink.

The failing test's PATCH at lines 107-109 supplies CSRF but omits Origin.
`services/accounts/identity/authentication.ts:13` requires an exact public
origin for mutations, making this a concrete fixture-request defect
consistent with the 403. The failing response body was not logged, so
`ORIGIN_DENIED` is a source-level diagnosis, not an observed response code.
The producer test and authentication policy were left unchanged. The producer
must supply a FINAL handoff and a correctly originated competing write before
unlink acceptance can be established. This verifier did not retry the
requested suite or relabel its failure.

### Password creation feedback

| Claim | Independently observed evidence | Verdict |
| --- | --- | --- |
| Live accessible feedback appears on actual creation/reset fields | Real signup/reset forms exercised lengths 0, 1, 11, 12, 16, 24 and 1024, including clearing. Four decorative segments, associated description, polite atomic status, masking, `new-password`, required/min/max validity and Tab to confirmation were asserted. A bounded MutationObserver was subscribed before typing; typing alone caused no POST. | PASS |
| Feedback adds no acceptance policy | Real registration accepted `aaaaaaaaaaaa`; local mail verification and login with that exact password succeeded. Actual contract remains length 12-1024 without composition requirements. The auth diff is an import and two field substitutions; the component stores length only. | PASS |
| Existing reset validation and token behavior remain | Mismatched confirmation sent no reset-confirm POST. Matching minimum-length input succeeded through the real service. Token replay returned 400, old-password login 401, new-password login 200. | PASS |
| Both responsive widths and themes remain readable | All eight form captures and the actual reset-complete capture were inspected. The indicator and guidance fit without overlap or horizontal overflow in light/dark at 1440px/390px. | PASS |

The real contract is
`packages/contracts/src/routes-accounts.ts:15`, and reset token consumption,
hash update and session revocation remain in
`services/accounts/identity/credentials.ts:116`. The exact reset design's
illustrative 10-character caption is not backend policy; existing 12-1024
acceptance takes precedence. Sign-in remains a current-password field.
This proves DOM accessibility semantics and keyboard behavior, not spoken
screen-reader output or a security-strength estimator.

## Independent method and exact command

```sh
QUIRE_TEST_CHROMIUM=/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  ./node_modules/.bin/bun test \
  --preload ./tests/ui-product/account/return-acceptance/evidence-preload.ts \
  tests/ui-product/account/checkout \
  tests/ui-product/account/identity-return \
  tests/ui-product/account/strength
```

The three requested test directories were executed once without retries,
test edits, skips or weakened assertions. Existing application, real
identity/billing services, actual CSRF/session checks, canonical local
Stripe/OIDC fixtures, same-origin Vite proxy and Chromium were used.
Checkout's existing merchant bridge changes only the local provider session
destination to a real TLS listener. It does not fake application success.
No unrelated account integration/editor/operations suites ran.

Producer tests hard-code screenshot paths outside the verifier write
boundary. The owned preload wraps only browser creation and screenshot
destination paths, redirecting those PNGs to this verifier's evidence packet.
It also logs capture URL/bounds and browser disconnection. It changes no
responses, actions, provider state, session handling or assertions.
Producer test bytes and producer evidence were not edited.

## Reference and visual inspection

Read `docs/discovery/design.md`, exact decoded
`docs/discovery/design-source/16-settings.source.html` security/settings
section and `23-reset-password.source.html` creation/confirmation/indicator
section, existing account consumers and shared fields/tokens. Original
settings/reset reference PNGs were also visually inspected. Existing panels,
fields, buttons, status notices and brand/border tokens remain in use.
No illustrative paid account or 10-character policy was treated as live data.

All **23 freshly generated PNGs** below were opened and visually inspected,
not accepted solely because screenshots existed. Paths are relative to
`docs/evidence/p6-account-verification/`.

| Directory | Inspected files |
| --- | --- |
| `p6-checkout-ui/` | `quote-1440.png`, `quote-390.png`, `hosted-landing-390.png`, `returned-unconfirmed-390.png`, `subscription-awaiting-webhook-1440.png`, `subscription-awaiting-webhook-390.png`, `denied-expiry-1440.png`, `denied-version-1440.png`, `denied-session-1440.png`, `unsafe-destination-1440.png`, `unconfigured-390.png` |
| `p6-identity-ui/` | `unlinked-desktop.png`, `linked-1440.png`, `linked-390.png` |
| `p6-password-feedback/` | `signup-1440-light.png`, `signup-1440-dark.png`, `signup-390-light.png`, `signup-390-dark.png`, `reset-1440-light.png`, `reset-1440-dark.png`, `reset-390-light.png`, `reset-390-dark.png`, `reset-complete.png` |

Every captured page reported `scrollWidth <= innerWidth`; pages were rendered,
not blank. Checkout status/errors and strength feedback are readable and stay
inside their controls/panels. Long account pages use document scrolling.
The identity mobile rows remain crowded, with provider-reason text wrapping
beside buttons and some existing label/reason text running together; P6 did
not change that layout. No broader identity visual cleanup is claimed.
Stale-unlink and signed-out frames are absent because the test never reached
them, and are not inferred from other captures.

## Provenance and retained evidence

Packet: `docs/evidence/p6-account-verification/`.

- `source-before.sha256` and `source-after.sha256` each contain the same
  **288 lines**: measured source hashes plus the missing identity-handoff
  sentinel. Both file SHA-256 values are
  `4c305eca4b093c946f6cb57919c014a9984bf259d7b3cc9c18d9ad49af4715eb`.
  Entry-by-entry comparison found no change across the run.
- Coverage includes account UI, contracts, runtime, account services,
  adapters, requested tests, shared account/browser fixtures, root
  manifest/lock, project Bun binary, original board, discovery, exact bundled
  and decoded settings/reset inputs, P3 handoff and available P6 handoffs.
  This is measured coverage, not a claim that every unrelated repository
  file was frozen while other lanes worked.
- The original board, discovery and settings/reset source hashes remain
  unchanged. The project binary remains SHA-256
  `10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235`.
  P3 integration files in the manifest and its FINAL handoff are unchanged.
- `acceptance-observed.log` retains the command, decisive observed terminal
  excerpts, real operation/callback/persistence details, exact failure and
  final test count/exit. It is explicitly an excerpt receipt, not complete
  stdout.
- `static-observed.log` retains owned strict TypeScript, type-aware
  deny-warnings oxlint, zero LSP diagnostics and scoped diff-check receipts.
  Final checks exit 0. Two initial preload-only shadow-name lint findings
  were fixed and retained as history, not suppressed.
- `cleanup-and-captures.md` retains exact directory/process results,
  independently refused ports, all 23 PNG hashes and manifest hashes.

Only `tests/ui-product/account/return-acceptance/**`, this evidence packet and
this handoff were written. No backend/shared contract, root dependency,
producer test/component/evidence, original input or P3 producer file was
edited. No commits, global installs, real external account operations or
payments occurred.

## Exact owned cleanup

All five application roots logged adapter/runtime/web closure and
`CONNECTIONS_CLEANED`. All five browsers logged disconnection. The owned test
runtime PID `920119` exited, and no owned Vite or Chromium process remained.
Independent event-driven TCP probes returned `ECONNREFUSED` on all **19**
known ports. Exact directories were independently absent:

| Fixture | Removed directory | Independently closed ports |
| --- | --- | --- |
| Checkout main | `/tmp/quire-ui-integrations-k2pbfs` | web 43461, API 41721, bridge 38099, provider 41729, TLS 34701 |
| Unsafe checkout | `/tmp/quire-ui-integrations-P41oY1` | web 40959, API 37337, bridge 42969, provider 38493, TLS 33225 |
| Unconfigured checkout | `/tmp/quire-ui-integrations-QYoINt` | web 41341, API 38105, bridge 38165, provider 40755, TLS 41601 |
| Identity | `/tmp/quire-ui-integrations-arjWDX` | web 37309, provider 40239 |
| Password | `/tmp/quire-ui-integrations-1H151f` | web 43925, API 43015 |

The identity API ephemeral port was not logged; its listener was owned by
the exited Bun process and closed by the fixture's disposal stack. No manual
directory deletion was needed. The owned static watcher was closed. Two
pre-existing unrelated editor Vite processes with different roots were left
untouched.

## Live-provider boundaries

Checkout still requires real merchant configuration, supported recurring
prices, encrypted API/portal settings, registered HTTPS webhook delivery,
valid signing secrets, explicit hosted payment and verified reconciliation.
Local protocol/TLS navigation is not a live Stripe charge or payment proof.

Live identity still requires each provider's registered client ID/secret,
exact public callback, operator configuration, HTTPS deployment, consent and
applicable provider approval. Google/GitHub/ORCID retain their distinct
existing protocols and prerequisites; the Google-shaped OIDC fixture does
not certify all live providers. Quire unlink removes its identity association;
provider consent remains under provider account controls.

Existing unchanged passing integration tests stand. No broad regression,
external authorization, production deployment or real payment acceptance is
claimed. At that historical checkpoint the precise remaining failure was the
identity FINAL-input gate and unreached unlink acceptance, not a demonstrated
production unlink defect. The current identity-only verification above closes
both acceptance gaps on the corrected input while preserving that failure.
