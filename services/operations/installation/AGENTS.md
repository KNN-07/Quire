# INSTALLATION AUTHORITY

## OVERVIEW
Independent controller ledger and authenticated fixed-recipe execution; score 9, distinct control-plane domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Controller | `controller.ts` | Controller lifecycle |
| Durable authority | `control-store.ts` | Controller-only ledger |
| Ledger schema | `control-migrations.ts` | Independent migration history |
| Command protocol | `protocol.ts`, `model.ts` | Canonical authenticated messages |
| Execution protocol | `execution-protocol.ts`, `execution-model.ts` | Execution boundary |
| Systemd authority | `systemd-authority.ts` | Unit and invocation ownership |
| Broker | `execution-broker.ts` | Execution coordination |
| Recipes | `execution-recipes.ts` | Fixed command definitions |
| Sealed source | `execution-source.ts` | Source description and sealing |
| Caller bridge | `caller-execution.ts` | Controlled sandbox entry |
| Storage preparation | `prepared-storage-host.ts` | Existing binding probes |
| Role binding | `binding.ts`, `launch.ts` | Authenticated role session |
| Release admission | `environment-admission.ts` | Signed environment authority |

## CONVENTIONS
- Control and execution have separate schemas and protocols.
- Commands use canonical JSON/digests and authenticated authority.
- Caller-supplied recipe arguments are parsed against fixed recipes.
- Rollback requires a fresh storage binding.
- Persistence records evidence; process ownership is separate authority.

## ANTI-PATTERNS
- Never add the control ledger migration to application `schema_migrations`.
- Never create a missing database while probing a binding.
- Never fall back to caller-selected commands, managers or monitor argv.
- Never treat persistence as a supervisor, launch gate or proof of stop.
- The caller must hold `controller.lock`; never invent a lost helper exit result.
