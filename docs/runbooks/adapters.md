# Adapter configuration and lifecycle

The application composes one fresh `createApplicationAdapters()` factory from
`services/adapters/index.ts` per runtime. It installs actual adapter modules,
not a second implementation of identity, source, Git, governance, or provider
routes. Use the repository-pinned Bun 1.4.4 runtime. Historical 1.3.14
receipts describe those earlier runs, not the current runtime requirement.

`createApplication({adapters?: AdapterDeployment | false})` installs the
aggregate by default in native and scale profiles. An explicit `modules` list
retains replacement semantics; add `adapters: { ... }` to opt that custom
catalog into the aggregate, or `adapters: false` to disable it explicitly.
The exported `composition.modules` remains the native/base catalog for existing
custom callers. The parent-owned `applicationMigrations()` in
`apps/server/src/migrations.ts` combines foundation, native/base and all fresh
adapter migration descriptors without registrations, configuration or remote
I/O. Migration, seed and quiesced-transfer CLI commands consume that helper.
Application startup also migrates its full selected module catalog.

## Start without provider credentials

```sh
bun run db:migrate
bun run seed
bun run dev:api
```

Keep the existing native SQLite/blob/Git data directory and encryption key.
Local identity and the durable local mailbox work without third parties.
The integration installs the built-in `localMail` provider record only when
absent; it never overwrites an operator-disabled record. No SMTP message,
model request, remote repository push, purchase, or publisher submission is
implied by startup.

Read authenticated `GET /api/connections/availability` for current provider
availability. `ready` means configured prerequisites, not verified live
credentials. Use an explicit provider test/probe for upstream verification.
`unconfigured` responses name missing credentials, tools, or private contracts.
Operator-disabled providers remain `disabled`; failed probes are not success.

## Deployment settings

All APIs must share the same protected `QUIRE_SECRET_KEY`. Scale also requires
actual PostgreSQL, Redis, S3-compatible storage, the singleton repository
service, an independently provisioned Ed25519 backup signer, and an absolute
shared durable `QUIRE_BACKUP_ROOT`. See the storage and backup runbooks.

For an already provisioned scale topology, set `QUIRE_PROFILE=scale`, a
private per-API `QUIRE_DATA_DIR`, shared `QUIRE_SECRET_KEY`,
`QUIRE_POSTGRES_URL`, `QUIRE_REDIS_URL`, `QUIRE_REDIS_NAMESPACE`,
`QUIRE_REPOSITORY_URL`, `QUIRE_REPOSITORY_TOKEN`, `QUIRE_S3_ENDPOINT`,
`QUIRE_S3_BUCKET`, `QUIRE_S3_REGION`, `QUIRE_S3_ACCESS_KEY_ID`,
`QUIRE_S3_SECRET_ACCESS_KEY`, `QUIRE_BACKUP_ROOT`, and
`QUIRE_BACKUP_SIGNING_KEY_FILE`. Then run the same migration, seed and API
commands above. Both APIs must see the same backup filesystem and signer;
their private data directories must not be treated as the archive store.
The encryption key and repository bearer must be provisioned consistently
across roles; never substitute the test fixture-origin bypass in deployment.

| Environment setting | Meaning |
| --- | --- |
| `QUIRE_ADAPTER_SCHEDULER_INTERVAL_MS` | Host wake interval, 1,000-86,400,000 ms; default 30,000. Provider due times still apply. |
| `QUIRE_DROPBOX_APP_KEY` | Registered Dropbox app key. |
| `QUIRE_DROPBOX_APP_FOLDER` | Explicit registration confirmation; only `Apps/Quire` accepted. |
| `QUIRE_AI_TERMS_VERSION` | Required consent version; default `2026-10-27`. |
| `QUIRE_AI_RETENTION_DAYS` | Shared conversation retention; default 30, positive days. |
| `QUIRE_AI_VISION_MODELS` | Comma-separated explicitly enabled image-capable model IDs. |
| `QUIRE_FEDERATION_ORGANIZATION_ID` | Existing institution UUID for provisioning. |
| `QUIRE_FEDERATION_TRANSFER_TO` | Explicit verified transferee UUID; management acceptance remains required. |
| `QUIRE_FEDERATION_LDAP_ALLOWED_URLS` | Comma-separated exact approved TLS LDAP URLs. |
| `QUIRE_FEDERATION_LDAP_SUBJECT_ATTRIBUTE` | Immutable textual LDAP subject attribute. |
| `QUIRE_PANDOC_IMAGE` | Locally installed immutable `sha256:` image digest. |

