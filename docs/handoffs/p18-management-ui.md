# Native managed-account screens: FINAL

October 28, 2026. Parent delivery, paired with the independently accepted
gated backend in `p18-managed-release.md` and
`p18-managed-release-verification.md`.

## Delivered

Two private, no-store read endpoints expose current management state:
`GET /api/organizations/:o/managed` is team administrator/operator-only and
lists current members with account counters, acceptance counters and available
actions; `GET /api/me/management` exposes only the current account's records.
Revoked membership cannot advertise acceptance. Invitations use the organization
counter, acceptance uses the management-record counter, and release/deletion
use the target account counter.

Sign-in & SSO settings show management invitations and state. Acceptance
requires an explicit consent checkbox. Accepted management refreshes account
state and disables self-deletion. Organization settings expose management
invitations, refresh, release and managed deletion. Confirmation dialogs name
the account and require its email. Deletion offers only other active accepted
managed recipients and is disabled when none are available.

Release uses the actual guarded native operation, not a local state change.
Its confirmation explains membership/control removal, retained projects and
session termination. Existing errors for stale versions, recent-login
requirements, unsafe recovery and identity provenance remain visible.

## Executed evidence

- Readers: initial absent-route 404 reproduced; final two native cases passed
  **17 assertions**, including administrator/self isolation, current counters,
  private caching and revoked-membership acceptance state.
- Consent browser: **1 case/16 assertions**, 47.38 seconds, exit 0 under
  `mon_6FBQ5HJAHVS0S7JK`. No control before consent; real acceptance, reload,
  persisted management and self-deletion restriction.
- Administration browser: **1 case/23 assertions**, 47.19 seconds, exit 0 under
  `mon_AJ1C6AH4NV103RYR`. Real invitations and consent, unavailable recipient
  guard, eligible-recipient filtering, confirmed deletion, actual reassignment,
  old-owner session denial and recipient project access.
- Release browser: **1 case/14 assertions**, 46.90 seconds, exit 0 under
  `mon_JAA7YV9F6328R58B`. Actual release removes team membership, retains project
  ownership, rejects the old session, and permits new password sign-in and
  project access while organization access is denied.
- Final management UI strict TypeScript and touched-source/test type-aware
  deny-warning lint passed before the release browser command. Account reader
  types/lint passed with `mon_AC98BC20XBCPDHMV`; earlier in-progress federation
  optional-property errors were corrected by their owner, not suppressed.
- New read-route dispatch invariant: **1 case/2 assertions**, exit 0 under
  `mon_2NBVMJ602T52CDEQ`.

No successful-response mocks or sleeps were used. The three browser cases
were separate successful selections, not a newly run combined suite.

Packets under `docs/evidence/p18-management-ui/`:

- `acceptance-84120cb4-a5aa-40c3-b460-e2f40a3c6f20/`, `acceptance.xml`.
- `administration-fcdef716-1aa8-4cb0-8457-418a9424d9f0/`, `administration.xml`.
- `release-a04cdd79-5ecf-4f89-ab9d-a91414bb5f9a/`, `release.xml`.

All **20** screenshots were opened and inspected at 1440/390 in both themes.
New management controls and dialogs have no observed overlap or horizontal
clipping. Existing provider-label wrapping in the surrounding Sign-in & SSO
section was cramped on phones; the subsequent scoped correction and
desktop/touch-mobile light/dark acceptance are in `p20-identity-layout.md`.
It was not claimed as polished by these management checks. Coverage is Chromium
viewports, not touch-device or cross-browser parity.

## Cleanup and limits

Exact roots `/tmp/quire-ui-integrations-5rnWeu`,
`/tmp/quire-ui-integrations-FSrrbr`, and `/tmp/quire-ui-integrations-1Im2lZ`
were independently absent. Their six ports independently refused
connections: 44979/37049, 45655/35899, and 40593/43477.
All 17 native release source hashes and eight evidence/parent-test hashes
still matched the independent backend delivery.

Backend gates remain: usable independent password/verified email, deployment
policy, known identity provenance and required owning adapters. No legacy
ownership-remediation, passwordless recovery, release-fence reset or live
vendor success is supplied by this UI. Automatic managed termination is
separate. The backend reviewer reported an unrelated existing federation
policy expectation of 420 versus the current 180 owner benefit. The parent
subsequently closed its missing entitlement setup without changing the original
420 assertion; see `p19-federation-policy-fixture.md`. This is still not an
all-repository-green claim.

The DAG's earlier terminal state was not accepted as completion: it had no
FINAL handoffs. The parent fixed its out-of-scope stale migration selector,
verified 2 cases/29 assertions with all pinned hashes retained, resumed the
original owners, and then read their actual FINAL reports.
FastShort and the unresolved final-port decision were untouched.
