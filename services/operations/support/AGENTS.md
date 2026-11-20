# OPERATIONS SUPPORT

## OVERVIEW
Operator diagnostics, inquiry outbox and ordered SIEM delivery; score 8, distinct support-data domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Registration and lifecycle | `index.ts` | Routes and SIEM dispatcher owner |
| Diagnostics | `diagnostics.ts` | Explicit bundle allowlist |
| Inquiry enqueue | `inquiries.ts` | SQL-only outbox boundary |
| SIEM delivery | `siem.ts` | Leased ordered dispatch |
| Runtime probes | `probes.ts` | Configuration and readiness checks |
| Schema | `migrations.ts` | Support persistence |
| Operator identity | `access.ts` | Current operator authority |
| Diagnostic route composition | `../` | Support module assembly |

## CONVENTIONS
- Run dispatch under background admission and drain it during shutdown.
- Enqueue inquiry work transactionally; perform network delivery outside SQL.
- Diagnostics expose an explicit allowlist of artifacts.
- SIEM advances durable cursors only after ordered delivery state is recorded.

## ANTI-PATTERNS
- Do not export probe output, secrets, endpoints or arbitrary private records.
- Do not perform network I/O inside inquiry enqueue transactions.
- Do not treat a probe as proof of provider interoperability.
- Do not lose SIEM lease, ordering or idempotency state on dispatch.
- Do not turn diagnostic bundle contents into a general database export.
- Keep durable retry state in the outbox and SIEM records.
