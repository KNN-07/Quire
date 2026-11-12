# PROJECT BASE TESTS

## OVERVIEW
Project access, file/source state, and dashboard behavior; score 8, retained project authority domain guidance.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Shared service setup | `harness.ts` | `baseFixture` |
| Access and requests | `access.test.ts`, `access-requests.test.ts` | Project admission |
| Source composition | `source-composition.test.ts` | Composed source behavior |
| Dashboard | `dashboard.test.ts` | Project discovery/presentation state |
| PostgreSQL domain | `postgres-domain.ts` | Alternate storage fixture |
| Type checking | `tsconfig.json`, `tsconfig.source.json` | Service and source scopes |

## CONVENTIONS
- The harness registers identity, governance, and project-base modules together.
- Runtime construction accepts adapter overrides through `baseFixture(options)`.
- The fixed clock is `2026-10-26T12:00:00.000Z`.
- `projectEnvelope`, `errorEnvelope`, and `okEnvelope` centralize response parsing.
- Successful mutation envelopes include both `ok` and `version`.
- Request helpers always set the declared fixture origin.
- String bodies receive JSON content type and requests have a ten-second bound.
- Login obtains a session cookie followed by the current user's CSRF token.
- Project creation uses a unique idempotency key and a blank project origin.
- Fixture runtime is exposed through a getter for restart-sensitive tests.

## COMMANDS
```sh
bun test tests/core/base
```

## ANTI-PATTERNS
- Keep access-request policy scenarios separate from ordinary project creation.
- Preserve version fields in successful mutation assertions.
- Restart tests must inspect the current fixture runtime rather than retain stale state.
- Sources: `harness.ts`, `access-requests.test.ts`, `access.test.ts`.
