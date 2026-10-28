# Independent P2X launch recovery verification

Owner: `st_01a17cd5`. October 27, 2026. **Status: FINAL.**

The four recovered adapter branches and shared base passed their native
protocol boundaries at the original verification checkpoint. This verifier observed **201 passing tests, zero failures,
567 expectations**, then an additional real AI transaction-denial test with
**1 pass, zero failures, 8 expectations**. All five new PostgreSQL adapter
schemas actually executed together on PostgreSQL 17.10. Strict compiler and
type-aware lint gates passed. **Whole adapter/application acceptance remains
open** for the concrete integration findings below.

All evidence named below is under `docs/evidence/p2x-launch-recovery/`.
Native execution used **Bun 1.3.14 (`0d9b296a`)**, not the eval kernel runtime;
Git was **2.53.0**. No provider credentials were supplied and no live/paid
external account write, live inference, live Dropbox sync or live Stripe
transaction was performed or claimed.

## Exact independent commands and terminal receipts

```sh
bun --version
bun test tests/adapters/shared tests/adapters/references \
  tests/adapters/dropbox tests/adapters/billing tests/adapters/ai \
  tests/accounts/governance/billing.test.ts
```

Exit 0: **201 pass, 0 fail, 567 expectations, 41 files, 137.34 seconds**.
`native-final.log` retains all 201 individual passing receipts, expected
negative-path error codes and the terminal exit. Counts: shared 54,
references 38, Dropbox 39, AI 44, merchant billing 20 plus governance billing 6.
The references producer handoff retained an older 34-test checkpoint; the
independent run includes its four additional current link/recovery cases.

```sh
for config in tests/adapters/tsconfig.json \
  tests/adapters/references/tsconfig.json \
  tests/adapters/dropbox/tsconfig.json \
  tests/adapters/billing/tsconfig.json tests/adapters/ai/tsconfig.json
do
  ./node_modules/.bin/tsc -p "$config"
done
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/adapters/shared services/adapters/references \
  services/adapters/dropbox services/adapters/billing services/adapters/ai \
  tests/adapters/shared tests/adapters/references tests/adapters/dropbox \
  tests/adapters/billing tests/adapters/ai services/accounts/governance/billing.ts
```

All five compiler exits and lint exit: **0**, retained in `static-final.log`.
The shared compiler configuration includes remote-Git dependencies; no
remote-Git producer suite was executed by this verifier.

```sh
bun test docs/evidence/p2x-launch-recovery/ai-transaction.test.ts
./node_modules/.bin/tsc -p docs/evidence/p2x-launch-recovery/tsconfig.json
./node_modules/.bin/oxlint \
  -c docs/evidence/p2x-launch-recovery/oxlint.json --disable-nested-config \
  --type-aware --deny-warnings \
  docs/evidence/p2x-launch-recovery/schema-check.ts \
  docs/evidence/p2x-launch-recovery/ai-transaction.test.ts
```

All terminal exits: **0**. The added test completed in **4.06 seconds**;
`ai-transaction-final.log` retains its assertions and final static gates.
Both owned TypeScript files have zero final LSP diagnostics. Initial lint
attempts selected no files because the root config excludes `docs/**`, even
with `--no-ignore`; the retained owned config applies the same root rules,
categories and plugins without that path exclusion. No rule was suppressed.

## Current source and observable protocol evidence

