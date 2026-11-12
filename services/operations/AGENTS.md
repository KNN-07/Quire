# OPERATIONAL SERVICES

## OVERVIEW
Runtime administration, process authority and infrastructure services; score 13, distinct operator domain.

## STRUCTURE
```text
installation/ controller-owned release and execution authority
updates/      authenticated update orchestration
backups/      full recovery archives and isolated restore
environments/ toolchain registry, probes and execution admission
workers/      owned worker pool and process controller
repository/   locked-volume repository service
storage/      PostgreSQL, Redis and S3 adapters
ssh/          restricted Git SSH service
support/      inquiry outbox, diagnostics and SIEM
tasks/        operation read API
overview/     topology and operational overview
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Module assembly | `index.ts` | Update/support modules and lifecycle exports |
| Repository ownership | `repository/service.ts` | Exclusively locked volumes |
| SQL conversion | `storage/postgres/placeholders.ts` | `??` is literal PostgreSQL operator |
| SSH protocol | `ssh/protocol.ts` | Restricted Git argument parser |
| Inquiry enqueue | `support/inquiries.ts` | SQL enqueue boundary |
| Diagnostic export | `support/diagnostics.ts` | Restricted data selection |

## CONVENTIONS
- Update safety and inquiry delivery require host-supplied authority.
- Repository imports validate immutable Git objects before publication.
- Infrastructure implementations use Bun-native storage and network APIs.

## ANTI-PATTERNS
- Do not perform network I/O inside the inquiry enqueue transaction.
- Diagnostics must not export probe output or arbitrary private records.
- Never share a repository engine across volumes without exclusive ownership.
- SSH accepts Git's single quoted repository argument, never shell syntax or paths.
- Keep this SSH service separate from ordinary machine sshd.
