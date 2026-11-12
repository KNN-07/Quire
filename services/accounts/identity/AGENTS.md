# ACCOUNT IDENTITY

## OVERVIEW
Authentication ports, credentials and onboarding; score 8, distinct login lifecycle domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Registration | `index.ts` | `register`, `migrations` |
| Sessions | `authentication.ts` | Authentication port and cookie |
| Runtime policy | `policy.ts` | `intersectPolicy` |
| Storage | `store.ts` | Repository and default preferences |
| Credential routes | `credentials.ts` | Credential lifecycle |
| Profile routes | `profile.ts` | Profile mutation |
| Account lifecycle | `account.ts` | Account routes |
| Discovery | `reads.ts` | Provider capability and identity policy |
| Onboarding | `onboarding.ts` | Durable request identity |
| Import flow | `onboarding-imports.ts` | Onboarding import registration |
| Benefits | `project-benefits.ts` | Project entitlement resolution |
| Retained mail | `mail.ts` | Local mailbox reads |

## CONVENTIONS
- Build the repository and authentication object before registering routes.
- Provide identity and policy ports before dependent feature lanes register.
- Identity migrations include provenance, onboarding and project sharing.
- `reads.ts` exposes provider discovery separately from authentication execution.
- Keep session-cookie handling with the authentication implementation.
- Default preferences come from the identity store.
- Verify this domain with `bun test tests/accounts/identity`.

## ANTI-PATTERNS
- Do not register account routes before the identity port exists.
- Do not turn provider discovery capability into proof of authentication.
- Do not use preference defaults as authorization for AI disclosure.
- Do not expose stored private keys through credential reads.
- Do not infer project benefits from a browser-selected plan label.
