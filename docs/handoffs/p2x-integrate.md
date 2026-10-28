# Adapter application integration

Owner: `st_01a17cef`. October 27, 2026. **FINAL for the assigned integration.**

## Current host follow-up: Bun 1.4.4

The released host contract is verified on project-local Bun 1.4.4:
**16 focused tests, 0 failures, 44 assertions**, full repository TypeScript
and owned host/test lint pass. The new explicitly assembled custom-caller
regression confirms there is no implicit second aggregate and the caller owns
its factory start/close. Default applications retain fresh host-owned adapters.

Composition now preserves the required message callback through
`satisfies WebSocketHandler<RealtimeSocketData>` and calls the actual realtime
handler directly, with no optional call or assertion. Backup/O/shared-root/
signer/quiescence/error boundaries remain intact. Composition is **FROZEN and
RELEASED** to the parent/deployment owner at SHA-256:

```text
394d2489317a0498cdadc5840dd9c42ce7af08cd1536d097d656f3a1512cc014
```

Current scoped commands, terminal receipts and cleanup are in
`docs/evidence/p2x-integrate/host-runtime-1.4.4.md`. Source-freeze notification
preceded the final focused regression run. No full build or full adapter/scale
suite was repeated in this follow-up. The following original acceptance,
including builds and scale tests, remains **historical Bun 1.3.14 evidence**;
it is not current-runtime acceptance for those broader surfaces.

## Historical integration acceptance

Every actual adapter module is composed into the default native and scale
application factories. The frozen-input native/real-scale integration command
passes **16 tests, 0 failures, 123 assertions**. Full repository TypeScript,
owned type-aware lint and production builds pass. Another actual native
application/caller regression command passes **15 tests, 39 assertions**.
All owned resources closed before this handoff was written.

The required global lint command was run and is **not green**: its last
complete classification contains only the two U-owned generated evidence
bundles identified below. No rule was suppressed and neither file was edited.
This is assigned backend integration acceptance, not whole-product/browser
acceptance or a live third-party success claim.

## Ownership and frozen source

The complete `p2o-backup-integration.md` was read after it explicitly RELEASED
composition and scale to downstream integrators. Composition was not edited
while that handoff was interim. This task edited only its assigned
`apps/server/src/composition.ts`, not `scale.ts`, runtime/contracts, root
dependencies, CLI scripts, other adapter implementations or editor U.

Composition is now released back to the parent/deployment owner:

```text
apps/server/src/composition.ts
Historical SHA256 ddeab5309a7e01e28c1734c0535f6b26fc59adcc9f23c0e12000aa8361bde9bd
```

`docs/evidence/p2x-integrate/frozen-input.md` records every owned source hash
and pure-line count. The largest source file is composition at 165 pure lines;
the aggregate factory is 163. No source file is in the warning band.

## Exact exports and host API

`services/adapters/index.ts` exports exactly:

```ts
type AdapterDeployment = {
  readonly http?: SafeHttpClient;
  readonly identityProfiles?: readonly IdentityProfile[];
  readonly federation?: FederationDeployment;
  readonly remoteGit?: RemoteGitOptions;
  readonly dropbox?: DropboxOptions;
  readonly ai?: Omit<AiOptions, "retrieval">;
  readonly converter?: PandocConverter;
  readonly schedulerIntervalMs?: number;
  readonly schedulerTicks?: SyncTicker;
};
loadAdapterDeployment(env?: NodeJS.ProcessEnv): AdapterDeployment;
createApplicationAdapters(options?: AdapterDeployment);
```

The factory returns `modules`, `references`, `remoteGit`, `dropbox`,
`interchange`, `ai`, `delivery`, `converter`, `start(): void` and
`close(): Promise<void>`. Component handles are the actual producer factories,
not substitute services. Create one aggregate per runtime.

`createApplication` retains existing `config`, `modules`, infrastructure
`createAdapters` and `backups` options. It adds:

```ts
readonly clock?: RuntimeOptions["clock"];
readonly adapters?: AdapterDeployment | false;
```

