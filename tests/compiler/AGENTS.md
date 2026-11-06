# COMPILER TESTS

## OVERVIEW
Compile jobs, previews, artifacts, access, and worker boundaries; score 10, distinct compilation domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Compile inputs | `fixtures.ts` | `sourceFixture`, settings, fixture IDs |
| Runtime and worker | `fixtures.ts` | `compilerFixture`, `terminalEvent` |
| HTTP surface | `http-fixture.ts` | `compilerHttp` |
| Portable assembly | `portable-domain.ts` | `portableCompilerDomain` |
| PDF text | `pdf-text.ts` | `pdfText` |
| Retained artifacts | `evidence.ts` | `retain` |
| Database variants | `postgres-domain.ts`, `postgres-benefits.ts` | Explicit infrastructure paths |
| Sandbox threats | `hostile-project.test.ts`, `invalid-source.test.ts` | Adversarial source inputs |

## CONVENTIONS
- `sourceFixture` builds file entries and an in-memory content-addressed blob store.
- Blob digests are SHA-256 values parsed through contract schemas.
- The main fixture source is `main.tex`; additional files are passed by relative path.
- Shared settings select pdfLaTeX, the seeded main file, and a seeded environment.
- `compilerFixture` accepts `integrated`, `wallSeconds`, adapter, and clock options.
- Integrated mode adds governance and core projects to identity plus compiler modules.
- The compiler store uses the runtime route boundary for lane C.
- Job-terminal synchronization belongs in the shared fixture helper.
- Preview/history/receipt cases have separate suites from engine execution.

## ANTI-PATTERNS
- Retain authorization denial coverage when changing preview or owner-history setup.
- Infrastructure-gated PostgreSQL paths are distinct from local fixture execution.
- Engine/PDF checks can require the configured environment image.
- Sources: `preview-access.test.ts`, `owner-history.test.ts`,
  `postgres-domain.ts`, `postgres-benefits.ts`, `pdf-validation.test.ts`.
