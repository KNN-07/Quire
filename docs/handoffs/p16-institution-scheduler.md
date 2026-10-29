# Scheduled institution eligibility reconciliation: FINAL

October 28, 2026. Bounded A53b scheduler integration.

The existing `reconcileInstitutionEligibility` service is now invoked by the
default application adapter scheduler. It is an independent admitted task,
using the existing configurable host wake interval (default 30 seconds),
single-active-pass guard, failure retention and awaited shutdown. No second
timer system, migration, new principal or external provider call was added.
Explicit custom aggregate callers still own start/close; disabling the
aggregate explicitly also disables this scheduled pass.

The existing reconciliation policy remains explicit: expired or
domain-ineligible self-enrolled, unlicensed ordinary membership is removed.
Administrative, explicitly licensed and accepted-management grants are
independent. Account credentials, projects and unrelated memberships are not
deleted. The runbook describes this policy and wake latency.

## Actual default-host proof

The new `tests/integration/adapters/eligibility.test.ts` uses the real
application composition with an injected clock and host tick source. It calls
the normal scheduler, not the reconciliation function directly.

Its baseline failed because the expired membership remained after a tick.
After wiring, the same test proves:

- Membership remains at 59,999 ms and is removed at the 60,000 ms expiry
  after a real application restart.
- A future eligibility record remains valid at that boundary.
- An explicit licensed institution grant and a separate team grant survive.
- The expired member's owned project remains owned/readable and the account
  remains active.
- Changing the institution domain removes the future-dated ordinary
  membership on a later scheduled pass after another restart.
- The affected account can still sign in independently.
- Subscriptions close and each started pass drains before assertions.

No sleeps or polling are used. Tests await the adapter close contract to
observe completed ticks.

The focused combined command passed **4 cases/28 assertions**, with four
unrelated cases filtered, in 32.85 seconds. The selection also executes custom
caller lifecycle ownership, real loopback TLS SMTP delivery draining, and
failure isolation with sibling factory/storage cleanup. Existing assertions
were updated from three to four tasks, and from two to three surviving
subscriptions after one task failure; failure checks were not weakened.
Receipt: `mon_VC4HJJ5AE3NEK5ZR`, exit 0.

Strict integration-adapter TypeScript and touched-source/test type-aware
deny-warning lint passed in the same command. The new scoped tsconfig includes
the existing runtime asset declarations. JSON Biome LSP was unavailable;
TypeScript parsed and checked the configuration successfully.

Both exact dedicated-test roots were independently absent:
`/tmp/quire-p2x-integrate-0mFmXw` (baseline failure) and
`/tmp/quire-p2x-integrate-dNbbgG` (passing run).
The integration fixtures await server/application disposal; this record does
not claim a separately captured per-port audit for these native-only fixtures.

This closes the missing scheduled trigger, not institution reconfirmation
configuration, live IdP revalidation, Commons product labels or distinct AI
entitlements. The existing institution browser proof remains unchanged.
