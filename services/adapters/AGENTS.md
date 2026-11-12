# EXTERNAL ADAPTER ASSEMBLY

## OVERVIEW
Provider contributions and integration lifecycle assembly; score 13, distinct external integration domain.

## STRUCTURE
```text
shared/       encrypted grants, receipts, HTTP and contribution framework
identity/     protocol verifiers and trusted profiles
federation/   institution SSO and provisioning
remote-git/   Git, GitHub and GitLab operations
references/   bibliographic retrieval and library sync
interchange/  shared import/export dispatcher and converter
dropbox/      folder synchronization
ai/           consent-bound generation and reviewed edits
billing/      durable billing intent and provider dispatch
publisher/    destination preparation and submission receipts
delivery/     SMTP and local mail contributions
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Host integration | `index.ts` | `createApplicationAdapters` and lifecycle |
| Contribution contract | `shared/CONTRACT.md` | Frozen producer interface |
| Provider assembly | `shared/index.ts` | Connections and provider modules |
| Trusted login profiles | `identity/admission.ts` | Bound during host assembly |
| Billing uncertainty | `billing/store.ts` | Durable intent before dispatch |
| Mail security | `delivery/README.md` | SMTP contract |
| Publication state | `publisher/README.md` | Receipt-backed submission |

## CONVENTIONS
- Contributions extend shared mechanics and core delegates.
- One host-owned scheduler interval still respects provider-specific due times.
- Provider readiness reports configuration availability, not successful interoperability.

## ANTI-PATTERNS
- Never reissue an uncertain billing operation.
- Never mark publication submitted without a provider receipt.
- Never disable SMTP certificate verification or return stored credential documents.
- Do not accept identity verifiers or trusted profiles from HTTP input.
