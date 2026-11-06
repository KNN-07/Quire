# RUNTIME UPDATES

## OVERVIEW
Authenticated release updates into an explicitly owned installation root; score 8, distinct update domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Registration | `index.ts` | Module and API setup |
| Orchestration | `service.ts` | Update workflow |
| Owned installation | `installer.ts` | Root validation, staging and switching |
| Release contracts | `model.ts` | Signed releases and configuration |
| Feed | `feed.ts` | Release discovery |
| Commands | `commands.ts` | Controller commands |
| Client | `client.ts` | Update client |
| Durable state | `store.ts` | Request and update records |
| Migration | `migrations.ts` | Application metadata schema |
| Legacy state | `legacy-import.ts` | Legacy import handling |
| Scheduling | `scheduler.ts` | Update scheduling |
| Control ledger | `../installation/control-store.ts` | Separate execution authority |

## CONVENTIONS
- The installer owns a pre-provisioned dedicated root.
- Root validation checks real paths and the `.quire-update-root` identity.
- The current target is a validated `releases/<id>` symlink.
- Installation locks belong to a specific operation.
- API update metadata and installation execution authority are separate.
- Validation is distinct from authenticated installation.

## ANTI-PATTERNS
- Never install into the running source checkout.
- Do not accept a root or release directory that resolves through another path.
- Do not bypass the owned-root marker or operation lock.
- Do not infer controller execution authority from application metadata.
- Do not turn release validation into an unauthenticated installation side effect.
