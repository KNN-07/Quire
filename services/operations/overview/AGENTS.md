# OPERATIONS OVERVIEW

## OVERVIEW
Operator-facing runtime topology and compile-queue view; score 8, distinct administrative read surface.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Topology mapping | `index.ts` | Adapter identity and queue route |
| Adapter types | `../storage/` and `../repository/` | Configured backend identity |
| Queue authority | `services/compiler/` | Existing compile job state |
| Route contracts | `packages/contracts` | Operator queue endpoint |
| Authentication | `services/accounts/identity/` | Operator principal |
| Host assembly | `apps/server/src/composition.ts` | Route registration |
| Runtime boundaries | `packages/runtime/src/context.ts` | Module dependencies |
| Cache policy | `index.ts` | Private response headers |
| Queue row schemas | `index.ts` | Bounded database result parsing |

## CONVENTIONS
- Report configured adapter identity separately from provider health.
- Restrict queue details to authenticated operators and private responses.

## ANTI-PATTERNS
- Do not claim provider interoperability from configuration presence.
- Do not expose compile queue metadata to non-operators.
- Do not report inferred health from backend class identity.
- Keep private topology responses out of shared caches.
- Do not create probe traffic as part of topology rendering.
- Keep cursor validation tied to current queue rows.
- Do not add mutation routes to this read-only operator surface.
