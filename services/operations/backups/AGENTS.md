# BACKUP AND RESTORE

## OVERVIEW
Signed full-recovery archives with isolated restore authority; score 8, distinct recovery trust domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Assembly | `index.ts` | Configuration, registration and scheduling |
| Schemas and host | `model.ts` | Archive format and exclusive host contract |
| Archive verification | `archive.ts` | Independent trust key |
| Signing | `signing.ts`, `signer-key.ts` | Signing boundary |
| Restore | `restore.ts` | Restore orchestration |
| Target ownership | `restore-target.ts` | Isolated target lifecycle |
| Database image | `database.ts` | Portable database representation |
| Repository image | `repositories.ts` | Git archive work |
| Git verification | `git-verify.ts` | Repository integrity |
| Files | `files.ts` | Archive file processing |
| Jobs | `jobs.ts` | Persisted backup operations |
| Schedule | `policy.ts` | Disabled or daily UTC schedule |
| SQL | `041-o-backups.sql`, `041-o-backups.postgres.sql` | Dialect pair |

## CONVENTIONS
- Host `exclusive` stops admission and drains every writer, including worker roles.
- Archive manifests declare authority, signer, file digests and repository refs.
- Trusted verification keys are independently provisioned.
- Storage is operator-selected and isolated from live runtime storage.
- Scheduling uses UTC minute/hour daily policy.

## ANTI-PATTERNS
- Never infer the trusted verification key from an archive.
- Never include signing private keys in recovery archives.
- Never resolve isolated backup storage to the live database, bucket or volume.
- Never delete a surviving restore-target directory.
- Never treat source process IDs as owned handles.
- Never use local time for backup schedules.
