# COMPOSITION INTEGRATION TESTS

## OVERVIEW
Application, storage, process, and installation composition; score 11, distinct cross-service domain.

## STRUCTURE
```text
integration/
  adapters/          application/adapter lifecycle assembly
  backup-admission/  backup fencing across native and scale roles
  installation/     native controller and accepted release workflows
  operations/       operation routes and lifecycle
  p1/               application and browser acceptance fixture
  portable/         PostgreSQL/S3 topology and process transfer
  prepared-runtime/ prepared release runtime behavior
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Provider composition | `adapters/harness.ts`, `adapters/api-host.ts` | API host/process helpers |
| Scale admission | `backup-admission/fixture.ts` | Explicit Postgres/Redis requirements |
| Portable processes | `portable/process.ts`, `portable/topology.ts` | Bounded commands and topology |
| Operation composition | `operations/harness.ts` | `operationsFixture` |
| End-to-end application | `p1/harness.ts`, `p1/browser.ts` | Application and browser ports |
| Shared application schemas | `application-schema.test.ts` | Composed schema boundary |

## CONVENTIONS
- Portable fixtures provision real storage dependencies and spawned application roles.
- Backup-admission scale setup requires `QUIRE_TEST_POSTGRES_URL` and `QUIRE_TEST_REDIS_URL`.
- Process/event helpers live beside the integration topology rather than UI harnesses.
- Adapter assembly tests exercise ownership of initialization and shutdown.
- Root-level collaboration, Git, and review-history suites span service boundaries.

## ANTI-PATTERNS
- Avoid duplicate application/adapter lifecycle ownership (`adapters/application.test.ts`, `adapters/assembly.test.ts`).
- Operation inquiry mail fixtures explicitly say not to send external mail.
- Source: `operations/application.test.ts`.
