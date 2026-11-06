# ASSISTANT BROWSER TESTS

## OVERVIEW
Consent, context, review, and preference workflows against an owned AI fixture; score 8, distinct assistant domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Application assembly | `application.ts` | `assistantApplication` |
| Browser interaction | `browser.ts` | `assistantBrowser` |
| Fixture UI | `surface.tsx` | Dedicated assistant surface |
| Consent behavior | `consent.test.ts`, `consent-visual.ts` | Interaction and visual evidence |
| Prompt context | `context.test.ts` | Context selection behavior |
| Governance and preferences | `governance.test.ts`, `preferences.test.ts` | Policy and saved state |
| Review workflows | `review.test.ts`, `advanced.test.ts` | Proposal/review behavior |

## CONVENTIONS
- Application setup imports the canonical AI adapter protocol provider.
- `termsVersion` is an optional application-fixture input.
- Assembly registers identity, core, Git, catalog, review, references, and AI modules.
- AI retrieval resolves through the reference module.
- Provider HTTP admission is limited to the owned provider origin.
- The vision-model list contains `fixture-model`.
- The API fixture forwards actual realtime upgrades and handlers.
- Event-stream requests disable the API server's request timeout.
- The fixture web server serves this directory's surface.
- An async disposable stack owns provider, data, API/web servers, and service teardown.
- LSP measured 36 non-declaration references to `assistantApplication`.

## ANTI-PATTERNS
- The provider is an owned loopback protocol fixture.
- Its results establish no live inference or production-availability claim.
- Keep that evidence boundary when describing assistant test outcomes.
- Source: the explicit fixture contract in `application.ts`.
