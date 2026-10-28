# P2X configured identity and federation admission

Owner: `st_01a17c45`. October 27, 2026.
**FINAL: complete for the assigned identity backend boundary.**

Google/GitHub/ORCID authentication, explicit linking/unlinking, durable session
rotation, verified federation admission, require-SSO password controls and
explicit break-glass enrollment/recovery are implemented. Final native
verification passed **83 tests, 0 failures, 308 assertions across 20 files**,
plus strict TypeScript, type-aware deny-warning lint and migration preservation.
This is not a live third-party login or completed product-UI claim.

## Frozen exports and assembly

Public entrypoint: `services/adapters/identity/index.ts`.

```ts
createIdentityModule(options?: {
  readonly http?: SafeHttpClient;
  readonly profiles?: readonly IdentityProfile[];
}): ServiceModule;

const identityContributions: readonly AdapterContribution[];
const identityProfiles: readonly IdentityProfile[];
identityDefinition(profile: IdentityProfile): AdapterDefinition;
const migrations: readonly Migration[];

registerIdentityProvider(
  context: ModuleContext,
  provider: IdentityProvider,
): void;

createExternalIdentityAdmission<Proof>(
  context: ModuleContext,
  verifier: {
    readonly kind: "oauth" | "federation";
    readonly verify: (
      proof: Proof,
      request: RequestContext,
    ) => Promise<ExternalIdentityVerification>;
  },
): (proof: Proof, request: RequestContext) => Promise<User>;
```

`createIdentityModule` returns `062-a-external-identity`, lane **A**, order 62,
and registers existing identity start/callback/link/unlink endpoints.
Its optional profiles are assembly-only protocol-fixture injection, never
HTTP/operator endpoint overrides. Add `identityContributions` to the shared
adapter contributions and include this module after accounts and shared
modules 060/061. Connection-grant OAuth remains separate from account login.

`IdentityProvider` extends the account capability reader with:

```ts
readonly start: (request: RequestContext, returnTo: string) => Promise<Response>;
readonly callback: (request: RequestContext) => Promise<Response>;
readonly link: (request: RequestContext, expectedVersion: number) => Promise<number>;
```

Federation registers providers through this dispatcher, not duplicate identity
routes. It owns its SAML ACS and administration routes. The genuinely FINAL
`p2x-base.md` was read completely; its actor-aware ports, availability route,
lifecycle/admission rules and released exports are consumed without casts.

### Verified account/session admission

`ExternalIdentityVerification` has these exact fields:

```ts
{
  readonly issuer: string;
  readonly subject: string;
  readonly name: string;
  readonly verifiedEmail: string | null;
  readonly allowCreate: boolean;
  readonly link?: {
    readonly userId: Id;
    readonly sessionId: Id;
    readonly expectedVersion: number;
  };
  readonly beforeCommit?: (tx: Transaction, userId: Id) => Promise<void>;
}
```

The trusted protocol verifier is bound at assembly. Its returned function
accepts protocol proof, not naked HTTP claims or a `verified: true` flag.
Verification/replay consumption and external I/O precede SQL. Admission resolves
immutable issuer/subject ownership, rejects implicit email merges, checks local
account/session authority and creates ordinary accounts only when allowed and
a verified email is available. Identity/account changes, audit, session rotation
and durable revocation events commit atomically.

`beforeCommit` uses the supplied transaction executor for configuration fencing
and authorized federation provisioning; a failure rolls everything back.
New accounts receive no operator privilege, managed ownership or memberships.
Existing linked accounts preserve their local verified email/profile.

`OpenIdVerifier` and `OpenIdExpectation` are exported directly by
`services/adapters/identity/oidc.ts`. The parent supplied the bounded final
follow-up: signed custom attributes/groups survive verification, and optional
`strictIssuer: true` requires exact issuer equality. Federation must parse its
configured custom attributes before authorization. Default Google login retains
Google's documented legacy alias; other issuers require exact equality.
The parent's real RSA/JWKS/custom-claim/tamper/issuer test passes in this node's
final combined run.

### Account-side policy hooks

`services/accounts/identity/index.ts` exports:

