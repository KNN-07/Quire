# P1 core Git

Status: WORKING and verified on October 26, 2026. Owner: Git lane. Native baseline: Bun 1.3.14 and Git 2.53.0. No commit, origin push, package edit, shared-contract edit or root composition edit was made.

## Composition and exports

Import from `services/core/git/index.ts`:

```ts
import { register, registerCredentials, migrations } from "./services/core/git";

// After identity/policy and core base:
{ id: "024-k-git", lane: "K", order: 24, register, migrations }
{ id: "025-a-git-credentials", lane: "A", order: 25, register: registerCredentials }
```

The two module registrations are required: the frozen token/SSH contracts belong to lane A, while repository/HTTP contracts belong to K. Registering all handlers through one K context correctly fails `INVALID_REGISTRATION`. This lane preserves the frozen ownership instead of bypassing the router. Identity does not register these credential handlers itself.

Exports are `register(context: ModuleContext): Promise<void>`, `registerCredentials(context: ModuleContext): void`, `migrations`, `GitRepository`, `GitJournal`, `credentialHash`, `tokenActor`, `sshFingerprint`, and `sshActor`.

Migration `024-k-git-named-intents` adds only `core_git_intents`, `core_git_staging` and `core_git_receipts`. Baseline SQL is unchanged. Core base must provide the actual `CoreProjects` writer before registration; registration recovers prepared named-ref intents before exposing its handlers.

## Registered endpoints

Exactly 19 shared endpoint registrations:

| Registration | Method and path |
| --- | --- |
| `gitStatus` | GET `/api/projects/:p/git/status?branch=...` |
| `gitLog` | GET `/api/projects/:p/git/log?branch=...` |
| `gitBranches` | GET `/api/projects/:p/git/branches?branch=...` |
| `gitBranchCreate` | POST `/api/projects/:p/git/branches` |
| `gitBranchDelete` | DELETE `/api/projects/:p/git/branches/:name` |
| `gitStage` | PUT `/api/projects/:p/git/stage` |
| `gitDiscard` | POST `/api/projects/:p/git/discard` |
| `gitCommit` | POST `/api/projects/:p/git/commit` |
| `gitMerge` | POST `/api/projects/:p/git/merge` |
| `gitTokensList` | GET `/api/me/git-tokens` |
| `gitTokenCreate` | POST `/api/me/git-tokens` |
| `gitTokenDelete` | DELETE `/api/me/git-tokens/:id` |
| `sshKeysList` | GET `/api/me/ssh-keys` |
| `sshKeyGet` | GET `/api/me/ssh-keys/:id` |
| `sshKeyCreate` | POST `/api/me/ssh-keys` |
| `sshKeyPatch` | PATCH `/api/me/ssh-keys/:id` |
| `sshKeyDelete` | DELETE `/api/me/ssh-keys/:id` |
| `gitHttpGet` | GET `/git/:p.git/*` |
| `gitHttpPost` | POST `/git/:p.git/*` |

The wildcard transport accepts only smart `info/refs`, `git-upload-pack`, and `git-receive-pack`. Dumb object/path access is rejected. All JSON mutations use actual session identity and CSRF/origin verification. Git transport uses its own current Git token, not browser cookies.

## Repository behavior

Repositories remain bare at `data/git/<projectId>.git`. Named history is actual Git objects and `refs/heads/*`; logs read actual authors, parents, messages and commit timestamps, including commits created by external CLI authors. Log pagination uses commit OIDs as cursors.

An unborn default branch gets a fresh named root commit from current durable source. It does not adopt a hidden source-checkpoint commit as user history. Named branch creation materializes independent durable documents through the base writer while preserving main-file identity. Default-branch deletion and deletion of dirty browser branches fail.

Status and mutation paths use the shared `CoreProjects.serialized` source queue. Stage selections are private to actor/project/branch and persist exact patches, not only checkbox IDs. Text hunks and actual Git binary patches are supported. Selection survives later browser edits and restart. Commit applies the selected patches to the checked named HEAD, publishes that real tree, and leaves newer/unstaged browser bytes untouched. Unstage changes no source; selected discard materializes the inverse tree through the source/epoch transaction. Changed HEAD, source revision, or unknown hunk selection is rejected rather than overwriting edits.