The returned application now also exposes its optional aggregate as
`app.adapters`. Existing `runtime`, `websocket`, `fetch`, `handle`, `start`
and `close` remain. Default applications install the aggregate in both
profiles. Explicit `modules` retain replacement semantics unless `adapters`
is also explicitly supplied; `adapters: false` disables it. Exported
`composition.modules` remains the existing native/base catalog.

The parent resolved the schema-only CLI integration delta through
`apps/server/src/migrations.ts:applicationMigrations()`. It gathers foundation,
native and fresh unregistered aggregate descriptors in canonical `(order,id)`
order and closes the temporary factory in finally. Migration, seed and
quiesced-transfer scripts consume it. Their actual CLI/forbidden-Git/seed
verification is the parent's FINAL `p3-cli-schema.md`, read from disk; this
child did not edit those files or duplicate that test run.

## Module and migration inventory

All native registrations remain once, including O041 backups, O042 tasks,
O060 environments and O080 workers with O081 migration. Runtime sorts module
registration by `(order,id)` and SQL migrations by migration ID.

| Aggregate module | Lane/order | Migration IDs |
| --- | --- | --- |
| `059-x-local-mail` | X/59 | none; insert built-in configuration only if absent |
| `060-x-shared-adapters` | X/60 | `060-x-shared-adapters` |
| `061-o-adapter-providers` | O/61 | none |
| `062-a-external-identity` | A/62 | `011-a-identity-breakglass`, `062-a-external-identity` |
| `062-x-mail-delivery` | X/62 | `062-x-mail-delivery` |
| `062-x-remote-git` | X/62 | `062-x-remote-git` |
| `064-x-dropbox` | X/64 | `064-x-dropbox` |
| `064-x-references` | X/64 | `064-x-references` |
| `065-x-interchange` | X/65 | `066-x-interchange-uploads` |
| `066-a-federation` | A/66 | `066-x-federation` |
| `066-x-publisher` | X/66 | `066-x-publisher` |
| `067-o-federation-admin` | O/67 | none |
| `067-x-billing` | A/67 | `067-x-billing` |
| `068-x-billing-portal` | X/68 | none |
| `069-x-ai` | X/69 | `069-x-ai` |
| `070-x-adapter-lifecycle` | X/70 | none |

The merchant module is intentionally lane **A** despite its `x` ID.
Provider/federation administration remains lane **O**.
The aggregate contributes 16 modules and 12 additive producer migrations.
Integration authored no migration and changed no existing SQL/digest.
Exact SQLite/PostgreSQL SHA-256 pairs are retained in
`docs/evidence/p2x-integrate/migrations.md`.

The actual scale workflow applied 32 total migrations and compared every
adapter PostgreSQL ledger digest with its exported PostgreSQL SQL. Native
restart preserves every prior migration row, digest and applied timestamp.
No SQLite substitution is used in scale.

## Route, transaction and lifecycle boundaries

There is one shared provider registry and one connection dispatcher.
Interchange alone owns imports and the installed export/external-link delegate;
remote Git keeps `registerImportRoute=false`. References supplies its exact
`references.links` to interchange and its actual retrieval factory to AI.
Identity alone owns the generic sign-in dispatcher; federation contributes its
verified providers. Core source, Git, ACL, policy and operation APIs remain
authoritative.

Local mailbox readiness is honest: the aggregate transactionally inserts its
built-in configuration if absent, without replacing an operator-disabled row.
Unconfigured external providers name actual missing credentials, contracts or
tools. Configured readiness is not a live credential verification claim.
Provider secrets and user grants retain the current encrypted runtime storage.

The host owns reference, Dropbox and delivery wake subscriptions. Each whole
pass uses `admission.background`, coalesces overlapping work and stops its own
subscription after an unexpected failure. Errors are retained for close;
sibling tasks retain independent lifetimes. AI inference/checks, conversion,
references, delivery and shared operations are drained or canceled by their
actual producer close methods.

Failed module registration drains registered resources before `createRuntime`
closes storage. Start failure closes partial subscriptions and runtime
resources. Normal close is idempotent and attempts every sibling cleanup,
including storage, even when another reports an error. Original and cleanup
errors remain in AggregateError with the caught cause preserved.