| Boundary / allocated capability IDs | Actual observed evidence |
| --- | --- |
| Shared Q03/Q05/Q06/Q10/Q12/Q15 seam | `packages/contracts/src/ports.ts` requires actor-aware grant testing and actor/parameters/version-aware execution. `storage.ts` exposes asynchronous SQL and `UnitOfWork.run`; `shared/operations.ts` prepares outside SQL and invokes consumer `publish(tx)` inside current actor/grant/configuration/cursor fences. Native tests observe encrypted grants, OAuth PKCE/replay/refresh/revocation, SSRF/redirect/byte limits, transaction rollback, real Git/source publication, durable receipts and reopen. |
| References A18/A20/I44a/I44b; A19/I45b DOI; I49b retrieval seam | `references/zotero.ts` uses v3/key headers, stable library versions and all-page exports. Protocol tests reject changing versions, duplicate identities/keys and repeated paging; Mendeley uses its vendor media type and marker paging. `retrieval.ts` inventories actual raw response blobs and binds endpoint/time/digest to parsed publication identity. DOI HTTP tests read the retained raw response and reject provenance for an altered title sharing an ID. Source/link tests exercise real read-only `.bib` publication, independent editable copies, supplied-executor rollback and Git recovery without redispatch. |
| Dropbox I43/P13; A52c policy seam | `dropbox/api.ts`, `sync.ts`, `journal.ts` and `policy.ts` implement actual OAuth/HTTP v2 transport, revision-conditional writes/deletes, durable mutation intent and current policy publication. The stateful fixture enforces bearer tokens, cursor pages, hash/CAS, exact revisions and conditional deletion. Tests preserve both persisted content versions, explicit rename metadata, concurrent delete conflicts and main source; cover archive, generated opt-in, late policy/grant denial, rollback and uncertain-write restart reconciliation. |
| Billing A52b/D05 backend boundary | `billing/contracts.ts` pins `2025-06-30.basil`; `webhooks.ts` authenticates raw signed bytes, timestamp and digest replay before transactional publication. The HTTP fixture enforces credentials, forms, proration, customer binding and idempotency. Tests observe signed duplicate/reordered events, current-provider reconciliation, expired-writer fencing, forged/expired/body-replaced signatures, seat-denial receipt rollback and exact persisted provider invoice bytes. Fixture PDF bytes are transport fixtures, not a claim of a genuine merchant-issued invoice. |
| AI A12/A14/A22/C14/I46/I47/I48/I49a/D03; I49b retrieval consumption; I50a/I50b governance seam | `ai/provider.ts` sends bearer-authenticated Chat Completions JSON-mode requests; the fixture parses their real envelopes. HTTP tests generate a proposal, accept it through `/api/ai/runs/:id/decide`, read changed real core source, undo and observe one charged use. Tests also observe inert multi-file proposals, real branch/optional commit, ACL/CSRF, policy cancellation/discard, shared atomic allowance across native instances, UTC reset, failure/regeneration charging and pre-dispatch refund. Retrieved citation IDs/provenance use the actual references factory; invented IDs are rejected. |

The extra `ai-transaction.test.ts` fills a specific missing independent proof:
after real HTTP inference, source preparation, durable AI journal staging and
actual Git CAS, it sets confidential policy **only on the supplied uncommitted
transaction executor**, then calls `AiJournal.finalize(tx, ...)`.
It receives `AI_CONFIDENTIAL`; file metadata/proposal status remain unchanged,
the decision receipt and policy insert roll back, the recovery journal remains,
and usage remains **1 dispatched / 0 reserved / 0 refunded**, with one provider
call. The log's `sourcePublished: false` describes SQL source finalization,
not the already completed Git CAS. The isolated fixture subsequently disposes
its deliberately pending journal and data root.

## PostgreSQL execution and immutable migration evidence

```sh
docker run --rm -d --name quire-p2x-recovery-st01a17cd5 \
  --network none --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine
QUIRE_RECOVERY_CONTAINER=quire-p2x-recovery-st01a17cd5 \
  bun run docs/evidence/p2x-launch-recovery/schema-check.ts
docker rm -f quire-p2x-recovery-st01a17cd5
```

Startup, schema execution and cleanup all terminated **exit 0**.
Readiness used an owned `pg_isready` monitor. No host port, external network,
bind mount or persistent volume was allocated. `schema-final.log` records
PostgreSQL **17.10**, foundation **75 tables**, final **98 tables / 725 columns /
135 foreign-key edges**, and equality with the same SQLite definitions.
This closes the previously unexecuted **schema** check, not PostgreSQL adapter
workflow, two-API, Redis/S3 or backup-composition acceptance.

The exact SQL hashes independently matched all five producer handoffs:

| Migration | SQLite SHA-256 | PostgreSQL SHA-256 |
| --- | --- | --- |
| `060-x-shared-adapters` | `aa6faa86145f1803425f2c0d3b0d109ccc954ff8eff21b87f7d0cc9a891b55e7` | `86365040117565cc585b676a07c6ea1ebedf1c9dc351a2d96fd8371649c1b9e3` |
| `064-x-references` | `98e24429196ee7de2333819f71695166daef57588102d28e4ee04a0cd58c5f81` | `4176084b7665c74c4add6c400c4eec4f78b799619de9e72746b54a56deee4c9e` |
| `064-x-dropbox` | `644e3ec772c665630ca0097e5f245d8cc64910d533c442f667cd7e9299d98d14` | `69f26fcc6350c6e4e0ecd61e9153a93ac763e570d5713774f2d9912089040695` |
| `067-x-billing` | `41e842affd86b64bc4e1d31a3edee055bc900012880a1b0eb2358fcd4a8fbeb2` | `dd4db40faa7bfc8581620773fda3420a7c3f03d92b8a2c76cf0d985324f0a11f` |
| `069-x-ai` | `1989c6fef1c964c73b60e25fc94981eafdad72a9944eb7d6cbb4619ae171c2f7` | `3020ad2cf4d073aeac2d1bf38b4af84734a72cfed67f557f22919a3cadde1277` |

The original five foundation SQLite files compare byte-identical to accepted
commit `3fe3a23` (exit 0). Native shared/references/Dropbox/billing/AI reopen
tests preserve full applied migration rows, including digests/timestamps.
No original SQL, input, applied receipt or production file was edited here.
The named adapter/test/contracts/runtime fingerprint before and after checks
was `7239dc2d7033d0ed6a73ab78103cd6496f25cdd19bff150b785d95baf9544d68`;
its exact scope/command is in `cleanup-final.log`, not asserted to cover
concurrent editor work, every transitive core dependency or the later parent
HTTP-admission changes below.

## Parent HTTP-admission closure, October 27, 2026

The follow-up `docs/handoffs/p2x-http-admission.md` was inspected alongside
the landed endpoint definitions and handlers in references `index.ts`,
Dropbox `index.ts`/`policy.ts`, and AI `routes.ts`. The original 201-test run
was not repeated; its counts, fingerprint and receipts remain historical
independent evidence, not proof of the subsequent changes.

Parent receipt `bash_148` reports **9 affected credential/policy tests passed**
and touched-file type-aware lint passed. Its complete compiler attempt reached
a concurrent assistant `Composer.tsx` missing import, so that receipt does not
establish a clean global compiler result. Parent receipt `bash_147` separately
reports **7 AI HTTP tests**, touched-file lint and complete repository TypeScript
passed, including configured consent terms, versioned acceptance and restart
without model dispatch. These are inspected parent-reported receipts, not
additional independently executed tests in this report.

`aiConsentGet`, GET `/api/me/ai/consent`, now returns configured
`requiredTermsVersion`, nullable `acceptedTermsVersion`, `accepted`, `current`
and `userVersion`; clients can use the existing versioned consent mutation
without guessing the server's terms identifier.

## Concrete remaining findings and parent contract delta

1. **Default application composition is not integrated.**
   `apps/server/src/composition.ts:24` contains no recovered adapter factories.
   Parent must assemble one shared registry, real references retrieval and
   links, Dropbox, billing contribution/two modules and AI, preserving module
   041 backup admission and factory shutdown order. Existing fixture assembly
   is not default-server, browser or scale acceptance. No missing-port cast or
   production workaround was introduced by this verifier.
2. **Closed by parent: Zotero authenticated credential admission.**
   `connectionCredentials` now defines
   `POST /api/connections/:provider/credentials`, with the provider schema
   restricted to `zotero`, body `{ accessToken, label }` and `AdapterGrant`
   output. The references handler authenticates and verifies mutation authority
   through the existing actor boundary, then invokes the upstream-validated
   encrypted key-admission logic without echoing the key. This is dedicated-key
   admission, not an invented OAuth2 implementation of Zotero OAuth 1.0a.
   Current references additionally exports `links: ExternalLinks`; compose it
   with the sole core/interchange dispatcher rather than adding duplicate routes.