`expectedVersion` and the status ETag refer to the target branch's **working revision**, not `projects.version`. Branch creation compares the `from` workspace revision and returns the new workspace ETag. Stage requires the shared If-Match header. Merge and commit also compare the supplied algorithm-tagged HEAD.

Merges use real three-way `git merge-tree` output and create actual two-parent commits. Conflicts return `409 MERGE_CONFLICT` without moving named refs or browser source; the message directs manual resolution in a local checkout. Merge requires a clean browser branch.

Named-ref publication uses a durable expected/new-ref intent and transactional `git update-ref --stdin` CAS. Source materialization goes through the existing source journal/epoch boundary; SQL head metadata, stage invalidation, Git events, operation records and operation replay receipts finalize durably. Recovery handles both pre-publication and already-published refs. Mismatched external refs are durably marked `conflicted`, return `REF_CONFLICT`, and fence later named-ref mutations. A conflicted record is intentionally retained for operator reconciliation rather than silently choosing a side. Serving refuses unfinished repository intents.

## Exact staged-tree compile gate

Production code consumes only `CompilePort`; it does not import C internals. Missing compiler registration returns the runtime's real `503 SERVICE_UNAVAILABLE`, never a successful commit.

Because frozen `CompileRequest` accepts a workspace/revision rather than a supplied tree, the gate materializes the exact staged tree into a durable private workspace named `quire-stage-<UUID>`. It has no named Git ref and is never advertised by the bridge. The compiler snapshots that workspace, and the commit proceeds only after an event-driven successful job whose snapshot tree equals the still-selected target tree. The target source queue is not held while the compiler snapshots.

Private compile workspaces are retained with their real jobs/snapshots so subsequent compile/log/artifact reads can pass the existing ProjectPort branch authorization. They are durable application history, not temporary process directories. O's eventual job/history retention must remove the associated private workspaces when deleting those jobs. Compile-only previews remain associated with that exact private snapshot, not mislabeled as a preview of newer unstaged browser text.

The acceptance tests compose the actual C module and lifecycle, execute confined TeX, and test success, TeX failure, and a partially staged valid tree while invalid unstaged TeX remains in the browser.

## Authenticated smart HTTP and credentials

Use username `git` and the one-time token as password with ordinary Git CLI URLs. Bearer authorization is also supported. Tokens contain 256 random bits; only SHA-256 hashes are stored. Issuance enforces ten stored tokens per account and an expiry within one year. Replay receipts contain no bearer; retrying token creation returns the existing ID with an empty `secretOnce`. Token expiry, deletion, user suspension/deletion and current project ACL are checked on requests. Viewer/Reviewer may fetch; only Editor/Owner may push.

Both fetch serving and receive quarantine use physically separate repositories containing only finalized named ancestry. Merely hiding `refs/quire/` was insufficient: the acceptance regression demonstrated that a known private OID could still be fetched from the private object store. The final implementation excludes those objects entirely, and the real CLI regression proves a known checkpoint OID cannot be fetched.

Receive-pack runs only in the isolated quarantine. Incoming refs, ordinary-file trees, main-file validity, source limits and `git fsck --strict` are checked before promotion. Tags/non-head refs, submodules, symlinks and Git LFS pointer/configuration are rejected explicitly. Current token and project write access are rechecked before journal publication. Existing dirty browser branches reject push; the client can push a separate named recovery branch. Hook execution is disabled for all Git commands, including receive-pack; an installed failing pre-receive hook cannot run. Temporary public/quarantine/index directories are removed in awaited `finally` blocks.

SSH helpers validate ordinary public keys using actual `ssh-keygen`, store SHA-256 fingerprints, scope CRUD to the authenticated user and expose live fingerprint-to-user lookup. `sshActor` checks current user status and key existence; an eventual SSH transport must additionally call current project authorization for every command. No SSH listener, shell access or claimed SSH transport is included; O owns that later transport.

## Concrete integration dependencies and contract boundaries