```ts
registerIdentityPolicy(
  context: Pick<ModuleContext, "services">,
  read: (executor: SqlExecutor) => Promise<IdentityPolicy>,
): void;
identityPolicy(context: ModuleContext, executor?: SqlExecutor): Promise<IdentityPolicy>;
passwordAllowed(context: ModuleContext, userId: Id, executor?: SqlExecutor): Promise<boolean>;
requireEnrolledBreakGlass(context: ModuleContext, userId: Id, executor?: SqlExecutor): Promise<void>;
enrollBreakGlass(context: ModuleContext, input: {
  readonly principal: Principal;
  readonly password: string;
}): Promise<void>;
```

`IdentityPolicy` is `{ readonly requireSso: boolean; readonly breakGlassUserId:
Id | null }`. With no registered federation policy, local startup is unchanged.
The persisted reader uses the supplied executor inside transactions.
Require-SSO denies ordinary password login, local signup, reset issuance/
confirmation and consumer OAuth; provider discovery reflects that disable.

Only the explicitly enrolled, currently active operator with verified primary
email and a password gets the password exception. Enrollment verifies the
current password and fresh active operator session, then persists enrollment
and audit. Saving an operator ID is not enrollment. Federation must check
`requireEnrolledBreakGlass` before enforcing SSO. Ordinary one-use password
recovery remains available to that enrolled operator.

## Provider configuration and observed behavior

`services/adapters/identity/README.md` documents exact operator fields,
callbacks, browser handling, federation usage and policy enrollment.
Configure encrypted JSON `{ clientId, clientSecret }` through the existing
operator provider API with CSRF, expected version and matching `If-Match`.

| Provider kind | Pinned base URL | Requested scopes |
| --- | --- | --- |
| `identity-google` | `https://accounts.google.com` | `openid email profile` |
| `identity-github` | `https://github.com` | `read:user user:email` |
| `identity-orcid` | `https://orcid.org` | `openid` |

Callbacks are exactly `<public origin>/api/auth/{google,github,orcid}/callback`.
Production needs HTTPS, exact registered callbacks, real client credentials,
provider consent/approval and the same runtime encryption key on every API.
Google needs consent-screen/web-client setup; GitHub needs an OAuth App with
wildcard callbacks disabled; ORCID needs Public API registration or an applicable
Member API contract. No additional executable or paid API contract is needed
for these login protocols.

Google validates discovery, RS256/JWKS, issuer, audience/authorized party, nonce,
expiry and optional access-token hash, and uses S256 PKCE. GitHub uses S256 PKCE,
re-reads `/user` and verified primary `/user/emails` after every exchange, and
never trusts its public profile email.

ORCID's consulted discovery exposes neither PKCE nor verified email. Its actual
confidential-client code/nonce/signed-ID-token flow is implemented without
pretending an ignored challenge is enforced. First verify a local account and
explicitly link ORCID; subsequent ORCID-only login resolves that durable link.
Unlinked ORCID-only signup returns `VERIFIED_EMAIL_REQUIRED`, never a fake
email/account. No real credentials were supplied or live user login claimed.

State is browser/provider/configuration/session bound, hashed, expiring and
one-use; PKCE verifiers are encrypted with runtime secrets. Return paths are
restricted to local projects/settings paths. Linking requires explicit CSRF and
fresh local authorization; ordinary login never silently links. Email collisions
require authenticating the existing account and explicitly linking.
Unlink protects the last stored sign-in method, forbids managed/require-SSO
self-unlink, and revokes every Quire session transactionally. No provider token
is retained as a connection grant; provider consent remains under the user's
provider account controls. Unconfigured providers name missing credentials;
`ready` means configured, not independently verified live credential acceptance.

## Migrations and original-data preservation

Both additive migrations are exported by the **new adapter module**:

| ID | SQLite SHA-256 | PostgreSQL SHA-256 |
| --- | --- | --- |
| `011-a-identity-breakglass` | `23d56b25eccc860edc1a803cff44f2a519be77ac527ec410df5617e559e6f7ba` | `235a0c4535e848d9ecda101312767e27624475d320be33fadddd7ea72f56143e` |
| `062-a-external-identity` | `5d07b2a1c9b4b3dc60d437d6b17ede2dfd559bf7ec4d499c009ff050ce26d388` | `8b252bb023c5fc29f128f6856509c1103bba89d0ae29eafa2264326cddc3325c` |

They add `identity_breakglass` and `identity_oauth_states`; SQLite uses
STRICT/BLOB, PostgreSQL has explicit non-STRICT/BYTEA variants. The original
account module migration inventory is unchanged. Its SQLite `010` SQL remains
byte-identical to baseline `3fe3a23`, digest
`36537de09a04c6bf116c8ff538539d9fbc57be443752d41443ba9d7adf4a18c2`.
Existing account migration tests retain original rows and applied receipts.
The new PostgreSQL variants were authored but not executed against live
PostgreSQL by this node.

