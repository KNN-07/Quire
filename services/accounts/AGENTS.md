# ACCOUNT SERVICES

## OVERVIEW
Identity and governance service lanes; score 9, distinct account authority domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Identity registration | `identity/index.ts` | Identity migrations and route wiring |
| Authentication | `identity/authentication.ts` | Session authority |
| Policy | `identity/policy.ts` | Runtime identity policy |
| Account writes | `identity/account.ts` | Account lifecycle |
| Credentials | `identity/credentials.ts` | Credential routes |
| Onboarding | `identity/onboarding.ts` | Durable request receipts |
| Import onboarding | `identity/onboarding-imports.ts` | Actor-bound import workflow |
| Governance registration | `governance/index.ts` | Domain registrar aggregation |
| Authorization helpers | `governance/shared.ts` | Audit, errors and publication |
| Membership | `governance/members.ts` | Organization membership |
| Invitations | `governance/invitations.ts` | Invitation lifecycle |
| Billing | `governance/billing.ts` | Verified provider event handling |
| Managed lifecycle | `governance/lifecycle.ts` | Managed account policy |
| Notifications | `governance/notifications.ts` | Digests and receipts |

## CONVENTIONS
- Each lane exports registration and migrations through its own entry point.
- Governance routes reuse shared authorization, audit and publication helpers.
- Identity receipts bind replay to the actor and request identity.
- Local migration additions include SQLite and PostgreSQL variants.
- Effective project benefits are resolved through account/governance services.

## ANTI-PATTERNS
- Never carry a previous login's queued onboarding draft to a different actor.
- Never invent an operator session for a verified provider event.
- Do not treat organization UI visibility as membership authority.
- Do not bypass the shared audit path for governance mutations.
- Provider credentials belong in encrypted runtime storage.
