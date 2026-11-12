# PRODUCT WORKFLOW TESTS

## OVERVIEW
Account, project, administrative, and product interaction acceptance; score 2, retained product workflow domain guidance.

## STRUCTURE
```text
ui-product/
  account/                identity, billing, governance, onboarding
  projects/               dashboard, bootstrap, import continuation
  admin/                  architecture, queue, LDAP, AI policy
  ai-steps/               actual progress and interaction evidence
  marketing/              browser claims and pricing
  creation-choices/       native project creation presentation
  dropbox-folder-project/ folder-backed project workflow
  citation-reviewer/      supported and unsupported citation flows
  ...                     focused editor/product preference scenarios
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Project preview/browser runner | `projects/preview.tsx`, `projects/run-browser.mjs` | Standalone browser harness |
| AI progress model | `ai-steps/fixture.ts`, `ai-steps/progress.test.tsx` | Matrix and rendered progress |
| Product claims | `marketing/browser-checks.mjs` | Claims tied to configured capabilities |
| Marketing server | `marketing/harness.ts` | Emits `MARKETING_READY` |
| Marketing browser checks | `marketing/run-browser.mjs` | Defaults origin to port 43871 |
| Creation evidence | `creation-choices/presentation.ts` | Choice locking and captures |
| Project folder application | `dropbox-folder-project/application.ts` | `folderApplication` |

## CONVENTIONS
- Product tests reuse editor/shared and integration provider fixtures across workflows.
- Standalone MJS browser runners coexist with Bun behavior suites.
- Evidence checks cover rendered state together with actual persisted results.
- Feature-specific tsconfigs explicitly include the application sources they exercise.

## COMMANDS
```sh
bun test tests/ui-product
```

## ANTI-PATTERNS
- Empty history must not fabricate AI progress (`ai-steps/progress.test.tsx`).
- Marketing must not invent catalog prices or unavailable deployment commands.
- Export continuation must not masquerade as import (`projects/import-continuation/browser.test.ts`).
- Sources: `marketing/browser-checks.mjs`, `ai-steps/progress.test.tsx`.
