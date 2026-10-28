# Generic Git credential admission

The parent implemented the previously missing generic Git connection contract:
POST `/api/connections/git/credentials` accepts `{label,url,username,secret}`
and returns only `AdapterGrant`. Session and CSRF checks precede safe pinned Git
transport verification. Publication rechecks current provider configuration and
active actor before encrypting the credential through the existing GrantStore.

The encrypted payload binds username/password to the canonical repository URL.
Clone, fetch, push and connection-test operations reuse the same transport;
a different repository is rejected before credentials are sent. The shared
stored-token schema now supports Basic as well as Bearer credentials.

Generic Git explicitly selects shared `revoke: "local"`. DELETE of the existing
connection clears and versions the saved credential using current grant claims.
It does not claim to revoke a user-managed token at an arbitrary upstream.
OAuth adapters retain their actual upstream revocation behavior.

`bash_150` passed 64 existing remote/shared tests; its new credential test exposed
the missing Basic variant. After that schema correction and correcting the
test's stale action cursor, `bash_153` passed the real end-to-end credential
workflow with 11 assertions and touched-file type-aware lint. It proves actual
Git verification/clone, durable source after restart, repository binding,
connection testing, local encrypted-secret deletion and continued validity of
the independently managed upstream credential.

The full TypeScript command in that run reported only concurrent
`tests/integration/adapters/harness.ts` and assistant `context.test.ts` errors;
their owners were notified. It is not a clean global-typecheck receipt.
No live credentials or external writes were used. Whole default-server and scale
integration remain the aggregate factory's acceptance gate.