Trusted embedding can supply typed `AdapterDeployment` instead of environment
settings. HTTP origins, resolver overrides and identity profiles are
assembly-only protocol-fixture hooks, never request-controlled settings.
Production safe HTTP still requires public approved HTTPS endpoints.

Provision conversion separately:

```sh
docker build -t quire-pandoc -f services/adapters/interchange/Dockerfile .
export QUIRE_PANDOC_IMAGE="$(docker image inspect quire-pandoc --format '{{.Id}}')"
```

Only a successful isolated execution probe enables the configured converter.
Changing the image name alone does not prove that Pandoc is installed.

## Encrypted provider administration

Operators use `GET /api/admin/providers` and
`PUT /api/admin/providers/:id`, with current session, Origin, CSRF,
`If-Match: "<version>"` and body `expectedVersion` agreeing. A configuration
contains `baseUrl`, optional `model`, optional plaintext `secret` on submission,
and the current typed policy. Secrets are AES-GCM encrypted under the runtime
key; GET responses expose `secretPresent`, never plaintext. Omitting a secret
preserves it. A successful configuration save is not a live provider test.

| Provider kind | Configuration and exact external gate |
| --- | --- |
| `identity-google`, `identity-github`, `identity-orcid` | Pinned provider issuer, encrypted `{clientId,clientSecret}` JSON, registered exact `/api/auth/:provider/callback`; provider consent. ORCID is explicit linking when no verified email is supplied. |
| `github`, `gitlab` | OAuth client registration/secret, provider-specific base/model from remote-Git README, saved user repository grant and required organization approval. |
| `git` | Installed Git, explicitly enrolled repository-scoped HTTPS credentials; forgetting a saved credential does not revoke the upstream credential. |
| `dropbox` | App Folder registration named Quire, app key above, encrypted app secret, provider base URL, saved scoped user OAuth grant. |
| `zotero` | API base `https://api.zotero.org`; user supplies a dedicated readable API key via `POST /api/connections/zotero/credentials`, `{accessToken,label}`. Actual upstream validation precedes encrypted persistence. |
| `mendeley` | Registered application/client secret, `all` account grant and approved API access. Upstream revocation is unavailable without a supplied provider contract. |
| `doi`, `crossref`, `arxiv` | Explicit permitted public metadata endpoint configuration and usage permission. DOI profile uses Crossref, not every registration agency. |
| `semanticScholar` | Permitted Graph endpoint, rate allocation and API key where the selected access tier requires it. |
| `readcube` | Approved partner authentication/search/export/pagination/refresh/revocation contract. Missing contract stays unconfigured. |
| `dimensions` | Institutional license permitting citation use, tenant endpoint, credential, licensed request/response contract. Missing contract stays unconfigured. |
| `ai` | HTTPS OpenAI-compatible endpoint ending in `/v1`, actual model ID, bearer secret, JSON-mode Chat Completions, applicable retention terms and user processing consent. |
| `stripe-billing` | Stripe API key, webhook signing secrets, operator recurring Price IDs, Billing Portal configuration ID. No operator-owned prices are invented. |
| `publisher` | Destination base URL, encrypted OAuth secret, approved versioned contract JSON in `model`, authorized recipient grant. Explicit submit requires confirmation and provider/manual receipt. |
| `smtp` | TLS SMTP host URL, `model` = `starttls` or `implicit`, encrypted JSON `{username,password,from,ehloName,ca?}`, authorized sender/domain. |
| `localMail` | Built-in durable local mailbox; no external credential. |

Provider-specific exact setup and action schemas remain in
`services/adapters/{identity,remote-git,dropbox,references,ai,billing,publisher,delivery}/README.md`.
Do not substitute an operator secret for a user-owned connection grant.
Never put credentials into repository URLs, project files, exports, or logs.

Stripe requests pin `2025-06-30.basil`; configure the webhook endpoint to the
same version. POST raw signed events to `/api/webhooks/billing/stripe`.
The fixture verifies this pinned contract; it does not assert that Basil is
the latest Stripe release. Only verified current provider reconciliation
activates local billing. Uncertain paid writes retain their operation key;
inspect/reconcile the provider before another purchase.

## Routes and background work

