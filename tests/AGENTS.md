# TEST KNOWLEDGE BASE

## OVERVIEW
Behavior suites across service lanes, native processes, and browser workflows; score 2, retained verification domain guidance.

## STRUCTURE
```text
tests/
  accounts/       identity and organization governance
  adapters/       external protocol fixtures and lifecycle boundaries
  compiler/       jobs, previews, PDF artifacts, sandbox behavior
  core/           project state, Git, catalog, collaboration
  contract/       shared schema and portable storage contracts
  integration/    composed application and process boundaries
  operations/     installation, recovery, infrastructure
  ui-editor/      editor surfaces and shared browser fixtures
  ui-product/     account, administration, project workflows
  ui-integrations/ provider connection browser flows
  ui-benefits/    benefit presentation and freshness
  e2e/           Playwright foundation configuration
  fixtures/      seeded identities and portable baseline inputs
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Shared seed values | `fixtures/foundation.ts` | IDs, policy, preferences, example files |
| Isolated runtime | `fixtures/runtime.ts` | `isolatedData`, `runtimeFixture` |
| Portable baseline | `fixtures/capture-portable-baseline.ts` | Historical fixture capture |
| Full browser configuration | `e2e/playwright.config.ts` | One worker, health readiness, teardown |

## CONVENTIONS
- Most behavior suites are Bun `*.test.ts`; browser coverage also uses TSX and Playwright.
- The E2E runner matches `*.spec.ts` under e2e, editor, and product directories.
- Its `bun run dev` server owns a fresh `QUIRE_DATA_DIR` and refuses server reuse.
- Scenario fixtures commonly register actual service modules and validate API envelopes.
- Test configurations live beside suites; fixture assets include TeX, YAML, and BibTeX.

## COMMANDS
```sh
bun run test
```

## ANTI-PATTERNS
- Baseline capture requires an extracted, unmodified `3fe3a23` tree; never use user data.
- Keep baseline recreation separate from normal runtime fixture initialization.
- Source: `fixtures/capture-portable-baseline.ts:9`; E2E setup: `e2e/playwright.config.ts`.