## Terminal verification and cleanup

Native Bun **1.3.14**. This final command terminated **exit 0**; raw evidence is
`docs/evidence/p2x-identity/accepted-final.log`:

```sh
bun test tests/adapters/identity tests/accounts/identity tests/accounts/migrations.test.ts &&
bunx --no-install tsc --noEmit -p tests/adapters/identity/tsconfig.json &&
bunx --no-install oxlint --type-aware --deny-warnings \
  services/adapters/identity \
  services/accounts/identity/authentication.ts \
  services/accounts/identity/credentials.ts \
  services/accounts/identity/reads.ts \
  services/accounts/identity/index.ts \
  tests/adapters/identity &&
bun docs/evidence/p2x-identity/audit.ts
```

Result: **83 pass / 0 fail / 308 assertions / 20 files / 52.10 seconds**.
All chained strict/lint/audit commands completed. This also includes the
parent's new federation-policy and verifier tests. No failing test was skipped,
deleted, weakened or retried until green.

Coverage includes actual HTTP code exchange with server-validated PKCE/client
secret/redirect and one-use code, real RSA/JWKS, bad issuer/audience/nonce/
signature/expiry, unverified email, browser/state/provider/replay denial,
account collision, explicit linking, revoked linking session, session rotation,
all-session unlink revocation, suspension, configuration fencing, fresh-runtime
session persistence, ordinary password denial, unenrolled-operator denial,
enrolled recovery and pre-SSO reset-token rejection. No fixed sleeps are used.

Earlier failures remain in `initial-checks.md`, `terminal-results.md` and raw
logs. A concurrent runtime stdin defect was fixed by its owner with
`Buffer.from(input)` before the final run. The initial test-only provider-grant
column typo and literal/type/lint issues were corrected. The migration inventory
concern was resolved by moving unchanged new SQL into the new adapter module.
Final adapter LSP scan had no errors; one earlier account-index freshness request
timed out, followed by the successful authoritative strict compiler.

Successful fixtures awaited HTTP, shared-adapter, runtime/repository and
temporary-root disposal. Four positively identified earlier failed-setup roots
were removed after confirming no live SQLite users; paths and native exit-0
receipts are retained. Concurrent roots were untouched. The parent RPC watch
was stopped; completed producer watches have no remaining terminal sessions.
No owned process/test is pending. No browser/container was created, no shared
image or listener 5173/3001 was touched, and no commit/push or nested agent occurred.

Self-review: single-purpose modules; owned source below 200 pure lines (largest
177); parsed protocol boundaries; exhaustive dispatch; no type escapes,
suppressions, speculative defensive layers or new logging framework; no
oversized parameter lists; behavioral regressions rather than prose tests.

## Integration deltas and acceptance limits

- Parent assembly adds the contributions and A-lane module while preserving
  backup lifecycle/admission wiring. Federation `st_01a17c62` consumes the actual
  admission/registry/policy hooks above.
- `apps/web/src/features/account/identities.tsx` currently discards Link response
  headers. Use existing `callWithMetadata`, unwrap `.result`, then navigate to
  `.metadata.headers["location"]`. After unlink, navigate to sign-in because all
  sessions are revoked. No link DTO change is needed.
- Public `AuthOptionsSchema` has no domain-routing DTO. An interactive domain
  chooser needs a foundation-owned endpoint/schema addition. Federation admin
  must wire fresh-session/current-password break-glass enrollment; merely
  selecting `breakGlassUserId` is insufficient.
- A54a and the A55c account/session seam are covered here. SAML/OIDC/LDAP admin,
  group provisioning and certificate rotation remain federation's work.
  D08/D14/D23 backend controls are covered, not full browser/UI acceptance.
  Live OAuth, new-migration PostgreSQL execution, global build and full-workspace
  release acceptance are not claimed.

Official primary sources consulted October 27, 2026 are retained with URLs
and contract observations in `docs/evidence/p2x-identity/sources.md`: Google
OIDC/discovery, GitHub OAuth App authorization, ORCID authenticated iD/OpenID
tutorial/discovery, and Zod API reference. Context7 was unavailable; official
pages were fetched directly. Original inputs were not edited.
