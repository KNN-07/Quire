# P0 foundation contract

Owner: F. Frozen interface date: October 26, 2026. This is a runnable foundation, not acceptance of any P1/P2 feature. Feature endpoints remain `501 NOT_IMPLEMENTED` until their owning module registers a real implementation. Seeded accounts do not enable login; stored Yjs documents do not imply a collaboration server.

## Start and verification

Native baseline is Bun 1.3.14. Run from the repository root:

```sh
bun install
bun run db:migrate
bun run seed
bun run doctor
bun run dev
bun run typecheck
bun test tests/contract
bun run build
bunx playwright install chromium
bun run test:e2e
```

The default API is `127.0.0.1:3001`; the Vite shell is `localhost:5173`. Vite proxies `/api`, `/git`, `/events`, and `/scim`. `GET /api/health` checks the actual SQLite connection and returns a checked JSON envelope. The development supervisor starts both children, forwards termination and awaits their exit. Stop with Ctrl+C.

Configuration is parsed by `loadConfig`: `QUIRE_DATA_DIR` (default `.data`, resolved absolutely), `QUIRE_HOST` (default `127.0.0.1`), `QUIRE_PORT` (default `3001`), `QUIRE_PUBLIC_URL` (default `http://localhost:5173`), `QUIRE_PROFILE` (`local|scale`, default `local`), `QUIRE_COMPILER_BACKEND` (`bwrap|docker`, default `bwrap`), `QUIRE_MAX_REQUEST_BYTES` (default 64 MiB transport ceiling, including multipart metadata), and `NODE_ENV`. Vite also accepts `QUIRE_WEB_HOST`. It follows `QUIRE_HOST`/`QUIRE_PORT` for its API proxy. Transport limits are separate from configurable feature upload quotas. The scale profile fails explicitly until O's storage integration is wired; it never silently uses SQLite.

`QUIRE_SECRET_KEY`, when supplied, is exactly 64 lowercase hexadecimal characters. Local startup otherwise generates `.data/secret.key` with mode `0600`; the data directory has mode `0700`. Production requires the explicit key. `QUIRE_SEED_PASSWORD` optionally supplies a local seed password of at least 12 characters. Otherwise seed displays a generated password once, stores only Argon2id hashes, and never resets existing passwords on rerun. Seed refuses production and non-loopback bindings. There are no committed login credentials.

This workstation already has unrelated listeners on IPv4 port 5173 and port 3001. Live verification therefore used:

```sh
QUIRE_PORT=3301 QUIRE_WEB_HOST=::1 bun run dev
```

The browser opened **http://localhost:5173** over IPv6, and the API ran at `127.0.0.1:3301`. Existing listeners were not stopped. Use the defaults on a free machine. The e2e harness selects an explicit IPv6 URL when `QUIRE_WEB_HOST=::1`.

Additional interfaces exist but do not claim downstream completion:

| Command | P0 behavior |
| --- | --- |
| `bun run lint` | Oxlint with the type-aware companion and local copy/suppression-reason rules. |
| `bun run format:check` | Oxfmt check; not a claimed P0 acceptance result. |
| `bun run verify:matrix` | Exits 1 explaining that full T01-T22 feature evidence is not implemented. |
| `bun run ops:restore-drill -- --fixture complete` | Exits 1 until O's real recovery drill is composed. |
| `bun run test:scale` | Exits 1 until O's actual scale verification is composed. |

`doctor` reports installed executable paths separately from verified capabilities. In particular, presence of TeX/bwrap/Docker does not mark an environment or sandbox ready. AI and external providers are unconfigured.

## Imports and ownership

Use `@quire/contracts` and `@quire/runtime`, not their internal files. Both are real workspace packages with source exports. Only F changes these packages, the package graph, lockfile, root configuration, application composition, and cross-lane fixtures. Ask F for an explicit contract delta rather than widening a schema or deep-importing an internal route table.

