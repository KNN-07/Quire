# PUBLISHER CONTRIBUTION

## OVERVIEW
Adapter contribution for preparing and submitting project exports to configured destinations; score 8, distinct publication-receipt domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Module and exports | `index.ts` | Contribution and contract exports |
| User actions | `contribution.ts` | Prepare, confirm and status actions |
| Destination contract | `configuration.ts` | URL and OAuth configuration |
| Provider client | `client.ts` | Bounded destination requests |
| Durable state | `store.ts` | Preparation and submission receipts |
| Schema | `migrations.ts` | Publisher state |
| Operator contract | `README.md` | Destination requirements |
| Shared action framework | `../shared/` | OAuth and action registration |
| Export authority | `../../core/base/export-adapter.ts` | Shared export preparation |

## CONVENTIONS
- Preparation uses shared export and operation mechanisms.
- Submission requires explicit confirmation and records the provider receipt.
- Destination endpoints are derived from validated configured contracts.
- OAuth and bearer credentials are stored through shared encrypted grants.
- Bearer enrollment verifies the supplied token separately; bearer disconnect is local.

## ANTI-PATTERNS
- Never report submission complete without a provider receipt.
- Do not replay uncertain external writes as if their outcome were known.
- Keep provider credentials within shared encrypted grants.
- Do not bypass source and export access checks during preparation.
- Do not treat a successful preparation as a completed submission.
- Do not let destination responses replace local durable operation state.
- Do not claim remote revocation for locally disconnected bearer grants.
