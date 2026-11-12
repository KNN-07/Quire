# ACCOUNT SERVICE TESTS

## OVERVIEW
Identity, governance, and onboarding service behavior; score 3, retained account policy domain guidance.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Storage isolation | `fixture.ts` | Account-specific `isolatedData` |
| Authentication and privacy | `identity/harness.ts` | Shared identity service fixture |
| Organization control | `governance/harness.ts` | `governanceFixture`, optional core module |
| Lifecycle timing | `governance/lifecycle-fixture.ts` | Scheduled transitions |
| Onboarding continuity | `onboarding/` | Import retries and persisted state |
| Database compatibility | `migrations.test.ts`, `postgres-benefits.ts` | Migration and PostgreSQL paths |
| Organization basics | `organization.test.ts` | Root-level organization behavior |

## CONVENTIONS
- Governance fixtures compose identity plus governance; core is opt-in via `core`.
- The governance clock starts at `2026-10-26T12:00:00.000Z`.
- `fixture.ts` returns the data path, runtime configuration, and async cleanup together.
- Governance HTTP requests use the fixed browser origin and a bounded timeout.
- Login helpers obtain both the session cookie and `/api/me` CSRF token.
- Governance login also resolves the actual identity principal.
- Administrative, audit, and benefit tests are separate from identity authentication tests.
- Lifecycle helpers own transition setup rather than spreading it across HTTP suites.

## COMMANDS
```sh
bun test tests/accounts
```

## ANTI-PATTERNS
- Preserve owner-grant policy boundaries tested in `identity/personal-benefits.test.ts`.
- Project benefits must obey the boundaries in `identity/project-benefits.test.ts`.
- Cross-user reads and avatar visibility have dedicated denial coverage.
- Secret-shaped test data in governance suites is deliberate redaction evidence.
- Do not treat those canaries as ordinary fixture defaults.
- Sources: `identity/reads.test.ts`, `identity/avatar.test.ts`,
  `governance/admin-actions.test.ts`, `governance/ai-notifications.test.ts`.