Pinned baseline: React/React DOM 19.2.9, Vite 7.3.1 with React plugin 5.1.4, TypeScript 5.9.3, Zod 4.3.6, Ky 1.14.3, Yjs 13.6.33, y-protocols 1.0.7, y-codemirror.next 0.3.6, CodeMirror 6 packages and Vim/Emacs bindings, PDF.js 5.4.624, fflate 0.8.3, Playwright 1.64.1, Oxlint 1.89.0, Oxfmt 0.74.0, and oxlint-tsgolint 7.0.2005. Exact individual pins are in `package.json` and resolved by `bun.lock`. Production code uses Bun 1.3.14 APIs, not eval-only APIs.

The LaTeX tokenizer is `@codemirror/legacy-modes` 6.5.5 (`mode/stex`), with direct `@lezer/highlight` 1.2.5 available for editor styling. The contract suite composes the real pinned tokenizer and EditorState rather than assuming that JavaScript/Markdown language packages cover LaTeX.

U and V consume the shared client. V owns the primitives `BrandMark`, `Button`, `IconButton`, `Modal`, `Field`, `Tabs`, `EmptyState`, `Spinner`, `ToastRegion`, `Icon`, and `AppHeader` from `apps/web/src/ui/index.ts`, along with its documented props. The foundation imports `styles/tokens.css` and `styles/global.css` but deliberately uses a semantic shell without guessing primitive props. F later composes feature page exports in `apps/web/src/router.tsx`; U/V do not edit that router.

The router exports `webRoutes` (the screen route patterns) and `AppRouter` (the mounted P0 shell). Share/new-project/tools dialogs remain feature components, not invented standalone browser paths.

## Complete public contracts export inventory

For every name in the following table, both the named type and `<Name>Schema` are exported:

| Domain | Names |
| --- | --- |
| Primitives | `Id`, `Instant`, `Digest`, `GitOid`, `Role`, `Scope`, `Version`, `JobStatus`, `Capability` |
| Projects/review/Git | `CompileSettings`, `Project`, `FileEntry`, `TextDocument`, `Snapshot`, `Anchor`, `ProposedEdit`, `Suggestion`, `Comment`, `Thread`, `HistoryVersion`, `GitHunk`, `GitStatus`, `TemplateVersion`, `Tag` |
| Accounts/governance | `User`, `Policy`, `Preferences`, `Organization`, `Membership`, `Invitation`, `AccessRequest`, `IdentityConfig`, `BillingAccount`, `Invoice`, `AuditEntry`, `Session` |
| Work/adapters | `CompileRequest`, `Artifact`, `Diagnostic`, `CompileJob`, `Operation`, `Publication`, `LibraryEntry`, `ProviderConfig`, `AiRun`, `Worker`, `Environment`, `Backup`, `Release`, `AdapterGrant`, `WorkerLease`, `AiTool` |
| Events/realtime | `EventTopic`, `Event`, `RealtimeClientMessage`, `RealtimeServerMessage` |

The paired schema identifiers are:

- Primitives: `IdSchema`, `InstantSchema`, `DigestSchema`, `GitOidSchema`, `RoleSchema`, `ScopeSchema`, `VersionSchema`, `JobStatusSchema`, `CapabilitySchema`.
- Projects/review/Git: `CompileSettingsSchema`, `ProjectSchema`, `FileEntrySchema`, `TextDocumentSchema`, `SnapshotSchema`, `AnchorSchema`, `ProposedEditSchema`, `SuggestionSchema`, `CommentSchema`, `ThreadSchema`, `HistoryVersionSchema`, `GitHunkSchema`, `GitStatusSchema`, `TemplateVersionSchema`, `TagSchema`.
- Accounts/governance: `UserSchema`, `PolicySchema`, `PreferencesSchema`, `OrganizationSchema`, `MembershipSchema`, `InvitationSchema`, `AccessRequestSchema`, `IdentityConfigSchema`, `BillingAccountSchema`, `InvoiceSchema`, `AuditEntrySchema`, `SessionSchema`.
- Work/adapters: `CompileRequestSchema`, `ArtifactSchema`, `DiagnosticSchema`, `CompileJobSchema`, `OperationSchema`, `PublicationSchema`, `LibraryEntrySchema`, `ProviderConfigSchema`, `AiRunSchema`, `WorkerSchema`, `EnvironmentSchema`, `BackupSchema`, `ReleaseSchema`, `AdapterGrantSchema`, `WorkerLeaseSchema`, `AiToolSchema`.
- Events/realtime: `EventTopicSchema`, `EventSchema`, `RealtimeClientMessageSchema`, `RealtimeServerMessageSchema`.

