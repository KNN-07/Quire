# P1S core base

Owner: `st_01a17b58`. October 27, 2026. Status: COMPLETE for the assigned
base/source/access migration. Native Bun 1.3.14: 69 tests pass; strict owned
source/tests and type-aware lint pass. Real PostgreSQL domain recovery passes.
This does not claim whole-repository or two-API scale acceptance.

## Frozen asynchronous consumer signatures

`CoreProjects` retains its `constructor(context: ModuleContext)`.
All storage readers are asynchronous:

```ts
rows<T extends z.ZodType>(sql: string, values: readonly SqlValue[], schema: T): Promise<z.output<T>[]>;
one<T extends z.ZodType>(sql: string, values: readonly SqlValue[], schema: T): Promise<z.output<T>>;
getProject(id: Id): Promise<Project>;
getBranch(scope: Scope): Promise<{ id: Id; project_id: Id; branch: string; revision: number; epoch: number }>;
listFiles(scope: Scope): Promise<readonly FileEntry[]>;
getFile(scope: Scope, id: Id): Promise<FileEntry>;
getSnapshot(id: Id): Promise<Snapshot>;
readUser(id: Id): Promise<User>;
role(actorId: Id, projectId: Id): Promise<Role>;
loadDocument(scope: Scope, fileId: Id): Promise<SourceDocument>;
readDocument(scope: Scope, fileId: Id): Promise<TextDocument>;
withTransaction(tx: Transaction): CoreProjects;
serialized<T>(scope: Scope, work: (lease: BranchLease) => Promise<T>): Promise<T>;
commitSource(input: {
  readonly actorId: Id; readonly scope: Scope; readonly lease: BranchLease;
  readonly expectedRevision: number; readonly inputs: readonly SourceInput[];
  readonly reason?: Snapshot["reason"]; readonly advance?: boolean;
  readonly receipt?: SourceReceipt;
  readonly finalization?: SourceFinalization;
  readonly http?: HttpSourceReceipt;
  readonly creation?: { readonly project: Project; readonly branchId: Id };
}): Promise<Snapshot>;
```

`SourceInput` and `SourceDocument` retain their fields. `SourceReceipt` is
`{ readonly actorId: Id; readonly key: string; readonly route: string;
readonly digest: string; readonly response: string }`.
`authorize`, `authorizeRequest`, `policy`, `checkSharing`, `checkCapacity`,
`snapshot`, `readSnapshot`, `applyEdits`, `create`, `createFromFiles`, `copy`,
and `patch` remain async; await every transitive reader.
`operation(service, id)` now returns `Promise<Operation>`.
Registration remains `register(context: ModuleContext): Promise<void>`.

`withTransaction(tx)` returns an immutable service bound to the callback's
executor. Use it for authorization/read helpers inside `uow.run`; do not call
the root service or root identity/policy ports inside that callback.
`serialized` supplies a durable coordinator lease, not merely a local queue.
Pass that lease to `commitSource`. Any downstream SQL writer must assert the
same lease with `await context.branches.assert(tx, lease)` in its transaction.
Never put blob, Git, network, password or hashing work inside SQL.

The original receipt remains finalized atomically with source state and
events. HTTP source mutations additionally persist a recoverable response
descriptor in the source intent, so finalization also records the HTTP receipt.
Project creation metadata and its prepared source intent commit together;
there is no independently committed empty project before durable intent.
Recovery takes a new lease, validates current revision and authorization,
and adopts the intent's fence before repository reconciliation.
Preparation and finalization also reauthorize changed cross-project links
against their parent source and require the same parent blob.

Additional concrete method signatures:

```ts
authorize(actorId: Id, scope: Scope, action: string): Promise<void>;
authorizeRequest(request: Request, scope: Scope, action: string): Promise<Id | null>;
policy(actorId: Id, projectId: Id): Promise<Policy>;
checkSharing(actorId: Id, projectId: Id, targetId?: Id): Promise<void>;
checkCapacity(actorId: Id, projectId: Id, role: string): Promise<void>;
snapshot(actorId: Id, scope: Scope, expectedRevision: number): Promise<Snapshot>;
readSnapshot(snapshotId: Id): Promise<{ files: FileEntry[]; tree: GitOid }>;
recover(): Promise<void>;
recoverReceipt(receipt: HttpReceipt): Promise<void>;
create(actorId: Id, input: {
  readonly name: string; readonly workspaceId?: Id | undefined;
  readonly origin: { readonly kind: "blank" | "example" }
    | { readonly kind: "template"; readonly templateVersionId: Id };
  readonly http?: HttpReceipt;
}): Promise<Project>;
createFromFiles(actorId: Id, input: {
  readonly name: string; readonly entries: readonly NativeFile[];
  readonly workspaceId?: Id; readonly http?: HttpReceipt;
}): Promise<Project>;
copy(actorId: Id, input: {
  readonly projectId: Id; readonly name: string; readonly expectedVersion: number;
  readonly request?: Request; readonly http?: HttpReceipt;
}): Promise<Project>;
patch(actorId: Id, input: {
  readonly projectId: Id; readonly expectedVersion: number;
  readonly name?: string | undefined; readonly settings?: CompileSettings | undefined;
}): Promise<Project>;
```