The accepted independent signer check, absolute shared scale backup root,
effective archived root, compiler quiescence and native/scale admission remain.
`openFresh` passes all selected module migrations to a fresh local runtime with
no-op registrations; runtime performs canonical ordering. WebSocket messages
still delegate to core's internal error/admission boundary.

SQL callbacks use their supplied executor. External provider/Git preparation
remains outside SQL; fenced core publication, receipts and events retain their
existing transactional boundary. No missing-port cast, suppression, local
canonical Git replacement, or unconfigured-provider success stub was added.

## Observable verification

`tests/integration/adapters` drives actual application factories, loopback
protocol providers, persistent core source/Git and native restart. The scale
case runs two OS API processes, real PostgreSQL/Redis/MinIO and a singleton
repository role, with an independent shared signer and absolute shared archive
root. It verifies:

- actual ZIP imports, preserved binary bytes and reads through the other API;
- upstream-validated Zotero admission, owned grant tests, competing API
  `GRANT_BUSY`, durable replay and current cursor discovery;
- the sole URL/bibliography dispatcher and persisted linked source;
- inert AI proposals before approval, actual reviewed source publication and
  cross-API/restart reads without another model call;
- signed merchant reconciliation, duplicate delivery and forged-signature denial;
- signed OIDC initiated on one API and admitted on the other, ordinary session
  authority and replay denial;
- all adapter PostgreSQL migration digests and PostgreSQL health metadata;
- real TLS SMTP scheduling, retained local mailbox and actual SQL-trigger
  failure-stop/cleanup;
- registration/start failure cleanup, default startup, explicit custom catalog
  preservation and idempotent close.

Subscriptions precede actions and use bounded deadlines. No fixed test sleep
or success-only service mock is used. Existing recovered 201-test adapter
suites were not rerun; their accepted producer/recovery handoffs remain input
evidence rather than a fabricated new result.

## Exact commands, exits and retained evidence

All execution in this historical table used native **Bun 1.3.14 (`0d9b296a`)**.
Paths in this table are under `docs/evidence/p2x-integrate/`.

| Command | Terminal result | Evidence |
| --- | --- | --- |
| `bun test tests/integration/adapters` | Exit 0; 16 pass, 0 fail, 123 assertions, 8 files, 175.00 s | `final-application.log` |
| `bun test tests/integration/adapters/application.test.ts tests/contract/http.test.ts tests/accounts/identity/composition.test.ts tests/integration/backup-admission/composition.test.ts` | Exit 0; 15 pass, 39 assertions, 4 files, 40.79 s | `native-lifecycle-final.log` |
| `bun run typecheck` | Exit 0, no diagnostics | `final-static.log` |
| `node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/index.ts apps/server/src/composition.ts tests/integration/adapters` | Exit 0 | `final-static.log` |
| `bun run build` | Exit 0; actual adapter API, web, repository and compiler bundles | `final-static.log` |
| `bun run lint` | Exit 1, only generated U evidence bundles after owned fixes | `global-lint-final.log` |
| Enforced owned process/container/volume audit | Exit 0, no owned resources | `cleanup-final.log` |

The build retains the existing 549.61-kB web chunk advisory above 500 kB.
Global lint's complete classified output identifies:

```text
tests/ui-editor/assembly/evidence/frame/frame-entry.js 6262 diagnostics
tests/ui-editor/source/evidence/browser/browser-entry.js 6236 diagnostics
```

Exact sampled rules/locations and the earlier owned cause correction are in
`global-lint-before-cause-fix.log`. The parent is coordinating those generated
files with their owners; this child did not suppress rules or delete their work.
No further unchanged lint run was launched after the parent's instruction.
The broader serial Bun UI descriptor diagnostic remains separate and
parent-owned; these backend results do not claim it resolved.

Historical honest failures and corrections are retained in `history.md` and
`progress.md`. They include stale fixture assumptions, initial integration
deadlines, real version-tag/receipt-schema mistakes and owned lint findings;
no failed test or permission check was removed to make a run green.

