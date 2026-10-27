# P1 local identity

Status: local implementation verified; federation and application assembly remain separate work. Owner: identity lane, with lead follow-up on October 27, 2026. Native CLI: Bun 1.3.14 (`0d9b296a`). The child made no commits or shared edits; the lead is publishing this verified increment.

## Integration

Import `register` and `migrations` from `services/accounts/identity/index.ts` and add this module to the application's ordered module list:

```ts
{ id: "010-a-identity", lane: "A", order: 10, register, migrations }
```

`register(context: ModuleContext): void` provides both `identity: IdentityPort` and `policy: PolicyPort` through the existing service registry. Consumers use `context.services.get("identity")`, not implementation imports. Registration is synchronous; password hashing and verification are asynchronous.

Public index exports:

| Export | Meaning |
| --- | --- |
| `register` | Installs the 23 owned handlers and both service ports. |
| `migrations` | Migration `010-a-identity-local`; adds `identity_rate_limits`, `identity_ai_consent`, and `identity_requests`. Baseline SQL is unchanged. |
| `intersectPolicy` | Typed policy intersection; restrictive numeric bounds, booleans, AI mode, and sharing mode win. |
| `sessionCookie` | Cookie name `quire_session`. |
| `defaultPreferences` | Canonical initial preferences for governance-created accounts. |
| `IdentityPort`, `PolicyPort`, `Principal` | Type re-exports of the foundation interfaces. |
| `registerAuthProviderCapability` | Registers an external adapter's actual capability reader for this runtime; does not install federation/login handlers. |
| `AuthProviderCapability` | Readonly `{id,label,read:()=>Capability}` provider metadata/capability reader. |

`services/accounts/identity/mail.ts` separately exports the operator-only `readLocalMail(dataDir)` reader and is an executable local mailbox CLI. It is not a public HTTP mailbox.

## Registered endpoints

| Contract | Method and path |
| --- | --- |
| `authOptions` | GET `/api/auth/options` |
| `authRegister` | POST `/api/auth/register` |
| `authVerifyEmail` | POST `/api/auth/verify-email` |
| `authLogin` | POST `/api/auth/login` |
| `authLogout` | POST `/api/auth/logout` |
| `me` | GET `/api/me` |
| `passwordReset` | POST `/api/auth/password-reset` |
| `passwordResetConfirm` | POST `/api/auth/password-reset/confirm` |
| `sessionList` | GET `/api/me/sessions` |
| `sessionDelete` | DELETE `/api/me/sessions/:id` |
| `sessionRevokeOthers` | POST `/api/me/sessions/revoke-others` |
| `identitiesList` | GET `/api/me/identities` |
| `profilePatch` | PATCH `/api/me` |
| `avatarGet` | GET `/api/me/avatar` |
| `avatarPut` | PUT `/api/me/avatar` |
| `avatarDelete` | DELETE `/api/me/avatar` |
| `preferencesGet` | GET `/api/me/preferences` |
| `preferencesPatch` | PATCH `/api/me/preferences` |
| `emailAdd` | POST `/api/me/emails` |
| `emailDelete` | DELETE `/api/me/emails` |
| `aiConsent` | POST `/api/me/ai-consent` |
| `accountExport` | POST `/api/me/export` |
| `accountDelete` | DELETE `/api/me` |

No federation mutation/login, notification, organization, billing, admin, SCIM, Git-token, or SSH-key handlers are claimed here. The lead explicitly assigned the newly added authentication-options and linked-identity read contracts; the owned avatar-read and email-delete deltas are also consumed.

### Governance successor contract ownership

The following contracts have landed and belong to the governance successor rather than this identity module:

| Contract | Method and path | Owner |
| --- | --- | --- |
| `notificationPreferencesGet` | GET `/api/me/notification-preferences` | A, governance successor |
| `billingInvoices` | GET `/api/organizations/:o/billing/invoices` | A, governance successor |
| `billingPortal` | POST `/api/organizations/:o/billing/portal` | X, P2 adapter lane |

The A-owned GET handlers must read actual persisted notification settings/invoices with their account/organization authorization. A landed contract is not an implemented handler. Do not register `billingPortal` from A or manufacture a portal URL; its external provider implementation belongs to X P2. The lead owns verification of the shared contract regression.

