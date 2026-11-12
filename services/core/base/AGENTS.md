# PROJECT AND SOURCE CORE

## OVERVIEW
Project authority, source composition and recoverable publication; score 11, distinct core persistence domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Registration | `index.ts` | Recovery precedes service and routes |
| Projects | `projects.ts` | `CoreProjects` |
| Authorization | `access.ts`, `effective-access.ts` | Current effective permissions |
| Access records | `access-records.ts` | Persisted access |
| Listing | `project-list.ts` | Access-aware pagination |
| Source service | `source.ts` | `SourceService` |
| Composition | `source-composition.ts` | Prepared source changes |
| Finalization | `source-finalization.ts` | Publication completion |
| Recovery | `source-recovery.ts` | Interrupted publication |
| Receipts | `receipts.ts`, `source-records.ts` | Durable operation contracts |
| File routes | `file-routes.ts` | File HTTP surface |
| Import/export seams | `export-adapter.ts`, `link-adapter.ts` | Adapter delegates |
| Git checkpoints | `git-checkpoint.ts` | Repository coordination |
| Limits | `limits.ts` | Validated environment limits |

## CONVENTIONS
- Preserve startup recovery before service availability.
- Source intent, composed documents and finalization receipts are separate contracts.
- Share effective-access logic across ordinary, adapter and history operations.
- Runtime environment limits are parsed as positive integers.
- Export and link adapters extend existing core entry points.
- Failure construction is centralized in `store.ts`.

## ANTI-PATTERNS
- Revoked link memberships must contribute neither rows nor pagination cursors.
- Do not publish prepared source by bypassing finalization and recovery.
- Do not duplicate core import/export authority in adapter routes.
- Do not infer write access from a previously loaded browser capability.
- Do not confuse a prepared receipt with completed source publication.
