# ACCOUNT WORKFLOW ACCEPTANCE

## OVERVIEW
Browser account identity, billing, onboarding, and governance workflows; score 7, retained account UI domain guidance.

## STRUCTURE
```text
account/
  onboarding/       setup, provider, import and billing returns
  identity-return/  authoritative OIDC round trip and replay denial
  checkout/         hosted Stripe protocol destination
  ldap-sign-in/     LDAP browser admission
  domain-discovery/ domain-based identity discovery
  organizations/   organization workflows
  management/      account management
  audit-zip/        actual audit export bytes
  self-deletion/    deletion workflow
  notifications/   persisted notification choices
  ...               invitations, strength, return acceptance
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Checkout composition | `checkout/fixture.ts` | `checkoutApplication` |
| Onboarding runner | `onboarding/run.ts` | Browser workflow setup |
| Identity round trip | `identity-return/identity-return.test.ts` | Redirect, replay, unlink |
| Export privacy | `audit-zip/browser.test.ts` | Secret canary in downloaded archive |
| Notification persistence | `notifications/preferences.test.ts` | Unchanged saves |

## CONVENTIONS
- Checkout reuses the canonical Stripe provider and substitutes its hosted destination.
- Its local TLS landing explicitly states that no payment has been made.
- Identity return uses actual provider configuration and authenticated browser contexts.
- Identity capture checks document overflow before saving full-page evidence.
- Browser cases share provider configuration helpers from `tests/ui-integrations`.

## COMMANDS
```sh
bun test tests/ui-product/account
```

## ANTI-PATTERNS
- Audit ZIP output must exclude the secret canary (`audit-zip/browser.test.ts`).
- Unchanged notification saves must not silently opt the user out.
- Identity replay and post-unlink sessions must retain denial coverage.
- Sources: `notifications/preferences.test.ts`, `identity-return/identity-return.test.ts`.
