# P34 account entry: independent verification FINAL

Date: October 28, 2026. Verifier: `st_01a182f2`.
Scope: D14 onboarding and D09 pricing, including their shared signup return.

## Verdicts

| Lane | Source verdict | Retained workflow evidence | Acceptance verdict |
| --- | --- | --- | --- |
| Onboarding | PASS | PASS | PASS for the bounded native account, blank/template and ZIP-to-editor journeys |
| Pricing | PASS | PASS: P45 current composition plus unchanged P34/P6 reuse | PASS for bounded catalog/auth/authorized organization preview and explicit owned checkout |
| Shared new-account plan continuation | PASS | PASS | PASS for retaining selection into the honest no-organization billing state, not a purchase |

No current acceptance blocker remains in these bounded paths after inspecting
the FINAL P45 composition and P44 status-layout supplements. The original
pricing evidence-completeness failure is retained below as history, not
rewritten into an original contemporaneous receipt.
Both producer artifacts are FINAL: `p34-onboarding.md` and `p34-pricing.md`.
Neither a live monitor nor a producer's end-of-turn message was accepted as
completion. No artifact watch was needed because both FINAL files were already
present when this audit began.

## Prioritized findings and supplemental disposition

1. **Historical P2 - Original pricing browser provenance incomplete;
   bounded current acceptance superseded by P45.**
   `docs/evidence/p34-pricing/acceptance.log:1-281`
   retains real native output and `PRICING_ACCEPTANCE_EXIT=0`, but no command,
   cwd, timestamped source snapshot or before/after hashes. Its
   `source-provenance.md:17-30` supplies ten reviewed hashes, all of which match
   the current files in this audit; that later table cannot establish that those
   bytes remained unchanged during the browser run. `static.log` contains only
   `TSC_EXIT=0` and `LINT_EXIT=0`. The separate three-line `parent-types.log`
   has two hashes and `P34_PRICING_TSC_EXIT=0`, not START/END provenance for the
   browser run. P45 now provides a separate affected-composition receipt with
   cwd, UTC start/end, eleven equal pre/post hashes matching current source and
   explicit exit 0. That closes the bounded composition acceptance gap without
   claiming to recover the original run. Parent reports its original session
   reader found zero matches; no original raw receipt is invented.
2. **Historical P3 - Two claimed P34 invocations remain unsubstantiated;
   excluded from acceptance.**
   The claimed unchanged destination tests (2 pass, 19 assertions) and scoped
   diff check are reported in `p34-pricing.md`, but the original retained
   packet contains neither passing raw output.
   `navigation.log` does not exist. The unchanged validator's current hash
   matches the producer's table, and the older FINAL
   `docs/handoffs/p6-checkout-ui.md` documents accepted coverage, but that is
   reuse evidence, not a raw receipt of the claimed P34 invocation. Acceptance
   now explicitly reuses P6's validator coverage and does not rely on either
   missing claimed invocation. No validator or unconfigured suite was replayed.
3. **Historical P3 - Mobile status clipping closed by P44.**
   The original onboarding editor captures still document the crop.
   P44's actual red receipt and geometry establish 104px content in a 79px
   client area; its scoped CSS fix removes the mobile height cap. The fixed
   native case passes 54 assertions with six inspected screenshots and a
   successful affected web build. This is a new scoped correction, not a claim
   that the original screenshots were unclipped.

The historical pricing TS2322 is **not an open type failure**. Original
`acceptance.log:278-281` remains red for that check. The separate parent receipt
records the corrected scoped tsc exit 0, and onboarding subsequently retained
clean scoped strict checks at its final source hashes. The parent receipt's
older onboarding hash is not presented as the final onboarding snapshot.

Pricing's older statement that signup/import remained pending is superseded
only by onboarding's later FINAL integrated receipt and source trace below.
The pricing handoff alone does not prove those behaviors.

## Onboarding source and observed results

- **Verification authority:** `auth.tsx:57-136` carries validated return intent
  through registration, verification and sign-in. Anonymous session storage
  holds only `create`/`verify`/`signin` screen hints
  (`onboarding-progress.ts:7-14`). `credentials.ts:19-79` still creates an
  unverified account without a session, consumes the real verification token
  and rejects unverified password login with HTTP 403. Choosing
  `?step=start` is not authentication evidence.
- **Actor-scoped persistence:** `services/accounts/identity/onboarding.ts:9-94`
  reads by principal ID, checks body actor ID after mutation authentication,
  serializes under the accounts lock, checks expected version and uses
  actor/route/key idempotency. Responses are private/no-store.
  `onboarding-imports.ts:36-151` applies the same actor/CAS boundary and derives
  recovery from server facts rather than a client success/project ID.
  Native receipt markers record stale and switched-actor HTTP 409,
  concurrent `[200,409]`, exact replay and restart.
