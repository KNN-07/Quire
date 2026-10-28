# Configured account identity

This module authenticates people. It does not grant access to repositories,
Dropbox, or any other connected service. Identity tokens are used only during
the server-side exchange and are not stored as connection grants.

## Assembly and configuration

Include `identityContributions` alongside the other contributions passed to
`createAdapterModules`. Include `createIdentityModule()` after the accounts
identity module and the shared connections/provider modules. The identity
module has lane **A**, order **62**, and registers the existing account endpoint
contracts. Do not register it as lane X or duplicate the federation dispatcher.
The root application composition is owned by integration, not this module.
This module installs both additive `011-a-identity-breakglass` and
`062-a-external-identity` migrations; the original accounts module's migration
inventory remains unchanged. Federation must install these migrations before
using the break-glass enrollment/enforcement hooks.

Configure the following kinds through the existing operator-only provider
configuration API (`PUT /api/admin/providers/:kind`) or `ProviderConfigurations.put`.
It requires the current operator's session, CSRF token, provider version and
an `If-Match` header containing that version (for example `"0"` for creation).
The shared store encrypts `secret` under the existing runtime encryption key.

| Kind | `baseUrl` | Encrypted `secret` object |
| --- | --- | --- |
| `identity-google` | `https://accounts.google.com` | JSON with `clientId` and `clientSecret` |
| `identity-github` | `https://github.com` | JSON with `clientId` and `clientSecret` |
| `identity-orcid` | `https://orcid.org` | JSON with `clientId` and `clientSecret` |

Both keys must contain the actual registered application credentials. There is
no default client or credential. Keep the runtime encryption key on all API
instances; changing it without re-encrypting the stored configuration makes
the ciphertext unreadable. A changed configuration version invalidates pending
authorization, including an exchange already in progress.

Register these **exact** redirect URIs at the providers:

```text
<QUIRE_PUBLIC_URL origin>/api/auth/google/callback
<QUIRE_PUBLIC_URL origin>/api/auth/github/callback
<QUIRE_PUBLIC_URL origin>/api/auth/orcid/callback
```

Use HTTPS in production. Google requires a configured consent screen and web
OAuth client; GitHub requires an OAuth App with wildcard callback matching
disabled; ORCID requires Public API client registration (or an appropriate
Member API contract). Their approvals, credentials and consent are external
prerequisites. No external account or authorization is created automatically.

Google requests `openid email profile`, validates discovery, RS256/JWKS,
issuer, audience/authorized party, nonce, lifetime and optional access-token
hash, and requires S256 PKCE. GitHub requests `read:user user:email`, uses
S256 PKCE, re-reads `/user` on every exchange and accepts only the verified
primary entry from `/user/emails`; a public profile email is not proof.
Provider numeric GitHub ID and OIDC subject are immutable identity keys.

ORCID requests only `openid`, uses its documented confidential-client code
flow and nonce-bound signed ID token. Its discovery on October 27, 2026
advertised no PKCE support and no email claim. The module does **not** pretend
an ignored challenge is enforced, invent an email, or treat an ORCID iD as an
email address. First verify a local account, explicitly link ORCID, and then
use ORCID to sign in to that account. An ORCID-only first registration returns
`VERIFIED_EMAIL_REQUIRED`. Broader ORCID record permissions are not requested.

Without credentials, `/api/auth/options` exposes `unconfigured` and the exact
missing fields; ordinary local registration/password/recovery still work.
`ready` means the required configuration is present, not that a live user's
third-party authorization has been verified. Provider failures remain failures.

## Browser flows

Start login at `GET /api/auth/:provider/start?returnTo=/projects`. Return paths
are restricted to local `/projects` and `/settings` paths. The redirect sets
an HttpOnly, SameSite=Lax browser-binding cookie (Secure under HTTPS).
Only state hashes and encrypted PKCE verifiers are stored. State expires after
10 minutes and is consumed before exchange; provider, browser, configuration,
nonce, redirect URI and optional linking session are bound.

To link, POST `/api/me/identities/:provider/link` with `expectedVersion`, the
current cookie, same-origin headers and CSRF token. A fresh session is
required. The normal JSON result retains its existing contract, and the
`Location` response header supplies the authorization URL; use the existing
typed client's `callWithMetadata`, unwrap `.result`, and navigate to
`.metadata.headers["location"]`.
After callback the current session is rotated. Starting ordinary login while
signed in never silently links identities.

DELETE `/api/me/identities/:id` uses the existing versioned authenticated
contract. The last usable password/identity cannot be removed, and managed or
require-SSO accounts cannot self-unlink. Successful unlink revokes **all** local
sessions and publishes the durable revocation event in the same transaction.
The user then signs in again. This removes Quire's login association; provider
consent remains under the user's provider account controls. No long-lived
provider tokens are retained to revoke.

Email matches never auto-merge accounts. A matching verified email on a
different subject returns `IDENTITY_EMAIL_COLLISION`; authenticate the existing
account and explicitly link instead. Linked users retain their local profile
and verified email even if a later provider response withholds email.

## Federation admission and password controls

`createExternalIdentityAdmission(context, { kind, verify })` binds a trusted
protocol verifier during module assembly. Call the returned function with
the protocol proof and `RequestContext`. No HTTP route can pass naked claims
directly to admission. The verifier must authenticate issuer, signature,
audience, expiry, replay and request binding before returning
`ExternalIdentityVerification`. In particular, `verifiedEmail` is either a
verified claim from that authority or null, never a guessed address.

The optional `beforeCommit(tx, userId)` hook is SQL-only and receives the
supplied transaction executor. It fences the configuration and can apply
authorized least-privilege federation provisioning. Account creation, linking,
provisioning, audit, session rotation and revocation receipts commit together.
Provider I/O is performed before this transaction. A failed hook rolls back
the entire admission. Ordinary new accounts receive no operator, managed
ownership or organization membership.

Federation may reuse `OpenIdVerifier` from `identity/oidc.ts`. It retains signed
custom attributes and groups after signature/standard-claim validation; the
federation consumer must parse its configured attributes before mapping roles.
Set `strictIssuer: true` in `OpenIdExpectation` for exact federation issuer
matching. By default the Google consumer login retains Google's documented
`accounts.google.com` legacy issuer alias. No alias is accepted for other
issuers, and retaining a custom claim never makes it an authorization grant.

Federation calls `registerIdentityProvider` for each named dispatcher and
`registerIdentityPolicy(context, reader)` for its persisted enforcement state.
The reader takes the supplied executor and returns
`{ requireSso, breakGlassUserId }`. Federation owns its SAML ACS and admin
routes, but must not duplicate identity start/callback/link/unlink routes.
While require-SSO is true, ordinary password login, new local registration,
reset issuance/confirmation, and consumer OAuth login cannot bypass it.
The only password exception is an explicitly enrolled active operator.

Before enabling require-SSO, a fresh active operator must call
`enrollBreakGlass(context, { principal, password })` with their current
password; it verifies the password, current session, operator status and
verified primary email and stores an audit record. Federation configuration
must call `requireEnrolledBreakGlass(context, id, tx)` before enforcing SSO.
Changing the named ID alone does not enroll that account. Existing operator
privileges must remain active. Enrolled recovery uses the existing one-time
mail reset flow. The federation administration endpoint must wire this hook;
this module does not add an unregistered or untyped enrollment HTTP endpoint.

The current public `AuthOptionsSchema` has provider capabilities and global
password/registration booleans, but no domain routing DTO or break-glass
enrollment request. An interactive domain chooser/enrollment control needs a
foundation-owned contract addition; consumers must not smuggle those fields
into existing strict request schemas.
