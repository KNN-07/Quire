# Quire implementation architecture

Status: implementation contract, October 26, 2026. This document and `feature-matrix.md` specify work to build, not completed application behavior. Inputs: the original HTML/research archive, `docs/discovery/{design,core,services}.md`, and the 23 decoded design sources. Original inputs and the existing Git baseline remain untouched.

## 1. Decisions

Build the entire supported product, with one local-first deployment and an additional scalable deployment profile. Phases are dependency boundaries, not an MVP cutoff. All matrix build rows remain targets.

| Boundary | Decision |
| --- | --- |
| Runtime | Native Bun **1.3.14** baseline, TypeScript strict mode. Do not use eval-only Bun 1.4 APIs. `bun:sqlite`, `Bun.serve`, `Bun.spawn`, WebSocket and standard Web APIs; React, Vite, CodeMirror 6, Yjs, PDF.js. Pin dependency versions in the foundation lockfile after compatibility checks. |
| Default deployment | One Bun API/realtime coordinator on `127.0.0.1:3001`, React dev server on **localhost:5173** proxying `/api`, `/git`, `/events`, `/scim`; separate local compile worker. SQLite WAL with foreign keys and `synchronous=FULL`, local content-addressed blobs, real per-project Git repositories. No external service required to start. |
| Persistence | SQLite owns identities, ACLs, working documents, durable collaboration updates, jobs and review metadata. Git owns actual repository objects, named branches/commits and immutable source/history checkpoints. Objects are durable before DB references commit. Neither localStorage nor browser state is authoritative. |
| Reference topology | Preserve browser, API, realtime, Git, AI gateway and isolated-worker boundaries as modules/process roles. SQLite plus disk replaces the reference's PostgreSQL/Redis/S3 **only in the default profile**; report actual topology in admin/architecture views. The scale profile uses PostgreSQL, Redis notification/lease transport and S3-compatible blobs, with the same service interfaces and tests. Do not draw nonexistent replicas or show sample health. |
| Collaboration | Yjs source convergence, persistent update-before-ack, per-file/per-branch documents, server-authorized updates. Presence is ephemeral. Review suggestions and AI proposals are separate explicit edits, never raw reviewer Yjs mutations. |
| Real Git | Actual Git CLI and smart HTTP bridge; local branches, stage/unstage hunks, commit, log, merge and clone. Add SSH transport in deployment phase. GitHub/GitLab remote adapters use user credentials. Unlike the research reference's linear bridge, Quire supports branches because screens 02/16/21 explicitly require them. |
| Compilation | Real latexmk with pdfLaTeX/LaTeX/XeLaTeX/LuaLaTeX, BibTeX/Biber and SyncTeX, first verified native environment `texlive-2025-native`. Restrictive bwrap plus resource containment, or explicit isolated Docker image. No unsandboxed fallback and no pretend PDF. |
| AI | OpenAI-compatible user/operator-configured endpoint and model; optional retrieval adapters. Ask is read-only; Agent returns validated proposed patches. No provider installed/credentialed by assumption. A missing provider disables invocation with a configuration reason, not a canned answer. |
| Commercial policy | Quire local/server capabilities are unlocked; account/project/organization policy mechanisms are configurable. Do not copy Overleaf pricing, license gates, institution ownership or support promises. Pricing/support pages consume operator-owned configuration, with “not configured” rather than invented amounts or `[PRICE]`. |
| Complete external integrations | Implement real adapter flows and contract tests; distinguish `unconfigured`, `ready`, `degraded`, `disabled`. Credentials and provider-specific approval are the only external gates. A mock is evidence for adapter tests, never the production implementation. |

Default policy values are Quire choices: 50 MiB/upload, 180 entries/upload, 2,000 files/project, 7 MiB editable text/project, 2 MiB/file editing/search; configurable independently. Files beyond editing limits remain byte-preserving downloadable assets. UTF-8 including non-BMP is supported in Quire editing, with surrogate-pair regression tests; NUL/non-UTF-8 stays binary. This deliberately improves the reference's uncertain restriction. Source main must be editable, unlinked `.tex` with `\documentclass`, or explicitly enabled plain-TeX main. Default compile wall budget 180 seconds, max 600; 1 GiB job memory, 128 processes, 512 MiB writable workspace, two local job slots. Full history, no automatic project trash expiry, unlimited named collaborators within technical resource limits. Optional quota plans use one policy engine, not duplicated checks.

## 2. Foundation first: artifacts and ownership

P0 must finish before parallel implementation. It creates runnable development skeletons, migrations, shared schemas, service dependency injection, empty route registries with typed registration, seeded test fixtures and test harnesses. It does **not** ship placeholder success responses. Unimplemented routes in the skeleton return `501 NOT_IMPLEMENTED` and cannot count as feature completion.

Shared package exports are frozen after P0. Any change is a contract delta requested from lane F; consumers do not edit the shared files. Each lane exports a `register(context)` function and its own test suite. Only F wires modules into the application, owns package/lock/config files and resolves integration changes.

| Lane | Exclusive authored paths | Responsibilities / dependencies |
| --- | --- | --- |
| F - foundation/integration | `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig*.json`, `.env.example`, `.gitignore`, `packages/contracts/**`, `packages/runtime/**`, `apps/server/src/{main,composition}.ts`, `apps/web/{index.html,vite.config.ts}`, `apps/web/src/{main.tsx,router.tsx}`, `scripts/dev.ts`, `scripts/seed.ts`, `tests/{contract,integration,e2e,fixtures}/**`, `README.md` | P0 contracts/schema, DB/blob/clock/transaction/event ports, route composition, final integration and cross-lane tests. Only lane editing the root dependency graph. |
| C - compiler | `services/compiler/**`, `workers/compiler/**`, `tests/compiler/**` | Job runner, sandbox, logs, artifacts, SyncTeX, PDF diff, toolchain discovery; consumes F ports. |
| K - core | `services/core/**`, `tests/core/**` | Projects/files/templates/library/tags, Yjs persistence, access/share/review/history, Git repository engine and HTTP bridge, source imports/exports. Consumes F; calls compiler port, not C internals. |
| A - accounts/admin | `services/accounts/**`, `tests/accounts/**` | Auth, sessions, organizations, entitlements, invitations/mail outbox, managed lifecycle, audit, institutional portal, billing state; consumes F/K public access ports. |
| X - adapters/AI | `services/adapters/**`, `tests/adapters/**` | Provider grants, remote Git, bibliography/DOI, conversion, sync, AI/retrieval, publisher adapters, SSO/LDAP implementations. Consumes F/K/A ports. |
| U - editor UI | `apps/web/src/features/editor/**`, `tests/ui-editor/**` | Source/visual/PDF, Git, review/history/logs, assistant and editor dialogs; consumes only shared client. |
| V - product UI | `apps/web/src/features/{projects,account,admin,marketing}/**`, `apps/web/src/ui/**`, `apps/web/src/styles/**`, `tests/ui-product/**` | Shared visual primitives/tokens first, dashboard/templates/auth/settings/admin/marketing, new-project dialog. Exports primitives to U; no edits inside U. |
| O - operations | `services/operations/**`, `deploy/**`, `scripts/ops/**`, `tests/operations/**`, `docs/runbooks/**` | Docker/Compose/Helm, PostgreSQL/Redis/S3 adapters, backup/restore, scale routing, SSH bridge, toolchain image construction, update/doctor/support bundles. |

Directory tests belong to their implementation lane; F owns cross-lane fixtures. Existing `docs/discovery/**`, original HTML/archive and these two plans are evidence, not implementation lane scratch space. No overlapping subtree ownership; root files not listed require F assignment before creation. Route registrations and database migrations use lane-prefixed modules; F runtime loads them in numeric dependency order, never a shared barrel edited by every lane.

UI lanes route to **unspecified-high**, with the available frontend skill loaded, not the disconnected visual-engineering category. C/K/A/X/O can execute independently after P0 except the phase dependencies below. No nested agents required.

## 3. Shared TypeScript contracts