## Configuration, capability mapping and external prerequisites

`docs/runbooks/adapters.md` publishes exact deployment/environment settings,
encrypted provider configuration, run/provision/close commands and the full
capability mapping. Coverage includes A12/A14/A18/A19/A20/A22, C14,
P09/P13/P15/P16/P27/P30, I42a/I42b/I43/I44a/I44b/I45b/I46/I47/I48/I49a/I49b,
A52b/A52c/A54a/A55c, D03/D05/D08/D12, and the assigned Q/configuration seams.
Editor/browser completion remains with U/product owners.

Live gates remain explicit:

| Gate | Actual prerequisite |
| --- | --- |
| X-AI | Permitted HTTPS compatible endpoint, model/modalities, bearer credential and processing consent/retention terms. |
| X-RETRIEVAL | Configured permitted public providers; Dimensions additionally needs institution license, tenant credential and approved response contract. |
| X-REF/X-DOI | Zotero dedicated readable key; Mendeley developer registration/grant; ReadCube approved partner contracts; permitted reachable DOI metadata service. |
| X-GIT | Operator enable, installed Git and authorized repository-bound user credential, or GitHub/GitLab OAuth registration/grant/organization approval. Generic enrollment is implemented; no stale contract blocker remains. |
| X-DROPBOX | Quire App Folder registration named Quire, key/secret, exact callback and scoped user consent. |
| X-IDENTITY | Consumer OAuth registrations or actual IdP metadata/certificates, OIDC secret, or trusted allowlisted TLS LDAP configuration; enrolled break-glass operator and configured institution/transfer authority. |
| X-BILLING | Merchant API/signing keys, operator Price IDs, Portal configuration and actual customer authorization. |
| X-PUBLISH | Destination API/response/revocation contract, recipient grant and explicit submission confirmation/receipt. |
| X-URL | Public direct-download bytes allowed by safe-fetch policy; Drive login pages are not native sync. |
| X-MAIL | Authorized SMTP sender/domain, reachable verified TLS submission host and encrypted credentials. |
| X-TOOLS | Select the actually provisioned immutable Pandoc image/installed profile; the producer's accepted real conversion evidence is not replaced by a pretend probe. |
| X-A11Y/X-DEPLOY | Separate validator/human accessibility evidence and chosen production destination/TLS/platform credentials; backend composition does not certify either. |

No live external credential, paid inference, merchant transaction, external
email, remote account write or publisher submission was supplied or performed.
Generic Git credential/cursor and mail event/failure parent follow-ups were read,
as were all named producer FINAL handoffs and `p3-cli-schema.md`.
Official primary documentation and consultation date **2026-10-27** are retained
in `docs/evidence/p2x-integrate/sources.md`, including access failures rather than
invented documentation success. No SDK/dependency upgrade was introduced.

## Cleanup and architectural review

Final actual APIs 3066204 and 3071793 exited 0. Their PostgreSQL/Redis/MinIO
containers, MinIO volume, singleton repository/Git children, provider sockets,
schedulers and `/tmp/quire-p1s-integrate-wbHxCm` were removed. No
`/tmp/quire-p2x-integrate-*` root or owned process remains. The release watch
was consumed and the unmatched RPC watch stopped. No owned check or browser
is pending. Unrelated listeners 5173/3001 and shared images were untouched.

Self-review: files own adapter/application lifecycle responsibilities; external
configuration/HTTP values parse at boundaries; no new tagged-variant dispatch
is incomplete; there are no assertions, suppressions or invented ports; checks
guard named authority/resource boundaries, not type-proven values. Cleanup
helpers have multiple callers, tests distinguish real behavior and failures,
signatures stay within three inputs or established deployment types, no
redundant production post-write verification or negative domain naming was
introduced, and no logging framework or secret-bearing log was added.

No workspace commit/push, nested agent, original-input edit or applied migration
change was made. Assigned implementation, verification and cleanup are complete;
the only reported repository-wide gate finding is the retained generated-bundle
lint failure above.
