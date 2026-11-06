# P73 SAML administration

Date: November 6, 2026.

Scope: research `expand-55.md` group SSO administration, matrix A55c,
and P60 N4 link status, reminders, unlink one/all. Existing protocol,
certificate rotation, break-glass and OIDC consumers remain independent.

## Implemented authority

Organization settings mount `OrganizationSaml`. The GET and POST
`/api/organizations/:o/saml-links` contracts expose authoritative status and
explicit reminder/unlink/unlink-all actions. Only an organization administrator
or installation operator can administer the assembly-owned organization.
Reads are private/no-store. Mutations require origin/CSRF, a fresh active
session, current transactional operator/membership authority, idempotency,
configuration version and a digest of the displayed account/membership/link
snapshot. Replays recheck current authority before returning a receipt.

Reminders create one local outbox entry and an organization audit entry in the
same transaction. They do not deliver mail, authenticate a user, or grant a
link. The consumer describes local queuing explicitly.

SAML ownership is recorded only during successful verified SAML admission,
in `federation_saml_links`, referencing the identity with cascade deletion.
No migration guesses protocol ownership from issuer equality. Historical
organization-owned links acquire SAML provenance on a successful SAML login;
legacy identity authority remains unresolved. The view labels unproven links
and never silently deletes them.

Unlink deletes only proven SAML identities with the matching organization
authority and a current member in that organization. Unlink all handles those
members atomically, aborting if any lacks active, verified independent password
recovery permitted by current deployment policy. Other organization and
personal identities, passwords, management acceptance, membership and projects
are retained. All target sessions are revoked through the shared event path;
account versions advance. Federation configuration version advances without
reapplying provisioning. Pending state consumption and already-prepared
admission both check that version, preventing an old callback from restoring
an identity or session.

## Managed identifier reset

Unlink is not management release. A managed target must still have accepted
management by this same organization and independently usable password
recovery. The administrator action records a one-use relink grant bound to the
organization, user and new account version.

The SAML verifier alone supplies the narrow trusted `authorizeManagedLink`
hook. Explicit linking must authenticate the exact initiating account/session,
retain current membership and accepted management, use a fresh active session,
retain independent password recovery, and match the grant's account version.
Grant consumption, identity publication and session issue are atomic.
Other managed identity linking remains denied. The permanent
`identity_organization_releases` fence is unchanged and still runs after
authorization; its denial rolls back grant consumption. Grants cannot enroll
a released account or authorize another organization.

Passwordless, suspended, unverified, SSO-exclusive accounts without independent
password admission, foreign management and unproven legacy links remain explicit
recovery/provenance gates. A local reminder is not recovery proof.

## Verification

The existing SAML and federation administration suites passed 18 tests.
Paired migration reapplication/provenance checks passed two tests.
Final verification used repository Bun 1.4.4:

- `bun test --timeout 120000 ./tests/adapters/federation/saml-administration.test.ts`:
  one test, 58 assertions, zero failures, 3.35 seconds. This uses real HTTP
  requests, signed SAML responses and local SQLite. It verifies member denial,
  CSRF, revoked-operator idempotent replay denial, reminder deduplication,
  mismatched replay input, stale status, multi-member bulk atomicity, independent
  recovery failure, foreign/personal identity preservation, callback invalidation,
  revoked sessions, changed-identifier relink, managed grant use/consumption,
  permanent release denial with rollback, self-unlink sign-out and stale auth.
- `tsc --noEmit --pretty false -p tests/adapters/federation/tsconfig.json`:
  exit 0 on the final implementation and tests.
- `oxlint --type-aware --deny-warnings` on the changed federation, admission,
  SAML contracts/component and fixture files: exit 0.
- `bun test --timeout 180000 ./tests/adapters/federation/saml-browser.test.ts`:
  one test, 14 assertions, zero failures, 45.05 seconds. Actual composed
  application, native organization settings and Chromium exercised local reminder,
  signed explicit linking, unlink one, independent sign-in/new identifier relink,
  managed unlink all and one-use managed relink. No page errors were observed.
  The existing project and accepted management survived.

Screenshot evidence:
`docs/evidence/p73-saml-administration/111c5c56-f6f7-410e-8f68-ee97f5f2f6b3/linked-1440.png`
and `linked-390.png`. Both full-page captures were opened and inspected:
the SAML section, link status, recovery explanation and actions render clearly
without blank output or overlapping controls. Browser assertions confirm no
horizontal document overflow at both widths. This is scoped Linux Chromium
evidence, not a whole-product or cross-platform visual verdict.

The successful fixture owned `/tmp/quire-ui-integrations-gnlWE0`, web origin
`http://127.0.0.1:37609` and local signed IdP origin
`http://127.0.0.1:41783`. Cleanup closed the browser, adapters, runtime, web/API
and IdP servers; the test asserted the data directory no longer exists.
Earlier failed fixtures also ran their registered disposal paths. No real user
data or external mail was touched. No commit was created.

An initial composed run failed during application registration because concurrent
billing work registered an account endpoint in the adapter lane. After its owner
corrected the lane, assembly succeeded. Another run overlapped a response-schema
edit and is not acceptance evidence. A self-unlink fixture initially used the
protected break-glass operator; the corrected fixture uses an actual organization
administrator. Break-glass protection remains unchanged.

Live institutional interoperability
requires authorized IdP configuration; the owned signed fixture proves the native
protocol and administration integration rather than a third-party deployment.
SQLite migrations were executed; a live PostgreSQL migration was not run in this
packet. Whole-repository build and the concurrent integrated changes remain the
lead's separate acceptance gate.
