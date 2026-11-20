# OPERATIONAL STORAGE

## OVERVIEW
Portable PostgreSQL, advisory Redis and content-addressed S3 storage adapters; score 8, distinct infrastructure boundary.

## STRUCTURE
```text
postgres/ transaction executor and mutation admission
redis/    advisory event and lease wake transport
s3/       content-addressed blob storage
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| PostgreSQL adapter | `postgres/index.ts` | SQL, unit of work and shutdown |
| Placeholder conversion | `postgres/placeholders.ts` | PostgreSQL operator handling |
| Mutation admission | `postgres/admission.ts` | Fenced write coordination |
| Redis transport | `redis/index.ts` | Subscription lifecycle |
| Redis wire protocol | `redis/wire.ts` | RESP2 connection |
| S3 blob store | `s3/index.ts` | Hash-addressed objects |
| Storage selection | `../../../apps/server/src/scale.ts` | Portable adapter assembly |
| Backup identity | `../backups/` | Restore uses actual storage authority |

## CONVENTIONS
- Use transaction-scoped executors for every operation inside a transaction callback.
- Drain admitted operations before closing storage resources.
- Redis carries wake signals; SQL owns durable events, leases and fences.
- Verify blob content against its content-address digest on reads.

## ANTI-PATTERNS
- Never capture the root SQL executor inside a transaction callback.
- Do not use Redis as durable state or ownership authority.
- Do not expose S3 credentials through restore identity or diagnostics.
- Do not accept corrupted bytes under a requested content digest.
- Do not mistake Redis readiness for durable event catch-up.
- Do not create or overwrite a bucket as a side effect of identity probing.
