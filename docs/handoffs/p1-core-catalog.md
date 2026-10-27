# P1 core catalog integration handoff

## Lead follow-up

The author-draft copy gap described historically below is now fixed in the
base consumer. Every copy requires an approved or published version;
non-authors still require published visibility. Authors can copy approved
private versions without exposing them publicly. Draft, submitted and
withdrawn versions are not copy choices. The project picker applies the same
eligibility filter after reading all pages. Native HTTP regressions reproduced
two unapproved copies returning 200 before the fix and now reject them.

The lead also added operator-only `adminTemplatesList` for discovering current
submissions without broadening public gallery visibility. Its native role and
privacy regressions pass. See `p1-contract-deltas.md`.

Owner: catalog child `st_01a17a56`. Date: October 26, 2026. Native CLI is Bun 1.3.14. This lane authors only its assigned catalog, tests, handoff and evidence paths. No commit, push, package, baseline migration, shared contract or root composition edit was made.

## Composition and exports

Import `register` and `migrations` from `services/core/catalog/index.ts` and compose after identity/policy and core base:

```ts
{ id: "024-k-catalog", lane: "K", order: 24, register, migrations }
```

Named exports are `register(context: ModuleContext): void`, `migrations`, `Library`, `Templates`, `cite`, `parseBibtex` and `singleRecord`. The migration ID is `024-k-catalog-publication`; it adds source/current/published-version references to `templates`, the catalog role table, and lookup indexes. It does not edit foundation SQL. No new dependency is required.

Exactly 18 shared endpoint objects are registered:

- `libraryList`, `libraryGet`, `libraryCreate`, `libraryPatch`, `libraryDelete`, `libraryImport`.
- `citationCreate`.
- `templatesList`, `templateGet`, `templateCreate`, `templatePatch`, `templateDelete`, `templateVersion`, `templateSubmit`, `templateApprove`, `templatePublish`, `templateUnpublish`.

`libraryDoi` and `referencesSearch` belong to X and are not registered here. The module provides no alternate DTO or fake provider lookup.

## Bibliography behavior

Account Library rows belong only to their actor. Imports consume real multipart UTF-8 `.bib` file bytes, enforce a 2 MiB editable-input limit, preflight the complete input and persist all records atomically. Nested braces, quoted/escaped values, parenthesized entries, concatenated macros, comments and macro declarations retain editable entry source. Duplicate keys in one import, incomplete records and malformed fields return `422 INVALID_BIBTEX`. Manual/code forms operate on exactly one entry. Imported individual entries are editable; persisted provider-linked `readonly` entries reject local patch/delete. Provider bulk synchronization remains X-owned.

Citations copy publication BibTeX into the actual project source. Zero editable `.bib` files creates `references.bib`; one selects it; multiple returns `409 TARGET_REQUIRED` unless `targetFileId` is supplied. Linked/binary/non-bibliography targets reject local mutation, and an occupied non-editable `references.bib` returns target-required rather than overwriting it. Citation keys cannot silently overwrite different records. The route scope must match the body scope. Owner/Editor roles may write; Reviewer/Viewer cannot.

The writer resolves the registered `ProjectPort` with the documented `instanceof CoreProjects` check. It holds the shared branch serialization queue and calls `commitSource` with the full desired live tree and expected branch revision. Blobs, Yjs state, Git objects, source intents, snapshots and source events are the real base implementation. It does not write project file rows directly.

Library edits never mutate copied project records. Edits in one copied project never mutate another project or Library. The actual HTTP test imports uploaded records, inserts them into two independent projects, changes Library and one project's source, restarts the runtime, and verifies three independent durable byte values.

`citationCreate` returns the frozen `FileEntry` DTO for the chosen bibliography. The editor must insert `\cite{key}`, `\citet{key}` or `\citep{key}` at its actual selection using the existing editor save flow; the endpoint has no source cursor/anchor in its request and does not invent one. The citation key is parsed from the submitted publication's BibTeX. `command` is shared-schema validated.

