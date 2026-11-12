# WORKER POOL CONTROL

## OVERVIEW
Serialized ownership and SQL-fenced admission of real worker processes; score 8, distinct process-control domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Public entry | `index.ts` | Controller, admission and registration exports |
| Controller | `controller.ts` | `WorkerController` |
| Process launch | `process.ts` | Parsed controller config and process handles |
| Persisted policy | `state.ts` | Pool and process state |
| Profiles | `profiles.ts` | Environment selection and role manifests |
| Admission | `admission.ts` | Managed worker pool checks |
| Authentication | `auth.ts` | Worker authority |
| Operations | `operations.ts` | Durable operation completion |
| Routes | `routes.ts` | Pool API |
| Schema | `migrations.ts` | Worker metadata |
| Worker body | `../../../workers/compiler/main.ts` | Executable worker entry |
| Installation roles | `../installation/launch.ts` | Controlled launch authority |

## CONVENTIONS
- One serialized controller owns its process map.
- SQL authority fences every claim.
- Startup checks configured environment capacity before reconciliation.
- Job and operation events wake the reconciliation loop.
- Each controller instance has a fresh owner identity.
- Role manifests identify the configured pool and environment.
- Shutdown stops wake sources before closing owned resources.

## ANTI-PATTERNS
- Never adopt another controller's process IDs.
- Never signal a remote host through local process handling.
- Do not treat a stored PID as an owned process handle.
- Do not bypass managed environment admission for a pool launch.
- Do not confuse worker API authentication with controller process ownership.