## Authentication reads and mutation counters

**Assigned and implemented:** `authOptions` and `identitiesList` are identity-lane handlers in `services/accounts/identity/reads.ts`. `index.ts` invokes `registerReads(context,{repository,auth})` from its actual module registration. Neither handler is deferred to a successor. `tests/accounts/identity/composition.test.ts` also installs this module into the real `createApplication` and verifies both routes through an ephemeral HTTP server.

`GET /api/auth/options` is public. The implemented local password and registration handlers produce `passwordEnabled:true` and `registrationEnabled:true`. There is no local feature-disable configuration to pretend to enforce. External providers are empty unless their owning adapter calls:

```ts
registerAuthProviderCapability(context, {
  id: providerId,
  label: configuredLabel,
  read: () => configuredAdapterCapability,
});
```

The capability reader must return the adapter's actual configuration/registered capability; it is evaluated on every options read. Registration is runtime-scoped rather than process-global, duplicate IDs fail, and output is sorted by ID. This module invents no Google/GitHub/ORCID/SSO entries and claims no federation implementation. Adapters must register their corresponding real login handlers separately; the availability function does not create them.

`GET /api/me/identities` requires the current session, queries only that user, and returns stable UUID-keyset pages of actual `{id,issuer,subject,createdAt}` records. Identity records are immutable and have **no fabricated mutation version**.

The optimistic version for a future `identityUnlink` is the **account aggregate** `users.version`, obtained from the user's ETag (`/me`, login, or profile mutation); identitiesList also exposes that same user ETag. The external-identity unlink owner must compare `expectedVersion` to this account counter, unlink and increment it atomically, preserve the final login route, and return the new user ETag. This local module does not claim an unlink implementation.

Session records instead serialize their own existing `sessions.version`, including nonzero counters. They never borrow the account version. Profile mutations retain the user response ETag; preference counters remain independent.

The landed read schemas match these handlers: AuthOptions is `{passwordEnabled,registrationEnabled,providers:[{id,label,capability}]}` and each linked identity is `{id,issuer,subject,createdAt}`. The session list serializer selects and returns the real `sessions.version`; its owned HTTP regression uses persisted version 7 rather than assuming zero.

## Security and persistence behavior

Passwords use real asynchronous Argon2id with 65,536 KiB memory and three iterations. Login accepts the primary email only, requires its verified-email record, and rejects suspended/deleted users. Verification does not sign in. Recovery does not sign in. A nonexistent recovery address receives the same successful public result as an eligible address.

Session secrets contain 256 random bits. SQLite stores their SHA-256 hashes, not their bearer values. CSRF values derive from an HMAC over the bearer using the private runtime key; only their hashes enter the session table. Cookies are `HttpOnly; SameSite=Lax; Path=/` with seven-day expiry and `Secure` when `QUIRE_PUBLIC_URL` uses HTTPS. Plain HTTP remains usable for the explicitly local development origin. The public URL, not request-supplied Host or forwarding headers, determines cookie security and accepted Origin.

All public credential mutations require the configured Origin. Authenticated mutations additionally require the current session and matching `X-CSRF-Token`; foreign `Sec-Fetch-Site: cross-site` is denied. A client signs in, reads `/api/me`, and sends its returned CSRF value on writes. Login rotates a presented session. Reads check current persisted expiry, user suspension/deletion, and session existence; successful authentication updates `last_seen_at`. Session revocation and reset therefore invalidate the next HTTP authentication immediately. Session IP remains null because the frozen RequestContext has no trusted peer-IP field.

Verification tokens expire after 24 hours; recovery tokens after 30 minutes. Both are random, hashed, purpose-bound, transactionally single-use, and superseded for the same user/purpose/address when reissued. Password reset atomically consumes the token, replaces the password hash, and revokes every session and outstanding reset token.

Credential/mail abuse buckets persist in SQLite: 30 requests per operation
category and subject per 15-minute bucket. Registration/login/recovery use
normalized email; verification/recovery confirmation use the supplied token;
secondary-email creation uses the authenticated account ID. Bucket keys are
HMACs and never contain raw addresses or tokens. One account exhausting its
budget no longer blocks unrelated accounts. This is not a distributed
trusted-peer limiter; public deployment still needs that ingress control.

