# P1 core base integration handoff

## Lead integration corrections

The generated example now uses ASCII starter prose compatible with its
default pdfLaTeX engine. The previous emoji caused a real `COMPILE_FAILED`
in the combined application. The corrected production-composition regression
passed source persistence/restart, Viewer denial and actual compilation:
41,496-byte PDF, SHA-256
`440001ec792e288cf2498c1cdd79360ed05fd2ab3fd4e1d366b4c460cfdcd0a3`.
Base strict types and targeted lint passed. Independent Unicode storage,
surrogate and engine/font regressions remain unchanged.

The lead added native operator-only `adminProjects` discovery, with UUID cursor
pagination and optional project URL resolution. This exposes project metadata
for ownership administration without granting an operator ordinary source
read access. Its HTTP regressions and related project suite passed nine tests;
base strict compilation and targeted lint passed.

Core mutations now call governance's `requireEditorOpen`, including before
an Editor-link membership grant. Read/download behavior stays available during
maintenance. Operation downloads recheck current operator privilege for
trusted `operatorOnly` results and validate optional MIME/filename metadata.
The corresponding native authorization regressions passed.

Template copies require approved or published versions even for the author.
Other users still require published visibility. The project picker applies
the same eligibility rule. Native tests reproduced author draft/submitted
copies incorrectly succeeding before this correction; related core/UI loader
checks and the four viewport/theme project browser runs now pass.

Owner: core base (`st_01a17a16`). Date: October 26, 2026. Native runtime: Bun 1.3.14. No commit or push was made.

## Composition and exports

Compose `services/core/base/index.ts` as a K-lane module after identity/policy, with `register`, `migrations`, a unique module ID and order 21. Registration recovers unfinished source intents before providing `services.projects` and installing routes. It does not register identity, realtime, review/history, named Git actions, catalog routes or `importCreate`.

Named exports:

- `register(context: ModuleContext): Promise<void>` and `migrations`.
- `CoreProjects` and `NativeFile`.
- `SourceInput` and `SourceDocument`.
- `importZip(service, actorId, {name,bytes,workspaceId?})`, `readZip(bytes)`, `sourceZip(service,snapshot)`.
- `uploadFiles`, `moveFile`, `deleteFile`, `emptyFile`, `mutateFiles`.
- `repositoryPath(context,projectId)` and `git(path,args,input?)`.
- `exportSource`, `downloadOperation`, `operation`.
- `provideProjectExporter(context,exporter)`, `ProjectExporter`, `ProjectExportRequest`.

Migration `021-k-base-source-intents` adds only lane-owned source-intent, transient Editor-link membership and anonymous-operation grant tables. Baseline SQL is unchanged.

## Registered endpoints

Exactly 37 endpoint registrations, all using the shared `endpoints` objects:

`projectList`, `projectCreate`, `projectGet`, `projectPatch`, `projectCopy`, `projectBulk`, `projectLeave`, `projectTransfer`, `projectDelete`;

`tagsList`, `tagGet`, `tagCreate`, `tagPatch`, `tagDelete`, `projectTags`;

`filesList`, `fileCreate`, `fileContent`, `fileDocument`, `filePatch`, `fileDelete`, `filesUpload`, `linkCreate`, `linkRefresh`, `projectExport`, `operationDownload`, `projectSearch`;

`accessGet`, `invitationCreate`, `invitationAccept`, `invitationResend`, `invitationDelete`, `accessMemberPatch`, `accessMemberDelete`, `accessLinkPut`, `accessRequest`, `accessDecide`.

`projectExport` implements source ZIPs. Submission/DOCX/Markdown/HTML dispatch to a real exporter supplied through `provideProjectExporter`; absence is `503 EXPORT_ADAPTER_REQUIRED`, not success. X must not register a second `projectExport` or duplicate `importCreate` here. X owns `importCreate` and calls the native `importZip` helper.

## Source and writer contract

The provided `ProjectPort` implements `authorize`, `snapshot`, `readSnapshot` and `applyEdits`. Unknown authorization actions are denied. Read actions are `read`, `view`, `download`, `copy`, `snapshot`, `git.read`, `history.read`. Editor actions include `write`, `edit`, `compile`, `files.write`, `source.write`, `document.update`, `suggestion.accept`, `suggestion.decide`, `history.restore`, `git.write`, `git.push`, `git.commit`, `git.stage`, `git.branch`, `git.merge`, `git.discard`, `settings`, `link.create`, `link.refresh`. `compile` is Editor/Owner-only for launch, cancellation and cache mutation; Viewer/Reviewer may read existing outputs but cannot authorize compiler mutations. Review actions are `review`, `comment`, `suggest`, `suggestion.create`, `thread.create`, `chat`; named Viewers may chat. Owner-only actions are `owner`, `share`, `transfer`, `delete`, `access.manage`.

