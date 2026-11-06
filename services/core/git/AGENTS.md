# PROJECT GIT

## OVERVIEW
Repository history, merge and transport with durable publication journals; score 8, distinct Git domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Public entry | `index.ts` | Registration, journals and sessions |
| Repository | `repository.ts` | `GitRepository` |
| Journal | `journal.ts` | `GitJournal` |
| Git processes | `process.ts` | Shared process boundary |
| Trees | `trees.ts` | Tree validation |
| Merge | `merge.ts` | Merge and conflict resolution |
| Comparison | `comparison.ts`, `hunks.ts` | Source differences |
| Ancestry | `ancestry.ts` | History relationships |
| Status | `status.ts` | Live default-branch comparison |
| Sessions | `session.ts` | Git session serving |
| Transport | `transport.ts`, `http.ts` | Transport parsing |
| Credentials | `credentials.ts` | Git credential handling |
| Routes | `routes.ts`, `actions.ts` | Authorized operations |

## CONVENTIONS
- Initial named history is a fresh root.
- Branch status compares against the live default branch.
- Repository state transitions use their journal alongside Git changes.
- Process helpers are shared across Git operations.
- Git credential registration is exposed separately from core registration.
- Merge and conflict resolution remain explicit operations.

## ANTI-PATTERNS
- `.git` paths are forbidden in imported Git trees.
- Do not treat a stale default-branch snapshot as current branch status.
- Do not bypass journal recovery when changing repository publication.
- Do not conflate repository object preparation with ref publication.
- Keep authenticated session handling separate from raw Git process execution.
