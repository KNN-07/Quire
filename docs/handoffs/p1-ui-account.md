# Account UI implementation

Status: owned implementation and contract-read integration verified,
October 26, 2026. The final native/browser and boundary checks pass at 1440/390
in light/dark. No server handlers or package configuration belong to this lane.

## Screen brief and design contract

Source: `docs/discovery/design.md`, decoded screens 05, 08, 14, 16 and 23,
the shared `styles/tokens.css`, and `docs/handoffs/visual-primitives.md`.
No new global design system is authored because shared files belong to foundation.
The frontend router's requirement to create a root DESIGN.md and install React
instrumentation is superseded by the assignment's exclusive paths/package gate.
Reference screenshots already exist; this feature has no previous implementation
to capture. Supplied references take precedence over generating replacement images.

Primary actions: sign-in = password sign-in when enabled, with the server's
available providers as alternatives; signup = Create account when enabled; verification = Verify email; onboarding =
Create project; reset = Send reset link / Save new password; settings = Save
changes; credentials = Generate token / Add SSH key in their separate forms;
billing = Preview plan only when the configured catalog supplies a plan.
Information priorities: task title and current state, required form fields,
secondary navigation and integration status.

Required content: full name, email, password, provider choices, reset and signup
navigation, verification token, writing kind, project name/start mode, default
view; profile name, LaTeX name, affiliation, ORCID, language, email and avatar;
all Preferences fields grouped into Editor, AI and Git; sessions, reset,
account export/delete; Git tokens and SSH keys; provider connections;
saved linked identities and versioned sessions; saved notification events/channels
and project overrides; billing catalog, organization billing status, quote,
invoice email, tax/address, invoices, hosted payment management and cancellation.

Left out on purpose: invented provider availability, illustrative linked identities, sample
prices/card numbers/invoices/usage, fake success transitions, vanity plan badges,
unsupported role metadata, a client-side email-verification bypass, and decorative
selected-card outlines. The API uses a token rather than the reference's six
separate code boxes. Password minimum is the actual contract's 12 characters.

