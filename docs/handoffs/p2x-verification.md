# Independent P2X verification

Owner: `st_01a17d0c`. October 27, 2026. **FINAL for the assigned X backend verification.**

Current project-local **Bun 1.4.4 (`38afee6c8`)** passed the remaining native
default-host and actual scale acceptance: **13 tests, 0 failures, 129
assertions, eight files, 192.71 seconds**, exit 0. Full TypeScript and lint
finished exit 0 after their owners corrected three out-of-scope test
diagnostics. The actual web/API/repository/compiler production build passed.
Owned resources were closed before this handoff was written.

This accepts the recorded adapter/default-host input, not live third-party
accounts, concurrent editor/product work, or subsequent O support/update
host wiring. The parent explicitly assigned that new operational integration
and its checks to separate owners. `p2o-deployment.md` was read for the separate
verified deployment boundary; its checks were not repeated here.

## Commands, exits and retained evidence

Working directory: `/home/norman/Repos/Quire`.
All paths in this table are under `docs/evidence/p2x-verify/`.

| Gate | Terminal result | Evidence |
| --- | --- | --- |
| Current native/default-host plus actual scale command below | Exit 0; 13 pass, 0 fail, 129 assertions | `native-scale-current.log` |
| `./node_modules/.bin/bun run typecheck` after owner corrections | Exit 0 | `current-static-repaired.log` |
| `./node_modules/.bin/bun run lint` after owner corrections | Exit 0 under the current repository configuration | `current-static-repaired.log` |
| `./node_modules/.bin/bun run build` | Exit 0; genuine web, API, repository and compiler bundles | `current-static.log` |
| `node_modules/.bin/tsc -p tests/adapters/acceptance/tsconfig.json` and owned type-aware deny-warning lint | Both exit 0 | `owned-static-current.log` |
| Actual DOCX/ZIP/PDF integrity, artifact hashes and original foundation SQL comparison | Exit 0 | `offline-artifacts.log` |
| Exact owned process/container/volume/root audit | Exit 0; empty inventories, scale root absent | `cleanup-current.log` |

Exact current acceptance command:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
./node_modules/.bin/bun test \
  tests/adapters/acceptance \
  tests/integration/adapters/assembly.test.ts \
  tests/integration/adapters/ai.test.ts \
  tests/integration/adapters/billing.test.ts \
  tests/integration/adapters/federation.test.ts \
  tests/integration/adapters/interchange.test.ts \
  tests/integration/adapters/schedulers.test.ts \
  tests/integration/adapters/scale.test.ts
