# P1S Git

Owner: `st_01a17b91`. October 27, 2026. Status: COMPLETE for the assigned
Git migration, native checks, evidence and cleanup. Native Bun 1.3.14.
No workspace commit/push, sibling edit or nested agent was made.

## Registration and exported signatures

`services/core/git/index.ts` retains:

```ts
register(context: ModuleContext): Promise<void>;
registerCredentials(context: ModuleContext): void;
const migrations: readonly Migration[];
credentialHash(secret: string): string;
tokenActor(context: Pick<ModuleContext, "db" | "clock">, request: Request): Promise<Id>;
sshFingerprint(publicKey: string): Promise<string>;
sshActor(context: Pick<ModuleContext, "db">, fingerprint: string): Promise<Id | null>;
```

Keep both registrations: K `024-k-git` calls `register` with migrations;
A `025-a-git-credentials` calls `registerCredentials`. The lane ownership is
unchanged. Registration awaits named-intent recovery before exposing routes.
The module has no persistent worker/listener of its own.

The exported `GitRepository` retains its `constructor(service: CoreProjects)`,
`readonly service` and `readonly journal: GitJournal`:

```ts
path(scope: Scope): string;
head(actorId: Id, scope: Scope, lease: BranchLease): Promise<string>;
live(actorId: Id, scope: Scope, lease: BranchLease): Promise<Snapshot>;
inspect(actorId: Id, scope: Scope, lease: BranchLease): Promise<{
  status: GitStatus; hunks: readonly PatchHunk[]; snapshot: Snapshot; head: string;
}>;
check(actorId: Id, input: {
  readonly scope: Scope; readonly head: GitOid; readonly expectedVersion: number;
}, lease: BranchLease): ReturnType<GitRepository["inspect"]>;
commitTree(actorId: Id, input: {
  readonly scope: Scope; readonly tree: string;
  readonly parents: readonly string[]; readonly message: string;
}): Promise<string>;
```

`path` remains native tooling/test support; no production operation uses it
to access a canonical repository. Returned raw commit/tree hashes retain the
existing SHA-1 representation; public DTOs retain tagged Git OIDs.

`services/core/git/journal.ts` exports:

```ts
type RefChange = { scope: Scope; before: string; after: string; hydrate: boolean };
type GitReceipt = { key: string; digest: string; operation: Operation };
class GitJournal {
  constructor(service: CoreProjects);
  publish(actorId: Id, changes: readonly RefChange[], leases: readonly BranchLease[],
    receipt?: GitReceipt,
    authorization?: { readonly tokenHash?: string; readonly initial?: boolean }): Promise<void>;
  recover(): Promise<void>;
}
```

Its existing public `finish(persisted, leases): Promise<void>` has the
following structural input (the documentation alias is not a new export):

```ts
type NamedIntent = {
  id: Id; actorId: Id; changes: RefChange[];
  leases?: BranchLease[]; revisions?: (number | null)[];
  sources?: SourceIntent[]; receipt?: GitReceipt;
  tokenHash?: string; initial?: boolean;
};
finish(persisted: NamedIntent, leases: readonly BranchLease[]): Promise<void>;
```

Ordinary callers use `publish`. Recovery parses and reuses persisted source
descriptors rather than rebuilding their snapshot IDs.

Changed owned helper exports:

```ts
type Mutation = { readonly scope: Scope; readonly head: GitOid; readonly expectedVersion: number };
stage(repo: GitRepository, actorId: Id, input: Mutation & {
  readonly hunkIds: readonly Id[]; readonly staged: boolean;
}, lease: BranchLease): Promise<GitStatus>;
discard(repo: GitRepository, actorId: Id, input: Mutation & {
  readonly hunkIds: readonly Id[];
}, lease: BranchLease): Promise<GitStatus>;
commit(repo: GitRepository, actorId: Id, input: Mutation & {
  readonly message: string; readonly compileFirst: boolean; readonly key: string;
}): Promise<Operation>;
merge(repo: GitRepository, actorId: Id, input: Mutation & {
  readonly from: string; readonly key: string;
}, lease: BranchLease): Promise<Operation>;
createBranch(repo: GitRepository, actorId: Id, input: {
  readonly projectId: Id; readonly name: string; readonly from: string; readonly expectedVersion: number;
}, lease: BranchLease): Promise<GitStatus>;
stagedHunks(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly head: string;
}): Promise<readonly PatchHunk[]>;
patchedTree(service: CoreProjects, scope: Scope, input: {
  readonly base: string; readonly hunks: readonly PatchHunk[]; readonly reverse?: boolean;
}): Promise<string>;
treeInputs(service: CoreProjects, input: {
  readonly scope: Scope; readonly path?: string; readonly commit: string;
}): Promise<readonly SourceInput[]>;
ensureWorkspace(service: CoreProjects, scope: Scope): Promise<void>;
hydrate(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly lease: BranchLease;
  readonly inputs: readonly SourceInput[];
}): Promise<Snapshot>;
branchName(name: string): Promise<void>;
```

