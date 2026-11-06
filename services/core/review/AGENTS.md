# COLLABORATION AND REVIEW

## OVERVIEW
Realtime documents, persisted review and access-aware history; score 8, distinct collaborative state domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Lifecycle | `index.ts` | Registration and disposal |
| Realtime | `realtime.ts` | `RealtimeService` |
| Review storage | `store.ts` | `ReviewStore` |
| History storage | `history-store.ts` | `HistoryStore` |
| Mutations | `mutations.ts` | `ReviewMutations` |
| Suggestions | `suggestions.ts` | Persisted proposals |
| Decisions | `decisions.ts` | Review decisions |
| Threads | `threads.ts`, `comments.ts` | Discussion state |
| History | `history.ts`, `history-changes.ts` | Visible history changes |
| Event replay | `events.ts` | Access and session replay |
| Operation events | `operation-events.ts` | Operation publication |
| Updates | `updates.ts` | Document updates |
| Presence | `presence.ts` | Collaborative presence |
| Recovery | `recovery.ts` | Durable state reconciliation |

## CONVENTIONS
- Review proposals and decisions persist on the server.
- History views honor access boundaries before describing changes.
- Realtime session revocation accounts for event age and session identity.
- The module exposes explicit disposal for lifecycle owners.
- Review and source publication share existing authority rather than browser state.

## ANTI-PATTERNS
- Never bridge hidden history transitions while constructing visible changes.
- Replaying an old wildcard must not revoke a valid later-created session.
- Do not make proposal acceptance a client-only persistence operation.
- Do not replace anchored source decisions with historical raw coordinates.
- Do not leave realtime resources active after module disposal.
