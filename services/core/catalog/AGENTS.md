# CORE CATALOG

## OVERVIEW
Project libraries, templates, citations and institutional templates; score 8, distinct project-content domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Registration and routes | `index.ts` | Catalog API wiring |
| Library persistence | `library.ts` | Actor-owned BibTeX entries |
| BibTeX parsing | `bibtex.ts` | Parse and single-record validation |
| Templates | `templates.ts` | Template lifecycle |
| Institutional templates | `institution-templates.ts` | Governance-scoped templates |
| Template publication | `publication.ts` | Version-pinned approval and publication |
| Schema | `migrations.ts` | Catalog tables |
| Citation formatting | `citations.ts` | Normalize supported citation output |
| Shared row helpers | `storage.ts` | Validation, paging and failures |

## CONVENTIONS
- Keep library entries actor-owned and parse imports before persistence.
- Template-version publication is governed here; project source changes use core authority.
- Route mutations through shared replay and version contracts.
- Catalog migration changes belong with this domain's migration declaration.

## ANTI-PATTERNS
- Do not treat template-version publication as project source publication.
- Do not treat a client-selected template or citation as authorization.
- Do not bypass actor checks when reading or changing library entries.
- Keep institution-wide template authority in governance policy.
- Do not accept malformed BibTeX as a successfully imported library record.
