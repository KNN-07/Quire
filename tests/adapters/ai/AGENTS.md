# AI ADAPTER TESTS

## OVERVIEW
AI run orchestration, consent, retrieval, and compiler coupling; score 6, retained provider-run domain guidance.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Service assembly | `harness.ts` | `aiFixture(origin, options)` |
| Provider protocol | `provider.ts` | `providerServer` |
| Compile preference replay | `compile-preference.test.ts` | No new work on replay |
| Project retrieval | `project-search/` | Search provider and authority boundaries |
| Operator restrictions | `operator-policy/` | Policy admission cases |

## CONVENTIONS
- The AI fixture borrows the controlled clock and origin from `../shared/harness.ts`.
- Fixture options independently enable review and compiler modules.
- Default vision model admission uses `fixture-model`.
- The provider origin is passed explicitly into the safe HTTP client.
- AI and reference modules share adapter contributions in the composed fixture.
- Retrieval resolves through the reference module's retrieval port.
- `termsVersion` is optional configuration carried into the module factory.
- Local provider response shapes belong in `provider.ts` or project-search's provider.
- Runtime and provider setup are kept separate so denial and failure cases can vary.
- Existing response helpers include `failure`, `errorSchema`, and `runSchema`.
- Compiler-enabled cases use actual compiler lifecycle hooks from the harness.

## COMMANDS
```sh
bun test tests/adapters/ai
```

## ANTI-PATTERNS
- Replay must not resample changed preferences or trigger another compile.
- Replay must not publish another decision.
- Sources: `compile-preference.test.ts`.
- Retrieved excerpts do not grant edit authority.
- Source: `project-search/workflow.test.ts`.
