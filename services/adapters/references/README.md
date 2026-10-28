# References and publication retrieval

Native runtime: Bun 1.3.14. No extra executable, browser, container, or SDK is
required. `SafeHttpClient` supplies bounded, DNS-pinned HTTPS requests; runtime
SQLite/PostgreSQL, encrypted secrets, account/project policy, branch leases,
source writers and Git publication remain authoritative.

## Assembly

```ts
const references = createReferencesModules();
const shared = createAdapterModules({
  contributions: [...otherContributions, ...references.contributions],
});
const interchange = createInterchangeModule({
  bibliographyLinks: references.links,
});
// Include shared.connections, shared.providers, references.module in runtime modules.
// Include interchange.module after references.module; it owns the sole external-link dispatcher.
// Include real identity, core projects and catalog modules first.
// When shutting down: stop HTTP admission, await references.close(),
// await shared.close(), then await runtime.close().
```

Use a fresh factory after restarting the runtime. Module `064-x-references`
contains the migration and owns `libraryDoi` and `referencesSearch`. The
contributions own their actions within shared connection operations:

| Provider | Actions | Prerequisites |
| --- | --- | --- |
| `zotero` | `bulkBib`, `refresh`, `librarySync` | Operator base URL `https://api.zotero.org`; user-created dedicated key with personal/group library read access |
| `mendeley` | `bulkBib`, `search`, `refresh` | Operator base URL `https://api.mendeley.com`; registered application's client ID in `model`, client secret in encrypted `secret`, exact callback registration; account OAuth grant with `all` scope |
| `doi` | `lookup` | Operator base URL `https://api.crossref.org`; no API credential required |
| `crossref` | `search` | Operator base URL `https://api.crossref.org`; no API credential required |
| `arxiv` | `search` | Operator base URL `https://export.arxiv.org/api`; public API terms and three-second request spacing |
| `semanticScholar` | `search` | Operator base URL `https://api.semanticscholar.org/graph/v1`; optional API key in encrypted `secret`, subject to assigned rate limits |
| `readcube` | `bulkBib`, `search`, `refresh` boundary | Approved partner/developer agreement; supplied endpoint, authentication/revocation, search, export/pagination and refresh response contracts |
| `dimensions` | `search` boundary | Institutional Analytics/CRIS license permitting this use, tenant endpoint, licensed authentication/response contract and credential |

Configure through the existing operator `PUT /api/admin/providers/:kind`
contract with `expectedVersion` and matching `If-Match`. Reads redact secrets.
`doi` is a DOI-lookup profile of Crossref, not a universal DOI registration
agency resolver. Non-Crossref DOI metadata can return `PUBLICATION_NOT_FOUND`;
the adapter does not invent a publication or silently switch sources.
Configure `doi` and `crossref` independently when using both HTTP routes.

ReadCube's public product page does not provide an executable reference API
contract. Dimensions documentation describes licensed APIs, but no permitted
tenant/account contract was supplied for this installation. Those two
contributions remain explicitly `unconfigured` even if arbitrary operator
secret text is entered. No invented endpoint is labeled production-ready.
Manual `.bib` imports, editable account Library entries and explicitly labeled
Crossref/arXiv/Semantic Scholar alternatives remain usable.

Zotero supports OAuth 1.0a or dedicated keys, not the shared OAuth2 flow.
`references.connectZotero(actorId, { apiKey, label })` is the typed server-side
admission port: it verifies `/keys/current` over the configured transport,
checks account/configuration authority, and uses encrypted `GrantStore`.
The caller must require identity and CSRF. A shared typed HTTP API-key endpoint
is a requested foundation delta, recorded in
`docs/evidence/p2x-references/contract-delta.md`; no registry is bypassed here.
For disconnect, revoke the dedicated key in Zotero's account settings first.
Quire verifies that the key is invalid before clearing its encrypted copy;
it never deletes a manually created upstream key. Mendeley's consulted public
OAuth documentation does not specify a revocation endpoint; shared disconnect
reports `REVOCATION_UNCONFIGURED` instead of pretending revocation succeeded.

## Actions and persistence

`bulkBib` parameters:

```json
{
  "scope": { "projectId": "<project-id>", "branch": "main" },
  "path": "references/zotero.bib",
  "selection": {
    "libraryType": "users",
    "libraryId": "123",
    "collectionKey": "ABCD1234"
  }
}
```

The action body also names the same `projectId`. Zotero selection is required;
`libraryType` also accepts `groups`, and `collectionKey` is optional.
Mendeley exports the authorized account's documents and omits `selection`.

Owner-only bulk publication creates a read-only `FileEntry.link` with a
stable source/link ID. Existing paths are never silently replaced.
`refresh` takes `{ linkId, expectedDigest, expectedVersion }`, plus the
operation's `projectId`. It checks the exact current bytes/identity and keeps
the old bytes on conflicts. The returned result gives `linkId`, `fileId`,
`snapshotId`, `digest`, entry `count`, and link `version`. Core source writers
create actual immutable blobs, Git trees/checkpoints and history. A durable
references journal precedes Git publication; its SQL finalization joins the
shared operation receipt, cursor, source metadata and events in the supplied
transaction. Restart recovery reconciles interrupted publications before
exposing source. A changed grant/configuration or owner authority fences
recovery instead of publishing under stale credentials.