## Template workflow and authority

Creation captures a real source-project snapshot through the project service; it never substitutes sample source. A name and nonempty explicit license are required. Organization visibility requires an organization source project. Draft patches may change metadata or capture another authorized source project. Submitted, approved and published version content/license/visibility are immutable: edits require a new draft version. New-version snapshots must belong to the recorded source project and remain readable by the author.

The returned `TemplateVersion.id` identifies the immutable version. Resource/action URLs use its **`templateId`**, not its `id`. Mutation `expectedVersion` is the aggregate `templates.version`, exposed consistently on every returned version. `templateVersion` takes an actual snapshot ID and returns a new draft version ID. `templateSubmit` submits the current draft; `templateApprove` and `templatePublish` pin explicit `versionId` values. A newer draft does not hide the already-published version from other readers.

Only the author creates drafts, patches, submits or deletes. A curator approves a submitted version. A template publisher publishes an approved version; operator status permits either role but never skips submission/approval. Publication cannot move the approved organization with `workspaceId`. Publishing a successor marks the previous published version unpublished. Withdrawal clears gallery/copy availability; existing independent copied project bytes remain intact. An author or correctly scoped publisher can withdraw.

Role grants persist in `catalog_roles(user_id, role, scope)`. `role` is `curator` or `template-publisher`; `scope='*'` is global and an organization UUID limits the grant to that organization. These roles are independent of project membership, organization membership and operator status. Tests provision explicit grants through the real database; there is no implicit elevation from Editor or organization Manager. Production role administration/configuration must provision these rows through the integration lane's authorized operator surface. Operator accounts can run the complete workflow immediately without a grant.

Anonymous gallery reads expose only published public versions. Organization versions require real organization membership; private versions are author-only. Authors can inspect their current drafts. Other users cannot discover private/submitted source through gallery reads, even when they hold an approval grant. Approval/publish calls take author-supplied version IDs and enforce their own scoped authority. Native project creation already consumes the exact persisted `template_versions` snapshot and enforces published visibility. The acceptance test copies actual uploaded TeX/bibliography bytes, publishes a later version, restarts, and proves the independent copy still contains the original uploaded source.

## Integration dependencies and contract deltas

- Identity and base must be registered first. Authenticated mutation routes use the real identity CSRF/origin check. Public gallery GETs use optional authentication.
- The current typed `ProjectPort` lacks file creation/tree mutation; catalog deliberately uses the documented native concrete-class source seam. A non-native project adapter must expose an equivalent source writer through a lead-owned port extension before replacing it. Absence fails `503 PROJECT_SOURCE_REQUIRED`; there is no fake fallback.
- The frozen `templatesList` query has only `cursor` and `limit`. Server-side search/category filters need a lead-owned contract addition; catalog does not accept undeclared query fields. Existing rows can be filtered by clients after paging. No shared schema was silently replaced.
- The frozen citation response has no insertion command or editor anchor. Editor key insertion is the UI's local selection action as described above.
- Native `CoreProjects.create(origin.kind="template")` currently allows an author to copy their own draft/unapproved version ID, while other users need published visibility. If the plan's "copies pin approved version" requirement also applies to the author's private template copies, the lead/base owner must add that status guard at the existing copy consumer. Catalog cannot change that endpoint or base file within this assignment. This concrete consumer finding was sent to the lead; it is not hidden by the passing catalog tests.
- X owns DOI/provider metadata lookup and read-only collection synchronization. External-provider credentials and external lookup acceptance are not claimed by this lane.
- UI files and root router/composition are outside this assignment. Tests compose the real modules explicitly and exercise actual ephemeral HTTP listeners; this is backend HTTP acceptance, not browser-screen acceptance.
- Create/import/version/citation replay uses the base durable idempotency wrapper and survives ordinary runtime restart. That wrapper records its receipt after the aggregate returns. A crash in that narrow post-aggregate/pre-receipt gap is not covered by this run; source checkpoint crash recovery remains base-owned. No exactly-once crash claim is made.

