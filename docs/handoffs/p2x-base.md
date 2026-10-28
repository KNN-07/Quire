# P2X shared adapter boundary

Owner: `st_01a17c22`. October 27, 2026.

**Status: COMPLETE for the assigned shared boundary.** The parent applied the
foundation delta; the authenticated availability handler, required actor-aware
consumers, and whole-operation backup admission hook are implemented and pass
terminal verification. Downstream adapter consumers may use the frozen shared
exports. This does not release composition/scale ownership from the backup
integration owner or claim completed consumer business workflows.

## Applied foundation contract

The actual foundation exports were re-read after the parent applied the delta.
The shared implementation consumes the following required signature directly,
without optional-input compatibility, casts or suppressions:

```ts
interface ExternalAdapter {
  capabilities(): Readonly<Record<string, Capability>>;
  test(grantId: Id, actorId: Id): Promise<{
    readonly ok: boolean;
    readonly reason?: string;
  }>;
  execute(input: {
    readonly actorId: Id;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly expectedVersion: number;
    readonly action: string;
    readonly grantId: Id;
    readonly projectId?: Id;
    readonly expectedCursor: string | null;
    readonly key: string;
  }): Promise<Operation>;
}
```

X-laned `connectionAvailability`, GET
`/api/connections/availability`, with no body/query/params and
`z.record(z.string(), CapabilitySchema)` output, is registered by the X module.
Its authenticated handler reads current configuration for each installed
provider. Direct tests cover anonymous denial, unconfigured/ready states,
generic-port ownership denial and generic-port parameter execution.
`ProviderConfigSchema` already has policy/version and needed no additional
delta.

The checked pre-application patch is retained at
`docs/evidence/p2x-base/foundation-contract.patch` as historical evidence.
Only the parent edited foundation files; this child stayed within its hard
write boundary.

## Implemented exports and assembly

Public entrypoint: `services/adapters/shared/index.ts`.

```ts
createAdapterModules(options: {
  readonly contributions: readonly AdapterContribution[];
  readonly http?: SafeHttpClient;
}): {
  readonly connections: ServiceModule;
  readonly providers: ServiceModule;
  readonly close: () => Promise<void>;
};

type AdapterContribution =
  (services: AdapterServices) => AdapterDefinition;

defineAction<T extends z.ZodType>(
  schema: T,
  action: {
    readonly projectAccess: "none" | "read" | "write" | "owner";
    readonly prepare: (
      parameters: z.output<T>,
      context: ActionContext,
    ) => Promise<PreparedAction>;
  },
): AdapterActionDefinition;
```

`AdapterServices` contains `context`, `http`, `configuration`, `grants` and
`operations`. Provider definitions supply `kind`, `label`, exact missing
`configuration(settings)` prerequisites, optional OAuth configuration,
typed `actions`, actual grant `test`, optional operator `probe`,
provider-specific `revoke`, and `close`.

`PreparedAction` is `{ result, cursor, publish?, release? }`.
`publish(tx)` uses the supplied SQL transaction for current authority/fence
checks and core finalization. `release()` closes prepared leases/files outside
SQL on either outcome. Preparation performs external HTTP/Git work first,
honors the signal, and owns cleanup if it fails before returning. Consumers
must persist their provider-specific recovery journal before Git publication.

Other value exports are `configurationCapability`, `GrantTokensSchema`,
`SafeHttpClient`, `ConfiguredAdapter`, `ProviderConfigurations`, `GrantStore`,
`AdapterOperations`, and `migrations`. Other type exports are
`AdapterDefinition`, `AdapterServices`, `AdapterActionDefinition`,
`ActionContext`, `GrantContext`, `GrantTokens`, `OAuthConfiguration`,
`PreparedAction`, `ProviderSettings`, `HttpRequest`, `HttpResponse`,
`HttpPolicy`, `DnsResolver`, and `ExecuteAction`.

The connections module is `060-x-shared-adapters`, lane X, order 60.
The provider administration module is `061-o-adapter-providers`, lane O,
order 61. The latter registers only existing O-owned provider routes.
The former owns connections availability/list/start/callback/test/delete/action.
The map is assembled from actual contribution factories and provided once
as `ServiceRegistry.adapters`; duplicate registration/kinds fail. There is no
identity-login implementation or invented provider map.

