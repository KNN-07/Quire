# REFERENCES AND RETRIEVAL

## OVERVIEW
Bibliography retrieval, provider libraries and opt-in synchronization; score 8, distinct reference-source domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Assembly | `index.ts` | `createReferencesModules` |
| Contract | `README.md` | Provider scope and safety |
| HTTP boundary | `transport.ts` | `ReferenceTransport` |
| Retrieval | `retrieval.ts` | `PublicationRetrieval` |
| Publication model | `publication.ts` | Normalized publication data |
| Bibliography | `bibliography.ts` | Bibliography materialization |
| Library synchronization | `library-sync.ts` | Provider library workflow |
| Provider configuration | `providers.ts` | Provider contributions |
| Provider clients | `zotero.ts`, `mendeley.ts` | Account libraries |
| Public discovery | `crossref.ts`, `arxiv.ts`, `semantic-scholar.ts` | Retrieval providers |
| Import links | `links.ts`, `link-source.ts` | Interchange contribution |
| Recovery | `source-journal.ts` | Source publication journal |
| Scheduling | `scheduler.ts` | Explicitly enabled sync |

## CONVENTIONS
- Manual synchronization is the default.
- Bibliography links contribute to interchange's existing dispatcher.
- Use the shared source publication boundary for retrieved bibliography edits.
- Provider requests follow configured provider transport rules.
- No executable, browser, container or provider SDK is required.
- Verify with `bun test tests/adapters/references`.

## ANTI-PATTERNS
- Never register bibliography links as a second adapter.
- Do not silently replace an existing bibliography path.
- Do not send provider requests to arbitrary user-supplied URLs.
- Do not enable scheduling implicitly while adding a provider.
- Do not claim account-library success from configuration alone.