Additional schema exports: `CountSchema`, `BranchSchema`, `ProjectPathSchema`, `EngineSchema`, `MemberRoleSchema`, `OkSchema`, `ErrorSchema`, `ErrorResultSchema`, `Base64Schema`, `EmptySchema`, `ListQuerySchema`, `BranchQuerySchema`, `ExpectedVersionSchema`, `IdParamsSchema`, `ProjectParamsSchema`, `FileParamsSchema`, `ProjectIdParamsSchema`, `MutationHeadersSchema`, `BytesSchema`, `HealthSchema`, `ImportSourceSchema`, `FilesUploadSchema`, `AvatarUploadSchema`, `LibraryUploadSchema`, `SamlCallbackSchema`, `ImportFormSchema`, and `ResourceVersionTagSchema`.

Additional values/functions: `pageSchema`, `resultSchema`, `assertNever`, `EventPayloadSchemas`, `AdapterActions`, `endpoint`, `request`, `noInput`, `endpoints`, `endpointRegistry`, `createClient`, `ClientContractError`, `resourceVersionTag`, and `parseResourceVersionTag`.

Additional types: `Page<T>`, `Result<T>`, `ClientResponse<T>`, `Method`, `Transport`, `Lane`, `Endpoint<I,O>`, `RequestOf<E>`, `ResponseOf<E>`, `EndpointName`, `AdapterProvider`, and `AdapterAction<P>`.

Injected cross-service interfaces: `ProjectPort`, `CompilePort`, `AiProvider`, `ExternalAdapter`, `Clock`, and `BlobStore`. Their signatures implement plan section 3. The prescribed four-input `ProjectPort.applyEdits` signature is retained rather than inventing an incompatible wrapper.

### Schema conventions

IDs are branded UUID strings; instants are branded UTC ISO strings ending in `Z`; digests are branded lowercase SHA-256 strings. Git OIDs retain the algorithm prefix and validated length. Counts and revisions are nonnegative integers. Project paths are normalized relative POSIX paths, with absolute paths, empty/dot/parent components, backslashes, NUL and `.git` rejected. Binary bytes remain `Uint8Array`, never decoded by the blob store.

DTO objects reject unknown properties and expose readonly results. Nullable fields must explicitly contain `null`; omission is not equivalent. Request bodies contain writable fields, not server IDs/status fields. Existing-resource mutations require `expectedVersion`; compile uses its specified `expectedRevision`, and document updates carry epoch/client sequence. Handlers still own path/scope agreement, authorization, optimistic comparison, idempotency storage and business limits.

JSON responses are `{data,requestId}` or `{error:{code,message,details?},requestId}`. Errors use `ServiceError(code,status,message)` at service boundaries. Output is validated before serialization; invalid service output is a 500, not client validation failure. Byte responses have content type, ETag and Content-Disposition. `Operation.progress` is 0 through 1.

Structured service failures use `ServiceError(code,status,{message,details})`; the router preserves machine-readable `details`, including conflict recovery data, without pinning the human message. The third-argument string form remains valid. `ServiceFailure` names this error value object.

Each endpoint's input is `{params,query,body,headers?}`. GET requests pass `body: undefined`; parameterless groups use `{}`. Query `limit` defaults to 50 and is at most 200. Branch reads require `query.branch`. Mutation headers use lowercase `"idempotency-key"` and `"if-match"` keys. The registry marks required idempotency and replacement preconditions; both client and server reject missing headers. No client retry is automatic.

Multipart conventions:

| Schema | Form fields and handler output |
| --- | --- |
| `FilesUploadSchema` | `scope` JSON, `paths` JSON string array, repeated `files` File values, `expectedVersion` decimal string. Output has typed scope, paths, files and numeric expectedVersion, equal path/file counts and distinct safe paths. K enforces operator-configurable upload quotas (defaults 180 entries and 50 MiB), not a hardcoded client schema cap. |
| `AvatarUploadSchema` | `file` File and `expectedVersion` decimal string. |
| `LibraryUploadSchema` | `file` File. Bibliography content parsing belongs to K. |
| `SamlCallbackSchema` | `SAMLResponse` string and optional `RelayState` string. Signature/protocol verification belongs to A/X. |
| `ImportFormSchema` | `kind`, `name`, optional `workspaceId`, `source` (File or JSON `ImportSourceSchema`). JSON imports use the same named source variants: upload, snippet, data-url, url, git. Provider/network/archive validation belongs to X/K before writes. |