Interchange alone mounts `/api/imports` and installs the source exporter and
combined URL/bibliography link delegate. Remote Git uses its default
`registerImportRoute=false`. References supplies `references.links` to
interchange and its real retrieval factory to AI. Identity alone owns the
common sign-in dispatcher; federation contributes its verified providers.
Billing merchant routes are lane A, portal routes lane X, and provider/
federation administration lane O.

The host starts scheduler wake timers explicitly at application start.
Each whole reference, Dropbox, institution eligibility and delivery pass uses
`runtime.admission.background`; one pass per task runs at a time.
An unexpected task failure stops that task's wake subscription and is retained
for shutdown reporting; sibling tasks keep their independent lifetimes.
Stored due times and shared operation/grant claims govern multi-API work.
There is no automatic replay of uncertain model or paid provider calls.

Institution eligibility reconciliation runs on each configured host wake
(30 seconds by default), not at an exact real-time expiry deadline. It checks
persisted verified-domain eligibility against current verified emails, current
institution domains and an existing `expires_at`, when present. It removes
only self-enrolled, unlicensed ordinary memberships. Explicit licensed or
administrative grants and accepted management remain independent; account
credentials, projects and unrelated memberships are retained. This trigger
does not configure an institution's reconfirmation interval or imply a live
IdP check. An explicitly disabled adapter aggregate has no such scheduled
pass; custom aggregate callers retain responsibility for starting and closing it.

Stop accepting HTTP requests and drain active handlers before closing.
Stop timers, await active scheduled passes, abort/drain AI, close converter/
reference/delivery/shared factories, then close runtime storage. Cleanup must
run on startup failure as well as ordinary shutdown, and every sibling cleanup
must run even if another reports a failure.
The application wraps module registration so failed construction drains
registered adapter/environment/compiler/review work before runtime storage
closes. `start()` failure closes partial subscriptions and storage; `close()`
is idempotent. Backup `openFresh` retains the full selected migration inventory
but runs no producer registrations against the isolated target.

## Capability mapping

| Matrix IDs | Actual composed owner |
| --- | --- |
| A12/A14/A22/C14/I46/I47/I48/I49a/D03 | Governed AI execution and reviewed source proposals. |
| A18/A20/I44a/I44b/I49b | References, linked bibliography, retrieval/provenance and AI retrieval consumption. |
| A19/I45b | DOI Library lookup and independent editable copies. |
| P09/P15/P16/P27/I42b | Interchange, public URL/manual Drive refresh, isolated Pandoc conversions. |
| I42a | Real GitHub/GitLab and generic remote Git transport. |
| I43/P13/A52c | Dropbox source synchronization, rename conflicts and scoped deny-wins policy. |
| P30 | Publisher prepare/explicit submit/status receipt. |
| A54a/A55c/D08/D12/Q07 | Consumer identity, OIDC/SAML/TLS LDAP, SCIM and federation administration. |
| A52b/D05 | Merchant catalog, signed billing reconciliation, invoices and governance state. |
| Q03/Q05/Q06/Q10/Q12/Q15; D16/D18/D21/D22 | Shared encrypted grants, provider configuration, idempotent fenced publication and operational metadata. |
| X-MAIL | TLS SMTP delivery of committed outbox rows; retained local mailbox remains default. |

X-AI/X-RETRIEVAL/X-REF/X-DOI/X-GIT/X-DROPBOX/X-IDENTITY/X-BILLING/
X-PUBLISH/X-URL/X-MAIL are live credential/contract gates above.
X-TOOLS is actual isolated-image provisioning, not an excuse for a pretend
conversion. X-A11Y requires separate validator/human evidence; X-DEPLOY
requires the chosen production destination/TLS/platform. Neither is accepted
merely by composing these backend modules. Editor U/browser acceptance is
separate.

## Verification and cleanup

```sh
bun --version
bun test tests/integration/adapters
bun run typecheck
bun run lint
bun run build
```

The integration suite uses unique owned temporary roots, ephemeral loopback
listeners, deterministic stateful provider protocols, persistent core/Git
and real scale infrastructure where declared by its test. It never submits
to a live account. Event waits subscribe before their action and have bounded
deadlines. Fixture disposal closes APIs, scheduler tasks, repositories,
provider sockets, containers/volumes and temporary roots. Shared Docker
images and unrelated listeners 5173/3001 must remain untouched.

Terminal evidence and exact remaining external prerequisites belong in
`docs/handoffs/p2x-integrate.md`; an interim note is not a completed release.