Layout: authentication - two wrapping equal columns -> switcher
(https://raw.githubusercontent.com/changeroa/StyleGallery/main/patterns/split-sidebar/switcher.md);
scroll owner: document; anti-patterns: fixed mobile column widths and clipped forms.
Layout: settings - narrow navigation with fluid form -> sidebar
(https://raw.githubusercontent.com/changeroa/StyleGallery/main/patterns/split-sidebar/sidebar.md);
scroll owner: document; anti-patterns: competing scroll containers and unbreakable tokens.
Layout: reset - bounded centered form -> cover
(https://raw.githubusercontent.com/changeroa/StyleGallery/main/patterns/viewport-shell/cover.md);
scroll owner: document; anti-patterns: vertically clipped form and forced viewport height.

Desktop contracts: auth 480px wrapping column bases, 380px form (420px signup),
44px serif statement (40px signup), 46px CTA; reset 420px card/32px padding/14px radius;
settings max1160px, 220px navigation basis, 32px gap, 28px panel inset.
Mobile wraps into one column. Colors/type/spacing use existing shared tokens;
fixed dimensions above are screen geometry transcribed from the reference.

## Exports and routing

`apps/web/src/features/account/index.tsx` exports `AccountPage` and the structural
`AccountPageProps` type. Props are exactly `path`, `client`, `navigate`, and async
`onSessionChange`; the router owns client construction and CSRF refresh.
Login/logout await session refresh before navigating. Profile/preference saves
also refresh the parent session snapshot. No competing global client is shipped.

Route the following paths to AccountPage (preserve the search string in `path`):

- `/sign-in` and `/sign-in?onboarding=1`.
- `/sign-up`; `?step=verify` and `?step=start` select subsequent stages.
- `/verify-email?token=...` (the actual local mail service emits this route).
- `/reset-password` and `/reset-password?token=...`.
- `/settings/profile`, `/settings/security`, `/settings/editor`, `/settings/ai`,
  `/settings/git`, `/settings/notifications` (legacy `notif` alias), `/settings/billing`.

Onboarding redirect chain: the verification link opens
`/verify-email?token=...` in AccountPage. After successful verification, Continue
to sign in opens `/sign-in?onboarding=1`. Successful login awaits
`onSessionChange()` before navigating to `/sign-up?step=start`; ordinary login
instead navigates to `/projects`. Creating the first project uses the returned
ID and navigates to `/projects/:id/edit`. No verification or project success is
inferred from navigation alone.

Starting-point choices fetch the actual template catalog, save the chosen
default editor view with its returned preference version, then create a blank
or selected-template project with an idempotency key. Navigation uses the
returned project ID. Imports navigate to the projects lane's import entry.
Role/experience marketing metadata is not fabricated or stored outside contracts.

## Endpoint ownership and consumed contracts

Registered server endpoints: **none**. This is exclusively a browser lane.
No migration, server module, no-op registrar, shared composition edit, commit,
or dependency change is included.

Direct client calls (using `endpoints`, not handwritten fetch/DTO replacements):

- Identity: `authOptions`, `authRegister`, `authVerifyEmail`, `authLogin`, `authLogout`, `me`,
  `passwordReset`, `passwordResetConfirm`, `sessionList`, `sessionDelete`, `sessionRevokeOthers`,
  `identitiesList`, `identityLink`, `identityUnlink`; enabled providers navigate to
  the checked `identityStart` URL.
- Profile: `profilePatch`, `avatarGet`, `avatarPut`, `avatarDelete`, `emailAdd`, `emailDelete`.
- Settings: `preferencesGet`, `preferencesPatch`, `notificationPreferencesGet`, `notificationPreferences`,
  `notificationsList`, `notificationRead`, `accountExport`, `accountDelete`.
- Credentials: `gitTokensList`, `gitTokenCreate`, `gitTokenDelete`, `sshKeysList`,
  `sshKeyGet`, `sshKeyCreate`, `sshKeyDelete`.
- Adapters: `connectionsList`, `connectionStart`, `connectionTest`, `connectionDelete`.
- Onboarding: `templatesList`, `projectCreate`.
- Billing: `billingCatalog`, `organizationsList`, `billingGet`, `billingPreview`,
  `billingCheckout`, `billingDetails`, `billingCancel`, `billingInvoices`,
  `billingPortal`; available invoice documents use the checked `invoiceDownload` URL.
- Async exports: `operationGet`. Completed account metadata exports use the
  actual operation result as a local JSON download, rather than inventing a
  downloadable artifact or relying on an unimplemented operation-download route.

Mutations use returned aggregate/resource counters. Missing `/me` ETag disables
account-version mutations; it is never guessed to be zero. Credential deletion
uses token version or a fresh SSH-key detail read. Creates requiring idempotency
always supply `idempotency-key`; avatar multipart supplies If-Match and version.
Linked-identity mutations use the GET `/me` ETag retained by callWithMetadata
in Settings, not metadata from the identities list.
Session deletion uses each returned Session.version. Notification editing uses
NotificationPreferences.version rather than the user counter and preserves
unknown saved event keys and every project override.

## Known integration dependencies and contract deltas

The lead has landed the formerly missing read contracts. Native settings no
longer remain unavailable merely because the original P0 schemas omitted reads:

1. **Authentication:** authOptions controls password/registration availability
   and every returned provider's enabled state/reason. Unknown/loading/error
   availability disables native submissions until actual policy is read.
   Enabled provider buttons navigate to identityStart with checked params/query.
   No provider IDs, capabilities or successful callback state are invented.
2. **Linked identities:** identitiesList renders saved issuer/subject/time.
   Link/unlink actions bind to their real contracts, then re-read saved state;
   an accepted request is never displayed as a fabricated linked identity.
3. **Sessions:** each non-current session can be revoked using its saved version;
   current logout and revoke-all-others remain available.
4. **Notifications:** notificationPreferencesGet loads every saved event,
   channel, project override and version. The replacement opt-in form is removed.
   Saving edits retains unknown events and project overrides. The contract has
   global channels rather than a per-event channel matrix; the UI matches that.
5. **Billing:** billingInvoices renders saved invoice rows and issued documents.
   billingPortal opens only the provider's returned hosted-management URL and
   surfaces actual unconfigured/provider errors. There are no raw card fields.
   Catalog plans bind to preview/checkout, invoice details and cancellation with
   no assumed payment success. A checkout operation is not payment confirmation.
6. **Avatar/email:** avatarGet renders the saved authenticated photo; errors are
   visible. emailDelete now selects by email, so non-primary verified addresses
   can be removed using the actual account counter.
   `/me.avatarBlob` determines presence. The image uses only the checked
   `/api/me/avatar` URL and is keyed by that stored digest plus the current
   `/me` ETag version. After upload, refreshing `/me` remounts the image even
   when identical bytes retain the same digest; deletion removes the image.
   The actual byte handler supplies `private, no-store` and the stored digest
   ETag. No public blob URL or guessed cache-busting query is constructed.

Remaining integration dependencies:

1. **Service registration:** this harness composes the available identity
   module. Other lane-owned endpoint families can still return real 501/503
   until their owner registers them; the UI already consumes their concrete
   schemas and does not replace them with local success. In particular, X owns
   federation link/start/callbacks and the configured billing portal.
2. **Onboarding:** requires K templates/projects handlers and the projects
   lane's `/projects?new=import` entry. There is no stored writing-role field.
3. **Deletion:** API enforces fresh authentication and ownership reassignment;
   account UI shows those errors. Transfer owned projects using project/admin
   surfaces before deletion. This UI does not invent recipient permissions.
4. **AI consent:** no current consent/terms read contract exists. Preference
   editing does not imply consent or enable an unavailable provider.

The real identity module was available during verification and was composed
directly in an isolated harness. Other service families still returned real 501
responses there. Browser-only HTTP fixtures are explicitly separated for
unbilled catalog, saved notification values, invoice/portal and credential interactions. They do not establish provider,
payment, Git transport, SSH parser, or service-persistence completion.

## Verification commands and results

Native CLI: Bun **1.3.14**. The harness bundles actual AccountPage/shared
primitives/styles, runs the actual identity module with real SQLite, cookies,
Origin/CSRF checks and seeded Argon2id password, and listens on an ephemeral
127.0.0.1 port. Unrelated 3001/5173 listeners were not touched.

```sh
bun docs/evidence/p1-ui-account/run-browser.mjs
```

The passing browser run prints `PASS ACCOUNT 1440 light`, `1440 dark`,
`390 light`, `390 dark`, then `ACCOUNT_UI_VERIFIED`, exit 0. Assertions live
under `tests/ui-product/account/`, not in a disconnected static mockup.
Tests use exact network/event signals and bounded locator waits, never sleeps.
The final `results.json` is the authoritative last-run receipt.

Real service/browser assertions: rejected and accepted login; navigation after
session refresh; profile persistence across reload; editor font-size persistence
with distinct values per case; AI/Git checkbox persistence; optimistic conflict
returns 409 while preserving edits; registration requires real mail verification;
the actual operator-local mailbox supplies a one-time token; invalid reset and
password mismatch remain errors; valid reset changes the persisted password and
new-password login works; account metadata JSON download contains the real user
without password hash; logout invalidates the session.
New native assertions additionally read public authOptions, render an actual
SQLite-linked issuer/subject, revoke another real session whose stored version
is deliberately 9, upload and decode the authenticated avatar-byte response,
remove that photo, and remove an actual non-primary verified email.
The avatar regression also re-uploads identical bytes and requires a new
authenticated GET returning the unchanged real content ETag, rather than merely
checking that the upload request succeeded.

Separated unavailable-service HTTP-boundary assertions: unconfigured catalog
plus unbilled organization offers no checkout/preview; Git token create requires
idempotency and reveals a one-time secret that can be hidden; token revoke uses
returned version 7 rather than account version; SSH creation and detail-read
deletion use returned version 9. These are frontend integration assertions, not
claims that those services are implemented.
New HTTP-boundary-only assertions use a disabled-password/disabled-registration
policy with enabled/disabled federation choices and prove checked start/returnTo
navigation. Saved notification version 17 loads true/false values, unknown event
keys and project overrides; changing one value preserves all unrelated saved
data across re-read. Saved invoices render their document route. Hosted portal
requests use billing version 23 plus idempotency, show a real 503 unconfigured
envelope without navigation/card fields, then navigate only to a returned
configured boundary-fixture URL. A hosted URL is never called payment success.
The unlink counter regression supplies conflicting identities-list metadata
`"v999"` while `/me` returns its real nonzero account ETag. The actual React
unlink request must select `/me`'s counter; the fixture's provider-unconfigured
503 remains an explicit error rather than a fabricated successful unlink.

Owned strict typecheck (exit 0):

```sh
bunx tsc --noEmit --strict --noUncheckedIndexedAccess \
  --exactOptionalPropertyTypes --verbatimModuleSyntax --module ESNext \
  --moduleResolution Bundler --target ESNext --jsx react-jsx \
  --lib ESNext,DOM,DOM.Iterable --types bun,vite/client --skipLibCheck \
  apps/web/src/features/account/*.tsx
bunx oxlint --type-aware --deny-warnings \
  apps/web/src/features/account tests/ui-product/account
```

Type-aware oxlint exits 0. LSP scanned 15 owned TSX files with **0 diagnostics**.
Frontend `check-draft-guard.ts` checked 17 feature/preview source/style files,
clean, exit 0. Native production browser bundling succeeds in the harness.
No whole-repository build/typecheck result is claimed while sibling lanes write.

The optional programming no-excuse checker exits **2**, because that installed
skill now requires `typescript/unstable/async` and `typescript/unstable/ast`
(TypeScript 7), while foundation pins TypeScript 5.9.3. The error inaccurately
suggests TypeScript is absent; it is installed and the actual strict compiler
passes. No package was upgraded or rule suppressed to hide this tool mismatch.
An initial shell line-count command also had a quoting error; the corrected
read-based count found every feature module below 200 nonblank/comment lines.

Architectural self-review: files own one screen/form concern; shared helpers have
multiple consumers; the offline component isolates its subscription lifecycle.
Checked client schemas parse API boundaries; preference/user field enums use
their actual exported parsers. No assertions, non-null escapes, untyped `any`,
silent catches, parameter mutation, speculative fallback version, new logging,
or one-off domain abstraction was introduced. Existing tests were not weakened.

## Visual QA and retained evidence

Thirteen states in each width/theme: sign-in, signup, verification, starting
point, reset request, reset confirmation, and seven settings tabs. Each has a
full-page and end viewport PNG. Additional `billing-unbilled-boundary-*.png`,
`notification-saved-boundary-*.png` and `billing-invoices-portal-boundary-*.png`
captures clearly distinguish fixture evidence. The pre-read-contract screenshots
are retained in `before-contract-reads/` for before/after comparison.
1440x900 desktop; iPhone 14 emulation is 390 CSS px, DPR 3, with actual touch.
All base states assert no horizontal overflow; phone interactive targets assert
at least 44px using their actual labels for checkbox hit regions; profile avatar
asserts 72x72. PNG signatures are checked before retaining images.

Dark/mobile are documented adaptations, not supplied pixel references. Real
data and unavailable-service notices replace illustrative billing/provider state.
No pixel-equivalence score, Lighthouse score, or installed React instrumentation
is claimed. Full application audit/tool installation remains foundation-owned.
Independent reviewers were not spawned, per the no-nested-agents assignment.

Initial visual issues found and corrected: explicit white wordmark in the dark
auth panel; first-span flex selector excluded the fixed 72px avatar; grid fields
align at their natural height instead of stretching inputs alongside hints.
Source inventory/required inputs remain intact after removing unsupported
decorative/illustrative content.
The reset region explicitly fills the viewport so its form is centered, rather
than relying on its parent's minimum height. Provider choices now come from the
actual server inventory rather than fixed Google/GitHub/ORCID placeholders.
The new boundary captures follow the real emulated color scheme; the old
preview-only forced-light attribute was removed. Invoice dates use a compact
locale date with a full ISO datetime attribute, and the file column stays
readable without clipped headers at 390px.

Failure history is retained in `docs/evidence/p1-ui-account/failures.md` and
`failure-*.json`. Omowright failed twice before any API request with CDP
`-32000 Cannot find context with specified id`; final runs use the installed
Playwright 1.64.1 with owned headless Chromium instead. This driver substitution
does not substitute the actual React/API surface.
Both CDP failures are tooling evidence, not application failures; no additional
retry of that failed approach is required.

Lead manual QA will use omowright's owned engine with the known-working binary
`/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`.
Keep the entire browser lifetime, captures and cleanup in one script: P0 targets
disappeared across cells. The automated suite remains on pinned Playwright and
the actual identity/SQLite/cookie/CSRF surface.

## Cleanup and integration receipt

Every run closes its owned browser and ephemeral HTTP server, closes the SQLite
application, then removes its unique `/tmp/quire-account-*` root including
TMPDIR/cache/data/profile/download files. Exact last-run path and booleans are
retained in `results.json`. Earlier failed roots were also removed in finally.
No production data, shared listeners, shared configuration, commits or Git state
were changed.
Final successful root: `/tmp/quire-account-gj8O5w`; browserClosed, serverStopped,
databaseClosed and removed are all true. Owned evidence-watch handles had already
completed; explicit cleanup found no remaining terminal sessions for watch_1
through watch_12.

Only assigned feature, test, handoff and evidence paths are authored. The lead
must retain `docs/evidence/p1-ui-account/**` explicitly (`git add -f`) because
foundation's ignore rules exclude evidence. No files were staged by this lane.