- **No credential-progress store:** strict onboarding DTOs in
  `packages/contracts/src/accounts.ts:107-153` contain choices, IDs, file
  metadata/digest and recovery keys, not passwords or verification/reset
  tokens. Repository URL validation rejects `@`, query and fragment rather
  than persisting credential URLs. The billing hint is a versioned 24-hour
  local-storage plan/period path (`onboarding-return.ts:6-56`), not an
  actor credential or entitlement. It is browser-wide public intent, not
  actor-scoped account progress. The browser test checks that storage excludes
  the actual email, password and verification token.
- **Retry-safe blank/template creation:** `starting-point.tsx:35-58` first
  freezes the server create key, then invokes the existing project writer.
  `onboarding.ts:62-84` accepts completion only from the actor/key/body-bound
  durable `projectCreate` receipt and owner check. `openOnboardingProject`
  validates the current actor; project identity is persisted before preference
  work. The native/browser cases lose a real successful response, reload and
  reuse the same key. Browser blank result:
  `714ef46a-ad5a-4b96-8977-baab850fb5a4`, two requests, one key, one project,
  writable source editor after preference failure and reload.
- **Actual template contents:** the browser publishes, approves and selects
  template version `748033e8-5cc4-4b57-9157-d86032476033` through native routes.
  Result `fc146399-5664-4a1d-b7c7-d17113209af2` has one matching project and
  identical source paths/blob digests to the source fixture. The real visual
  editor is enabled before and after reload. This proves this public template
  journey, not every template's suitability.
- **Actual import continuation:** the optional bridge is elected only by
  `ProjectsPage.tsx:28-31,207` for `new=import&onboarding=1`.
  `onboarding-import.ts:84-168` freezes draft, distinct import/upload keys and
  file fingerprint before staged upload/import dispatch.
  `onboarding-imports.ts:89-151` recovers actor/route/key receipts, checks the
  canonical body digest, operation kind/identity and live owned project.
  `NewProjectDialog.tsx:97-156,209-228` uses the existing importer and operation
  consumer. The real ZIP journey drops successful HTTP 201 upload and HTTP
  202 import responses; reload recovers without a selected File, then opens
  project `0708e456-a2f8-4661-a32e-e31579f7bc7a` from operation
  `c4ea8b73-3770-4209-b259-39b6c2fbc45b`: one upload request, one import request,
  one project. Its actual ZIP content is visible in a writable source editor
  after reload. A separate native interrupted-publication case replays the
  frozen source after staged-upload expiry without rereading it or duplicating
  the project.
- **Provider return remains bounded:** `services/adapters/identity/state.ts:15-27`
  adds only the exact raw `/sign-up?step=start` exception. Local path, origin,
  control/backslash and fragment checks remain. Native controlled LDAP/OIDC
  continuation is covered; live hosted identity vendors are not certified.

Evidence for these observations is
`docs/evidence/p34-onboarding/2026-10-28T13-16-28.267Z-integrated.log`,
with the inspected assertions in
`tests/accounts/onboarding/{persistence,imports}.test.ts`,
`tests/ui-product/account/onboarding/{browser,billing-return,providers}.test.ts`
and `tests/adapters/identity/onboarding-return.test.ts`.
Browser fault injection fetches real successful responses and drops them; it
does not replace them with fabricated successful application responses.

## Pricing source and observed results

- Immutable `docs/discovery/design-source/09-pricing.source.html:217-251`
  supplies six groups and 23 row labels. `pricing-comparison.ts:3-44` retains
  that structure while replacing illustrative commercial values with qualified
  local capabilities and unspecified operator entitlements.
- `pricing.tsx:13-54` gets the real catalog, renders its name, currency,
  amount and actual period, and filters monthly/annual choices. No sample
  plan price, trial, discount, seat cap, retention or AI allowance is adopted.
  Unconfigured pricing retains the comparison but offers no paid continuation.
- `pricing-selection.ts:5-14` constructs the exact catalog ID/period path and
  validates that pair against billing's freshly loaded catalog.
  `billing.tsx:21-77` leaves an unavailable selection blank rather than silently
  substituting another plan. A user can explicitly choose a published
  alternative. Native mounted proof covers monthly and annual selection,
  unknown ID, period mismatch and unconfigured billing; pure selection tests
  cover missing/removed selection data.
