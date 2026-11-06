# DROPBOX SYNCHRONIZATION

## OVERVIEW
Folder synchronization with explicit source and generated-artifact policy; score 8, distinct synchronization domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Assembly | `index.ts` | `createDropboxIntegration` |
| Contract | `README.md` | Source and export policy |
| Provider requests | `api.ts` | Discovery and remote I/O |
| Folder mapping | `folders.ts` | Folder preparation |
| Synchronization | `sync.ts` | Main operation flow |
| Authorization | `authorization.ts` | Current core ACL checks |
| Policy | `policy.ts` | Opt-in behavior |
| Generated files | `generated.ts` | Outbound artifact handling |
| Merge | `merge.ts` | Source reconciliation |
| Rebase | `rebase.ts` | Stale prepared imports |
| Recovery | `journal.ts`, `recovery.ts` | Durable prepared state |
| Scheduling | `scheduler.ts` | Opt-in recurring work |
| Boundary schemas | `model.ts` | Parsed state |

## CONVENTIONS
- Use shared encrypted OAuth grants and operation receipts.
- Recheck current core access when publishing changes.
- Generated artifact export is opt-in and outbound-only.
- Discovery retains unsupported entries for explicit handling.
- Stale prepared source becomes an explicit copy.
- Verify with `bun test tests/adapters/dropbox`.

## ANTI-PATTERNS
- Never overwrite live source with a stale prepared import.
- Never import generated output as editable source.
- Do not silently drop unsupported files during discovery.
- Do not turn generated-artifact export into bidirectional synchronization.
- Do not bypass consumer recovery journals for folder publication.
