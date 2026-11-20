# RUNTIME DEPLOYMENT

## OVERVIEW
Role-aware runtime image, startup and artifact assembly; score 8, distinct release packaging domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Runtime image | `Dockerfile` | Owned image and installed tools |
| Entrypoint | `entrypoint.sh` | Role dispatch |
| Server policy | `server.ts` | Production headers and application |
| Artifact assembly | `artifacts.ts` | Fresh owned release prefixes |
| Readiness | `readiness.ts` | Runtime admission checks |
| Manifest | `manifest.ts` | Release contents and identity |
| Schema readiness | `schema-ready.ts` | Database migration admission |
| Deployment guidance | `../portable/README.md` | Operator role startup |
| Service assembly | `../../apps/server/src/composition.ts` | Application modules |
| Compiler image | `../compiler/Dockerfile` | Owned toolchain image |
| Cluster role values | `../helm/values.yaml` | Operator deployment inputs |

## CONVENTIONS
- Runtime roles use project-owned images and explicit role entrypoints.
- Validate release artifacts and readiness before starting role services.

## ANTI-PATTERNS
- Do not infer compiler readiness from executable presence alone.
- Never replace an existing release prefix during artifact assembly.
- Keep repository and compiler work in their designated runtime roles.
- Do not expose the installation control ledger through application APIs.
- Do not start a role before its declared storage and schema readiness.
- Preserve the shared instance identity across API replicas.
- Do not use mutable tags as proof of immutable artifact identity.