- `billing.tsx:65-90` requires explicit Preview, then explicit Request checkout.
  Preview uses actual plan period, seats and current billing version; form
  changes clear the quote. Native annual proof sends `price_year`, `year`,
  two seats and receives 30000 USD minor units. Before checkout there is no
  provider checkout-session dispatch or hosted landing.
- `services/adapters/billing/index.ts:45-56`,
  `quotes.ts:11-28,67-120` and `store.ts:15-38,98-104` preserve session/CSRF,
  admin organization authorization, freshness, expected version and actor/org
  quote binding. The actual foreign-organization preview returns
  HTTP 403 `FORBIDDEN`.
- Explicit checkout returns HTTP 202, sends the original quote/version and
  reaches the real owned TLS listener at
  `https://127.0.0.1:35723/checkout/cs_fixture?session=opaque-fixture`.
  The browser assertion compares persisted billing before/after and finds it
  identical: unbilled, no plan, zero seats, version 0.
  `billing-navigation.ts:10-21` remains the HTTPS-without-credentials navigation
  authority. No navigation/payment-success equivalence is introduced.

The observations above come from `docs/evidence/p34-pricing/acceptance.log`
and the current, hash-matching
`tests/ui-product/marketing/pricing/browser.test.ts:20-142`. The checkout uses
the canonical local Stripe protocol fixture, encrypted operator settings and
loopback-only browser egress. This proves local protocol/application behavior,
not live Stripe acceptance, a real charge or arbitrary vendor parity.

## Shared selection seam

The later onboarding receipt's `ONBOARDING_BILLING_RETURN` identifies actor
`2f997e4b-101d-433d-8789-ae0c264bade5`, exact target
`/settings/billing?plan=price_year&period=year`, HTTP 403 before verification,
HTTP 200 verification in another tab, and successful sign-in continuation.
There are zero projects, organizations, quote/checkout mutations or hosted
landings. The optional starting-point action also retains the saved thesis
draft. These assertions are in `billing-return.test.ts:45-159`.

The resulting screen truthfully says no organization billing account is
available. This is a PASS for preserved intent, not evidence that a newly
registered personal account can buy a subscription. Eligible-organization
preview/checkout is independently proved by the pricing fixture.

## Supplemental current-composition and status acceptance

`docs/handoffs/p45-pricing-composition.md` and original
`docs/evidence/p34-pricing/parent-integrated-journey.log` are FINAL supplemental
evidence. After shared auth/start changes, only the affected native configured
catalog journey ran: 1 pass, 0 fail, 38 assertions, 48.48 seconds, explicit
`P45_TEST_EXIT=0`, cwd `/home/norman/Repos/Quire`, UTC 15:37:53Z-15:38:42Z.
All eleven source/test hashes are equal before/after and match current files.
The printed command marker uses `native_catalog_selection`; P45 documents
the actual tool selector as quoted `'native catalog selection'`. The printed
marker is not represented as a verbatim executable invocation.

The case proves monthly/annual catalog intent, exact annual two-seat quote,
explicit HTTP 202 checkout, real owned TLS landing on port 45171, unchanged
unbilled billing state, unavailable ID/period handling, foreign-organization
HTTP 403 and existing-account auth return. The one filtered-out unconfigured
case is not a skip or a claimed new pass: its unchanged original evidence is
reused, as is accepted P6 destination-validator evidence. The independent
onboarding new-account/no-organization receipt remains a separate proof.
No personal subscription, payment success or live vendor acceptance is inferred.

`docs/handoffs/p44-editor-status.md` and its original
`before-drawer-corrected.log`, `fixed.log`, geometry JSON and `web-build.log`
close the earlier mobile status finding. The initial `before.log` failed on
a wrong test close-button label, not clipping; only the next red receipt proves
clipping. Current `editor/workspace.css:119-137` has no mobile status height cap,
retains touch-target sizing and lets the grid give status natural height.
Current CSS/test hashes match `fixed.log`; that receipt records combined scoped
static exit 0, 1 pass, 0 fail, 54 assertions in 42.09 seconds and
`P44_TEST_EXIT=0`. The CSS-hashed web build records `P44_WEB_BUILD_EXIT=0`.
Unlike P45, P44's compact logs do not claim a UTC before/after hash envelope.

All six final P44 images were opened: 1440x900, 390x844 and 390x900 in both
schemes. Cursor, UTF-8, shared-save status and compile controls are visible
without the original internal clipping or new observed overlap. Geometry has
`scrollHeight == clientHeight`: 28px desktop, 104px mobile. Every recorded child
bottom fits the status box, whose bottom equals the viewport height. The real
source document remains visible. This is bounded status layout acceptance,
not full editor-mode or accessibility conformance.

