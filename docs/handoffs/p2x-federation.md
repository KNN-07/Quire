# P2X configured federation

Owner: `st_01a17c62`. October 27, 2026.
**FINAL: complete for the assigned federation adapter boundary.**

Configured institutional OIDC, SAML, TLS LDAP and SCIM Users/Groups are
implemented with the existing account, session, management and policy
boundaries. The final native command passed **53 tests, 0 failures,
112 assertions across eight files**, followed by strict TypeScript and
type-aware deny-warning lint, all exit 0. This handoff was written after
terminal checks and owned-resource cleanup.

This accepts backend adapters and direct protocol fixtures, not application
composition, product/editor UI, live institution credentials or a new live
PostgreSQL deployment. No paid/live account write was performed.

## Exact exports and assembly

Public entrypoint: `services/adapters/federation/index.ts`.

```ts
type FederationDeployment = {
  readonly organizationId?: Id;
  readonly transferTo?: Id;
  readonly ldapAllowedUrls?: readonly string[];
  readonly ldapSubjectAttribute?: string;
};

createFederationModules(
  options?: FederationDeployment & { readonly http?: SafeHttpClient },
): {
  callbacks: ServiceModule;
  administration: ServiceModule;
};
```

- `callbacks`: `066-a-federation`, lane A, order 66, with exported migrations.
- `administration`: `067-o-federation-admin`, lane O, order 67.
- Register after account identity/governance, shared modules 060/061 and
  external identity module 062. Use one fresh factory per runtime.
- The modules create no background scheduler, listener, or persistent LDAP
  client. LDAP clients use `await using`; shutdown follows ordinary runtime
  request draining and `runtime.close()`.

Other exact index exports are `migrations`, `FederationConfigurations`,
`emptyConfig`, `FederationOidc`, `FederationSaml`, `FederationLdap`,
`FederationProvisioning`, `groupCeiling`, `authenticateLdap`,
`enrollFederationBreakGlass`, `rotateFederationCertificates`, and the
`FederationConfiguration` / `FederationDeployment` types.

The FINAL `p2x-base.md` and `p2x-identity.md` handoffs were read completely,
along with accepted `p1s-verification.md` and implementation-plan sections
3 and 7-10. The implementation consumes the actual async runtime contracts:
all transaction callbacks use their supplied executor, external protocol I/O
precedes SQL publication, and account/session/configuration authority is
rechecked before commit. Transfer uses the existing governance
`transferProjects` function with that transaction; no direct Git/source
mutation, invented repository, or copied project transfer implementation exists.

Identity retains the common A-lane start/callback/link dispatcher. Federation
contributes `oidc`, `saml`, and the disabled-for-public-start
`federation-test` callback provider. It owns the SAML ACS, LDAP login, SCIM
transports and O-lane administration. Do not register duplicate generic
identity handlers.

## Delivered contract deltas

The parent authored these foundation/account changes; this child did not edit
outside its exclusive scope:

- Existing `identityConfigGet`, `identityConfigPut`, `identityTest`,
  `identityMetadata` and `scimToken` are O-laned.
- `identityBreakGlass`: POST `/api/admin/identity/break-glass`, `{password}`,
  Ok result.
- `identityCertificates`: POST `/api/admin/identity/certificates`,
  `{certificates,expectedVersion}`, IdentityConfig result.
- `ldapLogin`: A-lane POST `/api/auth/ldap/login`,
  `{username,password,returnTo}`, User result with rotated session cookie.
- `identityTest` accepts optional `ldapUsername` and `ldapPassword` for actual
  user-bind verification, rather than falsely accepting service-bind success.
- Account policy intersects independent `federation-user` rows with existing
  user/project/organization/global policies.
- `OpenIdVerifier.verify` preserves signed custom claims and accepts
  `strictIssuer: true`; federation uses that exact option.

Assembly-only organization, explicit transfer target, LDAP allowlist and
immutable-subject attribute were accepted by the parent and are validated at
construction. No missing-port cast, suppression or unowned route schema was
introduced. Root composition remains the parent's integration step, preserving
the accepted backup-admission lifecycle.