Put these types and runtime validators in `packages/contracts/src/`. Export a generated typed fetch client from the same endpoint registry; there is no independently handwritten frontend DTO. IDs are opaque UUID strings, dates UTC ISO 8601, byte counts integers, digests lowercase SHA-256; Git OIDs are algorithm-tagged strings. Validate at HTTP/worker/provider boundaries. JSON responses use the envelope below; byte responses use content type, ETag and Content-Disposition.

```ts
type Id = string;
type Instant = string;
type Digest = string;
type GitOid = `sha1:${string}` | `sha256:${string}`;
type Role = "owner" | "editor" | "reviewer" | "viewer";
type Scope = { projectId: Id; branch: string };
type Version = { revision: number; epoch: number };
type Page<T> = { items: T[]; nextCursor: string | null };
type Result<T> =
  | { data: T; requestId: Id }
  | { error: { code: string; message: string; details?: Record<string, unknown> };
      requestId: Id };
type Capability = {
  enabled: boolean;
  state: "ready" | "unconfigured" | "disabled" | "degraded" | "experimental";
  reason?: string;
};
type User = {
  id: Id; name: string; primaryEmail: string; verifiedEmails: string[];
  managedBy: Id | null; avatarBlob: Digest | null; latexName: string;
  affiliation: string; orcid: string | null; interfaceLanguage: "en" | "vi" | "zh";
};
type Project = {
  id: Id; name: string; ownerId: Id; workspaceId: Id | null;
  defaultBranch: string; settings: CompileSettings; version: number;
  createdAt: Instant; updatedAt: Instant;
};
type FileEntry = {
  id: Id; path: string; kind: "file" | "folder"; mime: string;
  blob: Digest | null; bytes: number; editable: boolean; version: Version;
  link: null | { kind: "project" | "url" | "bibliography";
    sourceId: string; lastRefreshedAt: Instant | null };
};
type TextDocument = {
  file: FileEntry; text: string; stateVectorBase64: string; updateBase64: string;
};
type Snapshot = {
  id: Id; scope: Scope; revision: number; tree: GitOid; createdAt: Instant;
  authorId: Id; reason: "checkpoint" | "compile" | "commit" | "restore" | "import";
};
type CompileSettings = {
  engine: "pdflatex" | "latex" | "xelatex" | "lualatex" | "plain";
  mainFileId: Id; environmentId: Id; draft: boolean; stopOnFirstError: boolean;
};
type CompileRequest = {
  scope: Scope; expectedRevision: number; settings?: CompileSettings; clean: boolean;
};
type JobStatus = "queued" | "running" | "succeeded" | "failed" | "timeout" | "canceled";
type Artifact = {
  id: Id; jobId: Id; name: string; mime: string; bytes: number; sha256: Digest;
  kind: "pdf" | "dvi" | "log" | "synctex" | "generated" | "diff";
};
type Diagnostic = {
  id: Id; jobId: Id; severity: "error" | "warning" | "typesetting";
  message: string; fileId: Id | null; line: number | null; column: number | null;
  rawStart: number; rawEnd: number; // UTF-8 byte range in full log
};
type CompileJob = {
  id: Id; snapshot: Snapshot; status: JobStatus; environmentId: Id;
  queuedAt: Instant; startedAt: Instant | null; finishedAt: Instant | null;
  elapsedMs: number | null; diagnostics: Diagnostic[]; artifacts: Artifact[];
  failureCode: string | null; workerId: Id | null;
};
type Anchor = {
  fileId: Id; epoch: number; startRelative: string; endRelative: string;
  quote: string; // base64 Yjs relative positions, quote is recovery context
};
type ProposedEdit = {
  id: Id; fileId: Id; anchor: Anchor; before: string; after: string;
  baseRevision: number; status: "pending" | "accepted" | "rejected" | "conflict";
};
type Suggestion = {
  id: Id; scope: Scope; authorId: Id; origin: "human" | "ai";
  edits: ProposedEdit[]; createdAt: Instant;
};
type Thread = {
  id: Id; scope: Scope; anchor: Anchor | null; resolved: boolean;
  comments: { id: Id; authorId: Id; body: string; createdAt: Instant; editedAt: Instant | null }[];
};
type Operation = {
  id: Id; kind: string; status: JobStatus; progress: number;
  result: Record<string, unknown> | null; errorCode: string | null;
};
type Policy = {
  compileSeconds: number; writableMembers: number | null;
  historyDays: number | null; trackChanges: boolean; chat: boolean;
  ai: "off" | "ask" | "agent"; aiDailyUses: number | null;
  sharing: "named" | "organization" | "anyone";
  anonymousRead: boolean; anonymousEdit: boolean;
};
type ProviderConfig = {
  id: Id; kind: string; baseUrl: string; model?: string; enabled: boolean;
  secretPresent: boolean; capabilities: Record<string, Capability>;
};
type AiRun = {
  id: Id; scope: Scope; mode: "ask" | "agent"; status: JobStatus;
  messages: { role: "user" | "assistant"; text: string }[];
  proposals: Suggestion[]; sources: Publication[]; usageId: Id;
};
type Publication = {
  provider: string; providerId: string; title: string; authors: string[];
  year: number | null; doi: string | null; url: string | null; bibtex: string;
};
type Event = {
  seq: number; id: Id; topic: string; aggregateId: Id; at: Instant;
  payload: Record<string, unknown>;
};
```

The remaining shared DTOs have these exact fields. Mutation schemas use the writable subset, require optimistic `version`, and never accept server-owned identity/status fields. `null` means absent, not an omitted unknown. F converts these and the registry into executable validators before consumers start.

```ts
type Preferences = {
  theme: "light" | "dark" | "system"; bindings: "default" | "vim" | "emacs";
  fontSize: number; fontFamily: "plex" | "system" | "serif";
  lineHeight: "compact" | "normal" | "wide"; defaultView: "source" | "split" | "visual" | "pdf";
  defaultEngine: CompileSettings["engine"]; dictionary: "en-US" | "en-GB" | "vi" | "zh";
  spellCheck: boolean; customWords: string[]; viewer: "builtin" | "browser";
  autoCompile: boolean; autocomplete: boolean; autoClose: boolean; cursors: boolean;
  aiModel: string | null; aiMode: "ask" | "agent"; aiStyle: "match" | "academic" | "plain";
  citationProviders: string[]; inlineCompletion: boolean; errorAssist: boolean;
  citationWebSearch: boolean; aiBranch: boolean; shareAiChat: boolean;
  compileBeforeCommit: boolean; version: number;
};
type Organization = { id: Id; slug: string; name: string; kind: "team" | "institution";
  domains: string[]; policy: Policy; version: number };
type Membership = { id: Id; organizationId: Id; userId: Id;
  role: "admin" | "manager" | "member"; licensed: boolean; version: number };
type Invitation = { id: Id; projectId: Id | null; organizationId: Id | null; email: string;
  role: Exclude<Role, "owner"> | Membership["role"];
  status: "pending" | "accepted" | "revoked" | "expired"; expiresAt: Instant; version: number };
type AccessRequest = { id: Id; projectId: Id; userId: Id; role: "reviewer" | "editor";
  message: string; status: "pending" | "accepted" | "declined"; version: number };
type TemplateVersion = { id: Id; templateId: Id; snapshotId: Id; name: string;
  category: string; description: string; license: string;
  visibility: "public" | "organization" | "private";
  status: "draft" | "submitted" | "approved" | "published" | "unpublished";
  organizationId: Id | null; version: number };
type LibraryEntry = { id: Id; ownerId: Id; citationKey: string; bibtex: string;
  origin: "manual" | "doi" | "provider"; providerId: string | null; readonly: boolean;
  publication: Publication | null; version: number };
type HistoryVersion = { id: Id; snapshot: Snapshot; labels: { id: Id; name: string }[];
  authors: Id[]; reviewSnapshotId: Id; accessible: boolean };
type GitHunk = { id: Id; fileId: Id; path: string; baseHead: GitOid; baseRevision: number;
  oldStart: number; oldLines: number; newStart: number; newLines: number;
  before: string; after: string; staged: boolean };
type GitStatus = { head: GitOid; branch: string; ahead: number; behind: number;
  files: { fileId: Id; path: string; status: "added" | "modified" | "deleted" | "conflicted" }[];
  hunks: GitHunk[]; staged: string[] };
type IdentityConfig = {
  protocol: "saml" | "oidc" | "ldap"; enabled: boolean; requireSso: boolean;
  createOnLogin: boolean; breakGlassUserId: Id; domains: string[];
  mappings: { group: string; role: Membership["role"] | "guest"; ai: Policy["ai"] }[];
  attributes: { email: string; name: string; groups: string };
  saml: null | { entityId: string; ssoUrl: string; metadataXml: string; certificates: string[] };
  oidc: null | { issuer: string; clientId: string; scopes: string[]; secretPresent: boolean };
  ldap: null | { url: string; baseDn: string; bindDn: string; userFilter: string;
    caCertificate: string; secretPresent: boolean }; version: number;
};
type BillingAccount = { id: Id; organizationId: Id | null; userId: Id | null;
  provider: "manual" | "configured"; planId: string | null; period: "month" | "year";
  seats: number; status: "unbilled" | "active" | "past_due" | "canceled";
  renewsAt: Instant | null; invoiceEmail: string; taxId: string; address: string; version: number };
type Invoice = { id: Id; billingAccountId: Id; providerId: string | null;
  amountMinor: number; currency: string; status: "draft" | "open" | "paid" | "void";
  issuedAt: Instant; documentArtifactId: Id | null };
type AuditEntry = { id: Id; seq: number; at: Instant; actorId: Id | null;
  organizationId: Id | null; event: string; targetId: Id; ip: string | null;
  details: Record<string, string | number | boolean | null> };
type Worker = { id: Id; poolId: Id; state: "idle" | "busy" | "draining" | "offline";
  environmentIds: Id[]; jobId: Id | null; lastHeartbeat: Instant; buildsToday: number };
type Environment = { id: Id; label: string; release: string; backend: "bwrap" | "docker";
  rootOrImageDigest: string; engines: CompileSettings["engine"][]; helpers: string[];
  packagesDigest: Digest; experimental: boolean; available: boolean; probeAt: Instant | null };
type Backup = { id: Id; status: JobStatus; createdAt: Instant; manifestDigest: Digest | null;
  destination: string; verifiedAt: Instant | null; operationId: Id };
type Release = { id: Id; version: string; manifestDigest: Digest; notes: string;
  signatureVerified: boolean; compatibleSchema: number[]; scheduledAt: Instant | null };
type AdapterGrant = { id: Id; provider: string; ownerId: Id; label: string;
  state: Capability["state"]; scopes: string[]; expiresAt: Instant | null; version: number };
```

