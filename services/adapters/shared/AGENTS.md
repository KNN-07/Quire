# SHARED ADAPTER FRAMEWORK

## OVERVIEW
Reusable external-operation authority and security machinery; score 8, distinct framework boundary.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Producer contract | `CONTRACT.md` | Read before extending contributions |
| Assembly | `index.ts` | Connections order 60, providers order 61 |
| Types and actions | `contracts.ts` | `AdapterContribution`, `defineAction` |
| Operation orchestration | `operations.ts` | Prepared action lifecycle |
| Receipts | `operation-store.ts` | Durable replay state |
| Grants | `grants.ts` | Encrypted provider grants |
| OAuth | `oauth.ts`, `oauth-protocol.ts` | Bound authorization exchange |
| HTTP | `http.ts` | `SafeHttpClient` |
| Network rules | `network-policy.ts` | DNS and redirect policy |
| Configuration | `configuration.ts` | Versioned provider settings |
| Cancellation | `cancellation.ts` | Preparation cancellation |

## CONVENTIONS
- `publish(tx)` performs only final fenced SQL publication on the supplied transaction.
- Provider and Git preparation finish before publication; `release()` runs outside SQL.
- Preparation honors cancellation and owns cleanup if it throws before returning.
- Persist consumer recovery journals before publishing Git refs.
- Detached scheduler work enters `context.admission.background`.
- The shared factory starts no provider scheduler itself.
- Verify with `bun test tests/adapters/shared`; full checks are in `README.md`.

## ANTI-PATTERNS
- Never store plaintext access, refresh or client tokens.
- Never replay a durable running operation after uncertain external completion.
- Never forward credentials across origins or disable SSRF checks via environment.
- Test loopback access requires exact explicitly constructed fixture origins.
- Do not add compatibility casts for missing required port fields.
