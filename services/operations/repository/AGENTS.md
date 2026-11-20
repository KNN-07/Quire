# REMOTE REPOSITORY SERVICE

## OVERVIEW
Singleton Git repository authority with SQL-fenced publication and remote client; score 8, distinct process-owned repository domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Engine and publication | `service.ts` | Per-volume repository engine |
| Remote client | `client.ts` | Authenticated repository calls |
| Admission | `admission.ts` | Mutation fencing |
| Shared schemas and journal state | `journal.ts` | Lease, update and intent schemas |
| Git process | `process.ts` | Owned Git execution |
| Runtime entry | `index.ts` | Repository service assembly |
| RPC server | `server.ts` | Authenticated repository RPC |
| SQL intent finalization | `journal.ts` | Lease-fenced completion |

## CONVENTIONS
- Run one engine per exclusively locked repository volume.
- Prepare Git objects before publishing refs and journal uncertain transitions.
- Fence publication with current branch lease and transaction authority.
- Remote service connections require HTTPS except explicit loopback development.

## ANTI-PATTERNS
- Never instantiate the portable/scale `RepositoryEngine` in API processes; it belongs to the remote repository role. Local-profile APIs intentionally use `LocalRepositoryService`.
- Do not treat remote completion alone as proof that local publication is fenced.
- Do not share process IDs or repository ownership across controllers.
- Do not bypass the explicit recovery RPC for uncertain journaled intents.
- Do not publish a ref before its objects and intent are prepared.
- Do not treat a lost response as proof that a remote mutation failed.