Zotero's exported BibTeX and citation keys are retained as returned, while
raw paged responses are retained by digest. Differing library versions across
pages, repeated/duplicate IDs and duplicate citation keys abort the operation
without partial source or account Library publication. Mendeley's documented
JSON API does not expose desktop citation keys: this adapter assigns stable
provider-ID-derived keys, preserves them across refreshes, and retains the
original JSON bytes. Use manual `.bib` imports when original desktop/export
keys are required. No existing key is silently renamed to resolve a conflict.

### Core link route contribution

`references.links: ExternalLinks` is safe to pass to interchange at composition
time, before modules register. Interchange alone calls `provideExternalLinks`;
references does not register a second adapter or competing link routes.
The actual callable signatures are:

```ts
create(input: Parameters<ExternalLinks["create"]>[0]): Promise<FileEntry>
refresh(input: Parameters<ExternalLinks["refresh"]>[0]): Promise<FileEntry>
```

The existing core `POST /api/projects/:p/links` and
`POST /api/projects/:p/links/:id/refresh` routes retain authentication, CSRF,
replay and their atomic HTTP receipt. Bibliography creation needs
`kind: "bibliography"`, the actor's `grantId`, a `.bib` target and core
`expectedVersion` (the **branch revision**, not grant/link version).
The optional Zotero URL is a resource selector under the configured API base:
`/users/123[/collections/ABCD1234][/items[/top]]` or the equivalent `groups`
path. Without a URL, key introspection selects the key owner's personal
library; group-only keys require explicit selection. Mendeley defaults to
account documents; an explicit URL must be the configured `/documents`.
An arbitrary user URL is never used for provider requests.

Refresh resolves the stored source by current actor/project/branch/file and
expected digest, retaining stable link/file IDs. Both handlers require current
project owner authority, configured provider readiness/policy and an active
owned grant. They reuse `BibliographySync.read` and core `commitSource`.
Core's durable `SourceFinalization` joins link DML, current grant/config/owner
fences, source/history and the supplied HTTP file receipt in one transaction.
The transient shared grant claim is released after work; durable replay does
not depend on that expiring claim. An injected SQLite-trigger regression
proves rollback and subsequent core-journal recovery without redispatch.

`librarySync` takes `{ selection }` and no project. It separately synchronizes
the selected Zotero collection into read-only **account Library** entries,
preserving their IDs while updating metadata and deleting removed synced
entries. An unrelated manual/editable entry with a duplicate key produces
`CITATION_KEY_CONFLICT` and rolls back the whole sync.

Individual imports use core Library create/import or core citation insertion.
They are editable independent copies, never back-synced. A linked `.bib`
cannot be a citation target. Core chooses zero/one/multiple editable targets
using its existing rules; references does not change them.

## Retrieval and AI provenance

`GET /api/references/search` requires an authenticated actor and accessible
`projectId`, plus `provider`, `query`, optional `cursor` and `limit` (1-100).
Results contain complete shared `Publication` DTOs. `fields`, when supplied,
must be `title,authors,year,doi,url`; unsupported projections fail explicitly.
`POST /api/me/library/doi { doi }` normalizes DOI prefixes/case and uses the
configured Crossref-backed `doi` profile. Its idempotency receipt and editable
Library copy commit together. Duplicate keys return an explicit conflict.

AI consumes `references.retrieval.search({
actorId, projectId, provider, query, cursor?, limit?, signal? })`.
It returns `{ items: [{ publication, provenance }], nextCursor }`, not
LLM-generated papers. Provenance includes provider/source ID, actual endpoint,
injected-clock retrieval instant and retained raw response digest.
`provenance(actorId, publication)` returns only that account's matching stored
publication, never verification for altered prose sharing a provider ID.

Search supports Crossref cursor paging, arXiv Atom/OpenSearch paging,
Semantic Scholar Graph offset paging, and Mendeley catalog marker paging.
Provider 401/403/404/429 and 5xx responses are distinct errors; `Retry-After`
and Zotero `Backoff` are honored by an injected-clock cooldown without
sleep/retry loops. arXiv requests are rejected during its three-second spacing
window. Invalid JSON/XML, external entities and unsafe pagination redirects
do not become empty/success results. Requests have bounded cancellation and
response sizes through the shared transport.

## Optional collection scheduler

No timer starts during registration. Default operation is manual. To opt in:

```ts
await references.scheduler.configure(actorId, {
  grantId, selection, intervalMs: 900_000,
});
references.scheduler.start(); // host owns start/close
// intervalMs: null removes that account's schedule.
```

Intervals range from 15 minutes to 24 hours. Due times, last error, versions
and selection are durable. `runDue()` supports a controlled clock; `start`
also accepts a deterministic `SyncTicker` subscription. Background work uses
runtime admission, rechecks grant/current account authority, persists failure
codes per schedule and drains before shutdown. Restart does not implicitly
resume the timer; the host explicitly starts its lifecycle again.

## Verification

```sh
bun test tests/adapters/references
./node_modules/.bin/tsc -p tests/adapters/references/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/references tests/adapters/references
```

Tests use real local HTTP protocol servers, native SQL, encrypted grants,
core source/Git APIs and isolated ephemeral data roots/listeners. No test
uses fixed sleeps or contacts an external account. The final handoff records
terminal exits, evidence, exact migration digests and external prerequisites.