Lifecycle: stop admitting HTTP work, await factory `close()`, then await
`runtime.close()`. Also close the factory if runtime construction fails.
Reopening uses a fresh factory. Operations are drained/canceled before provider
resource cleanup. No background scheduler is silently started.
`AdapterOperations.execute` wraps the entire operation and failure cleanup in
`context.admission.writer`. Consumer schedulers must start detached work with
`context.admission.background(() => operations.execute(...))`. Nested writers
share that admitted operation; they do not evade an expired ticket.

Shared fixture entrypoints are `adapterFixture`, `controlledClock`,
`errorEnvelope`, `fixturePassword`, and `fixtureOrigin` in
`tests/adapters/shared/harness.ts`. `adapterFixture` exposes the actual HTTP
origin, request/login/project creation, runtime/core service, injected clock,
restart and asynchronous disposal. `providerServer` is the stateful local
OAuth/resource server. `fixtureContribution`, `configure`, `authorization`,
`connect`, and `connectedFixture` compose that protocol for consumer tests.

## Observable implementation

The shared boundary uses real account/session/CSRF authority, real SQL
transactions, encrypted runtime secrets and current core ACL/policy.
OAuth uses state hashes, S256 PKCE, encrypted verifier, exact provider redirect,
session/account/configuration binding, injected-clock expiration, and one-use
consumption before token exchange. Return destinations are restricted to
same-origin settings/projects paths. Refresh rotates credentials/version;
revoke must actually succeed before ciphertext is cleared.

AES-256-GCM credentials bind resource/account/provider identity through
authenticated associated data. Provider reads are redacted. Missing operator
configuration or a contribution's named credentials/contracts/tools is
unconfigured, never ready. Configuration updates persist redacted audit and
policy events with the mutation.

Operations retain actor/key/request-digest receipts and cursor versions.
Durable grant claims serialize work; publication rechecks actor, grant state
and version, claim ownership/expiry, configuration version, project access
and cursor. Consumer SQL, cursor, result and outbox commit together.
Restart replay returns the stored operation without redispatch. Uncertain
external completion stays running for consumer reconciliation rather than
retrying a potentially paid write.

Safe HTTP validates all DNS answers, pins the selected address, preserves
Host/TLS identity, disallows private/loopback/link-local/metadata destinations,
checks redirects and prohibits credential forwarding/TLS downgrade.
Defaults: 15-second total deadline, 8-MiB request/streamed-response bound,
four redirects. Credentials/custom headers and mutations require HTTPS.
Only explicitly injected exact literal-loopback fixture origins bypass the
public-address rule; this is not an environment/user-input switch.

The local provider validates actual authorization codes, exact redirect,
PKCE verifier, client secret, bearer token, injected-clock token expiry,
refresh rotation, revocation, idempotency body and cursor. Tests are not
success-only service mocks.

## Migration preservation

New migration: `060-x-shared-adapters` in shared `migrations.ts`.
It adds `adapter_provider_configs`, `adapter_oauth_states`,
`adapter_operation_receipts`, and `adapter_grant_claims`.
SQLite uses STRICT tables/BLOB; PostgreSQL has an explicit BYTEA variant.
Session removal cascades only its OAuth states.

SHA-256 of exact new migration SQL:

- SQLite: `aa6faa86145f1803425f2c0d3b0d109ccc954ff8eff21b87f7d0cc9a891b55e7`
- PostgreSQL: `86365040117565cc585b676a07c6ea1ebedf1c9dc351a2d96fd8371649c1b9e3`

No original migration or input was edited. The native restart test retains
every existing applied migration ID, digest and timestamp byte-for-value.
The new PostgreSQL definition has not been executed against a live PostgreSQL
instance by this shared task; P1S acceptance does not establish that new test.

## Terminal commands and evidence

Native Bun: **1.3.14**.

| Command | Terminal result | Evidence |
| --- | --- | --- |
| `bun test tests/adapters/shared` | Exit 0; 54 pass, 0 fail, 96 expectations, 8 files, 24.55 s | `docs/evidence/p2x-base/native-final.log` |
| `./node_modules/.bin/tsc -p tests/adapters/tsconfig.json` | Exit 0 | `docs/evidence/p2x-base/static-final.log` |
| `./node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/shared tests/adapters/shared` | Exit 0 | Same static log |
| Pre-application `git apply --check docs/evidence/p2x-base/foundation-contract.patch` | Exit 0; historical check, no child foundation edits | Checked foundation delta |

