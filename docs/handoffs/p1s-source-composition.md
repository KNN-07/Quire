# Composed Git/source publication

Owner: lead base follow-up. Status: VERIFIED. This resolves the
single-pending-repository-intent composition decision for the public base
boundary. Git must still consume it and pass its actual transport suites.

Public exports from `services/core/base` now include `SourcePreparation`,
`PreparedSources`, `SourceIntent` and its persisted-data parser `sourceIntent`.
`CoreProjects` inherits:

```ts
prepareSource(input: SourcePreparation): Promise<SourceIntent>;
finalizePreparedSources(tx: Transaction, input: PreparedSources):
  Promise<readonly PendingEvent[]>;
```

`SourcePreparation` has the existing `commitSource` inputs plus optional
`newBranchId: Id`. Preparation writes immutable blobs/Git objects and creates
document state in the returned descriptor. It does not publish refs, change
source SQL, create a branch or insert a standalone source intent. It must run
outside SQL transactions. A new branch can use existing immutable file blobs.

`PreparedSources` is:

```ts
{
  publication: { id: Id; lease: BranchLease };
  sources: readonly { source: SourceIntent; lease: BranchLease }[];
}
```

## Git caller ordering

1. Hold the current leases and prepare all hydrated branch sources before
   repository publication. Supply `newBranchId` only when no workspace exists.
2. Persist the exact returned descriptors in the Git coordinator's durable
   intent before publishing. Recovery must reuse their IDs and payloads.
3. Publish one repository intent containing the named-ref changes and every
   prepared checkpoint:
   `refs/quire/history/<source.snapshot.id>` from null to
   `sha1:<source.commit>`.
4. In one caller-owned `uow.run`, acquire business locks and validate current
   Git credentials/permissions for every ref change. Call
   `finalizePreparedSources` with the common publication and all hydrated
   branches. It validates checkpoint binding and all source versions before
   applying any source writes, creates prepared new workspaces in this
   transaction, and finalizes the common repository intent once.
5. Write named-head metadata, Git receipts and journal cleanup in that same
   transaction. Record the returned source events and Git events only after
   business writes; dispatch only after commit. The helper intentionally does
   not dispatch or independently commit.

An empty source batch can finalize a publication that does not hydrate source.
Do not call the old `hydrate -> commitSource` path after named publication.
Do not insert these composed descriptors into `base_source_intents`; their
recovery belongs to the enclosing durable Git coordinator.

The regular `commitSource` path still owns its original standalone source
journal and events. Neither early source exposure nor early named-journal
finalization is used to bypass the repository invariant.

## Checks

New native regressions cover preparation invisibility, one named/checkpoint
publication, rollback plus persisted-descriptor recovery, multi-branch
finalization/new workspace creation, missing-checkpoint rejection and
blob-backed new-branch preparation. Initial checks exposed a new-branch
materialization bug and a stale expected read-gate error name; both are
corrected. The full native base/project/file boundary passed **74 tests,
zero failures, 257 assertions**. Strict base source/test compilation passed.
Lint then found one unused type import left by the refactor; it was removed,
and the final strict/type-aware lint command exited 0. No business assertion
was skipped or weakened.
