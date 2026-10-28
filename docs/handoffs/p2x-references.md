# P2X references and publication retrieval

Owner: `st_01a17c77`. Final owned-lane handoff, October 27, 2026.

**Owned implementation verified.** The final native suite passes with
38 tests, 138 expectations, no failures; strict typing, type-aware lint and
LSP diagnostics are clean. Public-provider retrieval, Zotero/Mendeley
bibliography actions, native persistence, real core source/Git publication,
restart recovery and controlled-clock collection scheduling are implemented.

**Parent contract/integration delta remains explicit:** the shared OAuth2
connection-start route cannot admit Zotero's OAuth1.0a/dedicated API keys.
The verified callable `connectZotero` port exists, but its typed authenticated
HTTP admission endpoint belongs to foundation/shared composition. This handoff
does not count that absent route, private ReadCube/Dimensions execution, AI
composition, live third-party authorization, or PostgreSQL execution as done.
The exact request is retained in
`docs/evidence/p2x-references/contract-delta.md`. Attempts to deliver it using
`thread_send` failed with `invalid_arguments`, guard `unknown_cause`; the
on-disk request and this child result preserve the report to the parent.
The later core-link contribution signature and plan were successfully delivered
to the parent, who confirmed forwarding them to interchange.

## Exports and assembly

Entrypoint: `services/adapters/references/index.ts`.

Value exports:

- `createReferencesModules`
- `PublicationRetrieval`, `RetrievalProviderSchema`
- `publication`, `DoiSchema`, `ProvenanceSchema`
- `ReferenceLibrary`
- `ReferenceScheduler`, `periodicSyncTicker`
- `migrations`

Type exports:

- `SearchRequest`, `RetrievalProvider`
- `Provenance`, `RetrievedPublication`, `PublicationMetadata`
- `SyncTicker`

`createReferencesModules()` returns:

```ts
{
  contributions, // readonly AdapterContribution[]
  module,        // ServiceModule "064-x-references", lane X, order 64
  links,         // ExternalLinks contribution, lazy-safe before registration
  retrieval,     // PublicationRetrieval, available after shared registration
  scheduler,     // ReferenceScheduler, manual unless explicitly started
  connectZotero(actorId, { apiKey, label }), // Promise<AdapterGrant>
  close(),       // drains/stops owned scheduler
}
```

Create one factory per runtime. Pass its contributions with other consumers
to shared `createAdapterModules`. Include actual identity/core/catalog
modules first, shared connections/providers next, then references `module`.
Pass `references.links` to
`createInterchangeModule({ bibliographyLinks: references.links })` and include
interchange's module after references. Interchange owns the single
`provideExternalLinks` registration/dispatcher. No alias, second link adapter,
competing link route, shared service-registry extension, cast, suppression,
foundation edit or server composition edit was used.

Stop admitting HTTP work, await references `close()`, then shared `close()`,
then runtime `close()`. Close constructed factories if runtime construction
fails. Start the scheduler explicitly only when the host owns its lifecycle;
restart constructs fresh factories and does not silently start a timer.
P2O backup/composition ownership was not touched or released by this lane.

`PublicationRetrieval.search({ actorId, projectId, provider, query,
cursor?, limit?, signal? })` returns
`{ items: [{ publication, provenance }], nextCursor }`.
`lookup(actorId, doi, provider = "crossref")` accepts profile `"crossref"` or
`"doi"`. The `libraryDoi` route uses `"doi"`.
`provenance(actorId, publication)` refuses verification for an altered
publication merely sharing the same provider ID.

AI's Citation Reviewer must consume this real retrieval factory. No fake paper
factory, LLM-only source verification, or Dimensions verification badge was
added here. Returned `Publication` DTOs use the actual shared contract.

## Implemented behavior and evidence

Route ownership:

- `libraryDoi`: authenticated/CSRF-checked `POST /api/me/library/doi`, normalized
  DOI lookup through a configured Crossref-backed DOI profile, transactional
  editable Library copy and idempotency receipt.
- `referencesSearch`: authenticated `GET /api/references/search`, current
  project read ACL, provider query/cursor/limit, real shared Publication page.

Provider contributions:

- Zotero: `bulkBib`, `refresh`, separate account `librarySync`; API-key
  validation, API v3 headers, collection/user/group selection, all-page export,
  stable provider IDs, exported citation-key/BibTeX preservation.
- Mendeley: OAuth2 registration configuration plus actual vendor-media-type
  document/catalog reads, marker paging, `bulkBib`, `search`, `refresh`.
  The documented JSON contract has no desktop citation-key field; deterministic
  provider-ID-derived keys remain stable across refresh. Manual `.bib` imports
  retain desktop/export keys when those exact keys are needed.
- Crossref/DOI: real `/works` cursor queries and `/works/{doi}` lookup, actual
  DOI identity checking. DOI profile is explicitly Crossref-backed, not a
  universal DOI-agency resolver; a non-Crossref record can be not found.
- arXiv: Atom/OpenSearch metadata, provider identity/DOI, offset paging,
  forbidden XML declarations, typed parse errors and shared-client
  injected-clock three-second spacing.
