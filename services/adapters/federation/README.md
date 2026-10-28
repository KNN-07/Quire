# Configured institutional federation

Native Bun 1.3.14. The adapter supports one operator-configured institution
per runtime. Providers are not connected by default. Fixture verification does
not establish access to a real institution's IdP or directory.

## Assembly

Register accounts identity/governance and the shared adapter and external
identity modules first. Then:

```ts
import { IdSchema } from "@quire/contracts";
import { createFederationModules } from "./services/adapters/federation";

const federation = createFederationModules({
  organizationId: IdSchema.parse(operatorConfiguredOrganizationId),
  transferTo: IdSchema.parse(explicitVerifiedTransferTarget),
  ldapAllowedUrls: ["ldaps://directory.institution.example:636"],
  ldapSubjectAttribute: "entryUUID",
});
// Add federation.callbacks and federation.administration to runtime modules.
```

`organizationId` is an existing institution/team. `transferTo` is optional:
without it, SCIM deactivation of any project owner fails with
`SCIM_TRANSFER_REQUIRED`. A configured target must be a distinct active,
verified member of that institution. These assembly options cannot be supplied
by an anonymous login or a SCIM client. LDAP URLs must match the assembly
allowlist exactly; the immutable subject attribute must match the provider's
SCIM externalId mapping. UUIDs, attribute names and allowlist URL structure are
validated at construction.

The callbacks module is A-laned, order 66, and owns additive migration
`066-x-federation`. The administration module is O-laned, order 67.
`createIdentityModule()` retains ownership of the common provider dispatch.
Do not register duplicate identity start/callback/link handlers. No scheduler,
background LDAP connection, listener, or external process is created by these
production modules; each LDAP client unbinds through async disposal.

## Operator configuration

Use an authenticated, fresh operator session and normal Origin/CSRF headers:

- `GET /api/admin/identity`: redacted `IdentityConfig`, with ETag.
- `PUT /api/admin/identity`: the existing configuration payload with
  `expectedVersion`, matching `If-Match`, and optional `oidcSecret` /
  `ldapSecret`. Omitted secrets preserve existing ciphertext; empty secrets
  clear credentials. Reads expose only `secretPresent`.
- `POST /api/admin/identity/break-glass {password}`: explicit enrollment of
  the requesting active operator after current-password verification.
- `POST /api/admin/identity/certificates {certificates,expectedVersion}`:
  replace the trusted SAML signing-certificate set. Install old and new
  certificates together, switch the IdP signer, then remove the old certificate.
- `POST /api/admin/identity/test`: `{draftConfig,nonce,oidcSecret?,
  ldapSecret?,ldapUsername?,ldapPassword?}` with `Idempotency-Key`.
- `GET /api/admin/identity/metadata.xml`: operator download of SP metadata.
- `POST /api/admin/scim/token {}` with `Idempotency-Key`: returns one bearer
  secret and revokes previous bearer tokens. Retry receipts are encrypted;
  tokens are hashed for authentication and never included in configuration.

Secrets are AES-256-GCM encrypted using the existing runtime secret key,
with associated resource identity. Production retains `QUIRE_SECRET_KEY`
according to the runtime key-management policy. Configuration mutations,
mapping ceilings, receipts and events use the caller-owned SQL transaction.
Provider network exchanges happen before admission transactions, followed by
configuration-version fencing and atomic account/session publication.

`requireSso` cannot be enabled without a ready configuration and a verified,
password-bearing, explicitly enrolled active operator identified by
`breakGlassUserId`. It disables ordinary password login and consumer OAuth;
the enrolled operator's password remains usable. Merely putting an operator
ID in a draft does not enroll it. Federation and SCIM cannot change an
enrolled break-glass account.

Configuration readiness names missing organization, issuer/client credentials,
certificates, directory URL/base/bind/CA, or assembly directory allowlist/
immutable-subject mapping. A ready configuration is structurally complete;
only the real handshake test proves provider interoperability.

## OIDC

Configure `protocol: "oidc"`, `oidc.issuer`, `clientId`, scopes including
`openid`, `oidcSecret`, verified email domains and attribute names. Register
these exact redirect URLs at the IdP:

```text
{publicUrl}/api/auth/oidc/callback
{publicUrl}/api/auth/federation-test/callback
```

Start login through `/api/auth/oidc/start?returnTo=/projects`. The adapter
performs discovery, validates the exact issuer and advertised authorization
code/RS256/S256 support, uses a browser-bound expiring single-use state,
PKCE, nonce, and client-secret-basic or client-secret-post as advertised.
Signature, issuer, audience/azp, nonce, times, and optional access-token hash
are checked before configured custom attributes are used. The generic
verifier is called with `strictIssuer: true`; consumer Google issuer aliases
are not accepted here. `email_verified: true` and an allowlisted email domain
are required. JWKS is fetched for verification, so a new signing key is
accepted only when published by the pinned issuer's discovered JWKS endpoint.

Backchannel HTTP uses the shared bounded, DNS-pinned, redirect-checked HTTPS
client. Private/loopback/metadata addresses are denied in production. An
internal-only IdP requires an approved public HTTPS gateway; fixture origins
are literal loopback-only assembly injections, not a production bypass.

## SAML

Configure `protocol: "saml"` with the IdP's `entityId`, HTTPS `ssoUrl` and PEM
signing certificates. `metadataXml` is retained for operator configuration;
trust comes from explicit issuer, URL and pinned certificates, not unverified
metadata content. The SP entity ID is
`{publicUrl}/api/admin/identity/metadata.xml` and ACS is
`{publicUrl}/api/auth/saml/acs`. Attribute names and allowed email domains must
match the signed assertion.