## Verified behavior

OIDC performs actual discovery, authorization code/client authentication,
S256 PKCE, nonce and browser-bound single-use state. Real RSA/JWKS fixtures
prove signature, exact issuer, audience, nonce, expiry, verified-email,
configuration fencing, replay rejection and signing-key rotation.
Custom group attributes are consumed only after cryptographic validation.
Existing-email collisions never silently merge accounts.

SAML is SP-initiated and requires signed response **and** signed assertion,
RSA-SHA256/SHA256, one direct assertion, issuer/audience/destination/recipient,
condition and subject-confirmation times, InResponseTo and durable
request/assertion replay protection. DTD/entity declarations are rejected.
Actual XML signatures cover both layers. Tests reject tampering, either
missing signature, wrong issuer/audience/destination/recipient/request,
expiration and replay; overlapping signer rotation succeeds and a retired
signer fails. Production cross-site POST state cookies use Secure/SameSite=None.

LDAP uses real TLS with CA/hostname verification, an exact assembly directory
allowlist, escaped subtree search, bounded connections/search, one unambiguous
result without referrals, then a user-DN bind. The real OpenLDAP fixture proves
valid authentication, wrong-password rejection after successful service bind,
allowlist denial, filter-injection resistance, untrusted-CA rejection,
HTTP session issuance and actual operator draft authentication.

SCIM uses separate hashed bearer credentials, raw SCIM JSON envelopes,
Users/Groups create/read/list/PATCH/DELETE, SQL-backed paging/filtering, weak
ETags and conditional mutations. ExternalId create replay is idempotent;
changed input conflicts. Group membership maps to the least privileged
matching role/AI ceiling, never automatically licenses a member, and does not
overwrite an independent user policy. Tightened configuration applies to
existing active federated accounts immediately.

Deactivation revokes sessions/grants but never deletes projects/accounts/
repositories. Project owners require both an explicit verified transfer target
and **accepted management by that organization** before reassignment.
Tests drive actual governance invitation/acceptance and release endpoints.
Ordinary institutional enrollment cannot gain transfer authority, and a
released account cannot be suspended again through SCIM. The last
administrator/operator and enrolled break-glass account remain protected.

Require-SSO checks explicit password-verified operator enrollment and preserves
that operator's recovery path while denying ordinary password login.
Configuration reads are redacted; runtime-key AES-GCM protects provider and
draft credentials, and SCIM token retry receipts are encrypted.
Operator tests become successful only after a real signed callback or actual
LDAP user bind; tests never create accounts or grant sessions/memberships.

## Migration and preservation

New additive migration: `066-x-federation`, exported by `migrations.ts`.
It creates configuration, request/replay, bearer, SCIM resource/membership,
adapter-membership/claim and draft-test tables. SQLite uses STRICT/BLOB;
PostgreSQL has an explicit non-STRICT/BYTEA variant.

| Dialect | SHA-256 of exact SQL |
| --- | --- |
| SQLite | `6848926a24cab770c36df67a751139a1e384800276db30b74f81648af71b6877` |
| PostgreSQL | `54e0ca57d89dcf2d2b0c956d90e27720b2ee04ec39e9b7b66b1aee3e797392f1` |

No original input or applied SQLite definition was edited. The native migration
test re-applies the adapter migration and retains every existing ledger
ID/digest/timestamp, with foreign-key checks clean. New PostgreSQL SQL was
authored but not executed against a live PostgreSQL instance by this child;
that is an explicit integration verification prerequisite, not a scale pass.

## Terminal commands and evidence

All product/test execution used native **Bun 1.3.14**.

```sh
docker build -t quire-p2x-federation-ldap:st_01a17c62 \
  -f tests/adapters/federation/Dockerfile tests/adapters/federation

bun test tests/adapters/federation &&
node_modules/.bin/tsc --noEmit -p tests/adapters/federation/tsconfig.json &&
node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/adapters/federation tests/adapters/federation
```

