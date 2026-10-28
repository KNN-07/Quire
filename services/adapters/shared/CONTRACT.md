# Shared adapter contribution contract

Frozen producer interface, October 27, 2026. Terminal evidence and release
status are in `docs/handoffs/p2x-base.md`.

Integration gate from the parent: backup admission owner `st_01a17c42`
temporarily owns `apps/server/src/composition.ts` and `scale.ts`. Future X
integration must consume final `docs/handoffs/p2o-backup-integration.md`,
preserve module 041 and its lifecycle gates, and wait for that owner's explicit
composition release. This shared implementation never writes those paths.

## Assembly

`createAdapterModules({ contributions, http? })` returns separate
`connections` (lane X, order 60) and `providers` (lane O, order 61)
`ServiceModule`s plus `close(): Promise<void>`.
The connections module constructs one `AdapterServices`, invokes contribution
factories, rejects duplicate kinds, and provides the assembled actual adapter
map to `ServiceRegistry.adapters` exactly once. The provider module registers
only operator provider configuration/availability routes. Consumers register
their business routes in their own modules; identity login is not shared.

`AdapterContribution = (services: AdapterServices) => AdapterDefinition`.
`AdapterDefinition` has `kind`, `label`, `configuration`, optional `oauth`,
`actions`, `test`, optional `revoke`, and optional `close`.
`defineAction(schema, action)` erases a parsed parameter type without casts:
the schema is applied once, and action receives typed parameters.

`AdapterServices` exposes `context: ModuleContext`, `http: SafeHttpClient`,
`configuration: ProviderConfigurations`, `grants: GrantStore`, and
`operations: AdapterOperations`.

`ActionContext` contains actorId, grant, tokens, configuration, projectId
(optional), expectedCursor, key and signal. A prepared action returns
`{ result, cursor, publish?, release? }`; `publish(tx)` performs ONLY final SQL/fenced
publication using the supplied transaction, after all provider/Git preparation
has completed. Provider side effects must use `key` for upstream idempotency.
A durable running operation is not replayed after uncertain external completion;
the caller receives its stored receipt instead.
`release()` closes prepared leases/files outside SQL after either outcome.
Preparation must honor `signal`, close resources itself if it throws before
returning, and persist any consumer-specific recovery journal before Git ref
publication. The shared receipt does not guess how to reconcile a provider's
uncertain external write.

Secrets use the runtime key, authenticated encryption and resource-associated
data. No consumer should persist plaintext access/refresh/client tokens.
`SafeHttpClient.request(url, options?)` bounds time/bytes, pins validated DNS
addresses, checks every redirect and disallows credential forwarding across
origins. Test-only loopback access requires an explicitly constructed client
with exact fixture origins; no environment variable disables SSRF protection.

## Applied foundation contract

The parent applied the actor-aware `ExternalAdapter` port:
`test(grantId: Id, actorId: Id)` and `execute` input require `actorId`,
`parameters: Readonly<Record<string, unknown>>`, and `expectedVersion`.
The shared implementation consumes these required fields without an optional
compatibility shape or missing-port cast.

X-laned `connectionAvailability`: GET `/api/connections/availability`,
returning `Record<string, Capability>`. `ProviderConfigSchema` already supplies
policy/version; no provider DTO change is required.
Provider routes remain O-laned; shared modules do not reassign route ownership.

Whole adapter execution, including cleanup, is wrapped in
`context.admission.writer`. Consumer schedulers must begin detached work with
`context.admission.background(() => operations.execute(...))`; nested writer
calls share that admitted operation. The shared factory starts no scheduler.

## Matrix allocation

Shared owns configuration, encrypted grants, OAuth, receipts/cursors and SSRF
for all X providers, including Q03/Q05/Q06/Q10/Q12/Q15. Consumer nodes own
the actual capability acceptance:

- AI: A12, A14, A22, C14, I46, I47, I48, I49a, D03; X-AI.
- Retrieval/references: A18, A20, A19/I45b DOI seam, I44a, I44b, I49b;
  X-REF, X-DOI, X-RETRIEVAL.
- Remote Git: I42a and GitLab/generic Git additions; X-GIT.
- Dropbox: I43, P13; X-DROPBOX.
- Interchange: P09, P15, P16, P27, I42b; X-URL, X-TOOLS.
- Publisher: P30; X-PUBLISH.
- Federation: A55c and A54a/D08/D12 identity integration; X-IDENTITY.
- Billing: A52b/D05; X-BILLING.
- Delivery: X-MAIL with accounts notification/mail boundary.
- Product views D16/D18/D21/D22 consume configuration/connections; UI is outside
  this shared implementation. X-A11Y and X-DEPLOY stay with accessibility and
  operations owners, not adapter live-success claims.

ReadCube, Dimensions and direct publisher readiness requires the selected
public/partner contract and credentials. Installed tools are explicit
configuration prerequisites, never fabricated readiness.