Unknown or duplicate scalar form fields are rejected. Client validation preserves the original FormData on the wire; the server performs normalization for its handler. A valid form is not an authorization or successful import.

`EventSchema` discriminates on topic. `document.saved` carries `{resourceId,revision,epoch}`; `job.changed` and `operation.changed` carry `{resourceId,status}`; the other registered topics carry `{resourceId,version}`. Raw source text and provider secrets do not belong in event payloads. `RealtimeClientMessageSchema` and `RealtimeServerMessageSchema` describe the wire variants, not an implemented handshake or durable-ack service.

### Client

```ts
import { createClient, endpoints } from "@quire/contracts";

const client = createClient("", { csrfToken: () => currentCsrfToken });
const response = await client.call(endpoints.projectGet, {
  params: { p: projectId },
  query: { branch: "main" },
  body: undefined,
}, abortSignal);
```

`call` infers request/response types from the same route object the server registers, checks JSON envelopes and byte responses, accepts multipart forms, includes same-origin credentials, supports AbortSignal, and has a 30-second timeout with zero retries. Inspect the `data`/`error` union. Client-side validation/protocol failures reject rather than manufacturing a server error envelope. `client.url(endpoint,input)` constructs the checked URL for downloads, EventSource and WebSocket; the caller must still use an authorized native transport. Stream calls through `call` fail explicitly.

DTO fields stay exactly as specified, including DTOs that do not carry a version. Mutable resource handlers must emit a JSON-resource ETag using `resourceVersionTag(counter)`, for example `"v2"`, through `request.responseHeaders`. `client.callWithMetadata(endpoint,input,signal?)` returns `ClientResponse<T>`: `{result,metadata:{etag,expectedVersion}}`, with the same checked result as `call`. The raw ETag can be sent as If-Match; the parsed number is used as `expectedVersion`. Missing/non-version ETags produce `null`, never a guessed zero. A DTO's explicit version must agree with the header.

For missing-version DTOs, fetch their owning aggregate: `/me` or admin-user reads expose the user counter; compile reads expose the job counter; thread reads expose the counter used for thread state, replies and nested comment edits/deletes. A mutable collection without an individual read route, such as the worker list, exposes a collection counter and its actions compare that same counter. Feature modules own the atomic comparison/increment and must return the new header after mutations. Lists of independently versioned resources require a detail read before mutation when no per-item version is present. Byte ETags remain content digests and are not parsed as resource counters.

## Endpoint registry inventory

There are **232** concrete method/path contracts, including health, smart HTTP, SSE, realtime, SCIM and internal worker routes. The method, exact path, input/output validators, lane, transport, successful status and preconditions live together in `endpoints`. `endpointRegistry` is a readonly dispatch list. No handwritten parallel DTO client exists.

Every named property is listed here; use `endpoints.<name>`:

- Foundation: `health`.
- Accounts/session/profile: `authRegister`, `authVerifyEmail`, `authLogin`, `authLogout`, `me`, `passwordReset`, `passwordResetConfirm`, `sessionList`, `sessionDelete`, `sessionRevokeOthers`, `identityStart`, `identityCallback`, `samlCallback`, `identityLink`, `identityUnlink`, `profilePatch`, `avatarPut`, `avatarDelete`, `preferencesGet`, `preferencesPatch`, `emailAdd`, `emailDelete`, `aiConsent`, `accountExport`, `accountDelete`, `notificationsList`, `notificationRead`, `notificationPreferences`.
- Organizations/managed/billing/identity admin: `organizationsList`, `organizationGet`, `organizationCreate`, `organizationPatch`, `organizationDelete`, `membersList`, `memberCreate`, `memberPatch`, `memberDelete`, `membersCsv`, `organizationPolicy`, `organizationPolicyPatch`, `organizationMetrics`, `organizationAudit`, `organizationAuditExport`, `institutionGet`, `institutionEnroll`, `managedInvite`, `managedAccept`, `managedRelease`, `managedDelete`, `billingCatalog`, `billingGet`, `billingPreview`, `billingCheckout`, `billingDetails`, `billingCancel`, `invoiceDownload`, `billingWebhook`, `identityConfigGet`, `identityConfigPut`, `identityTest`, `identityMetadata`, `scimToken`.
- Projects/files/templates: `projectList`, `projectCreate`, `projectGet`, `projectPatch`, `projectCopy`, `projectBulk`, `projectLeave`, `projectTransfer`, `projectDelete`, `tagsList`, `tagGet`, `tagCreate`, `tagPatch`, `tagDelete`, `projectTags`, `filesList`, `fileCreate`, `fileContent`, `fileDocument`, `filePatch`, `fileDelete`, `filesUpload`, `linkCreate`, `linkRefresh`, `projectExport`, `operationDownload`, `projectSearch`, `templatesList`, `templateGet`, `templateCreate`, `templatePatch`, `templateDelete`, `templateVersion`, `templateSubmit`, `templateApprove`, `templatePublish`, `templateUnpublish`.
- Access/review/history: `accessGet`, `invitationCreate`, `invitationAccept`, `invitationResend`, `invitationDelete`, `accessMemberPatch`, `accessMemberDelete`, `accessLinkPut`, `accessRequest`, `accessDecide`, `threadsList`, `threadGet`, `threadCreate`, `threadPatch`, `threadDelete`, `threadReply`, `commentPatch`, `commentDelete`, `threadState`, `suggestionCreate`, `suggestionDecide`, `chatList`, `chatCreate`, `historyList`, `historyLabel`, `historyLabelDelete`, `historyCompare`, `historyRestore`, `historySource`.
- Git/library: `gitStatus`, `gitLog`, `gitBranches`, `gitBranchCreate`, `gitBranchDelete`, `gitStage`, `gitDiscard`, `gitCommit`, `gitMerge`, `libraryList`, `libraryGet`, `libraryCreate`, `libraryPatch`, `libraryDelete`, `libraryImport`, `citationCreate`.
- Compiler/worker: `environmentsList`, `compileCreate`, `compileGet`, `compileCancel`, `compileLog`, `artifactContent`, `compileCacheDelete`, `synctex`, `pdfDiff`, `workerLease`, `workerHeartbeat`, `workerSource`, `workerArtifact`, `workerComplete`.
- Adapters/AI: `importCreate`, `libraryDoi`, `referencesSearch`, `connectionsList`, `connectionStart`, `connectionCallback`, `connectionTest`, `connectionDelete`, `connectionAction`, `aiRunCreate`, `aiRunGet`, `aiRunCancel`, `aiRunDecide`, `aiRunUndo`, `aiConversationDelete`.
- Operations/admin: `operationGet`, `adminOverview`, `adminUserGet`, `adminUserPatch`, `adminUserInvite`, `adminUserTransfer`, `adminUserRevoke`, `adminUserRestore`, `adminProjects`, `adminEditorState`, `workersList`, `workersCreate`, `workerPolicy`, `workerDrain`, `workerDelete`, `adminEnvironments`, `environmentCreate`, `environmentDefault`, `environmentRetire`, `environmentBuild`, `providerGet`, `providerPut`, `providerTest`, `auditList`, `auditExport`, `auditSiem`, `backupPolicyGet`, `backupPolicyPut`, `backupCreate`, `backupsList`, `backupVerify`, `backupRestore`, `releasesList`, `updateCreate`, `diagnosticsCreate`, `supportInquiry`.
- Other transports: `gitTokensList`, `gitTokenCreate`, `gitTokenDelete`, `sshKeysList`, `sshKeyGet`, `sshKeyCreate`, `sshKeyPatch`, `sshKeyDelete`, `gitHttpGet`, `gitHttpPost`, `realtime`, `events`, `scimUsersList`, `scimUserCreate`, `scimUserGet`, `scimUserPatch`, `scimUserDelete`, `scimGroupsList`, `scimGroupCreate`, `scimGroupGet`, `scimGroupPatch`, `scimGroupDelete`.

