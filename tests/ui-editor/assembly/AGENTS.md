# EDITOR ASSEMBLY TESTS

## OVERVIEW
Browser acceptance of assembled editor routes, recovery, authority, and file behavior; score 16 for 15 files, browser entry fixtures, and a distinct full-application boundary.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Actual app composition | `application.ts` | `startAssemblyApplication` and owned server lifecycle |
| Actual browser routes | `actual-browser.ts`, `actual.browser.test.ts` | Authenticated editor route interactions |
| Assistant fixture | `assistant-fixture.ts`, `assistant.browser.test.ts` | Owned assistant workflow setup |
| Authority behavior | `authority-refresh.test.ts`, `authority.browser.test.ts` | Refresh and browser authority changes |
| Files and recovery | `files.browser.test.ts`, `recovery.browser.test.ts` | Persisted file and reload behavior |
| Standalone frame geometry | `frame.browser.test.ts` | Uses its own HTML; not assembled-route acceptance |
| Route synchronization | `actual-browser.ts` | DOM observation helpers for navigation and visible surfaces |
| Shared server setup | `application.ts` | Temporary data directory and async resource ownership |
| Editor web process | `../shared/web-server.ts` | Vite server lifecycle used by assembled browser tests |

## CONVENTIONS
- Browser tests use the real composed application and authenticated API sessions.
- Fixtures own temporary data, API and web servers, and async disposal.
- Event subscriptions are registered before the action that should publish the event.
- Browser checks assert rendered and persisted state; the local TypeScript config includes workspace and browser TSX.
- Browser entry suites use owned provider fixtures when an external adapter is required.
- `actual-browser.ts` arms DOM signals before navigation so readiness is tied to observed UI.
- The frame geometry suite loads standalone HTML and does not exercise assembled application routes.

## ANTI-PATTERNS
- Do not treat browser state as durable authority; verify changes through the application.
- Preserve cleanup ownership for browser, servers, and temporary data.
- Do not replace application handlers with mocked success paths.
- Sources: `application.ts`, `actual.browser.test.ts`.
- Keep route readiness assertions on rendered selectors rather than fixed timing delays.
- Close the application fixture through its async resource stack after each browser scenario.
