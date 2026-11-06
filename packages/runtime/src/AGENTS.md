# RUNTIME FOUNDATION

## OVERVIEW
Runtime assembly, storage, admission and lifecycle machinery; score 11, distinct foundation domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Public API | `index.ts` | Foundation exports |
| Assembly | `context.ts` | Runtime and ModuleContext |
| Service lookup | `services.ts` | Typed registry |
| Routing | `router.ts` | Lane-scoped route registration |
| SQL setup | `database.ts` | Foundation migrations and dialect choice |
| SQLite execution | `sqlite.ts` | Executor and unit of work |
| Schema SQL | `migrations/` | Paired SQLite/PostgreSQL files |
| Prepared storage | `prepared.ts` | Binding and readiness checks |
| Lifecycle | `lifecycle.ts` | Prepared lifecycle transitions |
| Admission | `admission.ts` | Local mutation admission |
| Native admission | `native-admission.ts` | Native process coordination |
| Repository | `repository.ts` | Local repository service |
| Events | `events.ts` | Persisted event port |

## CONVENTIONS
- Modules receive `ModuleContext`; its routes are already scoped to their lane.
- Runtime adapters provide SQL, unit of work, blobs, events, branches and repositories.
- Adapter cleanup drains owned work and resources.
- Foundation migrations pair `sql` and `postgres` under one migration identity.
- SQL dialect selection fails when a PostgreSQL variant is absent.
- Config, persisted state and readiness have separate validation boundaries.

## ANTI-PATTERNS
- Production services receive `SqlExecutor`, never the native SQLite handle.
- Do not bypass prepared-storage or admission authority during assembly.
- Do not substitute a probe result for verified runtime readiness.
- Do not put the independent installation control ledger in foundation migrations.
- Do not assume local coordination provides remote ownership.
