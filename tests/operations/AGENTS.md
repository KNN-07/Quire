# OPERATIONS TESTS

## OVERVIEW
Deployment, recovery, infrastructure, and installation ownership; score 11, distinct operations domain.

## STRUCTURE
```text
operations/
  installation/  control ledger, supervisor, prepared runtime
  environments/  pinned compiler image and confinement profiles
  backups/       complete restore drills and scale backup
  deployment/    compose/cluster proofs and evidence
  updates/       release artifacts and update boundaries
  workers/       worker ownership, lifecycle, budgets
  repository/    repository authority and worker processes
  storage/       PostgreSQL, Redis, S3 fixtures
  ssh/           SSH processes and authorization
  support/       diagnostics and doctor behavior
  overview/      operational status and scale views
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Scale restore setup | `backups/scale-fixture.ts` | Actual isolated storage and singleton roles |
| Update timing | `updates/fixture.ts` | `ControlledTimer` and fixture |
| SSH process execution | `ssh/commands.ts` | Bounded command/process helpers |
| S3 protocol server | `storage/s3/server.ts` | `S3TestServer` |
| Deployment evidence | `deployment/record.ts` | Shared record helper |

## CONVENTIONS
- Operational fixtures exercise process, Docker, and persistence behavior directly.
- Deployment proofs use `/tmp/quire-p2o-deployment-compose` and fixed loopback ports.
- Storage fixtures are grouped under their backend rather than their consumer.
- Update evidence and release entry construction live beside update suites.

## ANTI-PATTERNS
- Scale backup fixtures explicitly forbid SQLite fallback.
- Their contract requires real PostgreSQL, Redis, S3, and singleton repository roles.
- Source: `backups/scale-fixture.ts:17`.
