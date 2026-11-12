# FEDERATION PROTOCOL TESTS

## OVERVIEW
OIDC, SAML, LDAP and SCIM authority fixtures; score 8, distinct signed identity and directory domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Composed runtime | `harness.ts:20` | `fixture(options)` |
| OIDC faults | `oidc-idp.ts` | `providerFixture`, `ProviderFault` |
| Signed SAML response | `signed-idp.ts:26` | `signedResponse`, explicit fault types |
| Temporary certificate | `signed-idp.ts:8` | `certificate`, OpenSSL subprocess |
| LDAP over TLS | `ldap-fixture.ts:5` | `ldapFixture`, Docker slapd |
| Management enrollment | `managed-fixture.ts` | `acceptManagement` |
| Release state | `release-fixture.ts` | `releaseFixture`, `releaseSnapshot` |

## CONVENTIONS
- Federation deployment defaults to the seeded institution organization.
- The fixture clock follows the owned OIDC provider's mutable current time.
- Administrative configuration is saved through `FederationConfigurations`.
- Browser request origin derives from the active runtime public URL.
- OIDC begin preserves both the callback path and issued cookie.
- SCIM token creation uses an authenticated operator and fresh idempotency key.
- LDAP provisions a private directory and publishes an OS-assigned loopback TLS port.
- SAML response and assertion signatures have independent negative cases.

## COMMANDS
```sh
bun test tests/adapters/federation
```
- LDAP cases require Docker and the image named in `ldap-fixture.ts:31`.
- Certificate setup requires the `openssl` executable.

## ANTI-PATTERNS
- Do not replace signed-proof and replay denial cases with unsigned success responses.
- Preserve explicit management enrollment and release authority checks.
- Credential-shaped failure values are redaction canaries; keep their denial assertions.
- Do not omit LDAP process readiness or certificate/container disposal.