`AdapterActions`, `AdapterProvider`, `AdapterAction<P>` and `AiToolSchema` freeze the plan's provider action/tool names. `connectionAction.parameters` remains an untrusted boundary record until X supplies each provider action schema through F; registering the generic route is not permission to execute unchecked parameters. Similarly, SCIM `Operations.value` is protocol-level input that the account SCIM parser must narrow before domain operations.

## Complete runtime export inventory

| Responsibility | Exports |
| --- | --- |
| Configuration | `RuntimeConfig`, `loadConfig`, `prepareData`, `loadSecretKey` |
| Persistence | `Migration`, `foundationMigrations`, `openDatabase`, `migrateDatabase`, `SqlValue`, `Transaction`, `UnitOfWork`, `LocalUnitOfWork`, `SqliteUnitOfWork`, `parseJson` |
| Blobs | `DiskBlobStore`, `referenceBlob` |
| Events | `PendingEvent`, `EventPort`, `LocalEventPort`, `SqliteEventPort` |
| Services | `Principal`, `IdentityPort`, `PolicyPort`, `RealtimeSocketData`, `RealtimePort`, `ServicePorts`, `ServiceRegistry` |
| HTTP | `RequestContext`, `RouteRegistry` |
| Lifecycle | `systemClock`, `Runtime`, `ModuleContext`, `ServiceModule`, `createRuntime` |
| Errors | `ServiceFailure`, `ServiceError`, `StorageError` |

`Runtime` exposes parsed config, SQLite `db`, `uow`, `blobs`, `clock`, `events`, `services`, `routes`, `secretKey`, and `close()`. `ModuleContext` supplies those dependencies with a lane-scoped route registrar, excluding runtime close. `createApplication` and the ordered `modules` list are exported from `apps/server/src/composition.ts`; its result exposes `runtime`, ordinary `fetch`, Bun-aware `handle`, `websocket`, and `close`.

### Module registration

Each server lane exports `register(context: ModuleContext): void | Promise<void>` from its own paths. F imports it and adds a `ServiceModule` to composition. Recommended order/IDs: A `010-a-accounts` (10), K `020-k-core` (20), C `030-c-compiler` (30), X `040-x-adapters` (40), O `050-o-operations` (50). Order is numeric, then ID; duplicate module IDs fail startup. Registration installs handlers and services; service resolution can be deferred until request time so K/C can refer to one another without import cycles.

```ts
export function register(context: ModuleContext): void {
  context.services.provide("projects", projectService);
  context.routes.register(endpoints.projectGet, async (input, request) => {
    const principal = await context.services.get("identity").require(request.request);
    return projectService.get(principal.user.id, input.params.p, input.query.branch);
  });
}
```

The example illustrates injection, not a second prescribed `ProjectPort` implementation: the concrete K service may have extra local methods, while only its declared public port is registered. `context.routes.register(endpoint,handler)` infers parsed input and output. Its request context exposes raw `request`, generated `requestId`, and writable `responseHeaders`. `registerTransport(endpoint,handler)` is for real byte/stream protocol responses, which must enforce their own protocol/security boundary. Duplicate registrations and registration by the wrong lane fail. Registration does not provide authentication automatically.

`ServicePorts` keys are exactly `projects` (K), `compiler` (C), `identity` and `policy` (A), `realtime` (K), `ai` and `adapters` (X). `provide` is typed and refuses duplicates. `get` throws `503 SERVICE_UNAVAILABLE` for absent services; `has` permits truthful capability reporting. No default success implementations exist.

`IdentityPort` has `authenticate`, `require`, and `verifyMutation`; a `Principal` holds `user`, `sessionId`, `csrfToken`, and `operator`. `PolicyPort.forProject(actorId,projectId)` returns a checked policy. `RealtimePort` supplies Bun WebSocket `handlers` and `upgrade(request,server)`. Socket data contains `actorId`, `sessionId`, `connectionId` and `scope`. Main routes upgrade requests through this service only when registered; otherwise realtime is 501. K must authenticate/origin-check/authorize before `server.upgrade`, implement durable update-before-ack, and reject non-realtime paths. The foundation forwards open/message/close/drain callbacks and caps messages at 4 MiB; it never sends an ack itself.

