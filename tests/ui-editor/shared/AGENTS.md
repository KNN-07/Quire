# SHARED EDITOR FIXTURES

## OVERVIEW
Canonical application, browser, authentication, and event ports; score 6, retained exported fixture boundary guidance.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Public fixture exports | `index.ts` | Application, API session, browser, events |
| Real application | `application.ts` | `startEditorApplication`, `EditorApplication` |
| Vite ownership | `web-server.ts` | `startEditorWeb` |
| Browser/session helpers | `browser.ts` | Browser, contexts, rendered state |
| HTTP authentication | `api-session.ts` | `authenticateApi` |
| Event synchronization | `events.ts` | `nextApplicationEvent`, `EventWaitError` |
| Fixture contract tests | `fixture.test.ts` | Shared fixture behavior |

## CONVENTIONS
- `startEditorApplication` owns unique storage and two OS-assigned loopback ports.
- The API listener delegates to the actual composed application's handler.
- WebSocket open/message/close/drain delegate through the same application.
- The web origin becomes the runtime public URL.
- Application readiness resolves before requests can enter its handlers.
- Seed credentials are generated per fixture.
- The application is started after seeding and returned with its owned resources.
- `nextApplicationEvent` registers a bounded, disposable runtime subscription.
- Event waits distinguish timeout from explicit disposal.
- Event disposal suppresses unhandled cancellation noise while preserving rejection for awaiters.

## COMMANDS
```sh
bun test tests/ui-editor/shared
```

## ANTI-PATTERNS
- Register event subscriptions before the action that emits the expected event.
- Dispose unused subscriptions so their bounded timeout and listener are cancelled.
- Avoid adding a second owner for the application resources returned by the fixture.
- Sources: `events.ts`, `application.ts`.
