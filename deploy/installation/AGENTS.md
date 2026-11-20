# INSTALLATION DEPLOYMENT

## OVERVIEW
Operator-facing contract for controller-owned installation and execution authority; score 8, distinct host-control boundary.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Controller contract | `README.md` | Host setup and role ownership |
| Implementation | `../../services/operations/installation/` | Controller and independent ledger |
| Admission guidance | `../../docs/runbooks/` | Release and environment operations |
| Runtime artifacts | `../runtime/` | Owned release assembly |
| Restore procedures | `../../services/operations/backups/` | Isolated recovery workflow |
| Portable roles | `../portable/README.md` | Service startup and transfer |
| Controller runbooks | `../../docs/runbooks/` | Host operations |
| Environment release data | `../../services/operations/environments/` | Signed toolchain admission |
| Backup verification | `../../services/operations/backups/` | Independent signer trust |
| Update root contract | `../../services/operations/updates/` | Owned release installation |

## CONVENTIONS
- Keep installation control authority independent of application schema history.
- Use authenticated fixed recipes and owned process evidence.

## ANTI-PATTERNS
- Do not infer process ownership from persisted PIDs or records.
- Do not let application APIs open the control ledger.
- Do not turn a storage probe into database creation.
- Do not accept caller-selected executable commands or managers.
- Keep controller, application schema and process ownership authorities distinct.
- Require explicit ownership evidence for stop and rollback decisions.
- Never use an unsigned proposal as installed execution authority.
- Keep database binding probes read-only and non-creating.