### SQLite, transactions and blobs

`quire.sqlite` uses WAL, foreign keys, `synchronous=FULL`, STRICT tables, and a 5-second busy timeout. Five embedded SQL migrations create the identity, project/Git, review, work/outbox, and governance domains. Tables use snake_case columns and JSON text columns ending in `_json`; IDs are UUID text, timestamps UTC text, booleans integer 0/1, byte/update data BLOB. File identity is `(id,branch_id)`; live paths are unique within a branch. Ownership is the non-null `projects.owner_id`; `project_members` stores only editor/reviewer/viewer, preventing a second membership owner.

All schema additions go through F. A module may supply `migrations: readonly Migration[]` with IDs matching `NNN-lane-description`, for example `010-a-session-recovery` or `020-k-working-tree`. The loader merges and lexically sorts them with foundation migrations. Each migration runs atomically and is recorded with its SHA-256; editing an applied migration or duplicating an ID fails. Never edit the five baseline SQL files after consumers begin persisting data.

`scripts/migrate.ts` opens the application composition without listening, so `bun run db:migrate` includes the same ordered module migrations as server startup rather than a separate migration registry.

For local atomic work use `uow.local(tx => ...)`, where `tx` is the real synchronous `bun:sqlite` database. Its callback must not return a Promise. Perform blob/Git/network work first; then atomically change aggregate version, ACL and outbox as required. `events.append(tx,event)` participates in this transaction. After commit call `events.dispatch()`.

The portable `UnitOfWork.run(async tx => ...)` supports the same async callback shape required by the scale adapter. `Transaction.execute(sql,parameters?)` returns changed rows; `Transaction.query(sql,parameters,rowSchema)` returns checked rows. SQLite serializes these callbacks, begins an immediate transaction, commits on resolution and rolls back on rejection. **Only await transaction operations inside this SQLite callback; never await network/blob/Git work.** Do not mix local transactions into an active async callback: they fail rather than joining unrelated state. `events.record(tx,event)` creates the event/outbox through this portable interface. O must implement the same ports with PostgreSQL and translate the documented `?` parameter convention; feature-specific SQLite repositories remain a local adapter boundary, not a promise that SQLite's Database object is PostgreSQL.

`BlobStore.put` returns SHA-256 after durable content-addressed disk publication. Layout is `blobs/<first-two-hex>/<full-digest>`. It fsyncs bytes/directories and atomically links the completed temporary file into place. Only then call `referenceBlob(tx,{digest,bytes},clock)` in the referencing DB transaction. A failed DB transaction may leave an unreferenced immutable blob; it must not leave a reference to missing bytes. `get` checks the digest and returns original bytes, including NUL/non-UTF-8. Snapshot file bytes are obtained through their blob digest, never mutable working paths.

`events.append`/`record` validate topic-specific payloads and insert both `events` and `outbox`. `after` is local synchronous replay; `read` is portable async replay. Both return ordered durable events with optional aggregate filtering and bounded limit. `subscribe` returns an unsubscribe function; `dispatch` delivers committed pending rows and marks them published only after listeners complete. Pending rows are dispatched after module registration on startup. HTTP/SSE authorization, access revocation and topic filtering belong to K/A; this internal port must not be exposed as an unrestricted event feed.

## Fixtures and tests

`tests/fixtures/foundation.ts` exports `fixtureIds`, `seedUsers`, `defaultPolicy`, `defaultPreferences`, and `exampleFiles`. UUID suffixes are stable:

| Fixture key | Suffix / role |
| --- | --- |
| `kien`, `mai`, `sam`, `alex`, `outsider`, `operator` | `001` owner Kien Nguyen, `002` editor Mai Tran, `003` reviewer Sam, `004` viewer Alex, `005` outsider, `006` operator. Emails are the corresponding lowercase name at `quire.local`. |
| `team`, `institution` | `010` Robotics Lab; `011` Quire Institute. |
| `project`, `branch` | `020` Latent Dynamics Note; `021` its main branch workspace. |
| `environment`, `snapshot`, `mainFile` | `030` unprobed TL2025 environment, `040` immutable checkpoint, `101` main.tex. |

