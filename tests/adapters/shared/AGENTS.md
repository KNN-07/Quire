# SHARED ADAPTER TEST SUPPORT

## OVERVIEW
Reusable connection/contribution fixture and adapter substrate tests; score 9, distinct shared lifecycle boundary.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Runtime fixture | `harness.ts` | `adapterFixture`, `controlledClock` |
| Contribution registration | `contribution.ts` | `fixtureContribution` |
| Established connection | `connected-fixture.ts` | `connectedFixture` |
| Provider HTTP behavior | `provider-server.ts` | `providerServer` |
| Concurrency and cursors | `concurrency.test.ts`, `cursor.test.ts` | Shared infrastructure contracts |
| OAuth and security | `oauth.test.ts`, `security.test.ts` | Shared authorization boundaries |
| Publication flow | `source-publication.test.ts` | Source-related adapter behavior |

## CONVENTIONS
- The clock begins at `2026-10-27T12:00:00.000Z` and advances in milliseconds.
- `adapterFixture` accepts contribution definitions and an optional HTTP client.
- It registers connection/provider modules alongside identity and core projects.
- The request helper adds origin only when the caller did not provide one.
- String request bodies receive JSON content type.
- Redirects remain manual so tests can inspect provider-facing transitions.
- Login returns a real session cookie and CSRF token.
- Project creation supplies a fresh idempotency key.
- The fixture exposes restartable runtime state through getters.
- `errorEnvelope` is the shared schema for structured error responses.
- LSP measured 29 non-declaration references to `adapterFixture`.

## ANTI-PATTERNS
- Preserve caller-supplied origins when extending the request helper.
- Preserve manual redirects in OAuth and HTTP boundary tests.
- Failure cleanup closes adapter modules as well as runtime/storage.
- Source: `harness.ts`; behavioral coverage: `http.test.ts`, `lifecycle.test.ts`.