Internal ports, implemented once and injected:

```ts
interface ProjectPort {
  authorize(actorId: Id, scope: Scope, action: string): Promise<void>;
  snapshot(actorId: Id, scope: Scope, expectedRevision: number): Promise<Snapshot>;
  readSnapshot(snapshotId: Id): Promise<{ files: FileEntry[]; tree: GitOid }>;
  applyEdits(actorId: Id, scope: Scope, edits: ProposedEdit[],
    key: string): Promise<{ revision: number; conflicts: Id[] }>;
}
interface CompilePort {
  enqueue(actorId: Id, request: CompileRequest, key: string): Promise<CompileJob>;
  get(actorId: Id, id: Id): Promise<CompileJob>;
  cancel(actorId: Id, id: Id): Promise<void>;
}
interface AiProvider {
  invoke(input: { mode: "ask" | "agent"; prompt: string;
    files: { id: Id; path: string; text: string }[];
    images: { mime: "image/png" | "image/jpeg"; bytes: Uint8Array }[];
    signal: AbortSignal }): Promise<{ text: string; edits: ProposedEdit[];
      sources: Publication[]; providerRequestId: string }>;
}
interface ExternalAdapter {
  capabilities(): Record<string, Capability>;
  test(grantId: Id): Promise<{ ok: boolean; reason?: string }>;
  execute(input: { action: string; grantId: Id; projectId?: Id;
    expectedCursor: string | null; key: string }): Promise<Operation>;
}
interface Clock { now(): Instant; }
interface BlobStore {
  put(bytes: Uint8Array): Promise<Digest>;
  get(hash: Digest): Promise<Uint8Array>;
}
```

`ExternalAdapter` is the scheduler boundary, not permission to omit provider-specific typed requests: X registers each action schema in the shared registry with F. Snapshot file bytes are retrieved by `FileEntry.blob` from `BlobStore`, not a mutable filesystem path. The database `UnitOfWork` offers synchronous local transactions and async PostgreSQL transactions through a common async callback; no network await inside a SQLite transaction. Outbox creation, aggregate version and access changes commit together.

## 4. Data model, concurrency and authority

Schema domains, with UUID PKs, foreign keys, timestamps, migrations and relevant unique keys:

* Identity: users, verified_emails, identities (`issuer,subject` unique), sessions (hashed token), one_time_tokens (hashed, purpose, expiry, used), organizations, members, invitations, managed_acceptances, institutional_eligibility, preferences.
* Projects: projects (exactly one owner), branch_workspaces, files (stable ID, unique live `branch,path`), blobs, document_states, document_updates (`docId,clientId,clientSeq` unique), snapshots, snapshot_files, project_user_state (archive/trash per user), tags and assignments.
* Review/history: threads, comments, permanent_comment_tombstones, suggestions, suggestion_edits, history_versions, version_labels, chat_messages, access_requests, share_tokens (hashed secret, role, revocation version).
* Git: repositories, git_intents, branch_heads, user_staging, remote_bindings; real objects under `data/git/<projectId>.git`. Metadata stays outside user repository/source ZIP.
* Work: compile_jobs, artifacts, diagnostics, worker_leases, operations, linked_files, provider_grants (encrypted), adapter_cursors, library_entries, templates/template_versions, ai_runs, ai_usage, notifications, mail_outbox, events/outbox.
* Governance: policy_sets, billing_accounts, subscriptions, invoices, webhook_receipts (provider/event unique), audit_entries, backups, releases, maintenance_jobs.

All file paths are normalized project-relative POSIX paths; reject absolute paths, `..`, NUL, reserved `.git`, duplicate normalized entries, links/device files and zip bombs before an atomic import. Preserve uploaded ordinary binary bytes. Zip source limits apply to expanded contents, not only compressed size. External fetches prohibit loopback/private/link-local/cloud-metadata addresses, validate DNS and every redirect, cap bytes and time; operator-approved private adapters use separate allowlisted connection configuration, never arbitrary user URL access.

**Save/convergence.** One logical writer per project branch serializes permission checks and state changes. Clients open `/api/projects/:p/realtime?branch=:b`, same-origin cookie/CSRF handshake, and send `{type:"sync",fileId,epoch,stateVectorBase64}` or `{type:"update",fileId,epoch,clientId,clientSeq,updateBase64}`. Server validates update size/schema by applying it to an isolated copy with only the authorized file's Y.Text, checks post-update limits, then atomically stores update/materialized text/revision/outbox. Only after commit emit `{type:"ack",clientId,clientSeq,revision}` and broadcast `{type:"update",fileId,epoch,revision,updateBase64}`. Duplicate sequence returns original ack. Read-only users can sync, never update. Presence `{type:"presence",fileId,cursor,name}` is server-attributed, rate-limited, nonpersistent. Epoch mismatch returns `409 EPOCH_CHANGED` plus a conflict recovery document, not silent overwrite.

Event subscribers use `/api/events?after=<seq>` SSE, authorized topic filtering and Last-Event-ID replay. Event payloads are typed variants: `document.saved`, `tree.changed`, `access.changed`, `review.changed`, `history.created`, `git.changed`, `job.changed`, `operation.changed`, `notification.created`, `policy.changed`. Payload carries only resource ID/version/status; clients refetch authorized DTOs. Revocation closes sockets, terminates subscriptions and cancels unstarted privileged jobs. In scale mode PostgreSQL persists source/outbox, Redis broadcasts invalidations, and branch leases fence stale writers with a monotonically increasing token.