`creation` is the internal new-project input: callers must not pre-insert an
empty project. Ordinary source consumers omit it. HTTP producers pass `http`
from `replay` explicitly; there is no ambient transaction or request context.
`HttpReceipt` is `{ actorId: Id; key: string; route: string; digest: string }`.
`HttpSourceReceipt` adds `result: {kind:"project"} | {kind:"file";id:Id}
| {kind:"files";ids:Id[]}`. `TransactionContext` is
`Omit<ModuleContext,"db"> & { readonly db: Transaction }`.

### Durable dependent source finalization

`SourceFinalization` is exported from base. It is trusted internal data, never
an HTTP DTO:

```ts
type SourceFinalization = {
  statements: {
    sqlite: string; postgres: string;
    parameters: (string | number | boolean | null)[];
    changes: number;
  }[];
  receipts: SourceReceipt[];
  events: {
    topic: "review.changed" | "history.created" | "notification.created";
    aggregateId: Id;
    payload: { readonly resourceId: Id; readonly version: number };
  }[];
};
applyEdits(actorId: Id, scope: Scope, edits: readonly ProposedEdit[], key: string,
  finalization?: SourceFinalization): Promise<{ revision: number; conflicts: Id[] }>;
```

Review must supply selected-status CAS statements, dependent metadata DML,
its response receipt and events through this durable descriptor. Each statement
has explicit dialect SQL and an exact affected-row count; mismatch rolls back
the source, statuses, receipts, repository finalization and events together.
Both preparation/finalization acquire `quire:accounts` before the branch lock.
No callback survives a crash, no sibling service registration is needed to
replay these statements, and no source receipt may be followed by a separate
review acceptance transaction. A conflicting `applyEdits` batch does not
execute the descriptor. Supplying the optional fifth argument includes it in
the apply-edits request digest; existing four-argument receipts remain valid.

## Named base-module exports

`migrations: readonly Migration[]` and `register` retain their names. Alongside
`CoreProjects`, `SourceReceipt`, `HttpReceipt`, `HttpSourceReceipt`,
`SourceFinalization`, and `TransactionContext`, the index exports:

```ts
type NativeFile = { readonly path: string; readonly bytes: Uint8Array; readonly folder?: boolean };
type SourceInput = { readonly file: FileEntry; readonly bytes?: Uint8Array; readonly document?: Y.Doc };
type SourceDocument = {
  fileId: string; docId: string; text: string; state: string; vector: string;
  revision: number; epoch: number;
};
readZip(bytes: Uint8Array): readonly NativeFile[];
importZip(service: CoreProjects, actorId: Id, input: {
  readonly name: string; readonly bytes: Uint8Array; readonly workspaceId?: Id;
}): Promise<Project>;
sourceZip(service: CoreProjects, snapshot: Snapshot): Promise<Uint8Array>;
emptyFile(path: string, kind: FileEntry["kind"]): FileEntry;
mutateFiles(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly expectedVersion: number;
  readonly http?: HttpSourceReceipt;
}, build: (files: readonly FileEntry[]) => Promise<readonly SourceInput[]>): Promise<readonly FileEntry[]>;
uploadFiles(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly expectedVersion: number;
  readonly entries: readonly { readonly path: string; readonly bytes: Uint8Array }[];
  readonly http?: HttpReceipt;
}): Promise<FileEntry[]>;
moveFile(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly fileId: Id;
  readonly path: string; readonly expectedVersion: number;
}): Promise<FileEntry>;
deleteFile(service: CoreProjects, input: {
  readonly actorId: Id; readonly scope: Scope; readonly fileId: Id; readonly expectedVersion: number;
}): Promise<{ ok: true; version: number }>;
operation(service: CoreProjects, id: Id): Promise<Operation>;
exportSource(service: CoreProjects, actorId: Id, input: {
  readonly projectId: Id; readonly snapshotId?: Id; readonly key: string;
  readonly request?: Request; readonly http?: HttpReceipt;
}): Promise<Operation>;
downloadOperation(service: CoreProjects, actorId: Id | null, input: {
  readonly id: Id; readonly request?: Request; readonly responseHeaders?: Headers;
}): Promise<Uint8Array>;
repositoryPath(context: ModuleContext, projectId: Id): string;
git(path: string, args: readonly string[], input?: Uint8Array): Promise<string>;
type ProjectExportRequest = {
  readonly actorId: Id; readonly projectId: Id; readonly snapshotId?: Id;
  readonly kind: "submission" | "docx" | "markdown" | "html"; readonly key: string;
};
type ProjectExporter = (input: ProjectExportRequest) => Promise<Operation>;
provideProjectExporter(context: ModuleContext, exporter: ProjectExporter): void;
```

