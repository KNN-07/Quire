# P74 publisher contract and enrollment

Implementation unit dated November 13, 2026. No commits were created.
Installation and interchange changes in the shared tree belong to the lead.
This unit edits neither area.

Parent follow-up supersedes the temporary evidence location below:
logs, screenshots and protocol artifacts are retained under
`.omo/evidence/p74/publisher/`. Parent evidence is under
`.omo/evidence/p74/parent/`; see `p74-parent-verification.md` for the additional
OAuth configuration-switch regression and final integrated gates.

## Delivered behavior

`ProviderConfig` and provider PUT now expose a public typed `publisherContract`.
The additive `060-x-shared-publisher-contract` migration adds a nullable JSON
column for both SQLite and PostgreSQL. Existing migration SQL is unchanged.
Legacy model-only rows retain their bytes and version; publisher runtime parsing
falls back to model JSON. Omitted publisher mapping fields retain the previous
mapping, and changing to one representation clears the other. Supplying both
mapping fields is rejected before mutation. Typed mappings reject unsafe paths.

The contract preserves version 1 OAuth mappings and adds bearer authentication.
OAuth mappings still use the same paths, scopes, client registration and encrypted
operator secret. Bearer enrollment verifies the destination-issued token with
GET against the explicitly configured credentialTestPath, outside SQL, then
fences actor/session/configuration before creating an encrypted ready grant.
OAuth start rejects bearer mode. The new route is
POST /api/connections/publisher/credentials; it requires ordinary session and CSRF
mutation authorization. No private provider endpoints were inferred.

Optional per-action flags default to enabled. The shared action capability hook
is resolved consistently for provider DTOs, the adapter port, operation admission,
and final fenced publication. Manual destinations still require a ready grant,
explicit submission confirmation and a provider-issued receipt. Manual status
still reads durable local state without destination traffic.

Authenticated GET /api/connections/options advertises publisher enrollment and
removal semantics. The account connection UI supports OAuth redirect/callback
and masked bearer input, clears submitted credentials, tests saved grants and
accurately describes local forgetting. Bearer grants retain their local removal
marker inside the encrypted credential document; public DTOs expose that marker
without exposing the credential. OAuth revocation retains the existing protocol.

## Exact owned files

```text
packages/contracts/src/publisher.ts
packages/contracts/src/index.ts
packages/contracts/src/work.ts
packages/contracts/src/routes-adapters.ts
packages/contracts/src/routes-operations.ts
services/adapters/shared/contracts.ts
services/adapters/shared/configuration.ts
services/adapters/shared/configured-adapter.ts
services/adapters/shared/connection-routes.ts
services/adapters/shared/grants.ts
services/adapters/shared/migrations.ts
services/adapters/shared/operations.ts
services/adapters/shared/CONTRACT.md
services/adapters/publisher/configuration.ts
services/adapters/publisher/contribution.ts
services/adapters/publisher/client.ts
services/adapters/publisher/README.md
apps/web/src/features/account/connections.tsx
apps/web/src/features/account/connection-forms.tsx
tests/adapters/publisher/configuration.test.ts
tests/adapters/publisher/enrollment.test.ts
tests/adapters/publisher/negative-scenarios.ts
tests/adapters/publisher/provider.ts
tests/adapters/shared/concurrency.test.ts
tests/adapters/shared/contribution.ts
tests/ui-integrations/publisher.test.ts
docs/handoffs/p74-publisher-scenarios.md
docs/handoffs/p74-publisher-notepad.md
docs/handoffs/p74-publisher.md
```

## Retained evidence

Exact scenarios were written before implementation in p74-publisher-scenarios.md.
The append-only p74-publisher-notepad.md records fixes and failed attempts.
RUN_TMP is `/tmp/quire-p74-publisher-So0Bd7`.

Every command exports:

```sh
export RUN_TMP=/tmp/quire-p74-publisher-So0Bd7
export TMPDIR="$RUN_TMP"
export XDG_CACHE_HOME="$RUN_TMP/cache"
export BUN_RUNTIME_TRANSPILER_CACHE_PATH="$RUN_TMP/cache/bun"
export BUN_INSTALL_CACHE_DIR="$RUN_TMP/cache/install"
export QUIRE_PUBLISHER_EVIDENCE="$RUN_TMP/evidence"
```

The completed full regression command:

```sh
./node_modules/.bin/bun test --timeout 240000 ./tests/adapters/shared ./tests/adapters/publisher
```