**Review.** Viewer: read/download/copy; named Viewer may chat. Reviewer: comments and suggestions only. Editor: source/files, chat, accept/reject, history restore, Git push. Owner additionally shares/transfers/deletes/configures linked bibliography. Anonymous Viewer cannot comment/chat. Editor link requires authenticated identity and counts once toward writable capacity; Reviewer links are not offered. Only comment author edits/deletes their comment; Owner/Editor resolve/reopen/delete resolved threads. Tombstones prohibit resurrection through history restore. Suggestions match relative anchor **and** exact `before`; divergence becomes `conflict`. Accept selected edits atomically, without applying unselected edits; AI undo is a new checked inverse edit, not rewind of collaborators.

**Git/working copy.** Browser saves are durable working state, not one commit per keystroke. Snapshot creation writes Git blobs/tree and a hidden checkpoint commit under `refs/quire/history`; ordinary bridge clients cannot enumerate/fetch hidden refs. Named commits update `refs/heads/<branch>`. Stage operations retain per-user base HEAD and exact before/after hunk; commit creates HEAD plus staged patches, leaving unstaged working edits intact. Head/working revision mismatch rejects with `409`, never discards remote edits. Commit-before-build compiles the **staged tree** and commits only that same tree after success. Branch switching is per user; each branch has independent persistent working documents. Dirty/actively edited branches cannot be deleted. Merge/pull uses three-way merge and explicit conflicts, materializes through the project transaction/epoch boundary. Git imports preserve supported full history/branches; reject submodules/LFS/symlinks with actionable errors rather than losing them silently.

Git and SQL cannot share a transaction: write an idempotent durable intent containing expected ref, new ref/tree and source snapshot, create objects, CAS the ref, finalize SQL/outbox. Recovery inspects refs and finishes or marks conflicted before allowing another branch mutation. Repository serving/compile snapshots only expose finalized intents. Smart HTTP authenticates before invoking `git-http-backend`; disable dumb object access and hide internal refs. Receive-pack validates size/tree/branch permissions in quarantine, serializes accepted pushes through the same intent journal, and refuses pushes to dirty browser branches with fetch/reconcile guidance. No arbitrary hooks from imported repositories run.

**History/copy/refresh.** Checkpoint on explicit save boundary, compile, named commit, restore and disconnect; bounded background checkpoint scheduling may coalesce edits, but never replaces durable update persistence. Timeline revision uses immutable snapshot plus review metadata snapshot. Restore creates a new revision/epoch and preserves unrelated files for file-only restore. Copy applies pending tracked edits to copied source, drops review/chat/ACL/tag/history metadata, selects latest installed stable environment. Linked refresh stores expected child/source digests, authorizes both projects, updates atomically or reports conflict; parent rename uses stable file ID, deletion reports `SOURCE_MISSING`, never clears child bytes.

## 5. HTTP endpoint registry

Prefix `/api`. `p` denotes project ID; project branch is required as `?branch=` for reads and `scope` in mutations. All mutation bodies include `expectedVersion` when changing an existing resource. Send `Idempotency-Key` for creates, jobs, external operations, accept/restore/transfer/billing actions; retries return the stored result. `If-Match` is required for direct binary/metadata replacement. Lists use `cursor,limit` (default 50, max 200). Errors: 400 invalid input, 401 unauthenticated, 403 denied, 404 inaccessible/missing, 409 stale/conflict, 413 limit, 422 unsupported content, 429 budget/rate, 503 unavailable provider/worker. Long work returns `202 {data: Operation|CompileJob}`; poll or subscribe, never pretend synchronous success.

Contract notation: `GET/POST /path -> result`; braces name required JSON fields, `?` optional. Standard CRUD means list/get/create/patch/delete with typed fields shown, never an unspecified permission policy. Every unannotated resource GET/POST/PATCH returns its domain DTO (`Page<DTO>` for lists); DELETE/action-without-result returns `{ok:true,version:number}`. `GET /operations/:id -> Operation` is universal. Organization/project metrics return `{from,to,activeUsers,activeProjects,compileCount,compileMs,storageBytes,aiUses}` from stored events, not illustrative numbers. F translates this registry to executable schemas in P0.