## Dependencies and status

Consumed and verified `p1s-contract.md` and `p1s-accounts.md`. Source writes
use `branches` and `repositories` from those frozen runtime contracts.
The direct native `git` / `repositoryPath` exports remain only for existing
native tooling/transport consumers; portable source code uses the port.
Downstream review/catalog/compiler/Git must migrate their owned callers;
their temporary errors are not suppressed here.

SQLite migration `021-k-base-source-intents` is preserved byte-for-byte and
now has an explicit PostgreSQL variant. Additive `026-k-base-portable-intents`
adds persisted `owner`, `fence`, and HTTP receipt identity columns plus the
unique pending-receipt index in both dialects. Old pending intents begin at
fence zero and are adopted only under a newly acquired current lease.
Base has no implicit rowid ordering to backfill. Shared 006 owns suggestion
`edit_order`; new test inserts supply it.

Consumed the actual PostgreSQL implementation and named `p1s-postgres.md`,
and the root's now-completed `p1s-foundation-postgres.md`. The real PostgreSQL
domain test passed all nine selected foundation/identity/base migrations,
source creation, dashboard/access reads, operator discovery, restart,
source-intent recovery, response replay, ZIP retrieval and Viewer denial.
It uses actual PostgreSQL plus native Git/disk blobs and SQL event delivery,
not a fabricated scale factory or SQLite fallback.

`serialized` uses a 60-second coordinator lease and a process-local queue only
for local ordering. A competing process gets `BRANCH_BUSY`; an expired writer
cannot prepare/publish/finalize. SQL assertions reject changed revisions,
project versions, child ACLs and changed-link parent ACL/digests. Recovery
never blesses a stale owner or silently applies a now-unauthorized intent.
Redis notifications, S3, two-API transport failover and full scale acceptance
remain root/integration responsibilities.

Access, invitation, tag and bulk-operation receipts now join their aggregate
transactions. Bulk state and its operation row commit together; anonymous
export grants join operation insertion. All owned source HTTP receipts are
derived and committed inside source finalization, including database ordering
for multipart results. External conversion exporters retain their own
idempotent-operation contract; the generic wrapper's post-return receipt is
only the boundary for those externally supplied adapters.

Review must consume `SourceFinalization`; catalog/compiler/Git must await
the helper signatures and pass leases. Whole-repository gates remain with
root after those migrations. No downstream type errors are suppressed or
sibling source changed.

## Verification and cleanup

Final native command:
`bun test tests/core/base tests/core/projects.test.ts tests/core/files.test.ts`
exited 0: **69 pass, 0 fail, 238 expectations, 17 files, 25.11 seconds**.
It includes genuine HTTP/auth, durable blobs/Git, Unicode/Yjs, path/ZIP/import,
sharing/revocation, dashboard CAS, source fences, parent-link ACL rechecks,
crash-before-receipt and crash-after-commit replay, dependent review effects,
multipart ordering, and accepted-baseline migration/data preservation.

Both strict configurations, `tests/core/base/tsconfig.source.json` and
`tests/core/base/tsconfig.json`, exited 0. Owned `oxlint --type-aware
--deny-warnings` and scoped `git diff --check` exited 0. Production LSP reported
zero diagnostics before the final parent-link regression; the final strict
compiler/lint runs include that regression and its implementation.

The real PostgreSQL script is `tests/core/base/postgres-domain.ts`, invoked
with `QUIRE_CORE_BASE_POSTGRES_URL` pointing at a disposable owned instance.
It exited 0 and dropped its unique database. Its initial harness-only HTTP
status expectation failed honestly and was corrected to the existing 200
contract. Intermediate type/lint failures, exact final commands/results and
complete native logs are in `docs/evidence/p1s-core-base/verification.md`,
`native-final.log`, `strict-final.log`, and `cleanup.log`.

Chosen mechanism: explicit transaction-bound helpers, durable branch fences,
repository-port publication, and serializable dependent finalization DML.
Rejected alternatives were ambient/root SQL access and completing receipts
or review statuses in a separate post-source transaction. The only assumed
domain lock convention is `quire:accounts` before branch assertions, shared
with the consumed accounts contract. SQL callbacks contain no Git/blob/network
I/O; deterministic real-executor probes verify that boundary.

All fixture listeners/adapters and owned temporary roots are cleaned.
Container `quire-p1s-core-base-20e2c2dc` and its loopback port were removed;
the initial immediate removal check raced Docker's automatic deletion, and
the subscribed completion receipt confirms removal. All checks and monitors
terminated. No commit/push, sibling edit, or unrelated resource cleanup occurred.
There is no unresolved owned blocker. Downstream conversions and root scale
integration remain the named dependencies above, not suppressed errors or
deferred assigned work.
