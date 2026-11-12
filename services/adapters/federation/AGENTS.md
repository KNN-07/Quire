# INSTITUTION FEDERATION

## OVERVIEW
Operator-configured SSO and SCIM for one institution per runtime; score 8, distinct identity provisioning domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Assembly | `index.ts` | `createFederationModules` |
| Contract | `CONTRACT.md` | Admission and publication boundary |
| Setup | `README.md` | Real provider prerequisites |
| Configuration | `configuration.ts` | Versioned institutional settings |
| Handshake evidence | `handshake-tests.ts` | Actual provider checks |
| OIDC | `oidc.ts` | OIDC exchange |
| SAML | `saml.ts`, `saml-provider.ts` | SAML validation and provider |
| LDAP | `ldap.ts` | Explicit adapter access |
| SCIM schemas | `scim-schema.ts` | Provisioning input |
| SCIM users | `scim-users.ts` | Immutable subject mapping |
| SCIM groups | `scim-groups.ts` | Group reconciliation |
| Membership publication | `provisioning.ts` | Adapter-owned memberships |
| Operator API | `admin.ts` | Configuration and receipts |

## CONVENTIONS
- Providers start disabled.
- Require an actual handshake test before claiming interoperability.
- Provider exchanges precede admission transactions.
- Fence publication against the configuration version used for preparation.
- Common login dispatch stays in the identity module.
- No background LDAP listener is created.

## ANTI-PATTERNS
- SCIM `externalId` is immutable IdP subject, never email auto-linking.
- Never seize manual administration or licensing during reconciliation.
- Never persist plaintext bearer secrets in idempotency receipts.
- Configuration reads must not disclose authentication secrets.
- Do not equate valid configuration with a successful real login.
