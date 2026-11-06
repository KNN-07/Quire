# EDITOR UI TESTS

## OVERVIEW
Editor surface acceptance and authenticated browser composition; score 15, distinct collaborative editor domain.

## STRUCTURE
```text
ui-editor/
  shared/              full application, browser, event ports
  assembly/            combined editor workflows
  source/              CodeMirror authoring acceptance
  assistant/           owned AI protocol browser fixture
  pdf/                 PDF render/navigation synchronization
  git/                 repository UI sessions
  review/              collaboration and review panels
  transport/           offline/recovery/authorization behavior
  tools/               source tool inputs and scenarios
  inline-references/   reference editing workflows
  source-tracking/     tracking and proposal presentation
  visual/              editor command/visual harness
  ...                  feature acceptance and layout suites
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Source acceptance contract | `source/README.md` | Commands, fixture lifecycle, dictionary limits |
| PDF readiness | `pdf/browser-helpers.ts` | DOM/canvas synchronization |
| Assembly setup | `assembly/application.ts` | `startAssemblyApplication` |
| Source tool scenarios | `tools/helpers.ts` | `toolScenario`, `createInputFile` |
| Source bundle lifecycle | `source/browser-session.ts` | Build, ready, close, browser errors |

## CONVENTIONS
- Browser coverage is commonly Bun-driven `*.browser.test.ts`, alongside ordinary tests.
- Source scenarios use actual authenticated services and acknowledged Yjs documents.
- The source README records `bun test tests/ui-editor/source` and strict checks.
- Source views are explicitly unmounted before reload/disposal.

## ANTI-PATTERNS
- Code Check preference changes must not hide actual compiler diagnostics.
- Source acceptance does not replace service implementations or raw modules with unknown casts.
- Native spellcheck is disabled; Chinese spelling remains unavailable independently of UI language.
- Source: `source/README.md`.
