# ACCOUNT GOVERNANCE

## OVERVIEW
Organization policy, managed lifecycle and billing authority; score 8, distinct governance domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Aggregate registration | `index.ts` | `register`, `migrations` |
| Shared authority | `shared.ts` | Authorization and publication |
| Organizations | `organizations.ts` | Organization routes |
| Members | `members.ts` | Membership operations |
| Invitations | `invitations.ts` | Invitation workflow |
| Managed accounts | `managed.ts` | Managed account operations |
| Lifecycle | `lifecycle.ts`, `lifecycle-policy.ts` | Managed policy transitions |
| Management reads | `management-reads.ts` | Read API |
| Billing | `billing.ts` | Catalog and provider-event seam |
| Benefits | `project-benefits.ts` | Effective benefit selection |
| Institution | `institution.ts` | Institutional policy |
| Notifications | `notifications.ts` | Digest and dedupe state |
| Operator mutations | `admin-mutations.ts`, `admin-users.ts` | Administration |
| Editor guards | `editor-state.ts` | Editor state policy |

## CONVENTIONS
- Require the identity service before registering governance lanes.
- Aggregate domain registrars from `index.ts`.
- Notification receipts deduplicate by user and dedupe key.
- Digest items retain their project and resource associations.
- User tombstoning removes that user's pending digest items.
- Keep billing catalog installation behind the governance billing seam.

## ANTI-PATTERNS
- Do not leave pending digest rows for a tombstoned account.
- Do not let capacity reductions silently discard existing memberships.
- Do not equate merchant prices with effective project benefits.
- Do not bypass lifecycle policy when transferring managed accounts.
