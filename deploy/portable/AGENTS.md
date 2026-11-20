# PORTABLE DEPLOYMENT

## OVERVIEW
Operational guide for the portable multi-role deployment profile; score 8, distinct operator procedure surface.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Deployment and transfer | `README.md` | External services, roles and quiesced transfer |
| Shared role runtime | `../runtime/` | Images and role entrypoints |
| Compose topology | `../compose/compose.yaml` | Local portable service layout |
| Cluster alternative | `../helm/` | Kubernetes operator deployment |
| Backup contract | `../installation/README.md` | Host control and recovery authority |
| Infrastructure stack | `../compose/compose.yaml` | Database, Redis, bucket and roles |
| Runtime images | `../runtime/` | Role-specific startup |
| Operational checks | `../../scripts/ops/` | Probes and fixture drills |

## CONVENTIONS
- Use the repository-pinned Bun runtime and real PostgreSQL, Redis and S3-compatible services.
- Keep repository storage on the singleton repository role.
- Transfer only after writers are quiesced and operator state is preserved.

## ANTI-PATTERNS
- Never create a separate instance key for each API.
- Do not copy live SQLite without its WAL, blobs and Git state.
- Do not describe quiesced transfer as online migration or automatic retry.
- Do not claim HA, SSH or backup acceptance from the portable build alone.
- Do not run concurrent repository processes against the same volume.
- Keep backup signing authority independent of application credentials.
- Require real external PostgreSQL, Redis and authenticated object storage.
- Preserve durable backup storage and instance secrets during role replacement.
