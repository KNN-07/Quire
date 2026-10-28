# Configured adapter boundary

Native runtime: Bun 1.3.14. No new dependencies are required.

## Registration and lifecycle

Import `createAdapterModules`, `defineAction`, `SafeHttpClient` and the
contribution types from `services/adapters/shared/index.ts`.
Pass every installed contribution together to one `createAdapterModules`
call. Register its `connections` module after account/core services, and its
`providers` module immediately afterward. The modules use lanes X and O
respectively. The actual assembled map is provided once as
`ServiceRegistry.adapters`; individual consumers must not provide that service.

Each contribution receives `AdapterServices`. It returns its provider kind,
label, exact missing-configuration function, optional OAuth definition,
typed action factories, actual grant test, optional operator probe, optional
provider-specific revocation, and optional cleanup.

`defineAction(schema, { projectAccess, prepare })` parses action parameters
once before invoking provider code. `projectAccess` is `none`, `read`, `write`
or `owner`. A project ID always incurs current core read authorization; actions
requiring a project cannot omit it. Core policy reads and authorization are
repeated through the supplied transaction executor before publication.
Consumers retain provider-specific consent/policy rules.

`prepare(parameters, context)` performs provider calls and Git preparation
outside SQL. It receives an abort signal and must honor it. Return
`{ result, cursor, publish?, release? }`. `publish(tx)` performs final SQL
and existing fenced core-source/repository finalization using that transaction,
not root SQL or external I/O. `release()` runs outside SQL on either outcome.
If preparation throws before returning, it owns its cleanup. Persist any
consumer-specific Git/provider recovery descriptor before publishing Git refs.

Shutdown order is: stop admitting HTTP work, await `modules.close()`, then
await `runtime.close()`. Reopening requires a fresh modules factory.
`close()` cancels admitted operation signals, drains operations and closes
provider-owned resources. No untracked background scheduler is started.
If runtime construction fails, call the same factory's `close()` in the error
path before discarding it.
Whole adapter execution, including failure cleanup, uses
`context.admission.writer`. A consumer's detached scheduled job must start with
`context.admission.background(() => services.operations.execute(...))` so it
waits for maintenance and receives a new admission ticket.

## Operator configuration

Existing O-laned routes are:

- `GET /api/admin/providers/:kind`: operator only; redacted configuration and
  ETag `"version"`. Missing configuration has version zero.
- `PUT /api/admin/providers/:kind`: authenticated operator, same-origin CSRF,
  matching `If-Match`, and JSON
  `{ baseUrl, model?, secret?, policy, expectedVersion }`.
- `POST /api/admin/providers/:kind/test`: authenticated operator with CSRF and
  `{ expectedVersion }`; performs the contribution's actual probe. Without a
  provider-level probe it reports the requirement for a user connection test.

The secret is encrypted with `Runtime.secretKey`, loaded by the existing
runtime from `QUIRE_SECRET_KEY` or its owner-only local `secret.key`.
Production requires that key explicitly. Omitted `secret` preserves the
existing value; an empty string clears it. The complete policy uses the existing
`PolicySchema`. Updates and redacted audit/events commit atomically.

`configuration(settings)` returns exact unsatisfied prerequisites, for example
the registered OAuth client ID/secret, provider API procurement contract, or
installed binary. An absent persisted operator configuration is always
`unconfigured`, even if a contribution's own prerequisite list is empty.
`ready` describes configuration availability, not a claimed successful live
third-party invocation. Only a real probe/grant action establishes that evidence.
Never turn a missing ReadCube/Dimensions/publisher contract into a canned
success. Domain contributions own their selected provider's official protocol.

## Connections and OAuth

The X module owns availability/list/start/callback/test/delete/action routes.
`GET /api/connections/availability` requires authentication and reads current
configuration for every actual installed provider without returning secrets.
Start and all mutations enforce existing session origin/CSRF checks.
OAuth authorization-code flow uses S256 PKCE, random one-use state stored only
as a hash, encrypted verifier, ten-minute injected-clock expiry, and binding
to account, exact session, provider, redirect URI and configuration version.
Each provider has a distinct exact callback:
`<QUIRE_PUBLIC_URL origin>/api/connections/<kind>/callback`.
Register that exact URI with the provider. `returnTo` is restricted to
same-origin `/settings` and `/projects` paths. Callback returns a 303 without
tokens and with no-store/no-referrer.