```

Per the parent's current evidence rule, the unchanged recovered producer suites
and already-passing current-runtime custom-caller/application lifecycle checks
were not repeated. The original requested whole
`bun test tests/adapters tests/integration/adapters` was therefore not rerun.
The command above covers the remaining current-runtime composed business
surfaces and the additional real Error Fix narrative. Prior producer and
recovery receipts remain explicitly separate inputs, not a newly summed
whole-suite result.

The first current root typecheck exited 2 at
`tests/core/base/source-export-history.test.ts:97` for an
`ArrayBufferLike`/`ArrayBuffer` assertion mismatch. The first root lint exited
1 at `tests/core/base/writable-capacity.test.ts:40,120` for `await-thenable`
and missing sort comparator. Their owners corrected those test files; only
the failed gates were rerun. Initial failures remain in `current-static.log`;
corrected file hashes and clean terminal exits are in
`current-static-repaired.log`. No verifier edit, weakening, skip or suppression
was applied to those tests.

The passing build retains the real Vite advisory: the web entry is
**1,851.98 kB** above its 500-kB advisory threshold. Root lint's existing
generated-editor-evidence exclusions were read and left unchanged. The
verifier introduced no exclusion or suppression.

## Recorded input, not a global freeze

The exact measured production/adapter input fingerprint matched before and
after the acceptance command:

```text
3a98b92a068584b759d23f91989fd21cd629967ad9324bc3955cb4f534f9956c
```

The log retains the fingerprint command and scope: TypeScript/SQL/JSON under
server, contracts/runtime, adapters, accounts, compiler, core, operations,
compiler workers, integration adapter/portable helpers and owned acceptance.
Root manifest, lockfile, TypeScript/lint config and composition hashes are
also retained. The recorded X host composition was:

```text
394d2489317a0498cdadc5840dd9c42ce7af08cd1536d097d656f3a1512cc014
```

This is a bounded observation across that run, not a whole-workspace freeze.
Concurrent benefits and U work remained outside this verifier's ownership.
The later core test corrections and newly assigned O lifecycle wiring do not
become retroactively verified inputs. No global stability chase or changed-O
module rerun was undertaken.

## Observed real surfaces

The owned `tests/adapters/acceptance/error-fix.test.ts` uses the actual released
`createApplication` fixture and its host `start()`. It creates genuine core/Git
source containing an undefined TeX command, compiles it in the installed
isolation, and obtains the failed job's actual diagnostic and raw log range.
The real HTTP provider fixture receives that exact diagnostic context.
Generation leaves source unchanged. Explicit authorized approval publishes
the correction; a new snapshot then compiles successfully with no error
diagnostics and supplies a downloaded, digest-verified genuine PDF.

```text
failed job    44a1aafc-a4f9-4a2e-946f-99a39863d3b5
diagnostic    a3b05750-fec8-4a27-be62-fbc324ecd127
AI run        0786154d-4b43-49e0-aba5-4a28a1ba148b
corrected job 6e9db1ac-674b-41c7-bb39-440d8c371ca4
snapshot      ac33e027-64a8-48ec-82d8-6329c254842a
PDF bytes     13535
PDF SHA-256   a52fc01f520dd000d7b851e77354306f1096b4c25d924eccd48522984c85d177
provider calls 1
```

The current native composed cases additionally prove no-provider-secret
startup, truthful installed availability and anonymous denial, migration-ledger
preservation on reopen, real binary import/replay, the sole URL/bibliography
dispatcher, upstream-validated Zotero grants and foreign-owner denial,
inert/approved/restarted AI source, signed billing persistence and replay,
signed institutional OIDC admission/replay denial, real TLS SMTP scheduling,
and failure-stop shutdown that still closes sibling resources.

The current scale case starts **two actual OS API processes**, PostgreSQL,
Redis, authenticated MinIO/S3 and a singleton canonical Git repository.
Both APIs use the default application host with the real adapter aggregate,
independent shared backup signer and absolute shared archive root. It observes
PostgreSQL health, cross-API grant testing and `GRANT_BUSY`, stored cursor and
idempotent replay without upstream redispatch, source/binary reads through the
other API, AI source unchanged before approval and real publication afterward,
one signed billing receipt with forged-signature denial, and OIDC started on
one API and admitted on the other with replay denial.

Scale project: `7769c3a2-c628-4f23-bde6-60c081d67cc8`.
Grant: `7269466a-3fe9-4214-8bfb-5cc39efac478`.
The actual ledger had **33 migrations**, including cooperating
`012-a-project-benefits`; every adapter PostgreSQL digest matched its
actual exported SQL. This is not SQLite masquerading as scale.

## Security, matrix inventory and prior evidence

`docs/evidence/p2x-verify/capability-inventory.md` is the final ID-to-code/test
inventory. It individually covers all primary X allocations:
A12/A14/A18/A20/A22, P09/P13/P15/P16/P27/P30, C14,
I42a/I42b/I43/I44a/I44b/I46/I47/I48/I49a/I49b and A55c;
it also records A19/I45b, I50a/I50b, A52b/A52c/A54a,
D03/D05/D08/D12/D16/D21 and assigned Q/security/configuration seams.
Backend evidence does not accept the cooperating browser screens.

The accepted `p2x-launch-recovery.md` native **201-pass/567-assertion** receipt
and PostgreSQL17.10 schema execution stand. Its extra supplied-transaction AI
denial test and parent HTTP-admission follow-ups stand. Inspected identity
83-test and federation 53-test receipts retain require-SSO password/reset/
consumer-OAuth bypass denial, explicit enrolled break-glass, signed
OIDC/SAML replay/tamper denial, both SAML signatures, rotated keys/certificates,
real CA-verified LDAP user bind and SCIM authority. They were not rerun or
relabelled current-runtime whole-suite checks.

Recovered shared protocol evidence proves encrypted resource-bound grants,
PKCE/state/session/configuration binding, no token echo/export, all-address
DNS restrictions, pinned destinations, private/metadata/redirect denial,
credential-forwarding denial, byte/deadline bounds and transactional rollback.
Billing receipts prove raw-byte signatures, freshness, duplicate/reordered
reconciliation, expired-writer fencing and receipt/seat rollback. Current
composed tests add the real default-host/cross-API checks described above.

Prior real Pandoc/isolated compiler conversion receipts were inspected rather
than repeated. Independent offline validation confirms valid retained DOCX
and ZIP containers and an actual pdfTeX one-page submission PDF. Conversion
originals and exact hashes remain in `offline-artifacts.log`; unsupported
layout/macros and missing isolated tools are not silently claimed supported.

## Exact public exports and composition contract

The current aggregate exports `AdapterDeployment`, `loadAdapterDeployment`
and `createApplicationAdapters`. The actual host retains its previous options
and adds `clock?: RuntimeOptions["clock"]` and
`adapters?: AdapterDeployment | false`; it exposes `app.adapters`.
Default hosts own a fresh aggregate's start/close. Explicit module catalogs
retain replacement semantics unless adapters are explicitly requested.

```ts
loadAdapterDeployment(env?: NodeJS.ProcessEnv): AdapterDeployment;
createApplicationAdapters(options?: AdapterDeployment);
// Returned: modules, references, remoteGit, dropbox, interchange, ai,
// delivery, converter, start(): void, close(): Promise<void>.
```

Actual producer `services/adapters/<name>/index.ts` exports were inspected:

| Name | Value exports | Type exports |
| --- | --- | --- |
| shared | `createAdapterModules`, `defineAction`, `configurationCapability`, `GrantTokensSchema`, `SafeHttpClient`, `ConfiguredAdapter`, `ProviderConfigurations`, `GrantStore`, `AdapterOperations`, `migrations` | `AdapterContribution`, `AdapterDefinition`, `AdapterServices`, `AdapterActionDefinition`, `ActionContext`, `GrantContext`, `GrantTokens`, `OAuthConfiguration`, `PreparedAction`, `ProviderSettings`, `HttpRequest`, `HttpResponse`, `HttpPolicy`, `DnsResolver`, `ExecuteAction` |
| identity | `createIdentityModule`, `createExternalIdentityAdmission`, `identityContributions`, `identityProfiles`, `identityDefinition`, `registerIdentityProvider`, `migrations` | `ExternalIdentityVerification`, `IdentityProfile`, `IdentityProvider` |
| federation | `createFederationModules`, `authenticateLdap`, `FederationConfigurations`, `emptyConfig`, `FederationOidc`, `FederationSaml`, `FederationLdap`, `groupCeiling`, `FederationProvisioning`, `enrollFederationBreakGlass`, `rotateFederationCertificates`, `migrations` | `FederationDeployment`, `FederationConfiguration` |
| remote-git | `createRemoteGitIntegration`, `githubContribution`, `gitlabContribution`, `RemoteRepository`, `RepositorySummarySchema`, `RemoteBindingSchema`, `BindingCursorSchema`, `migrations` | `RemoteGitIntegrationOptions`, `RemoteGitOptions`, `GitCredentials` |
| references | `createReferencesModules`, `PublicationRetrieval`, `RetrievalProviderSchema`, `publication`, `DoiSchema`, `ProvenanceSchema`, `ReferenceLibrary`, `ReferenceScheduler`, `periodicSyncTicker`, `migrations` | `SearchRequest`, `RetrievalProvider`, `Provenance`, `RetrievedPublication`, `PublicationMetadata`, `SyncTicker` |
| interchange | `createInterchangeModule`, `PandocConverter`, `conversionLosses`, `InterchangeImports`, `InterchangeExports`, `fetchSource`, `resolveSource`, `UrlLinks`, `sharedRemoteImporter`, `ImportUploads`, `migrations` | `NativeImport`, `RemoteImport`, `RemoteImporter` |
| dropbox | `createDropboxIntegration`, `DropboxApi`, `DropboxError`, `dropboxEndpoints`, `DropboxPolicies`, `DropboxScheduler`, `migrations` | `DropboxOptions`, `DropboxEndpoints`, `TickSource` |
| publisher | `publisherModule`, `publisherContribution`, `PublisherContractSchema`, `parsePublisherContract`, `publisherRequirements`, `migrations` | `DirectPublisherContract`, `PublisherContract` |
| billing | `stripeBillingContribution`, `createBillingModules`, `migrations` | none from this index |
| ai | `createAiModules`, `AiService`, `OpenAiChat`, `missingConfiguration`, `migrations` | `AiOptions` |
| delivery | `MailDelivery`, `createDeliveryModule`, `DeliveryScheduler`, `SmtpClient`, `parseSmtpSettings`, `smtpAvailability`, `smtpContribution`, `localMailContribution`, `migrations` | `DeliverySummary`, `MailDeliveryOptions`, `SmtpAttempt`, `SmtpAvailability`, `SmtpSettings` |

One shared provider/connection registry remains authoritative. Remote Git leaves
`registerImportRoute=false`; interchange owns the sole import/export/link
dispatcher, references supplies `links` and actual retrieval to AI, and
federation uses the common verified identity dispatcher. Billing merchant is
lane A despite its `067-x-billing` ID; administration remains lane O.

`ExternalAdapter.test(grantId, actorId)` is actor-aware. Execution requires
actor, parameters, expected grant version, action/grant/project/cursor/key.
SQL is asynchronous; `UnitOfWork.run` supplies the transaction executor.
`PreparedAction.publish(tx)` performs fenced SQL publication, while provider
I/O/Git preparation and resource release stay outside SQL. Actual
`prepareSource`, `finalizePreparedSources(tx, ...)`, repository pack import/
export, encrypted runtime secrets, ACL/policy, receipts and event ports are
used. There is **no remaining missing shared-port contract delta for the
observed X workflows**. Previously requested credential, cursor, consent and
Dropbox-policy routes are implemented, not stale blockers.

## Additive adapter migrations

Exact SQL SHA-256 inventory, preserving the producer definitions:

| ID | SQLite | PostgreSQL |
| --- | --- | --- |
| `011-a-identity-breakglass` | `23d56b25eccc860edc1a803cff44f2a519be77ac527ec410df5617e559e6f7ba` | `235a0c4535e848d9ecda101312767e27624475d320be33fadddd7ea72f56143e` |
| `060-x-shared-adapters` | `aa6faa86145f1803425f2c0d3b0d109ccc954ff8eff21b87f7d0cc9a891b55e7` | `86365040117565cc585b676a07c6ea1ebedf1c9dc351a2d96fd8371649c1b9e3` |
| `062-a-external-identity` | `5d07b2a1c9b4b3dc60d437d6b17ede2dfd559bf7ec4d499c009ff050ce26d388` | `8b252bb023c5fc29f128f6856509c1103bba89d0ae29eafa2264326cddc3325c` |
| `062-x-mail-delivery` | `abd0e2726adf48e728ba700d9c6976103932b5d1d4c1e1cdd34d43fd8376b2d4` | `cb371f9417505f0dc44d5649b6a73171151595bbb0ef27f265ee1532175147f8` |
| `062-x-remote-git` | `e5100e6461282f8c0e0b933db3a2fdc342eb61581aeda03f227b83e8be632ff9` | `9207d10ac088f2f689999172ae4c71b986eeef612838a8e0d7d1f96d2c123927` |
| `064-x-dropbox` | `644e3ec772c665630ca0097e5f245d8cc64910d533c442f667cd7e9299d98d14` | `69f26fcc6350c6e4e0ecd61e9153a93ac763e570d5713774f2d9912089040695` |
| `064-x-references` | `98e24429196ee7de2333819f71695166daef57588102d28e4ee04a0cd58c5f81` | `4176084b7665c74c4add6c400c4eec4f78b799619de9e72746b54a56deee4c9e` |
| `066-x-federation` | `6848926a24cab770c36df67a751139a1e384800276db30b74f81648af71b6877` | `54e0ca57d89dcf2d2b0c956d90e27720b2ee04ec39e9b7b66b1aee3e797392f1` |
| `066-x-interchange-uploads` | `97e4a3f1e12769beb7213bba7a100f6b85fbcd34f804f051a1b3da805dd33c8e` | `33615c3ce703a0defc98b4366076f7f64ffd11e033c6e1dbac610931dde6f3fc` |
| `066-x-publisher` | `38259d2fb2f705a3cdc9478611e98dfc67001d1ac759f4ee9726f3a2b032628a` | `e138fa1212a8d8f1ceb9196079e6bdcefee649dc36960b5c3b145de3a497f431` |
| `067-x-billing` | `41e842affd86b64bc4e1d31a3edee055bc900012880a1b0eb2358fcd4a8fbeb2` | `dd4db40faa7bfc8581620773fda3420a7c3f03d92b8a2c76cf0d985324f0a11f` |
| `069-x-ai` | `1989c6fef1c964c73b60e25fc94981eafdad72a9944eb7d6cbb4619ae171c2f7` | `3020ad2cf4d073aeac2d1bf38b4af84734a72cfed67f557f22919a3cadde1277` |

All have explicit dialect variants. Current native reopen compares existing
ledger rows, including hashes/timestamps; current scale compares actual
PostgreSQL rows with authored SQL. Independent offline comparison retains the
original five foundation SQLite files byte-identical to `3fe3a23`; accepted
P1S and producer migration-preservation receipts remain input evidence for
the wider original inventory. This verifier authored no migration and changed
no applied SQL, original input or baseline fixture.

## Exact external prerequisites and evidence limits

The final capability inventory retains the full provider-specific ledger.
No credential, account approval, private contract or tool was silently invented:

- **X-AI:** authorized compatible HTTPS endpoint, model, bearer credential,
  processing terms/consent and explicit vision support where selected.
- **X-REF/X-DOI:** readable Zotero account/group key; Mendeley registered
  client/secret/callback and user grant; permitted configured metadata endpoints.
  ReadCube requires approved partner/developer access plus search, export,
  pagination, refresh, authentication and revocation contracts.
- **X-RETRIEVAL:** explicit permitted Crossref/arXiv/Semantic Scholar selection,
  allocation/key where required. Dimensions needs an institutional
  Analytics/CRIS license permitting citation use, tenant endpoint, licensed
  authentication/response contract and credential. Neither private provider's
  executable protocol is counted complete without its supplied contract.
- **X-GIT:** registered GitHub/GitLab application/callback, repository grant
  and applicable organization/namespace approval, or an authorized generic
  HTTPS credential bound to the exact repository. Local credential deletion
  does not pretend to revoke the independently managed upstream secret.
- **X-DROPBOX:** Quire-owned App Folder registration named Quire, app key/
  secret, exact callback, applicable production approval and user folder grant.
- **X-IDENTITY:** actual consumer registrations or institutional IdP metadata/
  trusted certificates/OIDC client secret; LDAP allowlisted TLS directory,
  CA/base-DN/service-bind/search/immutable-subject settings; explicit break-glass,
  institutional/transfer authority and SCIM enrollment where selected.
- **X-BILLING:** merchant API/signing secrets, actual recurring Price IDs,
  Portal configuration, pinned snapshot webhook contract, reachable HTTPS
  webhook, synchronized clock and current customer purchase authorization.
- **X-PUBLISH:** approved versioned destination API/response/revocation mapping,
  recipient OAuth registration/grant/scopes and applicable journal/organization
  approval. Real external submission additionally requires explicit current
  authorization and an actual destination receipt.
- **X-URL:** permitted reachable public direct-download bytes. Drive login/
  confirmation pages do not imply authenticated or two-way synchronization.
- **X-MAIL:** authorized SMTP host/sender/domain, verified TLS mode and
  username/password/CA. No external recipient was contacted.
- **X-TOOLS:** installed Git and reachable Docker with an actually provisioned
  immutable Pandoc image. The producer built/tested Pandoc; missing provisioning
  is not disguised as a credential blocker. Other compiler/environment,
  accessibility-validator/human-review and deployment/platform prerequisites
  remain with their named owners.

No live model response, external login, remote account write, Dropbox sync,
Stripe sandbox/live purchase, publisher submission or external SMTP delivery
was performed or claimed. Protocol-faithful fixtures are not live success.
`sources.md` retains independent official Stripe/Zotero/OAuth consultations on
October 27, 2026; all producer official-source inventories were inspected.
Context7 was unavailable and direct official sources were used.

The publisher evidence attribution finding remains accurately bounded.
The current retained ZIP is
`8f142433c6268ee77dc1860d267b2d782647454e05629d0a9188ab809f28aefe`,
snapshot `de5704eb-d0b7-4c91-abac-8dda632a9bd8`; the parent corrected its
handoff and added `archive-current-inspection.md`. The previous ZIP/hash/
snapshot log remains historical. The replacing invocation was not established,
and submission/status artifacts have different preparation IDs. They are not
a demonstrated single lifecycle for the current ZIP. Current artifact
integrity is verified; that missing provenance is not manufactured or hidden.

## Owned cleanup and architectural review

Actual scale API PIDs **211751 / 220334** both exited 0. The owned PostgreSQL/
Redis UUID was `f2bd577b-8858-4b62-a476-68c6f5f2ada6`; MinIO/volume UUID was
`64879460-d2d6-47af-afb6-53a52761cd07`. Teardown closed the singleton repository,
provider sockets, host schedulers and storage, removed those containers and
volume, and removed `/tmp/quire-p1s-integrate-I10Rw9`. Independent terminal
audit found no owned API/test process, container, volume or native fixture root.
Coordination/file-watch cleanup requests found no remaining terminal sessions.
No browser was created; unrelated 5173/3001 listeners, deployment/benefits
containers, other temporary roots and shared images were untouched.

The sole authored behavioral test is **112 pure LOC / 116 total lines**.
It owns one real Error Fix acceptance narrative; configuration extends the
repository's strict TypeScript settings. Architectural review:

1. One responsibility: failed compile through reviewed correction/recompile.
2. HTTP values parse through actual shared schemas; no unknown provider data
   bypasses the real adapter boundary.
3. No new non-exhaustive tagged dispatch was introduced.
4. No casts, `any`, non-null assertions, suppressions or invented ports.
5. Guards concern actual missing fixture outputs, not type-proven nullability.
6. The compile helper serves the two real compile actions.
7. The test fails if generation mutates source, diagnostic context is wrong,
   approval fails to publish, or genuine recompilation/PDF retrieval fails.
8. No authored function exceeds three parameters.
9. Production code was not changed or padded with post-write verification.
10. No negative-form domain flag was introduced.
11. Existing logging practice is retained; only test evidence IDs/digests are
    printed, with no prompt/source/credential dump or new logger.

Subscriptions precede actions; waits are event-bound and bounded, never fixed
sleeps. All edits stayed inside the exact assigned test/evidence/handoff scope.
No producer edit, commit, push, destructive Git operation or nested agent was
used. All assigned checks have terminal receipts; the historical publisher
provenance limitation and live external prerequisites remain explicit.
