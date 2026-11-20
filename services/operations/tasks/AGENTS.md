# OPERATION READ API

## OVERVIEW
Authorized read surface joining application and update operation records; score 8, distinct cross-authority query domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Endpoint registration | `index.ts` | Operation get/list routes |
| Authority merge | `readers.ts` | Application and update rows |
| Row queries | `store.ts` | SQL mapping and query functions |
| Operation producers | `../updates/` and `../../core/base/` | Separate durable authorities |
| Shared response contract | `packages/contracts` | Operation schema |
| Identity service | `../../accounts/identity/` | Principal authentication |
| Project access | `../../core/base/` | Current project authorization |
| Route composition | `apps/server/src/composition.ts` | Update client wiring |

## CONVENTIONS
- Authenticate and authorize each operation before returning its result.
- Recheck project access for operation metadata that names projects.
- Return private no-store responses for operation state.
- Detect conflicting identifiers when combining application and update authorities.

## ANTI-PATTERNS
- Do not reveal operator-only update metadata to ordinary users.
- Do not treat possession of an operation identifier as access authority.
- Do not expose cached operation details publicly.
- Do not merge records with conflicting identifiers from separate authorities.
- Do not return project-scoped results before rechecking current project access.
- Do not reveal raw storage rows as the public operation representation.
- Keep operator-only flags authoritative across both operation sources.