- F must compose **both** module registrations above. No shared endpoint lane change is needed.
- Identity/policy and base must be registered first. The base shared writer, limits, authorization and filesystem/blob conventions are used rather than replaced.
- Optional compiler composition is C's existing `register`/migration plus `startWorker` after runtime creation and awaited `stopWorker` before SQLite closes. Native confinement/toolchain readiness and the project's environment selection must be real. Tests exercise this integration.
- U owns Git screens, branch selection, diff rendering, errors and refetch after `git.changed`. This backend lane does not claim browser-screen acceptance. Each browser request must supply the actual scope and working-revision ETag; no guessed counters are needed.
- The frozen branch-delete request contains no expected HEAD. It therefore checks the supplied workspace revision and CASes the current inspected head; a caller-supplied expected-head delete contract would require a lead-owned schema addition.
- There is no active-presence query in the provided ProjectPort/RealtimePort. Dirty source is protected and writes share the source queue; an additional prohibition on deleting a clean branch merely because an idle editor is connected requires the realtime owner's presence seam. No invented presence table or port is used here.
- Conflicting named-ref intents fail closed and require operator reconciliation; this module never force-resets refs or silently drops conflicted intents. Merge content conflicts are resolved with ordinary local Git and a checked push.
- O owns standard operation GET/download authorization, storage/backup/retention and SSH transport. Git mutation operations are durable standard `operations` rows with actual named-head results.
- X owns generic remote imports/GitHub/GitLab grants/adapters; this lane supplies the local real repository/bridge and source materialization seam, not external credential setup.

## Exact final verification

All commands used native Bun 1.3.14, owned `TMPDIR=/tmp/quire-git-lane-W4xIBK` and `BUN_INSTALL_CACHE_DIR=/tmp/quire-git-lane-W4xIBK/cache`.

| Check | Exact result |
| --- | --- |
| `bun test tests/core/git tests/integration/git.test.ts` | Exit 0; **22 pass, 0 fail, 95 assertions, seven files, 57.90 seconds**. |
| `bun node_modules/typescript/bin/tsc --noEmit -p tests/core/git/tsconfig.json` | Exit 0; no diagnostics, including the actual identity/base/compiler imports. |
| `bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings services/core/git tests/core/git tests/integration/git.test.ts` | Exit 0; no diagnostics. |
| Final production LSP directory check | Zero diagnostics across 12 source files. |
| Final owned test-directory LSP check | Zero diagnostics across seven test/helper files. |
| Integration-file LSP refresh | Earlier check had no diagnostics; final refresh timed out after 3,000 milliseconds. Fresh strict TypeScript and lint include this file and passed. |

Failure history, decisive errors and the progression of real test evidence are retained in `docs/evidence/p1-core-git/verification.md`. No warning, failing assertion or type error was suppressed. No whole-repository or browser-screen acceptance is implied.

## Post-write architecture review

Files own Git process execution, account Git credentials, named-ref recovery, tree materialization, hunk/index representation, repository inspection, workspace mutations, compiler gating, HTTP transport or endpoint registration. HTTP/DB input is parsed with shared/Zod schemas; internal IDs, source inputs and operation data stay typed. Compiler job status is exhaustively switched. There are no new `any`, type assertions, non-null assertions, diagnostic suppressions, broad swallowed errors, shell interpolation of user commands or framework-guarantee null checks.

Tests exercise actual bytes, refs, ancestry, authorization decisions, events/jobs and durable recovery, not pinned prose or an implementation-call mock. Async work is awaited or driven by exact job events with bounded deadlines; no test sleeps or timing-based polling were introduced. Temp-resource cleanup uses `finally`; logging remains the existing runtime error funnel. New functions have at most three parameters; reusable process/request values are typed.

Read-tool-backed pure-line measurements: production maximum `http.ts` **152**; test maximum `staging.test.ts` **156**. Other production sizes are actions 124, compile 59, credentials 132, hunks 81, index 17, journal 98, migrations 17, process 32, repository 60, routes 109 and trees 57. All owned source/tests are below 200 pure lines.

## Cleanup receipts

Fixture disposal awaited every ephemeral HTTP listener, stopped the real compiler worker/reaper before closing SQLite, and recursively removed each unique fixture data root. Git/SSH children were awaited; temporary public repositories, quarantine repositories and staging indexes were removed through awaited cleanup. Verification command subscriptions completed with the exit codes above.

After retaining the evidence, `rm -rf -- /tmp/quire-git-lane-W4xIBK` completed with exit **0** and emitted `CLEANED /tmp/quire-git-lane-W4xIBK`. No post-delete filesystem probe was used; the operation's successful completion is the receipt. No unrelated IPv4 5173/3001 listener was stopped. No commit or origin push was made.
