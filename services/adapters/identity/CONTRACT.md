# Identity integration boundary

Export contract, October 27, 2026; verification handoff is separate.

Identity owns the A-lane dispatch for `identityStart`, `identityCallback`,
`identityLink`, and `identityUnlink`. Federation must not register those same
routes. It may register `samlCallback` and its own administration endpoints.

Exports from `services/adapters/identity`:

- `createIdentityModule({ http? })`: A-lane service module, order 62. Requires
  accounts identity and shared adapter migrations. No connection-grant login.
  Exports both additive `011-a-identity-breakglass` and
  `062-a-external-identity` migrations. Original accounts module migration
  exports and SQL remain unchanged.
- `identityContributions`: shared adapter configuration contributions for
  `identity-google`, `identity-github`, and `identity-orcid`.
- `registerIdentityProvider(context, provider)`: add a named provider with
  `start(request, returnTo)`, `callback(request)`, and
  `link(request, expectedVersion)` handlers. Start/callback return `Response`;
  link returns the account version and sets `Location` to the start URL.
- `createExternalIdentityAdmission(context, { kind, verify })`: binds a trusted
  protocol verifier once and returns `(proof, request) => Promise<User>`.
  `kind` is `"oauth"` or `"federation"`; require-SSO denies consumer OAuth.
  Verification happens before SQL. The verifier must authenticate the proof,
  consume its replay/state binding, and return `ExternalIdentityVerification`:
  issuer, subject, name, verifiedEmail (or null), allowCreate, optional link
  (userId, sessionId, expectedVersion), and optional `beforeCommit(tx, userId)` for
  configuration fencing/provisioning. Admission never accepts raw HTTP claims.
  It atomically resolves/creates/links the account and rotates the session.
  Existing-email collisions require explicit authenticated linking.

Account exports:

- `registerIdentityPolicy(context, reader)`: reader accepts the supplied
  `SqlExecutor` and returns `{ requireSso, breakGlassUserId }`; defaults to local
  password behavior when no policy is registered.
- `enrollBreakGlass(context, { principal, password })`: explicit self-enrollment
  of an active operator after password verification and fresh session checks.
- `requireEnrolledBreakGlass(context, userId, executor)`: enforcement-time
  check for a live operator, verified primary email and enrolled password.

Federation must wire its persisted configuration reader and check enrollment
before enabling require-SSO. No automatic break-glass user is created. Admission
creates ordinary accounts only; privileged/group provisioning stays in the
federation verifier's fenced publication hook.

## Integration deltas outside this ownership

- The existing account Link button uses `client.call` and discards headers;
  change it to `callWithMetadata`, check/unwrap `.result`, then navigate to
  `.metadata.headers["location"]`. The shared client already supports this;
  no new link DTO is required. Unlink now revokes all sessions, so navigate to
  sign-in instead of immediately reloading an authenticated list.
- Root assembly adds `identityContributions` to the shared provider assembly
  and `createIdentityModule()` to the service modules. Do not alter the backup
  owner's admission/lifecycle wiring.
- A foundation-owned public domain-routing endpoint or extension to
  `AuthOptionsSchema` is needed for an interactive institutional domain chooser.
  The existing `authOptions` query schema is empty and cannot accept a domain.
- Federation administration must expose explicit break-glass enrollment
  (fresh session/current password) through its owned API or a coordinated
  foundation contract. Merely saving `breakGlassUserId` is not enrollment.