| Domain | Exact routes and request/result contract | Authority |
| --- | --- | --- |
| Session | `POST /auth/register {name,email,password} -> {verificationRequired}`; `POST /auth/verify-email {token}`; `POST /auth/login {email,password} -> User`; `POST /auth/logout`; `GET /me -> {user,preferences,capabilities,csrfToken}` | Public identity workflows; login only primary email, verified secondaries match invitations. Rate-limit without account enumeration. |
| Recovery/identity | `POST /auth/password-reset {email}`; `POST /auth/password-reset/confirm {token,password}`; `GET /me/sessions`; `DELETE /me/sessions/:id`; `POST /me/sessions/revoke-others`; `GET /auth/:provider/start?returnTo=`; `GET /auth/:provider/callback`; `POST /me/identities/:provider/link`; `DELETE /me/identities/:id` | Reset single-use/expiry; identity link requires fresh authenticated session; never unlink final login route. SAML POST callback separate `/auth/saml/acs`. |
| Profile | `PATCH /me {name,latexName,affiliation,orcid,interfaceLanguage}`; `PUT/DELETE /me/avatar` multipart; `GET/PATCH /me/preferences -> Preferences`; `POST/DELETE /me/emails {email|id}`; `POST /me/ai-consent {termsVersion,accepted}`; `POST /me/export -> Operation`; `DELETE /me {confirmation,password?,reassignment?}` | Managed account restrictions enforced; deletion confirmation and fresh auth. Source archive not falsely labeled full account recovery. |
| Projects | `GET /projects?q=&owner=me|shared|all&state=active|archived|trash&tag=&sort=updated|title|owner&direction=`; `POST /projects {name,workspaceId?,origin:{kind:"blank"|"example"|"template",templateVersionId?}} -> Project`; `GET/PATCH /projects/:p {name?,settings?}`; `POST /projects/:p/copy {name} -> Project` | Search case-folded title/owner, stable ID tie-break, updated-desc default; own dashboard state separate. Creation needs verified user. |
| Lifecycle/tags | `POST /projects/bulk {ids,action:"archive"|"trash"|"restore"|"download"} -> Operation`; `POST /projects/:p/leave`; `POST /projects/:p/transfer {newOwnerId,expectedVersion}`; `DELETE /projects/:p {confirmation}`; CRUD `/tags {name,colorHex}`; `PUT /projects/:p/tags {tagIds}` | Preflight every selected ID; atomic dashboard changes, download manifest failures explicit. Owner permanent delete invalidates all access; trash is per user. |
| Files | `GET /projects/:p/files -> FileEntry[]`; `POST /projects/:p/files {scope,path,kind,text?}`; `GET /projects/:p/files/:f/content -> bytes`; `GET .../:f/document -> TextDocument`; `PATCH .../:f {scope,path}`; `DELETE .../:f {scope}`; `POST /projects/:p/uploads` multipart `{scope,files,paths}` | Editor/Owner mutations; raw editable replacements enter collaboration via checked transaction, not separate stale text writes. |
| Links/import/export | `POST /projects/:p/links {scope,path,kind,sourceProjectId?,sourceFileId?,url?,grantId?}`; `POST .../links/:id/refresh {expectedDigest}`; `POST /imports` multipart/JSON `{kind:"zip"|"docx"|"markdown"|"git"|"github"|"open-in",name,workspaceId?,source}` -> Operation`; `POST /projects/:p/exports {snapshotId?,kind:"source"|"submission"|"docx"|"markdown"|"html"} -> Operation`; `GET /operations/:id/download` | Source union: upload ID, snippet, validated data URL, URL, or `{url,branch,grantId?}`. Directly linked `.tex` cannot be main. Downloads reauthorize. |
| Search | `GET /projects/:p/search?q=&case=&regex=&word= -> {matches:{fileId,line,column,preview}[],excluded:{fileId,reason}[]}` | Read permission; regex complexity/time limit. Current-file selection replacement is editor/Yjs local action with server save authorization. |
| Templates | CRUD `/templates {name,category,description,license,visibility,sourceProjectId}`; `POST /templates/:id/versions {snapshotId}`; `POST .../:id/submit`; `POST .../:id/approve {versionId}`; `POST .../:id/publish {versionId,workspaceId?}`; `POST .../:id/unpublish` | Author submits; curator approves; template-publisher or operator publishes; private access obeys organization. Copies pin approved version. |
| Sharing | `GET /projects/:p/access -> {members,invitations,requests,link}`; `POST .../invitations {email,role}`; `POST /invitations/:id/accept {token}`; `POST .../invitations/:id/resend`; `DELETE .../invitations/:id`; `PATCH .../members/:id {role}`; `DELETE .../members/:id`; `PUT .../link {role:"off"|"viewer"|"editor"}` -> `{urlOnce?}` | Owner; tokens hashed/revocable, named roles survive link revoke. Membership/seat limits serialize transactionally. |
| Access requests | `POST /projects/:p/access-requests {role:"reviewer"|"editor",message}`; `POST .../access-requests/:id/decide {accept}` | Current lesser role requests; only Owner decides; request grants nothing. |
| Review/chat | CRUD `/projects/:p/threads {scope,anchor?,body}`; `POST .../threads/:t/replies {body}`; `PATCH/DELETE .../comments/:id {body?}`; `POST .../threads/:t/state {resolved}`; `POST .../suggestions {scope,edits}`; `POST .../suggestions/decide {ids,editIds?,decision:"accept"|"reject"}`; `GET/POST .../chat {scope,body}` | Roles as section 4; author/comment/thread authority distinct. `GET` review lists accepts `fileId,status` filters. |
| History | `GET /projects/:p/history?branch=&labelsOnly=`; `POST .../history/:id/labels {name}`; `DELETE .../history/:id/labels/:labelId`; `GET .../history/compare?from=&to=&fileId= -> {files,hunks,authors}`; `POST .../history/:id/restore {scope,fileIds?}`; `GET .../history/:id/source.zip` | Read history policy on every route; restore Editor/Owner; access window never deletes physical history. |
| Compile | `GET /environments -> Environment[]`; `POST /projects/:p/compiles CompileRequest -> CompileJob`; `GET /compiles/:id`; `POST /compiles/:id/cancel`; `GET /compiles/:id/log`; `GET /artifacts/:id/content`; `DELETE /projects/:p/compile-cache {scope}` | Read actors may inspect existing outputs; Editor/Owner launch/cancel/cache mutation. Immutable snapshot pin; no artifact from another project. |
| Navigation/diff | `POST /compiles/:id/synctex {direction:"forward",fileId,line,column}` -> `{page,xPt,yPt,widthPt,heightPt}[]`; reverse `{direction:"reverse",page,xPt,yPt}` -> `{fileId,line,column}[]`; `POST /projects/:p/pdf-diffs {fromSnapshotId,toSnapshotId,mode:"side-by-side"|"overlay"} -> Operation` | Job-specific mappings; PDF points origin top-left after adapter conversion. Diff returns real changed-page rectangles, artifact and source revisions. |
| Git | `GET /projects/:p/git/status?branch= -> {head,ahead,behind,files,hunks,staged}`; `GET .../git/log`; `GET .../git/branches`; `POST .../git/branches {name,from}`; `DELETE .../git/branches/:name`; `PUT .../git/stage {scope,head,hunkIds,staged}`; `POST .../git/discard {scope,head,hunkIds}`; `POST .../git/commit {scope,head,message,compileFirst}`; `POST .../git/merge {scope,from,head}` | Editor/Owner, optimistic HEAD/working state checks; conflicts return hunks and manual resolution operation. Branch route segment URI-encoded. |
| Git access | `GET/POST /me/git-tokens {name,expiresAt}` -> `{id,secretOnce}`; `DELETE /me/git-tokens/:id`; CRUD `/me/ssh-keys {name,publicKey}`; `/git/:p.git/*` smart HTTP, username `git`, per-user token | Tokens max 10, max one year, hashed, current ACL on every request; bridge read Viewer/Reviewer, push Editor/Owner. SSH same ACL; never shell access. |
| References | CRUD `/me/library {bibtex,origin,providerId?}`; `POST /me/library/doi {doi}`; `POST /me/library/import` multipart `.bib`; `GET /references/search?projectId=&query=&provider=&fields=`; `POST /projects/:p/citations {scope,publication,targetFileId?,command:"cite"|"citet"|"citep"}` | Zero editable `.bib`: create `references.bib`; one: use it; several: 409 `TARGET_REQUIRED`. Read-only linked entries reject local editing. Cite copies records, no back-sync. |
| Connections | `GET /connections`; `POST /connections/:provider/start {returnTo}`; `GET /connections/:provider/callback`; `POST /connections/:id/test`; `DELETE /connections/:id`; `POST /connections/:id/actions {action,projectId?,parameters,expectedCursor?} -> Operation` | User-owned grant; explicit external-write confirmation in UI. Actions enumerated in section 7, validated per provider. No success for missing auth. |
| AI | `POST /projects/:p/ai/runs {scope,mode,tool,prompt,fileIds,selection?,diagnosticId?,imageUploadIds?,conversationId?}` -> AiRun`; `GET /ai/runs/:id`; `POST /ai/runs/:id/cancel`; `POST /ai/runs/:id/decide {editIds,decision,commit?,newBranch?}`; `POST /ai/runs/:id/undo {editIds}`; `DELETE /projects/:p/ai/conversations/:id` | User+project+organization policy/consent/budget before context lookup and call. Agent cannot execute shell/tools outside allowlisted read/search/propose services. Acceptance follows same role/edit checks. |
| Notifications | `GET /notifications`; `POST /notifications/:id/read`; `PATCH /me/notification-preferences {events,channels,projectOverrides}` | In-app and mail preferences separate; transactional outbox, deduped digests, injected clock. |
| Organizations | CRUD `/organizations {name,kind,domains}`; `GET/POST/PATCH/DELETE .../:o/members {userId?,email?,role,licensed}`; `GET .../:o/members.csv`; `GET/PATCH .../:o/policy`; `GET .../:o/metrics`; `GET .../:o/audit`; `POST .../:o/audit/export` | Admin/Manager/member independent of project role/seat. Manager membership/metrics only; Admin billing/policy; no ordinary institution content ownership. |
| Institution/managed | `GET /institutions/:slug`; `POST .../:slug/enroll`; `POST /organizations/:o/managed/invite {userId}`; `POST /managed/:id/accept`; `POST .../:o/managed/:u/release`; `POST .../:o/managed/:u/delete {transferTo}` | Verified domain/SSO claims; explicit managed acceptance; no ownerless projects. Release preserves projects, delete reassigns first. |
| Billing | `GET /billing/catalog`; `GET /organizations/:o/billing`; `POST .../billing/preview {planId,seats,period}`; `POST .../billing/checkout {quoteId}`; `PATCH .../billing/details {invoiceEmail,taxId,address}`; `POST .../billing/cancel {atPeriodEnd}`; `GET .../billing/invoices/:id/download`; `POST /webhooks/billing/:provider` | Fresh auth + Admin; signed/idempotent webhook; selected provider or manual invoicing. Local unbilled edition reports no active paid subscription. |
| Admin identity | `GET/PUT /admin/identity IdentityConfig`; `POST /admin/identity/test {draftConfig,nonce}`; `GET /admin/identity/metadata.xml`; `POST /admin/scim/token`; `/scim/v2/{Users,Groups}` GET/POST/PATCH/DELETE | Operator only; SCIM bearer token separate from browser session. Test completes real handshake, not toggle. Group mapping includes role and AI ceiling. |
| Admin operations | `GET /admin/overview`; `GET/PATCH /admin/users/:u`; `POST /admin/users/invite`; `POST /admin/users/:u/transfer {projectId,to}`; `POST /admin/users/:u/revoke-sessions`; `POST /admin/users/:u/restore`; `GET /admin/projects?url=`; `POST /admin/editor-state {closed,message}` | Operator-only disclosed access; managed org admin limited to managed domain. Close propagates read-only state to open clients. |
| Workers/environments | `GET/POST /admin/workers {poolId,count}`; `PATCH .../workers/policy {min,max,timeoutSeconds,sandbox}`; `POST .../workers/:id/drain`; `DELETE .../workers/:id`; `GET/POST /admin/environments {manifest}`; `POST .../environments/:id/default`; `POST .../environments/:id/retire`; `POST .../environments/build {baseId,packageList,fontUploads,mirror}` | Worker creation is local process pool/registered cluster action, never fabricated row. Retirement blocked while pinned. Dangerous unbounded timeout/shared unsandboxed options are absent, with rationale. |
| Providers/audit | `GET/PUT /admin/providers/:kind {baseUrl,model,secret?,policy}`; `POST .../providers/:kind/test`; `GET /admin/audit?event=&from=&to=`; `POST /admin/audit/export`; `PUT /admin/audit/siem {endpoint,secret?,enabled}` | Redacted reads, encrypted grants, audit on changes; no prompt text logging by default. Operator may enable disclosed prompt retention policy. |
| Backup/update/support | `GET/PUT /admin/backups/policy {schedule,retentionDays,destination}`; `POST /admin/backups`; `GET /admin/backups`; `POST .../backups/:id/verify`; `POST .../backups/:id/restore {target,confirmation}`; `GET /admin/releases`; `POST /admin/updates {releaseId,at,autoSecurity}`; `POST /admin/diagnostics`; `POST /support/inquiries {name,email,organization,users,runtime,airGapped,message}` | Operations return jobs; restore isolated target first, live restore requires maintenance and explicit confirmation. Support form queues mail only with configured recipient; otherwise gives truthful contact/export path. |

## 6. Compiler and worker boundary

Worker leases an immutable `{jobId,snapshotId,environmentId,settings,limits,attempt,fencingToken}`. Internal bearer-auth routes are `POST /internal/workers/lease {workerId,environmentIds} -> {lease|null}`, `POST /internal/jobs/:id/heartbeat {attempt,fencingToken}`, `GET /internal/jobs/:id/source.zip`, `PUT /internal/jobs/:id/artifacts/:name` (bytes plus digest), and `POST /internal/jobs/:id/complete {attempt,fencingToken,status,diagnostics,artifactIds,elapsedMs,failureCode}`. Lease expires after 30 seconds without heartbeat, worker sends every 10 seconds; these are production lease timers, not test sleeps. Job-specific capability headers protect download/upload routes; network binding is loopback or authenticated worker network, never public browser access. Only the API accesses user credentials/database. Duplicate completions are idempotent. Crash recovery marks running attempt lost and requeues only immutable compile work, never blindly retries external writes. Artifacts are immutable and linked to job/snapshot; canceled/failed jobs cannot replace `lastSuccessfulPdf`.

Materialize sanitized snapshot into a fresh private workspace. Sandbox root contains an explicitly constructed read-only TeX/runtime tree, selected font/config files, no host home/repository/secrets, a private `/proc`, minimal `/dev`, tmpfs `/tmp`, read-only `/src`, writable bounded `/work`; no host socket or network. Use unshared user/PID/network/IPC namespaces, drop capabilities, new session and kill-with-parent. CPU/memory/process/disk controls must be verified for the entire process tree (delegated cgroup v2; alternatively isolated Docker with `--network=none`, read-only root, dropped caps, no-new-privileges and explicit limits). bwrap without verified containment is not a passing doctor result. Never mount `/` or host `/tmp`. Fail closed with actionable setup when neither backend is usable.

Run `latexmk` with explicit engine, recorder/SyncTeX, noninteractive flags, job output directory and normalized project main. Capture stdout/stderr to bounded full log, parse file stack and line references, preserve raw offsets. Continue-on-error may yield a partial artifact, labeled partial; only a validated successful PDF becomes latest successful preview. DVI uses actual conversion to PDF; both artifacts retained. Validate PDF magic/page readability, not exit code alone.

Project `latexmkrc` executes **inside** the same sandbox after system configuration; it is executable Perl, not safe configuration parsing. Default TeX `-no-shell-escape`; custom rules can call only the isolated installed tools. Restricted helper profile enables verified minted/TikZ externalization commands inside isolation, never host PATH. R/knitr is an installed extension profile built by O with explicit package manifest; conversion uses installed Pandoc in isolated job execution. Missing local Pandoc/R is an installation task, not a reason to omit the implementation. Python runner is opt-in browser Pyodide in a dedicated Web Worker with termination and explicit “save generated files” permissions; not a server execution API.

Environment manifest: `{id,label,release,backend,rootOrImageDigest,engines,helpers,packagesDigest,experimental,available,probeAt}`. Only a successful actual probe marks available. Native TL2025 does not become TL2026 because a design label says so. Cache key covers source tree/settings/environment digest; clear deletes only generated job cache. SyncTeX paths are remapped through file IDs and output coordinates normalized. PDF comparison compiles both selected snapshots, renders actual pages to equal-resolution bitmaps, returns visual regions and generated side-by-side/overlay PDF; never invent semantic change confidence. Reflow-only label requires source/text comparison evidence, otherwise “visual difference”.

## 7. Adapter, governance and UI decisions

**Adapter action enums.** GitHub/GitLab: `listRepositories,import,exportNew,pull,push,disconnect`; generic Git: `clone,fetch,push`. GitHub linkage is new-project import or new-repository export, not silent linking to arbitrary existing projects. Remote conflict creates an explicit conflict branch and never overwrites either side. Dropbox: `initialSync,sync,disconnect`, app folder `Apps/Quire`, cursor/change journal and conflict copies, archived projects outbound-only, generated output opt-in and separately labeled. Zotero: `librarySync,bulkBib,refresh`; Mendeley/ReadCube: `bulkBib,search,refresh`. Bulk `.bib` read-only/owner refresh; individual imports editable; collection Library sync separate, default manual plus configurable 15-minute background schedule with provider backoff. DOI: `lookup`; Crossref/arXiv/Semantic Scholar/Dimensions: `search` returning provenance-bearing `Publication`. Publisher: `prepare,submit,status`, explicit confirmation and provider receipt mandatory for submitted state. Billing: `quote,checkout,cancel,invoices` with verified webhook reconciliation. SMTP/local mail sink: `send`.

Secrets reside encrypted server-side under an operator key (`QUIRE_SECRET_KEY`); hashes for Quire sessions/tokens; never log/provider-export source ZIPs containing credentials. OAuth state/PKCE and redirect allowlists, minimum provider scopes and revocation must be implemented against chosen current official provider docs. ReadCube/Dimensions/direct publisher access lacking an available public contract stays `unconfigured` with exact procurement prerequisite, not generic “coming soon”; adapter contract and UI are still implemented.

**AI specifics.** Tools: contextual chat, TeXGPT, error fix, table/equation prompt/image generation, grammar/fluency, paraphrase, concise/scientific, split/join, synonyms, title/abstract drafting, translate, inline completion and citation reviewer. Do not restore retired standalone Summarize/Explain tools as claimed research parity; explaining a compile log within ordinary chat remains valid reference UI. PNG/JPEG at most 10 MiB, reject unsupported modality before charge. Model response must pass schema/path/base-text validation. Returned citation is unverified unless tied to retrieval provider ID. Citation Reviewer can use configured Dimensions or an explicitly labeled alternative, never silently label ordinary LLM invention “Dimensions verified”.

Budget: one shared atomic daily reservation per admitted invocation; UTC-midnight reset, operator-configurable daily limit (default 50 with configured provider), refunded only for failure before provider dispatch. Regeneration is another invocation; accepting already-generated patches is not another charge. Monthly counter is reporting, not a conflicting reset. Organization/user/project deny wins, confidential-tag block is a project security label (not user-private dashboard tag). Recheck before dispatch and patch acceptance; disable cancels queued/in-flight calls where possible and discards late results. Context max 256 KiB, chosen files/selection/log excerpts shown before send; no implicit unrestricted repository traversal.

Default chat is session-local; “share assistant with collaborators” explicitly creates project-persistent conversations with current ACL, delete/clear controls and configured retention. Agent runs/proposals persist for audit/history independently. `ai/<task>` branch option is a real branch with proposed patches; accept and optional commit use K services, not provider direct writes. Read-only mode never returns auto-applied source. Inline completions are opt-in and flow through the same budget/consent policy.

**Identity/governance.** Passwords hashed with Argon2id via Bun password API, HttpOnly SameSite cookies, CSRF/origin checks, session rotation, configurable secure cookie/TLS in deployment. OAuth Google/GitHub/ORCID; SAML SP-initiated with signed response **and** signed assertion, pinned issuer/audience/destination/expiry/InResponseTo/replay cache, overlapping trusted certificate rotation; OIDC authorization code/PKCE with nonce/discovery validation; LDAP TLS with allowlisted directory. Document chosen SAML strictness as Quire policy. SCIM is a deliberate design requirement beyond the research: bearer-auth Users/Groups provisioning, pagination/filter/ETag, idempotent externalId, deactivate without accidental project deletion, configured transfer target; do not assume IdP removal without SCIM deprovisions anyone.

Keep one explicitly enrolled break-glass operator with a password when SSO enforced. Group mappings apply least privilege, AI ceiling and independent licensing. Ordinary institutional self-enrollment never grants managed ownership. Managed state transitions `invited -> accepted -> released | suspended -> soft_deleted -> deleted` are distinct; configurable lapse/soft-delete defaults 60/90 days only in the managed lifecycle. Release preserves content and enables independent recovery before SSO unlink. Account deletion executes reassignment before principal removal. Sharing policy changes prospective by default; explicit retroactive enforcement is a separate audited action. AI/security disables are immediate.

**Visual/editor.** Use exact supplied tokens/type/inline SVG paths and dense geometry from design report. Replace simulated source/PDF with CodeMirror and PDF.js; populate the seeded Latent Dynamics Note, named authors and genuine undefined `ha2018world` warning. Show actual environment/time/page/save/Git counts. Source/Split/Visual/PDF modes; fifth layout is vertically stacked Source+PDF. Persist split sizes per user. Visual editing uses a lossless interval parser for paragraphs, headings, bold/italic, lists, inline/display math, citations/references, simple tabular, figures and include placeholders; unknown constructs remain editable source islands. Commands modify source ranges, never regenerate the whole document and lose unknown macros.

Autocomplete includes maintained commands/environments, project `\\label` references and citation keys; current-file outline intentionally excludes expansion/includes. Spell checker uses bundled dictionaries plus per-user custom words, separate from language/model. Provide en/vi/zh UI catalogs with English fallback and visibly tested locale selectors. Theme Light/Dark/System is required by D16 even though only light visual tokens were supplied; derive accessible dark tokens without altering light reference. Vim/Emacs are scoped emulation. Symbols expose package requirements; table TSV paste/formatting and single-image PNG paste operate in both source/visual workflows.

Desktop reference at 1440px: 56px header, 52px rail, ~236px tree, dual ~340px-min panes, ~320px assistant. At <1024px collapse secondary panels to drawers; at <768px show one workspace pane selected by accessible tabs, assistant/fullscreen sheets, wrapped toolbar, scrollable tables, never fixed 816px mobile heights. Dialog focus trap/Escape/focus return, visible focus, labelled icon buttons, keyboard equivalents for splitters/actions, live save/compile notifications and reduced motion. Do not claim PDF accessibility from compiling; tagged fixtures and external validator/human review are separate acceptance.

All 23 screen routes: `/projects/:p/edit`, `/projects/:p/git`, `/projects/:p/agent`, `/projects/:p/history`, `/settings/billing`, editor tools drawer, `/projects`, `/sign-in`, `/pricing`, `/projects/:p/review`, `/projects/:p/logs`, `/admin/identity`, `/projects/:p/pdf-diff`, `/sign-up`, `/`, `/settings/:tab`, `/self-hosting`, `/admin`, `/admin/architecture`, share dialog, new-project dialog, `/admin/:section`, `/reset-password`. Marketing links lead to implemented routes/docs/configured contact, not `.dc.html` or fictional hosted download domains.

## 8. Phase DAG and exit gates

`P0 -> {P1C,P1K,P1A,P1V}; P1K+P1A -> P2X; P1V -> P2U; P1C+P1K+P1A -> P2O; all P1/P2 -> P3 -> P4`.

| Phase | Owners / implementation increment | Required observable exit |
| --- | --- | --- |
| P0 Foundation | F; create manifests, contracts/validators/client, migrations/ports, router injection, harness, seed, dev runner. V supplies token/primitives contract early within its own paths. | `bun install`, `bun run typecheck`, `bun run dev` work on Bun 1.3.14; 5173 serves real shell; seed persists users/example; contract tests compile all request/response types. Empty features are not marked accepted. Hand parallel lanes the frozen exports and test fixtures now. |
| P1C Compiler | C; isolation/actual compile/artifacts/log/SyncTeX/cache/PDF diff/toolchain profile. | T07-T10/T18 use real tools, including security probes, error/stale PDF and bibliography. |
| P1K Core | K; projects/tree/uploads/templates/ACL/realtime/review/history/library/Git bridge. | T02-T06/T11-T13 with persistent restart and two users; local Git clone/push and actual staged commit, not JSON fake history. |
| P1A Accounts | A; local auth/mail sink/settings/org/policy/notifications/audit/billing model/institution/managed lifecycle. | T01/T14/T15 with direct authorization tests, clock-controlled boundaries and independent sessions. |
| P1V Product UI | V; primitives + 07-09/12/14-19/21-23 and all hidden panels. | Real typed API bindings, errors/loading/accessibility; local operation routes useful before external configuration. Handoff primitives to U as soon as exported. |
| P2X Adapters | X; all section 7 adapters, AI proposal system, conversion/federation/provider configuration. | T16-T19/T22 contract fixtures plus available real authorized providers; every unavailable live provider has an exact external prerequisite, not a stub implementation. |
| P2U Editor UI | U; 01-04/06/10-11/13/20 with CodeMirror, PDF.js, visual editing, Git/review/AI. | T03/T05-T13/T17/T20 against real API, workers and browser; all reference actions wired. |
| P2O Operations | O; Linux installer/doctor, isolated images (including Pandoc/R), Compose, Helm/scale storage/leases, backup/update/SSH/SIEM/health. | T18/T21/T22 in local and isolated scale profiles. Actual local runtime stays dependency-light; Docker image preparation explicit. No fake cloud resource creation. |
| P3 Integration | F with narrow owner fixes; unify routes/settings/policy, build production assets, source/export migration, complete feature matrix evidence. | Full commands below pass once; no route/button stub, no unhandled permission bypass, native startup/seed/compile and restart verified. |
| P4 Browser/release QA | Lead personally; F records evidence, owners fix their paths. | All 23 screens and alternate states at desktop/mobile, multi-user/reconnect, real PDF download/diff, setup from clean data. Missing external live checks explicitly recorded, all native targets complete. |

## 9. Runnable verification contract

The foundation must provide these scripts and test paths; commands below are the acceptance interface to implement, not claims that scripts exist today.

```sh
bun install
bun run doctor
bun run db:migrate
bun run seed
bun run dev                         # UI http://localhost:5173
bun run typecheck
bun test tests/contract tests/core tests/accounts
bun test tests/compiler tests/adapters tests/operations
bun test tests/integration
bun run test:e2e                    # browser harness starts isolated app/worker
bun run build
bun run verify:matrix               # each matrix ID has evidence or external prerequisite
bun run ops:restore-drill -- --fixture complete
bun run test:scale                  # owned Compose PostgreSQL/Redis/S3 + two API processes
```

`doctor` reports runtime/tools, sandbox/resource probes, configured environments and optional providers separately. The app starts with no supplied secrets: SQLite/disk, bundled templates/dictionaries/fonts, local mailbox, AI/integrations clearly unconfigured. Local setup generates/persists its encryption key in an owner-only file if `QUIRE_SECRET_KEY` is absent; production requires explicit protected key configuration. `seed` is idempotent and creates owner Kien, editor Mai, reviewer Sam, viewer Alex, outsider, operator, two organizations and a real example repository. Local credentials are generated/displayed once by seed or supplied via `QUIRE_SEED_PASSWORD`, never committed or enabled on non-loopback production. Core configuration: `QUIRE_DATA_DIR`, `QUIRE_PUBLIC_URL`, `QUIRE_SECRET_KEY`, `QUIRE_PROFILE=local|scale`, `QUIRE_COMPILER_BACKEND=bwrap|docker`; optional scale `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_BUCKET`, protected S3 credentials. `bun run dev` supervises its children and exits without orphans. `test:e2e` includes `tests/ui-editor`, `tests/ui-product` and `tests/e2e`; browser tests must not silently sit outside the runnable suite.

| Suite | Test path / scenario and decisive observable |
| --- | --- |
| T01 Identity | `tests/accounts/identity.test.ts`: register/verify through local mail sink, primary versus secondary login, reset expiry/reuse, session revoke, linked identity collision, managed restrictions; HTTP status and surviving project ownership asserted. |
| T02 Persistence/projects | `tests/core/projects.test.ts`: all creation/copy/template/tag/archive/trash/leave/delete/bulk/search variants; restart API with same data directory and compare file bytes, ACL, tags, Git refs and metadata. |
| T03 Authoring | `tests/ui-editor/authoring.spec.ts`: source edit/ack/reopen, commands/theme/bindings/shortcuts/font/outline/find filters, project exclusions, visual supported/unknown round trip, symbols/tables/figures/clipboard, dictionaries/locales and Unicode. Assert source bytes as well as visible controls. |
| T04 Files/interchange | `tests/core/files.test.ts`: nested ZIP and folder uploads, hostile paths/limits/binary preservation, parent/URL link manual refresh/conflict/deletion, source versus generated ZIP manifests, open-in input forms. Conversion fixtures belong T16. |
| T05 Collaboration/access | `tests/integration/collaboration.test.ts`: two subscribed clients concurrent overlap/reordered duplicates, durable ack then restart, reconnect offline buffer and epoch conflict, every role mutation/read/download/WS matrix, token revoke on live socket, quota races. |
| T06 Review/history | `tests/integration/review-history.test.ts`: anchored comments across edits, mention/reply/resolve/delete, selected accept/reject/conflict, restore file/project and deleted file, irreversible comment tombstone, labels/history window/copy metadata exclusion. |
| T07 Actual compile | `tests/compiler/engines.test.ts`: each real engine; valid PDF/DVI, `pdftotext` content, local class/style/font, Unicode, BibTeX and Biber resolved citations/`.bbl`, installed environment pins and reversible switches. |
| T08 Compile lifecycle | `tests/compiler/jobs.test.ts`: subscribe before enqueue, immutable snapshot while source changes, auto/manual/draft/first-error/cache cancel/timeouts/crash lease, actual log navigation and old-PDF label. Inject clock for scheduling; one actual bounded runaway process proves cleanup. |
| T09 PDF/navigation | `tests/ui-editor/pdf.spec.ts`: real PDF.js page/zoom/presentation/browser-view/layouts; forward/reverse SyncTeX known text; source search not misrepresented as PDF search. |
| T10 Rendered diff | `tests/compiler/pdf-diff.test.ts`: two snapshots with changed number and moved paragraph; page images/regions and downloaded PDF are real; identical PDFs yield empty changes. |
| T11 Git | `tests/integration/git.test.ts`: disposable real CLI clone/fetch/push with user token, revoke, hidden refs denied, stage/discard hunk and unstaged preservation, compile-staged-tree gate, branches/merge conflicts, crash points in ref/SQL journal. |
| T12 Git UI | `tests/ui-editor/git.spec.ts`: same operations through screen 02, ahead/behind from actual refs, unified/split/rendered diff and history/clone token. |
| T13 Library/templates | `tests/core/library-templates.test.ts`: BibTeX forms/code/upload/DOI fixture, zero/one/multiple target bibliography, independent copies versus read-only sync, public/private template approvals/version pinning. |
| T14 Organization | `tests/accounts/organization.test.ts`: Admin/Manager/member/seat separation, invite/access request races, entitlement transition, transfer/downgrade, institution verified eligibility loss, managed accept/release/reassign/lapse/recovery, no unrelated project destruction. |
| T15 Notifications/privacy | `tests/accounts/governance.test.ts`: mention/reply/project preferences and digest with controlled clock, mail dedupe, optional cookie analytics denied by default, private export/audit CSV pagination/redaction, user data export versus backup distinction. |
| T16 Connectors | `tests/adapters/connectors.test.ts`: local protocol-faithful HTTP/Git fixtures exercising OAuth/errors/cursors, Github/GitLab imports/conflicts, Dropbox add/edit/delete/archive, bibliography bulk/search/library refresh, DOI, actual Pandoc conversions, publisher prepare versus submit receipt. Live suite conditional on explicit credentials. |
| T17 AI | `tests/adapters/ai.test.ts` and `tests/ui-editor/ai.spec.ts`: deterministic boundary server returns multi-file patches/citations; assert no mutation before approval, per-hunk/all decisions, conflict, undo, new real branch/commit, log-only Error Assist, images/modality, inline/linguistic tools, shared budget race, consent/deny/no context leak, clear/share chat. Optional live call proves configured provider only. |
| T18 Sandbox/extensions | `tests/compiler/isolation.test.ts`: TeX and latexmkrc try host secret/cross-job read, network, shell escape, fork/resource abuse; forbidden probes fail, legitimate helper/knitr/minted/TikZ/local asset fixture works in installed profiles; killing job removes descendants/workspace. Never use sensitive real host data; plant owned canaries outside jail. |
| T19 Federation/billing | `tests/adapters/identity-billing.test.ts`: local signed SAML/OIDC test IdP, LDAP directory, SCIM Users/Groups/disable/ETag, cert rotation/replay/issuer rejection/break-glass; signed billing fixture webhook idempotency/seat/period/cancel/invoice; real sandbox provider only with credentials. |
| T20 Visual/accessibility | `tests/e2e/screens.spec.ts`: all D01-D23 primary and alternate states at 1440x900 and 390x844, screenshots against design evidence with deliberate live-data differences; keyboard dialogs/splitter/tab order, axe checks, offline/empty/loading/error/permission states. Lead inspects screenshots and actual browser. Screen reader and tagged-PDF validator results separately recorded, not inferred from axe. |
| T21 Recovery/operations | `tests/operations/recovery.test.ts`: quiesce edits, snapshot DB/blobs/Git/review/settings/keys manifest, restore to isolated root and compare all categories; worker drain, pinned-image retirement, signed update reject/accept/schedule/migration, redacted support bundle, SIEM event delivery/dedupe. Config archive must fail full-recovery validation. |
| T22 Scale/deployment | `tests/operations/scale.test.ts`: Compose then Helm render/install in owned cluster where available; two API instances, fenced branch lease failover, Redis outage catch-up from DB, S3 bytes/history preserved, replace compile node; air-gap bundle no network at runtime. SSH clone/push and bounded autoscaling pool report real state. Missing cluster/arm64 runner is a named external verification prerequisite, not a fake pass. |

Async tests subscribe before action and wait for exact ack/event with bounded failure timeout; no fixed sleeps or retry-until-green. Provider fixtures preserve actual protocol/error behavior, not success-only mocks. Local clock injection covers date boundaries; real process tests prove actual execution/isolation. New code/tests are checked with LSP diagnostics before build. Keep test evidence (commands, exit codes, screenshots, logs, environment digests) under an owned evidence directory; never overwrite original design captures.

## 10. Completion and evidence boundaries

Completion means every build target in `feature-matrix.md` has its suite assertion and visible operational route; all native tests pass, real compiler and Git work, persistence survives restart, browser QA is inspected, and remaining live external checks name the exact missing credential/hardware/service contract. Policy/evidence-boundary rows are tested representations, not removed features. An unavailable optional provider is acceptable only with finished connection/validation/execution code and fixture coverage; an unavailable native capability without an installation/implementation result is unfinished.

Upstream reports contain 86 core IDs and 55 service IDs; design adds 23 screen IDs plus explicit cross-cutting decisions. `feature-matrix.md` preserves them individually. No application tests were run by this architecture assignment. Runtime claims here derive from upstream probes; sandbox and compiler integration still require the listed real tests. Implementers verify selected library API versions when locking dependencies; compatibility is gated by P0 on native Bun 1.3.14, not assumed from the eval runtime.
