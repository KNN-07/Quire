# CATALOG SERVICE TESTS

## OVERVIEW
Catalog library, template publication, concurrency, and migration behavior; score 17 for 18 files, shared fixture exports, and a distinct service boundary.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Runtime fixture and schemas | `harness.ts` | `catalogFixture`, request and restart helpers |
| Library behavior | `library.test.ts`, `bibtex.test.ts` | Entry creation and BibTeX handling |
| Template lifecycle | `templates.test.ts`, `lifecycle.test.ts` | Copy, version, and publication behavior |
| Concurrent writes | `concurrency.ts`, `concurrency.test.ts` | Deterministic competing transitions |
| Bootstrap templates | `bootstrap-template/` | Seeded template fixture and focused config |
| Database-backed coverage | `postgres-domain.ts` | Explicit PostgreSQL path |
| Fixture response schemas | `harness.ts` | Entry, template, project, and file envelopes |
| Versioned lifecycle | `lifecycle.test.ts` | Publication and persisted template versions |
| Seeded content | `bootstrap-template/` | Isolated bootstrap policy and template assets |

## CONVENTIONS
- `catalogFixture` composes identity, core, and catalog modules with isolated runtime storage.
- Requests use the fixture origin and mutation idempotency keys with session/CSRF headers.
- Restart cases recreate the runtime with the same configuration and clock.
- Concurrency cases admit both contenders before transactions proceed, avoiding timing assumptions.
- The scoped TypeScript config includes catalog service and test files.
- `harness.ts` exports shared BibTeX samples and parsed API envelope schemas for focused suites.
- PostgreSQL coverage creates a uniquely named disposable database and drops it after the scenario.

## ANTI-PATTERNS
- Preserve optimistic-version conflicts for library writes and template publication.
- Keep PostgreSQL coverage distinct from local fixture behavior.
- Verify persisted versions and snapshots after publication or restart.
- Sources: `harness.ts`, `concurrency.ts`.
- The PostgreSQL domain suite requires `QUIRE_CATALOG_POSTGRES_URL`; it fails clearly when unset.
- Keep deterministic concurrency barriers in `concurrency.ts` rather than relying on sleeps.
