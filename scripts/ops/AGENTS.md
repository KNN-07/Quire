# OPERATIONS SCRIPTS

## OVERVIEW
Operator commands for environment management, configured backups and fixture-only recovery drills; score 8, distinct operations boundary.

## WHERE TO LOOK
Paths are relative to this guide unless marked repo root.

| Task | Location | Notes |
|------|----------|-------|
| Environment tooling | `environments.ts` | Build, probe and configured API commands |
| Admission proposal | `environment-admission.ts` | Offline unsigned review material |
| Backup operations | `backup.ts` | Opens configured app; default action creates a backup |
| Fixture restore drill | `restore-drill.ts` | Accepts only the complete fixture |
| Shared environment policy | `services/operations/environments/` (repo root) | Probe and admission authority |
| Restore fixture | `tests/operations/backups/drill.ts` (repo root) | Isolated recovery evidence |
| Toolchain procedure | `docs/runbooks/toolchains.md` (repo root) | Build, probe and admission steps |
| Project commands | `package.json` (repo root) | Script aliases and runtime |
| Evidence destination | `docs/evidence/` (repo root) | Reviewed drill artifacts |

## CONVENTIONS
- Validate each command's inputs at the CLI boundary; some commands call the configured application directly.
- Treat environment probes and proposals as evidence, not execution admission.
- `backup.ts` creates by default; restore requires an archive, target and explicit confirmation.
- Restore drill accepts the complete fixture and writes evidence only.

## ANTI-PATTERNS
- Never use a probe to grant live execution authority.
- Never target live user data with the restore drill.
- Do not convert unsigned admission proposals into installed release authority.
- Keep credentials out of command-line URLs and logged output.
- Do not treat local fixture evidence as host fencing acceptance.
- Keep generated evidence distinct from production backup artifacts.
