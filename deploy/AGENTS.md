# DEPLOYMENT SURFACES

## OVERVIEW
Portable, container and controlled-installation runtime layouts; score 9, distinct deployment domain.

## STRUCTURE
```text
portable/     project-local Bun deployment instructions
runtime/      runtime image, entrypoint and role launchers
compose/      API, repository, workers and infrastructure topology
helm/         chart values and workload templates
installation/ controller and role authority contract
compiler/     fixed compiler image, wrappers and fixtures
ssh/          restricted Git SSH topology
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Portable operations | `portable/README.md` | Concrete deployment commands |
| Runtime image | `runtime/Dockerfile` | Bun base pinned by digest |
| Runtime modes | `runtime/entrypoint.sh` | Migrate, API, repository, worker |
| Compose stack | `compose/compose.yaml` | Services and health checks |
| Helm setup | `helm/values.yaml` | Operator values |
| Installation contract | `installation/README.md` | Controller-only ledger |
| Compiler sandbox | `compiler/compile.sh` | Fixed compiler execution |
| TikZ wrapper | `compiler/tikz.sh` | Generated basename input |
| SSH constraints | `ssh/README.md` | Broker and high-port sshd roles |

## CONVENTIONS
- Portable deployment uses project-local pinned Bun 1.4.4.
- Repository and compiler workers run as distinct roles against shared authority.
- `portable/README.md` documents migration, repository, seed and worker commands.
- Compiler fixtures include deliberately forbidden shell escape input.

## ANTI-PATTERNS
- Never replace the workstation's global runtime during portable setup.
- Never generate a separate instance key for each API directory.
- APIs and helpers must never open the installation control SQLite ledger.
- TikZ wrapper input is a generated basename, never command options.
- SSH must not allow passwords, TTYs, forwarding or user rc/authorized_keys files.