Result: 72 pass, 0 fail, 204 assertions, 13 files, 82.41 seconds.
Log: `$RUN_TMP/http-verified.log`.

This includes actual HTTP listeners, bearer verification, CSRF and ownership
denials, configuration-change fencing during credential verification, typed and
legacy persistence, encrypted token non-disclosure, action admission/publication
enforcement, real compiler archive creation, direct submit replay, remote status,
and manual receipt/local status behavior. The later path-validator lint fix
preserves the same validation semantics; its focused rerun is recorded below.

The completed browser command before the final copy-only correction:

```sh
export QUIRE_TEST_CHROMIUM=/home/norman/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome
./node_modules/.bin/bun test --timeout 180000 ./tests/ui-integrations/publisher.test.ts
```

Result: 1 pass, 0 fail, 20 assertions, 69.07 seconds.
Log: `$RUN_TMP/browser-4.log`.
The test uses the actual aggregate application and account route, tests masked
bearer enrollment/test/local forgetting at 1440 and 390 pixels, checks horizontal
overflow and page errors, and completes the real OAuth callback.

Visual inspection of the desktop forgetting and mobile enrollment screenshots
found legible, non-overlapping controls and no clipping. It exposed inherited
"repository credential" wording for publisher tokens, corrected to "saved
credential". Refreshed browser evidence is recorded below.

The owned PostgreSQL migration variant is present and asserted; no PostgreSQL
database was used in this unit. These fixtures establish protocol behavior,
not live publisher interoperability or recipient approval.

## Failed attempts and boundaries

- Initial fresh-runtime tests caught a migration ID sorting before the table
  creation migration. The new ID now sorts after shared-adapters.
- Initial UI typecheck caught index-signature property notation; corrected.
- One in-flight test process had loaded the provider helper before its pause
  method was added; a fresh test process passed.
- Isolated browser caches initially hid the globally installed binary. The
  subsequent command selected the owned Chromium path explicitly.
- The unconfigured browser assertion initially read collapsed requirement text;
  it now opens the real disclosure before checking the requirement.
- Lint caught control-character regex and string-spread rules; the validator now
  uses the repository's existing split/charCodeAt pattern without suppressions.
- Repository-wide typecheck observed concurrent installation test errors at
  pandoc-recipes.test.ts:28 and supervisor-execution/pandoc.test.ts:91,99.
  Repository lint also observed floating promises in pandoc-lifecycle.case.ts.
  Those paths were not edited in this unit.

A dedicated publisher administration form and a project preparation/submission
screen remain required product surfaces and were explicitly outside this unit.
The operator API and account enrollment surface are implemented.

## Final receipts

- Refreshed browser command above: exit 0, 1 pass, 0 fail, 20 assertions,
  81.64 seconds. `$RUN_TMP/browser-verified.log`.
- Focused final validator/config/enrollment command:
  `./node_modules/.bin/bun test --timeout 30000 ./tests/adapters/publisher/configuration.test.ts ./tests/adapters/publisher/enrollment.test.ts`.
  Exit 0, 6 pass, 0 fail, 54 assertions, 1.45 seconds.
  `$RUN_TMP/http-delta.log`.
- `./node_modules/.bin/oxlint --type-aware --deny-warnings` followed by the
  24 TypeScript/TSX files in the owned-file list: exit 0, no diagnostics.
  `$RUN_TMP/lint-final.log`.
- `./node_modules/.bin/bun run typecheck`: exit 2. The latest run has only
  the concurrent installation error at
  `tests/operations/installation/pandoc-recipes.test.ts:28:95`, TS2322:
  string digest lacks the Digest brand. `$RUN_TMP/typecheck-latest.log`.
  There are no diagnostics in this unit's files.
- Scoped `git diff --check`: no whitespace errors.
- Full product build and live publisher interoperability were not run.
- Final browser screenshots were visually inspected at both widths. No blank,
  overlapping or horizontally clipped publisher controls were observed.

Final screenshot paths, all under
`/tmp/quire-p74-publisher-So0Bd7/evidence/`:

```text
publisher-unconfigured.png
publisher-1440-enrollment.png
publisher-1440-forget.png
publisher-390-enrollment.png
publisher-390-forget.png
publisher-oauth.png
```

The evidence directory also retains the real submission ZIP, manifest, and
submission/status correlation artifacts from existing publisher acceptance.
Tokens and passwords are not printed or written to evidence; screenshot token
inputs are masked. The synthetic provider-issued submission receipts are
business receipts, not credentials.