Profile changes use the user counter exposed by `/me` ETag. Preferences have their own counter and ETag. Session list records expose the persisted session `version`. Avatar replacement checks the matching If-Match and body counter, limits input to 2 MiB PNG/JPEG magic/MIME, writes actual bytes through BlobStore, and references their digest transactionally. Avatar GET requires authentication and returns only the current user's exact stored bytes, correct PNG/JPEG MIME, inline disposition, content-digest ETag (not an optimistic resource counter), `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`. Missing avatars return 404 with private/no-store caching; an account without an avatar cannot read another user's image.

Secondary addresses do not become verified until their one-time link is consumed, and they never become password-login aliases. `emailDelete` accepts exactly `{email,expectedVersion}`; it normalizes the requested address, compares the persisted primary address case-insensitively, and scopes both lookup and deletion to the authenticated user. The existing verified-email column uses NOCASE collation, so mixed-case stored secondary addresses match. Primary removal returns 409 to preserve the local login route; another user's address returns 404; managed-account removal returns 403. Denied actions leave the user counter unchanged; successful deletion increments the account counter and returns its ETag. No email UUID discovery or emailsList endpoint is needed. Managed accounts cannot self-delete, change secondary addresses, or use local password recovery. Managed-account lifecycle/SSO enforcement remains the organization/external-identity lanes' responsibility.

Registration, secondary-email creation, and account export honor stored idempotency keys and reject changed input under a reused key. Request fingerprints use the private runtime HMAC key rather than creating a fast offline password-verification digest.

AI consent persists the supplied nonempty terms version and acceptance state. It emits a durable `policy.changed` event with the user aggregate/counter. There is no current-terms catalog in the foundation contracts; this lane does not invent one. A future configured terms authority can require renewed acceptance of its version.

`policy.forProject` reads persisted global/user/project policy_sets, workspace organization policy, member organization policy, and organization-scoped policy_sets. It intersects all applicable settings: false booleans, smaller finite limits, lower AI mode, and narrower sharing win. Null numeric limits mean unlimited. With no persisted policy it uses local defaults (including AI off); absent/refused consent always forces AI off. Invalid stored policy fails closed rather than returning an invented grant. This port resolves policy, not project ACL: consumers must separately call ProjectPort authorization and recheck policy before AI context lookup, dispatch, and edit acceptance.

Account export creates a real persisted, completed `account-export` Operation. Its `result` contains account/profile/preferences/email/consent/identity/membership/project-index/notification/library metadata, with no authentication hashes, bearer tokens, or provider credentials. It is explicitly not a source/history archive or full account recovery image. Project source/history export belongs to K. The completed result is returned inline, so this endpoint does not depend on an invented download URL.

Account deletion requires a session created within 15 minutes, exact primary-email confirmation, the current password, and a complete reassignment of every owned project to an active verified user. Version checks and all reassignments are one SQLite transaction. Reassignment emits durable project `access.changed` events. The account becomes an anonymous suspended tombstone to preserve historic foreign-key attribution. Sessions, tokens, verified emails, identities, preferences, Git tokens, SSH keys, project/organization memberships, consent, local mail, account exports, personal library, notification settings, and identity idempotency records are removed; provider secrets are cleared and grants disabled. Authored collaborative history/content remains attributed to the tombstone, not silently deleted from collaborators' projects.

The last active operator cannot self-delete. The current active-operator count
is checked inside that same transaction before counters or account data change.
An operator can delete their account when another active operator remains.

## Durable session revocation contract for K and governance

**Implemented:** every owned session-removal path appends the landed `session.revoked` event in the same SQLite transaction as the session deletion. The runtime persists both the event and its outbox row; `events.dispatch()` runs only after commit. A failed event insert rolls back the session removal, rather than losing the transport invalidation.

```ts
{
  topic: "session.revoked",
  aggregateId: userId,
  payload: { userId, sessionId }
}
```

`userId` and a non-null `sessionId` are checked Id values. `aggregateId` always equals `payload.userId`. `sessionId:null` means every session for that user. The event contains no raw cookie, CSRF value, password, or one-time credential.

