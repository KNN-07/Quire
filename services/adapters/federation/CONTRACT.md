# Federation integration contract

Export contract, October 27, 2026. Terminal acceptance is recorded separately
in `docs/handoffs/p2x-federation.md`.

`createFederationModules(options)` returns `callbacks` (A, order 66,
`066-a-federation`) and `administration` (O,
order 67, `067-o-federation-admin`). Register after external identity module 62.
Both use the same runtime service registry. Additive migration
`066-x-federation` has separate SQLite and PostgreSQL definitions.

Assembly options: `organizationId`, explicit optional `transferTo`,
`ldapAllowedUrls`, `ldapSubjectAttribute`, and optional `SafeHttpClient`.
Do not derive directory allowlists or transfer authority from public HTTP input.
SCIM `externalId` is the immutable IdP subject, not the email address.

Identity owns shared `identityStart`, `identityCallback`, and `identityLink`
dispatch. Federation contributes `oidc`, `saml`, and `federation-test` handlers.
Federation owns `samlCallback`, SCIM Users/Groups transports, configuration,
test, metadata and bearer rotation.

Delivered foundation routes:

- O `identityBreakGlass`: POST `/api/admin/identity/break-glass` `{password}` -> Ok.
- O `identityCertificates`: POST `/api/admin/identity/certificates`
  `{certificates,expectedVersion}` -> IdentityConfig.
- A `ldapLogin`: POST `/api/auth/ldap/login`
  `{username,password,returnTo}` -> User envelope and rotated session cookie.
- Existing `identityTest` accepts optional `ldapUsername` and `ldapPassword`.
- Identity administration and SCIM-token routes are O-laned.
- Accounts policy intersects `policy_sets(scope_kind='federation-user',scope_id=userId)`
  alongside existing restrictions. These independent ceilings never overwrite a
  manual user policy.

The FINAL `docs/handoffs/p2x-identity.md` and `p2x-base.md` handoffs were read
completely. Root dependencies installed by parent: node-saml 5.2.0,
xmldom 0.9.12, ldapts 9.2.0; xml-crypto 6.4.0 for signed fixtures.

## Resolved runtime finding

Two separate native fixture runs hit the same pre-existing seed error:
`packages/runtime/src/repository-process.ts:28`, `child.stdin.end(input)`:
`ERR_INVALID_ARG_TYPE: Received an instance of ArrayBuffer`.
The first run passed 19 OIDC/SCIM cases; the second passed 11 signed SAML cases.
The failed test in each never reached federation behavior. The
runtime owner fixed native byte-input normalization with `Buffer.from(input)`.
Subsequent complete native federation runs passed.
Parent `thread_send` reports `unknown_cause` and rejects this report delivery;
the terminal output and this contract retain the exact finding.