- Semantic Scholar: Graph search, requested fields, actual paper ID,
  optional API key and offset/next paging.
- ReadCube/Dimensions: exact unavailable-contract/configuration boundaries,
  not invented production endpoints or falsely ready adapters.

Public provider administration probes perform real parsed metadata queries
when explicitly invoked. Anonymous requests, inaccessible projects, invalid
credentials, auth/access/not-found/rate/server failures, malformed payloads,
changing Zotero library versions, duplicate IDs/keys and repeated pagination
have deterministic negative coverage. Retry-After/Backoff cooldowns use the
injected clock, not sleeps or automatic retry loops.

Raw responses are retained in the real content-addressed blob store with
per-page provenance: provider/source ID, endpoint, retrieval instant and digest.
Their SQL blob references persist before publication; credentials/introspection
responses are not retained as publication provenance.

Bulk project `.bib` files are read-only linked bytes. Only an owner can create
or manually refresh a link; refresh checks link version, expected digest,
stable file identity, grant/configuration authority and source revision.
Previous bytes remain available on conflicts. Provider I/O and Git/object
preparation occur outside SQL. A durable owned recovery journal precedes
Git publication. Core `prepareSource`, repository publication and
`finalizePreparedSources(tx, ...)` are real, not file-table shortcuts.
Finalization, source/history metadata, link state, shared operation receipt,
cursor and events join the supplied transaction.

Restart recovers interrupted Git publication before exposing source. A changed
grant/configuration/owner fences that recovery rather than publishing under
stale authority. Successful bulk receipt replay after restart does not contact
the provider again.

Account collection sync is independent from project source, updates stable
Library IDs, removes departed synced records and atomically rejects conflicts
with manual keys. Read-only Library records reject local edits. Individual
Library imports and real core citation insertion produce independent editable
copies; subsequent provider refresh does not change those copies. Linked
`.bib` files are rejected as citation targets.

The optional scheduler persists due times/selections/versions/error codes,
uses runtime background admission and current account/grant authority, and
drains its subscription/work on close. Default is manual; opt-in interval is
15 minutes to 24 hours. Tests advance the injected clock and drive an exact
subscription, without fixed sleeps.

Matrix allocation: A18/A20, I44a/I44b, I49b retrieval/provenance seam, plus
A19/I45b DOI and independent-copy seam; external gates X-REF, X-DOI and
X-RETRIEVAL are represented explicitly. Editor U remains out of scope.

## Core external-link integration follow-up

The exact callable property is `references.links: ExternalLinks`, using the
interface exported by `services/core/base`:

```ts
create(input: Parameters<ExternalLinks["create"]>[0]): Promise<FileEntry>
refresh(input: Parameters<ExternalLinks["refresh"]>[0]): Promise<FileEntry>
```

Core retains its existing `linkCreate` / `linkRefresh` routes, authentication,
CSRF, replay and atomic HTTP receipt. The actual interchange dispatcher
delegates bibliography creation/refresh to these handlers and handles URL
links itself. The existing references fixture enables this real module only
for affected integration tests; it does not register a competing test adapter.

Create requires an owned configured bibliography grant and `.bib` target.
Zotero's optional URL selects a library/collection under the configured API
origin; absence uses real key introspection for the personal library.
Mendeley selects account documents. Arbitrary user URLs, foreign grants,
non-owner actors and unavailable provider policy/configuration are rejected.
Refresh resolves the current owned source by stable file/link ID and digest.
In both core methods `expectedVersion` is the branch revision.

The handlers reuse provider retrieval and encrypted shared grants. A live
grant claim serializes work; provider I/O remains outside SQL. Core
`commitSource` owns source/Git journaling. Its durable `SourceFinalization`
fences active owned grant version, enabled provider configuration version and
current project owner, and applies the link row with source/history and the
supplied file receipt in the same transaction. It deliberately does not pin
an expiring claim ID into durable recovery.

Actual route tests prove create/refresh, URL coexistence in the sole dispatcher,
stable read-only bytes/IDs, owner and grant ownership, stale branch/digest and
configuration fencing, plus create/refresh receipt replay after restart
without provider redispatch. A real SQLite trigger changes grant authority
between source DML and finalization: the source/link/receipt transaction rolls
back, its core journal remains, and restart recovers after the transient claim
is released and the controlled clock advances three minutes. No success-only
mock stands in for that boundary.

The focused route suite passed 4 tests, 31 expectations in 7.20 seconds;
the final full references suite passed 38 tests, 138 expectations in
14.70 seconds. Exact evidence and peer coordination are in
`docs/evidence/p2x-references/link-final.log` and
`docs/evidence/p2x-references/link-contribution.md`. No migration or existing
SQL digest changed for this follow-up.

## Migration and preservation

Only new migration `064-x-references` was authored, in
`services/adapters/references/migrations.ts`. It creates:

- `reference_provenance`
- `reference_links`
- `reference_library_sources`
- `reference_schedules`
- `reference_source_journal`

It supplies explicit SQLite STRICT and PostgreSQL variants.
SHA-256 of exact SQL:

- SQLite: `98e24429196ee7de2333819f71695166daef57588102d28e4ee04a0cd58c5f81`
- PostgreSQL: `4176084b7665c74c4add6c400c4eec4f78b799619de9e72746b54a56deee4c9e`

Existing inputs and applied migration SQL were not edited. The DOI restart
test compares the full original `schema_migrations` rows, including digests
and timestamps, byte-for-value across reopen. PostgreSQL SQL is supplied but
was not executed against a PostgreSQL server by this lane.

## Terminal commands and exits

Native Bun: **1.3.14**, build `0d9b296a`.

| Command/check | Final result | Retained evidence |
| --- | --- | --- |
| `bun test tests/adapters/references` | Exit 0; 38 pass, 0 fail, 138 expectations, 10 files, 14.70 s | `docs/evidence/p2x-references/link-final.log` |
| `./node_modules/.bin/tsc -p tests/adapters/references/tsconfig.json` | Exit 0 | Same link log |
| `./node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/references tests/adapters/references` | Exit 0 | Same link log |
| LSP diagnostics on owned implementation/tests | 17 source files, 13 test/support files; zero diagnostics | Same link log |
| Native migration digest command | Exit 0; exact hashes above | Same static log |
| Owned process probe | Exit 0; no references test/type/lint process | Same link log |
| Owned `/tmp/quire-p2x-references-*` scan | Empty after final run | Same link log |

Earlier failures and their root fixes remain documented in
`docs/evidence/p2x-references/history.md`; no failure was hidden or weakened.
The original 34-test checkpoint and migration digest evidence remain in
`native-final.log` and `static-final.log`; they were not overwritten.
Full repository/editor/scale/browser suites were not this lane's terminal
commands and are not claimed green here.

## Configuration, prerequisites and remaining integration

Configuration and exact action examples are in
`services/adapters/references/README.md`.

Zotero requires an actual dedicated readable account/group key, encrypted
through runtime `GrantStore`, and the parent-owned API-key HTTP admission
delta. The callable port validates the provider rather than accepting a
success-only credential fixture. Revocation is manual in Zotero settings:
disconnect verifies invalidity before clearing the encrypted copy and never
deletes a user-created upstream key.

Mendeley requires a registered application, client ID/secret, exact callback
registration and account `all` grant. Shared token refresh remains the shared
adapter contract; no live OAuth exchange was claimed. Its consulted public
OAuth docs do not specify a revocation endpoint, so shared disconnect reports
`REVOCATION_UNCONFIGURED` instead of claiming remote revocation.

Crossref/DOI and arXiv require permitted/reachable public metadata endpoints
and explicit operator configuration, not fabricated API credentials. Semantic
Scholar requires permitted Graph API access/rate allocation and an API key
where the operator's usage tier requires one.

ReadCube executable integration is blocked on approved partner/developer
access and supplied search/export/pagination/refresh/authentication/revocation
contracts. Dimensions requires an institutional Analytics/CRIS license
permitting the proposed citation use, tenant endpoint, licensed request/
response contract and credential. Those are named procurement/configuration
boundaries; no private endpoint was guessed and no full private-provider
execution was counted complete.

There is no missing installed executable for the implemented references lane.
No real user credentials were supplied, no live external account read/write
was tested, and no paid or live external write was performed. Official primary
sources, consultation date and unavailable-document details are retained in
`docs/evidence/p2x-references/sources.md`.

## Architectural review and cleanup

1. Single responsibility: provider protocols, transport, publication modeling,
   provenance, Library sync, source sync/journal, scheduler and module assembly
   are separate. All source/test files are below 200 pure lines; the largest
   source file is provider contributions at 132.
2. Boundary purity: HTTP/provider/SQL payloads parse with Zod or the installed
   XML parser; runtime secrets remain in the shared encrypted store.
3. Variants: provider/tagged dispatch uses exhaustive switches; optional fields
   are not treated as hidden tagged variants.
4. Escape hatches: no type casts, suppressions, non-null assertions or missing-
   port compatibility shims were introduced.
5. Defensive layer: final review removed redundant parsing of already typed
   core results and internal IDs; named nullable/schema boundaries remain.
6. Helpers: shared provider/provenance/sync operations have real callers;
   no speculative one-off abstraction was added.
7. Tests: protocol errors, native persistence, stable source keys, copy
   independence, ACLs, transactional conflict rollback and restart recovery
   have regressions that can fail.
8. Parameters: no authored function exceeds three parameters.
9. Redundant verification: no production delete/set-then-requery layer.
   Test reads assert observable outcomes.
10. Negative names: no negative-form domain flag/name was added.
11. Logging: no logging framework or new production log lines were added.

All terminal checks ended before this final handoff was written. Fixtures
awaited listener, scheduler, shared/runtime/repository closure and removed
their unique temporary roots. The owned process probe is empty and exited 0.
No browser/container was created. Listeners 5173/3001 and shared Docker images
were untouched. No workspace commit/push, destructive Git operation, nested
agent, or edit outside the exact assigned paths was used.