| Writer | Payload sessionId | Transaction boundary |
| --- | --- | --- |
| `authLogout` | Current session ID | Delete and event append commit together. |
| `sessionDelete` | Checked target session ID | Account scope/version comparison, delete, and append are atomic; conflicts append nothing. |
| `sessionRevokeOthers` | Each actual removed ID separately | DELETE RETURNING identifies removed rows; one event per ID, never null, so the current session survives. No removed rows means no revocation events. |
| `passwordResetConfirm` | null | Token consumption, password replacement, all-session deletion, and wildcard append are atomic. |
| `accountDelete` | null | Project reassignment, session deletion, tombstone/account cleanup, and wildcard append are atomic. |
| Login cookie rotation | Actual previous session ID | Old deletion and new insertion share a transaction; event user/aggregate comes from the removed row, even when signing in to a different account. |

K subscribes through the internal EventPort and closes already-authenticated sockets/SSE subscriptions matching `payload.userId` and either the named session or all sessions when null. It must not treat revoke-others as an account-wide closure or broadcast this user-scoped control event to unrelated project readers. Durable sequence/replay uses the existing events/outbox interface; polling the session table is not needed to discover these revocations.

Governance successors must emit this same contract for admin revoke-all, suspension, managed deletion, and other session removals they own. Local writes use `events.append(tx,event)` inside `uow.local`; portable writes use `await events.record(tx,event)` inside the corresponding UnitOfWork transaction. Dispatch follows commit. These are lifecycle events, not invented identity/session mutation versions; account and session optimistic counters retain their existing meanings.

The HTTP tests verify every owned writer, subscriber delivery against a separate SQLite connection, wildcard versus individual scope, caller survival for revoke-others, correct previous-user scope on rotation, and rollback when SQLite rejects the event insert.

## Local mailbox operation

Mail is inserted transactionally into the real `mail_outbox` with status `local`, not marked as externally delivered. Bodies contain links under `QUIRE_PUBLIC_URL`:

```text
/verify-email?token=...
/reset-password?token=...
```

An operator with filesystem access to the private data directory retrieves it using:

```sh
bun services/accounts/identity/mail.ts --data-dir /absolute/path/to/private-data
```

This opens the existing database read-only and prints actual local messages as JSON. Treat this output as sensitive: it contains usable one-time tokens. It is never exposed through an unauthenticated mailbox endpoint. The implementation does not claim SMTP delivery.

## Checks and retained evidence

Lead follow-up: `bun test tests/accounts/identity.test.ts tests/accounts/identity`
passed **42 tests, 0 failures, 175 assertions across 11 files in 13.36 seconds**.
Strict compilation of all identity sources/tests and type-aware lint exited 0.
Before the corrections, a real HTTP regression showed last-operator deletion
returning 200, and another showed an exhausted login bucket blocking an
unrelated account. Both failures are retained in the lead tool transcript.

Exact commands, passing scenario output, prior failures, and cleanup receipts are in `docs/evidence/p1-identity/verification.md`.

- `bun test tests/accounts/identity.test.ts tests/accounts/identity`: exit 0; **39 pass, 0 fail, 168 assertions**, nine test files, 20.11 seconds after durable session revocation/private avatar verification.
- Strict native TypeScript check of owned production/tests plus their actual imports: exit 0.
- Owned type-aware Oxlint with `--deny-warnings`: exit 0.
- LSP: zero diagnostics for owned production/tests.
- Real surfaces: ephemeral loopback HTTP servers with actual seed/SQLite/blob behavior, plus a separate native Bun process executing the operator mailbox CLI.
- No fixed sleeps, timing-based retries, mocked identity port, or browser-local persistence. No failing assertion was weakened or skipped.
- No browser screen acceptance is claimed; account screens belong to V, composition to F, and cross-lane browser integration to the lead.

Preserved native test history (exact intermediate failures and their HTTP envelopes are retained in the evidence file):