Follow-on local nodes can resolve the concrete class with an `instanceof CoreProjects` check, then use:

- `getProject(id)`, `getBranch(scope)`, `listFiles(scope)`, `getFile(scope,id)`, `getSnapshot(id)`.
- `readDocument(scope,id)` for the DTO; `loadDocument(scope,id)` for durable `docId`, text, epoch/revision and base64 Yjs state/vector.
- `serialized(scope, async () => ...)` to hold the shared per-DB/per-branch writer queue. All realtime/Git/review source writers must use this same queue.
- `commitSource({actorId,scope,expectedRevision,inputs,reason?,advance?,receipt?})` **inside that queue**. Inputs are the complete desired live tree, not a patch list. Omitted current files become recoverable tombstones. Existing unchanged entries use `{file}`; new editable files supply `{file,bytes}`; Yjs saves supply `{file,document}`. A supplied Y.Doc remains caller-owned. Do not supply both bytes and document.

The optional receipt is `{actorId,key,route,digest,response}` with the response already JSON encoded. It is inserted into `idempotency_results` in the same transaction as source finalization and retained in a pending intent across recovery. Realtime can use it for its ack/client-sequence receipt rather than acknowledge before durable finalization.

Blob bytes are durable before references. A commit writes actual Git blobs/trees/commits, persists the intent, publishes `refs/quire/history/<snapshotId>`, then atomically finalizes files, Yjs state/update records, linked-source metadata, branch revision, project counter, snapshot files and outbox. Recovery repeats ref publication and finalization from the intent. A crash-boundary test demonstrates replay before ref publication. The source snapshot and file edit paths never update named Git refs.

Repositories are bare at `data/git/<projectId>.git`; transfer/receive configuration hides `refs/quire/`. New native projects have an unborn named `main` HEAD: the Git node owns named-branch initialization/actions. It must not treat hidden source checkpoints as named user commits. Named Git serving and cross-store intent recovery for named refs remain Git-node responsibilities.

`applyEdits` resolves actual Yjs relative positions, checks epoch and exact before text, applies selected edits atomically, rejects split UTF-16 surrogate pairs, and stores its successful replay receipt with the source transaction. A conflicting batch changes no source. Snapshot byte reads are trusted internal calls; transport callers must authorize before exposing them.

## Behavioral and version details

Blank/example creation writes real source. Template creation reads exact DB `template_versions` and snapshot bytes, enforcing author/public/organization visibility. Copies create fresh identities, ownership, environment selection, ACL/history/review/tag state and materialize pending anchored suggestion edits. An environment row is required; no installed compiler is fabricated.

Per-user archive/trash/restore changes only that user's state; no automatic trash expiry is implemented. Owner deletion is global `deleted_at` plus live-link revocation, retaining data for the separate privileged administrative restore path. File deletion retains tombstones for the review/history recovery node.

File paths and upload bodies use shared validators. Independent configurable limits are `QUIRE_UPLOAD_BYTES` (50 MiB), `QUIRE_UPLOAD_ENTRIES` (180), `QUIRE_PROJECT_FILES` (2,000), `QUIRE_PROJECT_TEXT_BYTES` (7 MiB) and `QUIRE_EDITABLE_BYTES` (2 MiB). ZIP preflight rejects traversal, duplicate paths, special Unix files, encryption, multipart/ZIP64 and malformed directory/local records. Streaming decompression checks actual expanded bytes against both declared size and quota; CRC32 is verified before creation. Ordinary binary bytes are preserved. Search executes regexes in a disposable worker with a 1-second budget and reports excluded binary/linked files.

Project mutations, project tags, bulk items, share links and invitation creation compare the project counter. File-tree mutations compare the branch revision from the `filesList` ETag. Invitation/member/request actions compare their own counters. JSON ETags are resource counters; byte ETags are content digests. The shared bulk contract is `{items:[{id,expectedVersion}],action}`, not the original ambiguous common-version body. Lists emit the shared `ProjectSummary` owner name, role and tag IDs.

Authenticated mutations call the sibling identity port's CSRF/origin verification. Tokens are hashed in sharing/grant records. Browser share URLs contain `share`; API consumers must transfer that value to `X-Project-Token` because strict shared API query schemas do not accept `share`. Viewer links do not create named memberships. Editor links require a real authenticated session, capacity checks, and a separately recorded transient membership that revocation removes without affecting named collaborators. Source ZIP operations also support explicitly permitted anonymous Viewers and recheck the live credential on download. Share-link replay receipts redact the one-time URL rather than persisting the secret.