The tests include real persisted encrypted grants, SQL/file secret absence,
OAuth replay/session/expiry/CSRF/redirect rejection, ownership, operator access,
refresh/revoke, SSRF/DNS/redirect/byte/TLS/cancellation denial, cursor/idempotency
conflicts, transactional rollback, suspended-account and cleared-grant fencing,
real prepared Git/source publication through `finalizePreparedSources`,
restart preservation, and actual listener/temp-root cleanup.

Negative-path `request.failed` entries for `PROVIDER_SECRET_LEAK` and
`GRANT_UNAVAILABLE` are expected and contain codes/request IDs only.
Earlier failed type/lint/cancellation checkpoints and the diagnosed native
request-lifetime correction are retained in `docs/evidence/p2x-base/history.md`.
No failing test was deleted, skipped, weakened or hidden by a suppression.
After concurrent operations assembly added compiler text imports to the seed
dependency graph, strict typing initially reported missing ambient text
declarations. The owned tsconfig now includes the existing
`tests/operations/environments/assets.d.ts`; concurrent remote-Git include
entries were preserved. `static-asset-declarations.log` retains the failure,
and the final strict run is clean. Final LSP requests timed out for three
changed implementation files; the authoritative full strict compiler and
type-aware lint both completed successfully.

All implementation/test files are below 200 pure lines; the largest measured
file is HTTP transport at 137. Architectural review: files have single
responsibilities; external inputs parse at boundaries; variant dispatch is
exhaustive; there are no assertions/suppressions around missing ports; no
speculative defensive layer or new logging framework was introduced. The
native transport function isolates socket lifetime from redirect policy;
the remaining shared helpers are reused. Changed behavior has regressions; no function exceeds three
parameters; no negative naming or production post-delete verification was
introduced.

## Scope, prerequisites and cleanup

Matrix allocation and exact consumer ownership are in
`services/adapters/shared/CONTRACT.md`; configuration, security, lifecycle
and usage are in adjacent `README.md`. Shared owns the common Q03/Q05/Q06/
Q10/Q12/Q15 boundary, not the business acceptance of every consumer row.
AI owns A12/A14/A22/C14/I46-I49a/D03; references/retrieval own
A18/A20/I44a/I44b/I49b plus the A19/I45b DOI seam; remote Git owns I42a;
Dropbox owns I43/P13; interchange owns P09/P15/P16/P27/I42b; publisher owns
P30; federation owns A55c and A54a/D08/D12; billing owns A52b/D05.
D16/D18/D21/D22 consume the connection/configuration surface. X-MAIL remains
with delivery; X-A11Y/X-DEPLOY are not adapter live-success claims.

No real provider credentials were supplied and no paid/live external write
was made. Live gates remain the selected OAuth developer registrations/user
grants, model/merchant/SMTP credentials, and Dimensions/ReadCube/publisher
public or partner API contracts. Local fixture success is not live success.
Missing installed tools remain consumer provisioning tasks, not an excuse
for a fabricated readiness state.

Official primary documentation consulted October 27, 2026:

- https://www.rfc-editor.org/rfc/rfc9700.html
- https://www.rfc-editor.org/rfc/rfc7636.html
- https://nodejs.org/api/http.html

Context7 was unavailable in this child; these documents were fetched directly.

Terminal checks have ended. The exact owned test/diagnostic process probe
reports zero processes; the owned `/tmp/quire-p2x-base-*` directory scan is
empty after the final run. `static-final.log` retains these final cleanup
results. Fixtures awaited listener/runtime/repository closure and removed their
unique data roots. No browser or container was created; shared Docker images
and listeners 5173/3001 were untouched. The foundation deltas have arrived;
there is no pending check or implementation blocker. Cleanup requests for the
two former contract-watch IDs found no remaining terminal sessions.
No workspace commit/push or nested agent was used.

Backup admission owner `st_01a17c42` retains composition/scale ownership unless
the parent subsequently receives that owner's explicit release.
Future X integration must read final
`docs/handoffs/p2o-backup-integration.md`, preserve module 041/lifecycle gates,
and wait for that owner's explicit composition release. Its currently
in-progress handoff was read for the actual writer/background hook, and the
shared operation wrapper consumes that landed API. X base is ready for
downstream shared-code consumption, but has not modified or released
composition/scale and does not accept the unfinished backup integration gate.
