# ADAPTER TESTS

## OVERVIEW
Provider protocol and connection lifecycle coverage; score 15, distinct external integration domain.

## STRUCTURE
```text
adapters/
  shared/       connection infrastructure and contribution fixtures
  ai/           provider runs, consent, retrieval, replay
  remote-git/   remote transport and repository workflows
  references/   Zotero and Mendeley protocols
  dropbox/      file synchronization and conflict behavior
  federation/   OIDC, SAML, LDAP, SCIM
  identity/     external identity verification
  billing/      Stripe protocol and dispatch
  interchange/  archive and URL import/export boundaries
  publisher/    submission provider protocol
  delivery/     SMTP and TLS fixtures
  host/         managed adapter lifecycle
  acceptance/   composed error-fix acceptance
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Local provider doubles | Each provider's `provider*.ts` | Owned protocol endpoints |
| Federation infrastructure | `federation/Dockerfile`, `federation/ldap-fixture.ts` | LDAP server fixture |
| Import threat cases | `interchange/urls.test.ts`, `interchange/imports.test.ts` | Metadata URLs, archive paths |
| Reference pagination | `references/mendeley-groups.test.ts` | Repeated and foreign pages |

## CONVENTIONS
- Provider suites compose adapter contributions with real runtime services.
- Protocol fixtures cover signed identity, hosted checkout, SMTP, and paginated APIs.
- Local provider origins are explicitly admitted through `SafeHttpClient` fixture options.
- Harness/provider helpers are reused across account and browser suites.

## ANTI-PATTERNS
- Credentials must stay absent from reference API responses (`references/credentials.test.ts`).
- Import URL and archive protections are asserted in the interchange suites.
- Federation failure fixtures intentionally carry credential-shaped redaction canaries.