Teardown: the final browser log records adapter/runtime/web shutdown and
CONNECTIONS_CLEANED for `quire-ui-integrations-rVyNGZ`. A subsequent request to
its port 44351 failed with ECONNREFUSED. A directory scan of RUN_TMP found no
remaining `quire-*` fixture data directories. The test monitor processes exited;
only retained logs, evidence and runtime caches remain. No server is left running.

## Independent omowright fixture

Reuse the existing exported `connectionApplication` from
`tests/ui-integrations/application.ts` and `publisherProvider` from
`tests/adapters/publisher/provider.ts`. They start the real aggregate application,
Vite account route and owned publisher HTTP protocol. This is the same fixture
composition used by the passing browser test, not a mock account UI.

The following startup function can be placed in the parent's private QA runner.
Resolve imports from the repository root, or replace the relative paths with
absolute paths if the runner lives under RUN_TMP. Start that runner with
`./node_modules/.bin/bun "$RUN_TMP/publisher-qa.ts"` under a background monitor,
with the cache exports above. Keep the returned object in memory while driving
omowright and call its async disposer when finished.

```ts
import { connectionApplication } from "./tests/ui-integrations/application";
import { publisherProvider } from "./tests/adapters/publisher/provider";
import { SafeHttpClient } from "./services/adapters/shared";
import { defaultPolicy } from "./tests/fixtures/foundation";

export async function startPublisherQa() {
  const resources = new AsyncDisposableStack();
  try {
    const provider = resources.use(publisherProvider());
    const app = resources.use(await connectionApplication({
      http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }),
    }));
    const operator = await app.login("operator@quire.local");
    const response = await fetch(new URL("/api/admin/providers/publisher", app.url), {
      method: "PUT",
      headers: {
        ...operator.headers, origin: app.url.origin,
        "content-type": "application/json", "if-match": '"0"',
      },
      body: JSON.stringify({
        baseUrl: provider.origin, expectedVersion: 0, policy: defaultPolicy,
        publisherContract: {
          version: 1, mode: "manual", credentialTestPath: "api/me",
          authentication: "bearer",
        },
      }),
    });
    if (response.status !== 200) throw new Error("Publisher fixture configuration failed");
    const session = await app.login();
    const token = provider.issueToken();
    const owned = resources.move();
    return {
      app, provider, session, token,
      async [Symbol.asyncDispose]() { await owned.disposeAsync(); },
    };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
}
```

Use `qa.app.url.origin + "/settings/git"` as the browser URL. The seeded user is
`kien@quire.local`; its synthetic password is `qa.app.password`. Alternatively
inject `qa.session.headers.cookie` into the browser context for that origin,
as `contextFor` in `tests/ui-integrations/helpers.ts` does. The enrollment token
is `qa.token`, generated and admitted only by this owned fixture. Keep password,
token and cookies in the runner's memory; pass them directly to omowright fill
or cookie operations without printing them or writing credential artifacts.
Do not use the illustrative provider domain from the README: the concrete
baseUrl must be `qa.provider.origin`.

For a standalone runner, call `startPublisherQa`, print only its application
origin, subscribe to SIGTERM/SIGINT, await that subscription, then call the async
disposer. The parent should start and stop this own listener; no listener from
this implementation remains available.

Stable selectors retained in the implemented test:

```text
button: Connect Publisher (exact)
form: Publisher credentials
label: Connection label
label: Publisher access token
button inside form: Save connection (exact)
button: Test <chosen connection label> (exact)
button: Forget <chosen connection label> (exact)
button: Forget saved credential (exact)
```

After saving, the password field must be empty. Testing must show
`<label>: connection test passed.`. Confirmation must say
`Forget this saved credential locally?` and
`The independently managed upstream credential remains valid.`.
After forgetting, the notice must say
`Saved credential forgotten locally. Upstream credential was not revoked.`.
Use 1440x900 and 390x900 contexts and inspect overflow and page errors.

To test OAuth instead, PUT expectedVersion 1 / If-Match "1" using the exact
configuration in the final block of `tests/ui-integrations/publisher.test.ts`.
That block contains only synthetic client registration fixtures, never a live
provider secret. The owned provider's `/oauth/authorize`, `/oauth/token` and
`/oauth/revoke` implement that contract. Click Connect Publisher and observe
the callback returning 303 to /settings/git.