## Receipts, pixels and cleanup

The independent inventory, receipt fingerprints, source-match results, capture
manifest and cleanup observations are retained in
`docs/evidence/p34-account-entry-verification/audit.md`.

Onboarding's integrated run is 18 pass, 0 fail, 403 assertions, 94.53 seconds,
exit 0, with 28 equal START/END hashes. The final focused presentation case is
1 pass, 0 fail, 21 assertions, 51.33 seconds, exit 0, with 29 equal START/END
hashes. All 29 final source hashes still match the current tree. The integrated
run predates the two disclosed footer/name presentation changes; the focused
receipt and final scoped strict/lint checks cover them without replaying the
accepted suite.

The parent's later current-root refresh is independently read in
`docs/evidence/p41-product-validation/final-onboarding.log`: explicit
`P41_FINAL_TYPECHECK_EXIT=0`, `P41_FINAL_LINT_EXIT=0` and
`P41_FINAL_BUILD_EXIT=0`. Its recorded dialog and starting-point hashes match
the final onboarding receipt and the current files. It covers the two final
footer/name presentation lines; P25 is not its authority. The build retains
Vite's large-chunk advisory, not a failed build or lint result.

P37 admission is also complete, not pending:
`docs/evidence/p37-admission-recovery/installed-parent.log:246-250` records
1 pass, 0 fail, 644.37 seconds and `P37_INSTALLED_TEST_EXIT=0`; its adjacent XML
records 80 assertions and zero skipped tests. That normal blank-admission
journey is distinct from onboarding import presentation. Parent reports that
the source differences are confined to the scoped onboarding presentation
paths not exercised by normal blank admission. The settled admission receipt
is not replayed or treated as invalid merely because those paths changed.

Pricing's original raw browser receipt is 3 pass, 0 fail, 64 assertions,
65.28 seconds, exit 0. Its ten reviewed source hashes match current files;
the later P45 envelope supplies current affected-composition provenance.
The historical tsc exit 2 is retained rather than rewritten and is
superseded by `parent-types.log`, with the later clean current-root refresh
providing additional static/build evidence. Neither that historical type error
nor the older pricing signup cutoff is an open blocker. Original pricing
provenance remains historical, not a missing current composition or build.

The initial audit opened all 86 claimed changed screenshots through the read tool: 72
onboarding and 14 pricing, both widths and schemes, including superseded
before images and all eight final corrections. Images were displayed in
comparison sheets, not regenerated. Final footer/name captures show the
operation action, contained footer and persisted import name; the earlier
mobile operation image visibly clips its footer and is not final acceptance.
Pricing and no-organization screens are nonblank and structured without
observed overlap. Long full-page PNGs are downsampled by the read tool, so this
review does not claim full-resolution typography/accessibility conformance.
Native bounds/assertion receipts supplement that visual limit.
The nine fixed-name `configured-*`, `selected-billing-*` and
`unavailable-selection-390-dark.png` files now belong to P45, not the original
pricing run. I reopened all nine; the original unconfigured captures and raw
logs remain reused evidence. I also opened P44's six fixed captures and actual
red 390x844 image. Exact supplemental provenance is in `audit.md`; no replaced
fixed-name PNG is misattributed to its earlier run.

Independent read-only cleanup checks at 14:43Z found all 21 exact documented
fixture roots absent and all ten pricing plus two final onboarding listeners
refusing connections. Docker inspect returned exit 1 for the exact owned LDAP
container and image. The original guarded image-removal receipt was read.
Supplemental read-only checks at 16:19:12Z found P45's exact fixture root and
P44's final/two earlier roots absent. P45's five final listeners and P44's two
final listeners all returned `ECONNREFUSED`; no open/timeout result was accepted
as cleanup.
No shared resources were stopped, and this verifier created no running
fixture, browser, server or monitor needing cleanup.

No test, build or lint suite was replayed. This verifier changed only this
handoff and its own evidence directory, with no production/test/ledger edits
and no commit. The documentation-only change requires no new behavioral test.
Root P25 builds are stale and are **not** used to certify the current shared
tree; P41 supplies root typecheck/lint/build at the final onboarding presentation
hashes, and P44 supplies scoped static and rebuilt web evidence for its later CSS
correction. P41 server/worker/installation bundles remain separate evidence;
P44 is not represented as another whole-tree build. No deployment,
live-mail delivery, live hosted Git import, provider payment, load or
whole-product behavioral acceptance is claimed.
The existing 24-hour staged-upload limit and pre-commit identical-file
reselection boundary remain explicit, not bypassed by key rotation.