`commit` owns short branch leases around compilation; `createBranch` also
acquires its target lease. An explicit `treeInputs.path` is only a private
quarantine. `hydrate` remains standalone discard/private-compile work, not
named publication. `run` permits an omitted native `GitCommand.path` for
standalone CLI checks. The internal `objects(service,scope,args,input?)`
delegates immutable plumbing to the repository port, and `copyTree` copies
only the selected immutable tree into/out of a private index repository.

## Mechanism and preserved behavior

All Git metadata and transitive base/identity reads are awaited. Transaction
helpers use the supplied executor, acquire `quire:accounts`, assert current
branch fences and recheck active authorization. Token hashes, not bearer
secrets, are persisted and checked again during finalization. Credential
quotas and key uniqueness/version decisions hold the accounts lock.

Named hydration consumes the verified public boundary in
`p1s-source-composition.md`: prepare all immutable source descriptors outside
SQL, persist them in `core_git_intents`, publish ONE repository intent
containing named updates and every prepared hidden checkpoint, then call
`finalizePreparedSources` in the same SQL transaction as named-head metadata,
staging cleanup, operation receipts and journal removal. Returned source
events and Git events are recorded last; dispatch follows commit.
No composed descriptor enters `base_source_intents`.

Recovery adopts current leases and reuses exact persisted source descriptors.
The accepted pre-portable JSON intents remain recoverable. CAS conflicts
remain durable and block later named mutation. Published but unfinalized refs
remain hidden. Multi-branch source/new-workspace changes, receipts and events
roll back together. Initial read authorization is narrowly limited to creating
the default named root; a current Viewer still cannot mutate Git.

Staging keeps exact per-user hunk bytes after later browser edits and restart.
The private index copies immutable trees through the port, so scale never
opens an API-local canonical Git directory. Actual confined compilation pins
the staged tree; the named commit checks that exact compiled tree again.
Unstaged browser bytes remain untouched.

Smart HTTP always authorizes before serving. It restores a finalized
named-only bundle into a physically separate public/quarantine repository.
Validated pushes export a self-contained pack for `importPack`, then use the
same fenced named publication. Hooks/config/hidden refs are not imported;
private checkpoint objects cannot be fetched. Dirty-browser pushes remain
rejected with separate-branch support. Native uses the real local adapter;
scale operations delegate to the actual repository-service ports.

## Migrations and dependencies

`024-k-git-named-intents` keeps its original SQLite `sql` bytes and digest.
Its explicit PostgreSQL variant is added under the same ID; no baseline SQL
or original input was rewritten. The migration regression compares SHA-256
against the actual source at accepted commit `3fe3a23`.

Read and verified the requested architecture/implementation plan,
`p1-integration.md`, `p1-acceptance.md`, and the named contract/accounts/base/
compiler/repository handoffs. The transfer gap was resolved by F's common
`exportNamed`/`importPack` and real local implementation. The composed-source
gap was resolved by the parent's VERIFIED `p1s-source-composition.md`;
the owned Git integration and rollback/restart tests pass against it.

No unresolved owned dependency remains. Root integration still owns complete
PostgreSQL/Redis/S3/two-API scale acceptance and deployment composition.
This lane did not run a whole-application scale suite or claim Git-service HA.
The authored PostgreSQL Git migration is not separately claimed as a passed
PostgreSQL Git-domain suite.

## Verification and cleanup

`bun test tests/core/git tests/integration/git.test.ts` exited 0:
**28 pass, 0 fail, 132 expectations, 65.12 seconds**. It includes actual CLI
clone/fetch/push, dirty-browser/quarantine/hook protection, hidden-object denial,
current ACL/token checks, staged binary/hunk isolation, real successful/failed
staged compilation, branches/merge, migration preservation and deterministic
fence/recovery/atomic multi-branch rollback cases.

The final initial-Viewer correction was followed by the affected CLI/recovery/
fence run: 11 cases passed; the new Viewer mutation assertion first hit 428
because its test omitted If-Match. Adding the required test header, without
changing its 403 assertion, produced the final transport result:
**2 pass, 0 fail, 10 expectations, 1.84 seconds**. It also verifies actual
clone/fetch and first-Viewer initialization followed by mutation denial.
The unchanged actual compiler cases were not rerun unnecessarily.

Final strict `bun node_modules/typescript/bin/tsc --noEmit -p
tests/core/git/tsconfig.json` and `bun node_modules/oxlint/bin/oxlint
--type-aware --deny-warnings services/core/git tests/core/git
tests/integration/git.test.ts` exited 0. Owned LSP diagnostics and scoped
whitespace checks are clean. No tests were skipped or weakened.

Evidence starts at `docs/evidence/p1s-git/verification.md`; exact full-suite
and final static/transport receipts are retained alongside the chronological
intermediate failures. Evidence is ignored by existing Git rules and requires
explicit inclusion by integration when commits are authorized.

Every assigned check has a terminal receipt. Fixtures awaited their HTTP
listeners, actual Git children, compiler lifecycle and runtime closure, and
removed their unique roots. The final probe returned
`GIT_OWNED_FIXTURE_ROOTS_ABSENT` and `GIT_OWNED_WHITESPACE_CLEAN`.
No owned container/volume was created. Dependency subscriptions were closed
or had already terminated; no owned asynchronous check or resource remains.
