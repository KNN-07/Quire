# COMPILER SERVICE

## OVERVIEW
Compilation API, job leases and worker lifecycle; score 8, distinct compilation authority domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Registration | `index.ts` | Service wiring and public lifecycle |
| Compilation | `service.ts` | `CompilerService` |
| Leases | `leases.ts` | `CompilerLeases` |
| Worker endpoints | `worker-routes.ts` | Worker API |
| Environment probing | `environment.ts` | Native compiler probe |
| Quiescence | `quiescence.ts` | Drain compilation jobs |
| Job state | `store.ts` | Migrations and persisted jobs |
| Preview | `preview.ts` | Branch preview |
| Diagnostics | `diagnostics.ts` | Compiler output processing |
| Navigation | `navigation.ts` | SyncTeX navigation |
| PDF comparison | `diff.ts` | Authorized PDF difference |
| PDF receipts | `pdf-receipt.ts` | Artifact receipt handling |
| Worker execution | `../../workers/compiler/` | Sandbox and worker implementation |

## CONVENTIONS
- The service is registered before environment configuration.
- Configured environment resolution rechecks environment admission.
- The native probe is cached at module scope for bwrap registration.
- Job and comparison reads recheck project and history access.
- Quiescence is called while runtime admission is held exclusively.
- Worker start and stop operate on the registered service instance.

## ANTI-PATTERNS
- Do not let a successful probe grant execution authority.
- Do not configure environments before compiler registration.
- Do not bypass project/history authorization for existing artifacts.
- Do not treat local-job drain as a substitute for exclusive admission.
- Keep process execution in worker/sandbox machinery rather than HTTP handlers.
