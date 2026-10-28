# P6 identity UI

Status: FINAL. October 27, 2026. Owner: `st_01a17e23`.

## Acceptance

The actual LinkedIdentities consumer follows the exact authorization Location
returned by `identityLink`, completes the existing loopback OIDC authorization
and callback, and displays the saved identity. Successful unlink navigates to
sign-in because the service clears and revokes every account session.

Project-local Bun 1.4.4:

```sh
./node_modules/.bin/bun test tests/ui-product/account/identity-return
./node_modules/.bin/tsc --noEmit -p tests/ui-product/account/identity-return/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings apps/web/src/features/account/identities.tsx tests/ui-product/account/identity-return/identity-return.test.ts
```

Final terminal `bash_9`: exit 0. Browser: **1 pass, 0 fail, 37 assertions,
48.71 seconds**. `IDENTITY_ACCEPTANCE_EXITS browser=0 types=0 lint=0`.
Durable complete output: `docs/evidence/p6-identity-ui/acceptance-final.log`.
SHA-256: `ffce71a8282dbd078f1c65b07b85e4bcda89a8579728edab86d4a6873a058534`.

The earlier failed fixture runs are explicitly preserved/described in
`docs/evidence/p6-identity-ui/provenance.md` and `acceptance.log`; they are not
acceptance. No result is inferred from DAG status. LSP was unavailable because
biome was absent; strict TypeScript and type-aware oxlint passed without adding
dependencies. Global tsc was not rerun; the parent separately owns its reported
concurrent updater migration diagnostics.

## Consumer and authority

Only production edit owned here:
`apps/web/src/features/account/identities.tsx`.

- Link uses existing `client.callWithMetadata`, unwraps its result before
  navigation, and passes the returned `metadata.headers["location"]` unchanged
  to `location.assign`. Missing Location is an actionable error, not success.
- It does not invent a provider URL, reconstruct state, bypass callback, refresh
  the pre-callback identity list, or claim a link before verified persistence.
- Unlink unwraps the actual server result before `location.assign("/sign-in")`.
  It does not refresh an authenticated identity list after session revocation.
- Existing null-version guards, current-user authorization, server error
  propagation, provider capability/reason display, and password reset link remain.

The server's existing protocol binds provider/configuration version, browser
cookie, initiating user/session, account version, nonce and PKCE verifier. Those
services and contracts were read, not changed.

The parent supplied a separate one-line alias in `settings.tsx`:
`/settings/identities` selects the security tab. The regression follows the
actual server callback to that exact path and asserts `aria-current="page"` on
Sign-in & SSO. This task never wrote settings.tsx or changed server returnTo.

## Real browser evidence

`tests/ui-product/account/identity-return/identity-return.test.ts` reuses the
FINAL P3 actual application fixture read-only, the existing real local protocol
provider, and the owned Chromium launcher. Assembly registers an explicit local
OIDC profile; the real operator configuration stores fixture credentials.
The provider performs discovery, authorization code issuance, PKCE validation,
token exchange, RS256 ID token signing and JWKS verification. There is no
intercepted identity response, seeded linked identity, or fabricated success.

Assertions include:

- Browser authorization request equals the Link response Location exactly;
  callback URI is the actual same-origin `/api/auth/google/callback`.
- State, nonce and S256 challenge are present; one token exchange occurs.
- Callback returns 303 to `/settings/identities`; issuer and `subject-one`
  are read back through the real identities API, and the old session is denied.
- Wrong-browser binding and replay with the original consumed browser binding
  receive `OAUTH_STATE_INVALID`/400 without another token exchange. These probes
  run after successful callback; they do not claim independent pre-consumption
  configuration-mismatch coverage.
- A real competing origin/CSRF/version-authorized profile writer makes the
  displayed unlink version stale. Unlink returns `VERSION_CONFLICT`/409 while
  keeping both identity and session.
- After reload, successful unlink reaches sign-in. No authenticated identities
  list refresh follows. The current browser and a second session created after
  linking are denied; a fresh password session reads an empty identity list.
- Unconfigured ORCID remains disabled. Browser page errors are empty.

HTTP/navigation listeners are registered before the triggering UI actions.
Rendered-state waits use the existing bounded MutationObserver helper. There
are no sleeps or polling delays.

## Visual inspection and references

Read `docs/discovery/design.md`, exact
`16-settings.source.html` linked-identity section, and
`23-reset-password.source.html`. Existing account controls, classes and tokens
remain; there is no new stylesheet or visual redesign.

Inspected final full-page captures in `docs/evidence/p6-identity-ui/`:

- `unlinked-desktop.png`, `unlinked-mobile.png`: actual availability and empty list.
- `linked-1440.png`, `linked-390.png`: actual callback landing, selected
  Sign-in & SSO navigation, persisted issuer/subject and unlink action.
- `stale-unlink-mobile.png`: retained identity and visible server conflict.
- `signed-out-1440.png`, `signed-out-390.png`: actual post-unlink sign-in page.

All seven capture points assert no horizontal document overflow. Desktop is
1440 pixels wide and mobile 390 pixels wide. Existing long provider names and
requirements wrap narrowly in mobile rows; that pre-existing density was not
redesigned. Frames are after-change workflow evidence, not a claimed original
pixel-identical comparison. Source before/after hashes and immutable reference
hashes are retained in `provenance.md`.

## Exact cleanup and scope

Final root `/tmp/quire-ui-integrations-Pncj0y` reaches both
`CONNECTIONS_CLEANED` and `IDENTITY_CLEANED`; the test asserts it is absent.
Final web listener was `127.0.0.1:38013`; provider was `127.0.0.1:40713`.
An independent post-exit audit found the root absent, no listeners on those
ports, and no process referring to any of this task's three exact fixture roots.
`docs/evidence/p6-identity-ui/cleanup.md` retains the audit receipt.

The reused fixture awaits adapter/runtime/web closure and stops its API
listener before removing its exact data/cache root. Browser launch disposal
awaits `browser.close`; browser contexts, including the foreign context, close
in finally blocks. The protocol fixture awaits its own listener disposal.
The test process exits cleanly. No broad cleanup touches sibling fixtures.

No P3 producer, backend, shared contract, root dependency, auth/security/shared
component, original input, or parent operator recovery file was written here.
No commits, global installs, live external accounts, or payments occurred.