| Stage | Exit | Pass / fail | Assertions | Duration |
| --- | ---: | --- | ---: | --- |
| Initial live T01 checkpoint | 0 | 4 / 0 | 19 | 1.80 s |
| Shared Session.version delta exposed | 1 | 17 / 3 | 84 | 12.33 s |
| Focused missing-version diagnosis | 1 | 0 / 1, 3 filtered | 3 | 667 ms |
| Corrected initial delivery | 0 | 21 / 0 | 97 | 10.26 s |
| Read-contract follow-up | 0 | 26 / 0 | 116 | 12.28 s |
| Explicit assignment/application composition | 0 | 28 / 0 | 123 | 13.17 s |
| Mixed-case primary deletion reproduced | 1 | 0 / 1, 4 filtered | 1 | 460 ms |
| Email-address deletion correction | 0 | 31 / 0 | 132 | 12.76 s |
| Avatar/revocation first pass (lint finding retained) | 0 | 39 / 0 | 167 | 15.93 s |
| Avatar/revocation final pass | 0 | 39 / 0 | 168 | 20.11 s |

## Current integration responsibilities

1. F owns ordered application assembly using `{id:"010-a-identity",lane:"A",order:10,register,migrations}`. The owned tests exercise that real module through `createApplication` and actual HTTP; this lane did not edit shared composition.
2. `authOptions` and `identitiesList` are assigned, implemented, registered identity reads. Session list records expose actual stored counters; linked identities use the account ETag and no fabricated per-identity mutation version.
3. `emailDelete` is implemented as `{email,expectedVersion}`, with case-insensitive comparison, caller scope, primary-login protection, and managed-account protection. No emailsList endpoint is needed.
4. `avatarGet` is implemented as an authorized, byte-preserving, MIME-correct private image read with 404 when absent.
5. External federation and provider linking remain later adapter work. This lane does not claim Google/GitHub/ORCID/SAML/OIDC/LDAP login or make their unimplemented routes succeed.
6. The durable `session.revoked` contract above is produced transactionally by every owned removal path and available for K's transport invalidation without polling. Governance-owned removals must emit the same event. Policy changes retain their existing policy.changed signal for X.
7. Organization policy writers should persist full checked Policy values in the documented organization/policy_sets locations. Confidential-project security labels must translate into a project policy deny at that boundary. Local identity does not inspect K's private dashboard tags.
8. O owns cross-lane Operation reads/download authorization, distributed limiters/storage, backups/blob garbage collection, and retention. Immutable avatar bytes may remain unreferenced after a failed DB transaction or avatar deletion; this is the BlobStore contract, not a missing referenced object. Historic shared content/audit attribution is retained under the account tombstone.

## Architecture review and cleanup

Each file owns one responsibility: identity storage, authentication, credential routes, profile routes, account lifecycle, policy intersection, authentication read discovery, mailbox retrieval, or module registration. Largest production module: 164 pure lines; every owned source/test module is below 200. Boundaries use checked contract schemas/row schemas; no any, unsafe assertions, non-null assertions, enum fallthrough, suppression, redundant defensive catch, new one-off abstraction, or function parameter bloat was introduced. Finite mail variants use a complete lookup table; policy orderings use complete literal maps.

Tests exercise behavior through actual HTTP/CLI and would fail on missing CSRF enforcement, token replay acceptance, revocation failure, stale updates, missing persistence, policy-deny failure, or incorrect reassignment. No natural-language prompt/prose assertions were added. Structured error handling stays in the foundation HTTP boundary; this lane adds no logging.

Initial verification used the owned `mktemp` root `/tmp/quire-identity.BZP1hD`; the read-contract follow-up used `/tmp/quire-identity-reads.HdjzXD`; the explicit assignment/application check used `/tmp/quire-identity-composed.3cIZtO`; the email deletion correction used `/tmp/quire-identity-email.qZxAiY`; the avatar/revocation work used `/tmp/quire-identity-revocation.maPy2Q`. Each used its own TMPDIR/cache environment. Fixtures stopped their ephemeral HTTP servers, closed SQLite, and removed their individual roots through `await using`; revocation subscribers and the independent SQLite reader used `using`. Native mail CLI children exited. All check monitors completed. All five owned parent roots were removed successfully after their evidence was read. No unrelated listeners on 5173/3001, shared LSP processes, or another lane's files were stopped or removed.
