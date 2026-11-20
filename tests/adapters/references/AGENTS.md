# REFERENCE ADAPTER TESTS

## OVERVIEW
Provider-backed bibliography, credential, retrieval, and link lifecycle behavior; score 17 for 19 files, owned fixture exports, and distinct protocol boundaries.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Runtime fixture | `harness.ts` | `referencesFixture`, restart and authenticated requests |
| Owned providers | `provider.ts`, `mendeley-provider.ts` | Zotero and Mendeley protocol responses |
| Credential privacy | `credentials.test.ts` | Admission, encrypted persistence, response redaction |
| Link lifecycle | `links.test.ts`, `link-recovery.test.ts` | Bibliography link creation and recovery |
| Retrieval and refresh | `retrieval.test.ts`, `library-refresh.test.ts` | Search, scheduling, and provider state |
| Inline lifecycle | `inline-lifecycle-provider.ts`, `inline-lifecycle.test.ts` | Provider behavior during editor changes |
| Pagination and recovery | `mendeley-groups.test.ts`, `link-recovery.test.ts` | Foreign/repeated pages and recovered links |
| Fixture cleanup | `harness.ts` | `referencesFixture` owns temporary runtime storage |

## CONVENTIONS
- Tests compose actual adapter, identity, core, catalog, and optional interchange modules in an isolated runtime.
- Provider origins are explicitly admitted through `SafeHttpClient`; owned HTTP fixtures supply protocol behavior.
- Authenticated requests carry session cookies and CSRF tokens, and JSON requests set their content type.
- Restart cases verify persisted grants after reinitializing the fixture runtime.
- `provider.ts` supplies owned Zotero/DOI HTTP behavior; `mendeley-provider.ts` owns Mendeley responses.
- Link-enabled cases opt into interchange through the fixture's `links` option.

## ANTI-PATTERNS
- Never expose reference-provider credentials in API responses or persisted plaintext.
- Preserve upstream-invalid credential rejection and do not store rejected grants.
- Keep provider protocol and runtime paths in coverage; avoid canned service results.
- Sources: `credentials.test.ts`, `harness.ts`.
- Retrieval cases assert retained response provenance as well as returned library entries.
- Restart checks should reuse the fixture lifecycle so durable grants are read from rebuilt modules.