3. **Closed by parent: Dropbox policy HTTP administration contract.**
   `dropboxPolicyGet`/`dropboxPolicyPut` now expose GET/PUT
   `/api/dropbox/policies/:scopeKind/:id` for organization/project scopes.
   PUT takes `{ enabled, expectedVersion }`; both return
   `{ enabled, effectiveEnabled, version }`. Handlers enforce authentication,
   mutation CSRF checks, organization-admin/project-owner authority, optimistic
   version checks, transactional audit/events and effective organization
   deny-wins. Application mounting and visible administration acceptance remain
   under item 1, not an unresolved endpoint-contract delta.
4. **Real composed PostgreSQL adapter workflows remain unverified.**
   The five schema variants now execute, but this verifier did not run adapter
   business flows across PostgreSQL/Redis/S3, two APIs or backup quiescence.
   P1S remains accepted and is not relabeled as these new workflows.
5. **Named live prerequisites remain external gates.**
   AI needs a permitted HTTPS compatible endpoint, model, bearer credential,
   processing consent and explicit vision support; Git is installed.
   Dropbox needs the Quire-owned scoped App Folder registration/key/secret,
   registered callback, applicable provider approval and user grant.
   Zotero needs a readable dedicated key and application mounting; Mendeley needs app
   registration/client credentials/callback and an account `all` grant.
   Its unspecified remote revocation remains `REVOCATION_UNCONFIGURED`.
   Public metadata needs permitted reachable configured endpoints/rate allocation;
   Semantic Scholar needs its tier's key where required. ReadCube needs approved
   partner authentication/search/export/paging/refresh/revocation contracts.
   Dimensions needs licensed institutional citation access, tenant endpoint,
   response/authentication contract and credential. Stripe needs an actual
   merchant key, endpoint signing secret(s), recurring Price IDs, Billing Portal
   configuration and HTTPS webhook. No private endpoint or live success is invented.

No further native failure was found in the assigned recovered boundaries.
These findings are integration work, not a claim that complete matrix rows,
screens D03/D05/D16/D18/D22, or the whole application are accepted.

## Sources, scope and owned cleanup

Read implementation-plan sections 3 and 7-10, allocated feature-matrix rows,
current async contracts/runtime ports, accepted `p1s-verification.md`, and all
five final producer handoffs plus retained terminal logs. Current official
OpenAI generated request types, Zotero v3/OAuth, Dropbox hash/upload/delete and
Stripe signature documentation were independently retrieved on October 27,
2026. `sources.md` retains exact URLs, extraction digests, decisions and
Context7/web access limitations; inherited source inventories are distinguished
from these independent consultations.

`cleanup-final.log` records empty initial/final adapter process and temporary
root probes, terminal removal of the exact owned PostgreSQL container, and
seven stopped exact monitor IDs. Fixtures awaited application/provider listener,
runtime/repository, scheduler/subscription closure and removed their unique roots.
No browser or persistent volume was created. No shared Docker image or unrelated
container/listener on 5173/3001 was modified. Editor U remained out of scope.
No independent identity/federation/interchange/remote-Git/publisher/delivery
producer suite, nested agent, workspace commit or push was used.

Owned code review: the schema evidence script owns relational schema comparison
(77 pure LOC); the additional test owns supplied-executor AI denial (61 pure
LOC). Boundary results parse with Zod, external I/O stays outside SQL callbacks,
no type escapes/suppressions, speculative defense, negative flags or new logger
were added; the reused psql helper has real multiple calls and two parameters
at most. No fixed sleep exists in either check. Tests assert persisted behavior,
not prompt prose. Original independent strict/lint/LSP results are clean;
follow-up compiler evidence is qualified separately above. The original final
handoff was written only after checks and owned cleanup had terminal receipts.
This documentation-only closure update started no process, listener, browser
or container and reran no unchanged suite.