All full IDs use the form `00000000-0000-4000-8000-000000000NNN`. The fixture contains `main.tex`, `sections/`, `sections/intro.tex`, `sections/method.tex`, `sections/results.tex`, `refs.bib`, and `quire.yml`. The paper title is "Latent Dynamics for Sample-Efficient Control", authored by Kien Nguyen and Mai Tran. `ha2018world` is genuinely referenced but absent from `refs.bib`; there is no manufactured compiler warning or PDF. The environment is explicitly unavailable and unprobed, not a claim that a sandbox is configured.

`scripts/seed.ts` exports `seed(runtime,password?)`, returning `{createdUsers,password}`; password is non-null only when users were created. Seed creates actual users/verified emails/preferences, both organizations, team membership, project ACL, branch, blob references, Yjs `source` texts/state/state vectors, snapshot file records, a real bare Git repository at `git/<projectId>.git`, named main HEAD and hidden checkpoint ref. Repeating seed does not reset credentials or overwrite a working project.

`tests/fixtures/runtime.ts` exports `isolatedData()` and `runtimeFixture()`. Both support `await using`; each owns a unique temporary root and cleans it. The latter also closes its SQLite connection. Do not share a fixed sandbox/cache path between processes.

Contract suites:

- `schemas.test.ts`: malformed primitive/path rejection, Unicode, writable mutation boundaries, concurrency, realtime bytes and unambiguous registry; mapped `Requests`/`Responses` compile every route's types.
- `multipart.test.ts`: parsed files/metadata and rejection of missing version rather than null-to-zero coercion.
- `editor-baseline.test.ts`: the installed CodeMirror state/language/LaTeX tokenizer actually parse a TeX document together.
- `runtime.test.ts`: actual durability PRAGMAs, blob/key reopen, transaction/outbox rollback, committed delivery/replay, changed-migration refusal, corruption detection and unavailable ports.
- `transactions.test.ts`: portable async SQL/outbox atomicity, rollback, serialized concurrent writers.
- `http.test.ts`: a real ephemeral HTTP server and checked health client, 501 identity/realtime, lane ownership, binary/multipart transport preservation, structured conflicts and ETag version metadata.
- `seed.test.ts`: actual seed/reopen, Argon2 verification, source/Yjs agreement, real `git show`, idempotence and foreign-key integrity.
- `cli.test.ts`: separate native processes execute the actual migrate/seed scripts; a new connection compares persisted users and source bytes.

`tests/e2e/playwright.config.ts` includes `tests/e2e`, `tests/ui-editor`, and `tests/ui-product`. Its web-server harness uses an isolated temporary data directory and teardown. The P0 browser scenario drives the mounted shell and actual proxied health. It does not accept any editor/account feature. Broader T01-T22 suites remain owned by their feature lanes.

## Evidence and remaining integration findings

See `docs/evidence/p0-foundation/verification.md`, `shell-desktop.png` (1440x900), and `shell-mobile.png` (390x844). Screenshots were inspected: mounted nonblank shell, connected native API, no horizontal overflow or overlapping navigation, no browser console errors.

Root lint initially reported `apps/web/src/ui/surfaces.tsx:39` (`typescript/consistent-return`), a parallel V-owned file. F did not edit or suppress that finding. Foundation-owned lint is checked separately; final status is recorded in the evidence file. Oxfmt checking and full feature/scale/restore acceptance are not claimed.

Architecture review: each source module has a concrete responsibility; all 60 F-owned TypeScript/JavaScript/SQL source files are below the 250-line ceiling, with the HTTP dispatcher largest at 129 pure lines. Endpoint/schema files are declarative data tables. Boundaries parse with Zod, domain DTOs are readonly, event/realtime variants are explicit, and enum dispatch uses exhaustive cases. No `any`, unsafe type assertions, non-null assertions or suppression comments were introduced. No speculative fallback services or permission bypasses exist. Tests observe real SQLite/blob/Git/HTTP/CLI behavior, not prompt prose. The one larger prescribed port signature is retained explicitly. Durable publication syncs are required persistence operations, not read-after-write confirmation. Error output stays at CLI/HTTP decision boundaries and omits secrets. The evidence file records the full eleven-point architecture review.