- Image build: exit 0, actual OpenLDAP 2.5.13+dfsg-5 installation.
- Final combined test/compiler/lint command: exit 0. Tests: 53 pass,
  0 fail, 112 assertions, eight files, 38.92 seconds.
- LSP implementation and test directory scans: zero diagnostics.
- Final owned file measurement: 28 TypeScript files, maximum 170 pure lines,
  none in the warning band.
- Owned container/process/temp-root inventory and image removal: exit 0.

Evidence:

- `docs/evidence/p2x-federation/native-final.log`: exact command, terminal
  status and complete final test output; chained compiler/lint are clean.
- `cleanup-final.log`: terminal cleanup exits, resource inventory and final
  source fingerprint.
- `history.md`: retained initial failures, their corrections and earlier runs.
- `sources.md`: official primary sources and consultation date.
- `services/adapters/federation/README.md`: operator configuration, exact
  callbacks, supported SCIM profile, lifecycle and verification commands.

Earlier seed failures were the native runtime stdin ArrayBuffer defect; its
owner fixed that boundary with `Buffer.from(input)`. No retry workaround or
test weakening was used. A task-fixture permission error was fixed with the
correct host UID/GID and tmpfs ownership, without disabling TLS validation.
The final review additionally closed the management-transfer/release gap and
its new real-governance regressions pass.

Architectural self-review: modules each own one named responsibility; untrusted
protocol values are parsed at their boundary; variant dispatch is exhaustive
or uses complete typed dispatch maps; no type escapes/suppressions, invented
ports, redundant success checks, speculative recovery layers or new logging
framework were added. Reusable helpers remain small, no function takes more
than three parameters, and resource ownership is explicit. Tests observe
protocol/account behavior rather than prompt/prose strings; no fixed sleeps,
timing-luck assertions or skipped failures exist.

## External prerequisites, profile limits and cleanup

No real institution credentials were supplied. Live OIDC needs the institution
issuer/client registration/client secret and both configured callback URLs;
SAML needs trusted IdP issuer/SSO endpoint/signing certificates and Quire's
both-signature policy enabled; LDAP needs reachable TLS directory, trusted CA,
service bind credentials, explicit directory allowlist and immutable textual
subject mapping. Production needs HTTPS publicUrl, the protected runtime key,
an existing organization, an explicitly enrolled break-glass operator and,
for managed-owner deactivation, an explicit verified transfer target.

The implemented profile deliberately limits SCIM to documented single-attribute
`eq` filters and conditional PATCH/DELETE; bulk/PUT/schema extensions are not
advertised. Emails use the account verification workflow rather than silent
SCIM replacement. Provision SCIM externalIds before first login when the account
will be SCIM-managed: existing independent accounts are not adopted by email.
Private OIDC backchannels need an approved public HTTPS gateway; LDAP uses its
separate operator allowlist. Abandoned draft operations expire cryptographically
after ten minutes and are marked failed/secret-cleared by the next test request.
Full browser/product UI and new-migration live-PostgreSQL acceptance are not
claimed.

Matrix scope: A55c, the federation portion of A54a/D08/D12, X-IDENTITY and the
assigned Q03/Q07 policy/protocol additions. Consumer OAuth and product/editor
UI remain their owners' scopes; the U editor was not touched.

All fixture HTTP servers, TLS clients, runtimes/repositories, certificate
processes, task-owned LDAP containers and temporary roots closed. The two
identified earlier failed-seed roots were removed. The task-owned image
`quire-p2x-federation-ldap:st_01a17c62` was removed after the final tests;
rebuild it before rerunning. Shared images/build caches, unrelated services,
and listeners 5173/3001 were untouched. Dependency/handoff watches had already
completed, and no test or cleanup process remains pending.

All authored files remain within the assigned federation implementation/tests,
owned evidence directory and this handoff. No workspace commit/push or nested
agent was used. No contract blocker remains.