## Verification and evidence

Target commands use `TMPDIR=/tmp/quire-catalog-lane-ZjEEjU` and `BUN_INSTALL_CACHE_DIR=/tmp/quire-catalog-lane-ZjEEjU/cache`; every fixture has its own unique child root. All source behavior is driven through actual `Bun.serve` listeners on ephemeral IPv4 loopback ports, actual password login/cookies/CSRF, SQLite, disk blobs and Git. No identity, project, SQLite, Git or bibliography implementation is mocked. Tests use a fixed clock, no fixed sleeps, and bounded HTTP signals.

Earlier evidence is retained under `docs/evidence/p1-core-catalog/`:

- `tests-first.log`: 11 pass, 1 fail. The failing fixture tried uploading another `main.tex` over an existing file; the base correctly rejected its duplicate path with HTTP 409. The fixture now uploads an independently named actual TeX file and verifies that exact file's bytes.
- `types-first.log`: strict optional-property and tuple-inference errors, corrected without suppression.
- `tests-second.log`: 28 pass, 0 fail, 42 assertions across 4 files, 12.31 seconds.
- `types-second.log`: successful strict isolated typecheck, empty output.
- `lint-first.log`: one type-only import failure, corrected with `import type`.

The first complete final pass (`tests-final.log`) passed 37 tests with 59 assertions across 6 files in 15.73 seconds; `types-final.log` and `lint-final.log` are empty successful outputs. A final response-metadata review then added successor ETags to successful Library/template deletions and two machine-consumed metadata assertions. The final metadata pass is retained separately rather than overwriting earlier results.

Final native acceptance:

| Check | Exact result |
| --- | --- |
| `bun test tests/core/library-templates.test.ts tests/core/catalog` | Exit 0; **37 pass, 0 fail, 61 assertions, 6 files, 13.00 seconds**. |
| `bun node_modules/typescript/bin/tsc --noEmit -p tests/core/catalog/tsconfig.json` | Exit 0; no output. |
| `bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings services/core/catalog tests/core/library-templates.test.ts tests/core/catalog` | Exit 0; no output. |
| Source/test LSP before strict checks | Zero diagnostics across 8 source and 6 catalog test/helper files. Source LSP rechecked clean after final metadata edit. |

The combined verification process emitted `CATALOG_EXIT tests=0 types=0 lint=0` and exited 0. Exact final evidence is `tests-metadata.log`, `types-metadata.log`, `lint-metadata.log` and `verification.md`. No full-repository check or browser acceptance is claimed.

## Architectural review

Each source file owns one responsibility: bibliography grammar, row mapping, Library persistence, citation source copying, catalog migration, template drafts, publication transitions or HTTP registration. Read-tool-backed measurements found all 15 owned TypeScript source/test files below 200 pure lines; the largest source is `templates.ts` at 138. Boundary requests and responses use the shared Zod schemas, DB rows use local typed parsers, IDs remain branded, and publishing transitions are exhaustive. No `any`, assertions, non-null escapes, ignored diagnostics, broad swallowed error, new logger, post-delete re-query or dependency was introduced. Helpers reuse the base source and identity seams instead of recreating them. Tests assert role decisions, persisted records and actual uploaded/copied source bytes, not prompt/doc prose.

## Cleanup receipts

All verification command sessions completed, including the final combined command with exit 0. Fixture disposal awaited each ephemeral HTTP listener shutdown, closed its SQLite connection, and removed its unique fixture directory; Git children were awaited through the native base implementation. After evidence retention, `rm -rf /tmp/quire-catalog-lane-ZjEEjU` completed successfully with no output. No unrelated listener or path was touched. No owned process, cache or temporary verification root remains. No commit or push was made.

The foundation/base handoff notes that `docs/evidence/` and log artifacts are ignored by default. The lead should explicitly include these evidence files if they are to be retained in its verified commit; this lane did not change ignore rules.