Invitations store only the credential hash in the invitation table; the local delivery outbox contains the actual invitation URL. Acceptance requires a matching verified email, current version, unexpired token, sharing policy and writable capacity. SMTP delivery is not claimed here.

## Integration dependencies and boundaries

Identity and policy must be composed before base; tests use the actual sibling identity module, real seeded password login, session cookies and CSRF. Missing identity/policy services fail through the runtime's unavailable-service error.

Realtime must persist its own client sequence/ack contract and call the shared source writer seam; base does not register a socket handler. Review/history must attach their review metadata/history rows and implement restore APIs over the immutable snapshots/tombstones. The catalog node owns template publishing and creates DB version rows; base consumes them. URL/bibliography links require the later external adapter and return an explicit unavailable error here.

Converters/compiler integration registers one exporter through `provideProjectExporter`. Its input contains actor, project, optional snapshot, requested non-source kind and idempotency key; its output must be a real durable `Operation`. Base's downloader is for its own blob-backed source operations, not provider URLs or generated-artifact downloads with unrelated receipt shapes.

Root composition, package configuration, shared contracts and application screens were not edited. Lead must compose this module and its migration. No whole-repository success is claimed while other lanes are landing.

## Exact verification results

All commands below ran with native Bun 1.3.14. Test execution used owned `TMPDIR=/tmp/quire-core-lane-VaMxHP` and `BUN_INSTALL_CACHE_DIR=/tmp/quire-core-lane-VaMxHP/bun-cache`.

| Check | Result |
| --- | --- |
| `bun test tests/core/projects.test.ts tests/core/files.test.ts tests/core/base` | Exit 0; **34 pass, 0 fail, 97 assertions, 9 files, 13.46 seconds**. |
| `bun node_modules/typescript/bin/tsc --noEmit -p tests/core/base/tsconfig.json` | Exit 0; no diagnostics, including the owned tests and their real identity/seed imports. |
| `bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings services/core/base tests/core/projects.test.ts tests/core/files.test.ts tests/core/base` | Exit 0; no diagnostics. |
| LSP directory diagnostics for `services/core/base` before final type/lint run | 0 diagnostics across 27 source files. |
| Read-tool-backed pure LOC measurement of every owned TS source/test | Largest source is `source.ts`, **179** pure lines; all owned source/tests below 200. |

The tests drive actual `Bun.serve` HTTP listeners on ephemeral loopback ports, real password login/cookies/CSRF, real SQLite/blobs and Git CLI objects, real multipart uploads and ZIP bytes, runtime restarts, role/link revocation and a prepared-intent crash boundary. No test mocks the project service, SQLite, Git, identity or ZIP codec. Fixed test clocks and unique temporary roots avoid timing and process-order fixtures. There is no browser-screen acceptance claim from this backend-only lane.

Exact logs, earlier failures and size measurements are retained under `docs/evidence/p1-core-base/`. Earlier failures were fixed or, for the transient sibling identity errors, left to their owner and later verified clean. No warning, type error or failing test was suppressed.

## Post-write architecture review

Each file has a single named responsibility (storage mapping, access, source checkpoint, project creation, tree mutation, archive parsing, HTTP registration or a matching test surface). Boundary data is parsed with shared/Zod schemas; source files, snapshots, worker messages and DB rows are typed internally. Creation/sort variant switches are exhaustive, and access uses explicit allowlists with deny-by-default unknown actions.

There are no `any` annotations, type assertions, non-null assertions, ignored diagnostics or empty catches. Domain/boundary errors are typed. Existing Yjs objects and state vectors are reused rather than replaced for anchored edits. The four-input `ProjectPort.applyEdits` signature is the frozen shared-contract exception to the parameter limit; other helpers use small positional signatures or reusable source/request aggregates. Tests observe source bytes, ACL decisions, durable revisions and actual HTTP results, not prose. Production helpers add no post-delete verification, negative flag names or logging framework; the existing runtime error funnel remains the boundary logger.

## Cleanup receipts and remaining verification boundary

After exact logs were retained, recursive removal of owned `/tmp/quire-core-lane-VaMxHP` completed successfully. Every fixture awaited its ephemeral HTTP server stop, closed SQLite and removed its unique data root. Search workers terminate in `finally`; Git children are awaited. Verification command sessions exited 0. No unrelated IPv4 5173/3001 listener was touched.

The foundation deliberately ignores `docs/evidence/` and `*.log`; evidence exists locally but needs an explicit force-add if the lead wants it in the verified commit. This lane did not modify `.gitignore`, create a commit, push, or change root composition.