Quire deliberately requires **both a signed response and signed assertion**,
RSA-SHA256/SHA256, one direct assertion, exact response/assertion issuer,
audience, destination and recipient, bounded conditions and subject
confirmation times, SP-initiated InResponseTo, a browser-bound RelayState,
and durable request/assertion replay protection. DTD/entity declarations are
rejected. IdP-initiated unsolicited responses, SHA1 and encrypted assertions
are not accepted by this configured profile. TLS `publicUrl` is required in
production: cross-site POST bindings use a Secure, SameSite=None state cookie.

Certificate-set changes increment configuration version and invalidate
in-flight login states. New logins during overlapping trust accept either
configured signer. Removing a certificate removes that signer's authority.

## LDAP

Configure `protocol: "ldap"`, `url`, `baseDn`, service-account `bindDn`,
`ldapSecret`, a trusted PEM CA certificate, and a `userFilter` with exactly one
`{username}`. Attribute mappings select email, name and group values.
`ldapSubjectAttribute` selects an immutable textual identifier such as
OpenLDAP `entryUUID`; binary AD objectGUID needs an explicitly configured
textual immutable attribute rather than an unsafe implicit conversion.

`POST /api/auth/ldap/login {username,password,returnTo}` returns the normal
User envelope and rotated HttpOnly session cookie. Same-origin requests and
persisted login rate limits apply. LDAPS or mandatory StartTLS precedes every
bind; certificate validation and TLS 1.2 minimum cannot be disabled.
The client service-binds, searches one allowlisted subtree with an escaped
username, rejects ambiguity/referrals, then rebinds as the returned user DN.
Service-account bind success alone is never user authentication. Empty
passwords are rejected. Connect/operation/search bounds are 5/10/5 seconds.

## Draft handshake tests

The operator test returns a durable Operation. OIDC/SAML begin as `running`,
with `result.authorizationUrl`; follow that URL using the same browser.
Only a verified callback completes the test. LDAP requires actual user-bind
credentials and can complete in the original request. No test creates an
account, grants membership, links identities, or issues a login session.
The initiating operator session must remain active. Nonces are correlated by
hash; draft secrets are encrypted and cleared after completion or expiration
cleanup. Abandoned requests expire after ten minutes; the next test request
marks expired pending operations failed and clears their draft secrets.
Operation reads remain actor/operator authorized through the existing
operations module.

## SCIM profile

Use `Authorization: Bearer <secret>` and `application/scim+json` under
`/scim/v2/Users` and `/scim/v2/Groups`. Browser cookies do not authenticate SCIM.
Responses are SCIM documents, not Quire envelopes.

- GET list/detail, POST create, PATCH add/replace/remove, DELETE are supported.
- Lists use 1-based `startIndex`, `count` 0..200 and stable resource-ID order.
  Supported filters are a single `eq` on `id`, `externalId`, `userName`,
  `displayName` or `active`; unsupported expressions return `invalidFilter`.
- Mutations of existing resources require exact weak ETag `If-Match: W/"N"`.
  Stale updates return 412; missing conditions return 428.
- `externalId` is required and unique per resource kind. Identical POST replay
  returns the original resource; changed input conflicts. Map User externalId
  to OIDC sub, SAML NameID, or the configured LDAP immutable subject.
- User email comes from the primary/first `emails` value, or an email-form
  `userName`. It must match configured domains. Existing local email collisions
  require explicit account linking, never silent SCIM takeover. `userName`
  and `externalId` are immutable in this profile. Email changes use the
  account's verified-email workflow rather than a silent SCIM email replacement.
- Group members reference SCIM User IDs. PATCH supports `members` and
  `members[value eq "UUID"]` removal. Group displayName selects configured
  role/AI mappings. Multiple matches take the least privileged role and AI
  value; no match means guest/AI off.
- Provisioning never grants a license or automatically accepts management.
  Existing independent licensing and manually owned memberships remain under
  existing account policy. Adapter-owned membership and independent
  `federation-user` policy ceilings reconcile transactionally. Configuration
  changes apply tighter ceilings to existing active federated accounts
  immediately, not only on their next login.
- `active:false` revokes sessions and provider grants and suspends the account.
  DELETE tombstones the SCIM resource and deactivates the account; it never
  deletes a Quire user/project/source/Git repository. Owners require the
  explicit transfer target and accepted institutional management first;
  an ordinary enrollee never grants project-transfer authority. A released
  account cannot be suspended again through SCIM. The last organization administrator,
  last operator and enrolled break-glass user remain protected.
- Managed acceptance/release remains an explicit account-governance workflow.
  SCIM does not assign `managed_by` or silently release/delete a managed user.

The implemented profile does not advertise bulk, PUT replacement, arbitrary
SCIM schema extensions or the full filter grammar.

## Verification

Install root dependencies with the repository lockfile, then build the
task-owned directory image:

```sh
docker build -t quire-p2x-federation-ldap:st_01a17c62 \
  -f tests/adapters/federation/Dockerfile tests/adapters/federation
bun test tests/adapters/federation
node_modules/.bin/tsc --noEmit -p tests/adapters/federation/tsconfig.json
node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/adapters/federation tests/adapters/federation
```

Tests run real RSA-signed OIDC/JWKS and signed SAML protocol exchanges and a
task-owned OpenLDAP service with verified TLS, ephemeral ports and generated
fixture certificates. LDAP readiness subscribes to the server's actual
startup event, without sleeps. Fixtures close listeners, unbind directory
clients, await process termination and remove their containers/temp roots.
No real institution credentials, external account write or paid IdP operation
is part of this suite.