Tokens are AES-256-GCM encrypted with a fresh nonce and resource-associated
data binding grant ID, account and provider. Reads never return access/refresh
tokens. Refresh rotates encrypted credentials and grant version; an expired
grant's connection-test route refreshes before testing. Lack of refresh
credentials reports reconnection, not successful renewal. Delete performs real
configured revocation before clearing ciphertext and disabling the grant.
Failed upstream revocation is not reported as successful.

Use `GrantStore.create(input, tx)` only after the consumer's credential
protocol has actually verified credentials. It requires a current active
account and caller-owned transaction. This also supports non-OAuth credential
protocols without adding identity login endpoints.

## Receipts, cursors and concurrency

Each action binds its durable receipt to actor, idempotency key, grant,
provider/action, parameters, project, expected grant version and cursor.
Different input under the same key conflicts. Replays return the stored
operation, including after restart, without redispatch. A crashed/uncertain
external write stays visibly running until its consumer reconciles it; shared
code never retries a potentially paid write or fabricates success.

Persisted grant claims serialize refresh/revoke/actions across processes.
Claims have a 150-second expiry; admitted actions receive a 120-second signal.
Final publication checks current actor, grant version, claim fence, provider
version, project ACL and cursor. Cursor, operation result, consumer SQL and
outbox event commit together. Known protected token/client-secret values are
rejected from returned operation results.

The actor-aware scheduler port and availability registry are applied foundation
contracts, documented in `CONTRACT.md`.

## HTTP egress and local fixtures

`SafeHttpClient` uses the native Node-compatible HTTP transport with validated,
pinned IP addresses, original Host/TLS server name, certificate verification,
no environment proxy, and no pooled sockets. All DNS answers must be public.
Loopback/private/link-local/multicast/metadata, mapped IPv6, transition and
documentation ranges are denied. Every redirect is checked; non-GET/body
redirects, TLS downgrade and cross-origin custom-header forwarding are denied.
Credential-bearing/custom-header requests and mutations require HTTPS.

Defaults are 15 seconds for the whole request, 8 MiB request/response bytes,
and four redirects. DNS waiting and sockets are cancellation-bounded; response
limits apply while streaming. Response bodies and URLs are not inserted into
transport error messages.

Tests explicitly inject `new SafeHttpClient({ fixtureOrigins: [origin] })`.
Each origin must use a literal loopback address and exact ephemeral port.
This exception is a constructor capability, not an environment toggle or a
user request field. A fixture origin never permits a redirected private target.

Shared fixtures export real identity/account/session/project helpers from
`tests/adapters/shared/harness.ts` and a protocol server from
`provider-server.ts`. The server validates client credentials, exact redirects,
S256 verifiers, one-use codes, rotating refresh tokens, revocation, bearer
tokens, idempotency bodies and cursor conflicts. Tests use actual HTTP, SQLite,
encrypted key storage, core Git/source and restart, not service mocks.

## Migration and checks

`060-x-shared-adapters` adds provider configuration, OAuth state, operation
receipt and durable grant-claim tables. It has explicit SQLite STRICT/BLOB and
PostgreSQL/BYTEA definitions. All existing migrations and applied digests stay
untouched. Session deletion cascades only its OAuth states.

```sh
bun test tests/adapters/shared
./node_modules/.bin/tsc -p tests/adapters/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/shared tests/adapters/shared
```

## Primary documentation consulted

Consulted October 27, 2026; shared uses protocols rather than a vendor SDK.
Context7 was unavailable in this child session; primary documents were fetched
directly.

- OAuth security BCP: https://www.rfc-editor.org/rfc/rfc9700.html
- PKCE: https://www.rfc-editor.org/rfc/rfc7636.html
- Native HTTP request, stream and socket lifecycle: https://nodejs.org/api/http.html

No credentials for a real third-party account were supplied or used. Real
provider-specific app registrations, user consent/grants, procurement contracts,
SMTP sender authorization and model/billing credentials remain external
prerequisites of the corresponding consumer contribution. Local protocol
success is not a live-provider success claim.