Successful HTTP replay receipts survive ordinary restart, as tested. Unlike the shared source-port receipt, the generic HTTP wrapper records its receipt after the aggregate method returns; a process crash in that narrow gap is not covered by the acceptance run and can require a refetch after a stale-version response. Full multi-lane/browser acceptance, external conversion/download adapter composition, realtime transport and named Git action verification remain with their assigned lanes.

## Dashboard contract delta verification

The lead-owned dashboard contract is implemented and independently reverified. `projectList` is explicitly typed as `Page<ProjectSummary>` and returns the actual owner name, only the requesting user's tag IDs, and that actor's current effective role. It emits no list ETag. `projectGet` remains the strict unchanged `Project` DTO with its detail resource ETag.

`projectBulk` accepts `{items:[{id,expectedVersion}],action}`. It rejects duplicate IDs and authorizes every member before mutation. Inside the same immediate SQLite transaction it rechecks the entire selection's current versions and access, then updates each project with `WHERE id=? AND version=?`. Any later stale item raises 409 and rolls back all preceding state/counter updates. A deterministic real SQLite trigger regression failed against the previous implementation (HTTP 202 instead of 409) and now proves rollback of the earlier write and trigger effect.

Bulk downloads read already-finalized source snapshots rather than creating checkpoints or changing project counters. Their durable operation insertion rechecks all selected versions/access inside the final operation transaction after ZIP/blob I/O. Git import authentication remains `grantId`; this change adds no raw UI token import path.

This subsequent native Bun 1.3.14 run supersedes the earlier 34-test acceptance count:

- `bun test tests/core/projects.test.ts tests/core/files.test.ts tests/core/base`: exit 0, **42 pass, 0 fail, 126 assertions, 10 files, 17.45 seconds**.
- `bun node_modules/typescript/bin/tsc --noEmit -p tests/core/base/tsconfig.json`: exit 0, no diagnostics.
- `bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings services/core/base tests/core/projects.test.ts tests/core/files.test.ts tests/core/base`: exit 0, no diagnostics.
- LSP: zero diagnostics across 27 base source files before strict checks.
- Changed files remain single-responsibility and below 200 pure lines: serializer 48, project routes 166, operation persistence 75, dashboard regressions 141. No new type escapes, variant handling, logging, dependency or shared-contract edits were introduced.

Exact before/after evidence is `docs/evidence/p1-core-base/dashboard-{before,tests,types,lint}.log`. Owned verification root `/tmp/quire-dashboard-delta-GLMS24` was removed successfully after evidence retention; fixture servers/databases and all command processes completed. No commit or push was made.

## Compile permission correction

`compile` has been removed from the shared read-action set and added to the Editor/Owner action set in `services/core/base/access.ts`. Viewer and Reviewer now receive `403 FORBIDDEN` for this action while retaining `read` authorization. Owner and Editor retain both actions. The fix is at the shared permission boundary, not deferred to compiler integration.

Eight real-role cases in `tests/core/base/access.test.ts` call the actual registered `ProjectPort` against seeded durable project memberships, with no authorization mock. Before the fix, the focused compile run passed Owner/Editor and failed both Viewer/Reviewer denial cases: 2 pass, 2 fail, 4 assertions, 946 milliseconds. After the fix, all eight read/compile matrix cases pass. Current compiler enqueue/cancel/cache guards on disk use the existing writable `write` action; both `write` and `compile` are now restricted consistently. No compiler-owned file was edited.

Final native Bun 1.3.14 verification supersedes earlier counts:

- `bun test tests/core/projects.test.ts tests/core/files.test.ts tests/core/base`: exit 0; **50 pass, 0 fail, 134 assertions, 10 files, 17.01 seconds**.
- `bun node_modules/typescript/bin/tsc --noEmit -p tests/core/base/tsconfig.json`: exit 0, no diagnostics.
- `bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings services/core/base tests/core/projects.test.ts tests/core/files.test.ts tests/core/base`: exit 0, no diagnostics.
- LSP: zero diagnostics across 27 base source files before strict checks.

Evidence is retained as `docs/evidence/p1-core-base/compile-permission-{before,tests,types,lint}.log`. The changed access module and regression file own only permissions and role behavior, respectively, and measure 96/107 pure lines. There are no new helpers, type escapes, dependencies, defensive branches, logging or shared-contract edits. The regression tests fail for the actual authorization bypass rather than pinning the action-set implementation or prose.

Owned root `/tmp/quire-compile-permission-W8iRdw` was removed successfully after evidence retention. All fixture servers/databases and verification command sessions completed; no unrelated listener was stopped and no commit or push was made.
