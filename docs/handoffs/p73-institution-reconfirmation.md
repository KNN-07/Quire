# Institution reconfirmation

November 6, 2026. Bounded native A53a/A53b implementation. This extends P15
admission and P16 scheduler evidence, following the P60 remaining-goal
distinction between accepted scheduling and missing reconfirmation policy.

An institution administrator or installation operator can configure a nullable
positive whole-day period, protected by the existing accounts transaction lock,
authorization, audit path, CSRF checks and expected-version conflict contract.
No mandatory period is invented. A missing policy or null period gives subsequent
enrollment/reconfirmation no scheduled expiry. Configuration changes are
prospective: existing deadlines remain unchanged until the user explicitly
reconfirms. This avoids imposing retroactive expiration on existing memberships.
The form states this behavior and supports refreshing after a stale write.

The existing self-enrollment endpoint now renews eligibility for an existing
member rather than returning before updating it. The same transaction reads
current verified email rows and institution domains, computes checked_at and
expires_at from the injected clock, preserves membership role/licensing, and
writes an audit receipt. Administrators still cannot enroll other accounts.
Idempotency replay returns the original receipt without extending a deadline;
a distinct explicit action gets a distinct request key.

The P16 default-host scheduler remains the only scheduled execution path.
Expiry is inclusive at expires_at. Ordinary unlicensed membership is removed;
explicit licensed and administrative grants, account credentials, projects and
unrelated memberships survive. Expired eligibility records now remain as
non-authorizing receipts so the portal can show overdue state after removal.
Repeated passes do not publish repeated membership-removal events. Domain loss
still removes ordinary membership and deletes nonexpired eligibility; the
portal separately reports current domain ineligibility.

The actual organization settings route mounts InstitutionReconfirmationSettings.
The native institution portal shows the current configured period, deadline,
current/expired/ineligible state and explicit reconfirmation action. The adjacent
institution template mount is owned by its separate implementation track.

## Evidence

The first focused native run passed 5 cases / 68 assertions, including P15
admission regression and the updated real application scheduler test
(`mon_2X62WAE2ET8H38CA`, exit 0). The scheduler test now configures a one-day
period through HTTP and renews the future member through HTTP rather than
installing expiry timestamps directly. It proves the millisecond before expiry,
the exact boundary after application restart, preservation of projects/licensed
and independent grants, domain-loss removal after another restart, independent
sign-in and owned-root disposal.

The expanded renewal selection passed 2 cases / 32 assertions
(`mon_DGE76V1R4SZEDV0C`, exit 0), including explicit administrator authority to
configure the period and preservation of that grant after renewal and expiry.
Account and organization-browser strict TypeScript plus touched-file type-aware
deny-warning lint passed (`mon_BNZQK7RD10JAQGE7`, exit 0).

The first browser attempt was blocked before application startup by a concurrent
unregistered billing-usage endpoint (`mon_PVBVTE90KR6NFZSZ`, exit 1).
After that lane was integrated, the actual browser journey passed 1 case /
16 assertions (`mon_RCYJK8KS1BC37HET`, exit 0). It saves a seven-day policy
through settings, enrolls through the portal, reconciles an installed already-due
receipt, observes overdue state after membership removal, explicitly renews,
and checks persisted membership and the exact seven-day deadline interval.
The native test, rather than this real-clock browser fixture, proves the exact
configured expiry boundary.

All nine screenshots under
`docs/evidence/p73-institution-reconfirmation/693d1a04-8108-4b27-a777-f4e80c67b7a5/`
were opened and inspected: settings and expired portal at 1440/390 in light/dark,
plus renewed portal at 390 dark. Principal controls are legible without overlap
or horizontal overflow; the separate featured-template mount remains present.
This is Chromium viewport evidence, not cross-browser or touch certification.
The owned root `/tmp/quire-ui-integrations-MOQAxN` was independently absent,
and ports 35915/45571 refused connections after awaited fixture teardown.
Earlier failed-browser and native roots were also independently absent.

The new migration initially omitted SQLite STRICT, causing the existing
accounts dialect-invariant test to fail. The correction adds STRICT only to
this new SQLite table and keeps an explicit PostgreSQL variant; prior accepted
migration SQL and tests were not changed. The corrected migration, renewal,
admission and actual host/restart selection passed 8 cases / 112 assertions,
followed by account strict TypeScript and changed-source type-aware
deny-warning lint (`mon_692JYHDQ4EMAMTEJ`, exit 0). This includes preservation
of accepted SQLite migration digests and reopening accepted native data.
The final native fixture `/tmp/quire-p2x-integrate-SbBFnb` was removed by awaited
disposal and its absence asserted by the test. PostgreSQL SQL is provided and
the dialect invariant passes; no live PostgreSQL execution is claimed here.

## Boundaries

Reconfirmation checks previously stored verified email against currently
configured domains. It does not send a new challenge, prove present mailbox
ownership, validate institutional domain ownership, or call an IdP. UI copy
states that limitation. Real domain/department/IdP claim verification needs an
elected authority and provider contract.

This slice does not invent Commons vendor tiers, prices, institution licenses,
AI entitlements or commercial product connections. Those remain distinct
product decisions. Accounts retain alternative sign-in methods; this work
does not provision or revalidate an external identity provider. Custom hosts
that disable the aggregate scheduler still own reconciliation invocation.
The usual scheduler wake latency applies; this does not promise instantaneous
membership removal between ticks. This evidence does not close all of A53.
