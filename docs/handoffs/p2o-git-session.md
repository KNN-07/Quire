# P2O core Git session boundary

Owner: `st_01a17c41`. October 27, 2026. Status: COMPLETE for the assigned
core Git session boundary, direct tests, native verification, evidence, and
cleanup. Native Bun 1.3.14. No workspace commit/push, root dependency edit,
operations SSH edit, compiler edit, or nested agent was made.

## Exported contract

`services/core/git/index.ts` now exports:

```ts
serveGitSession(repo: GitRepository, input: {
  readonly fingerprint: string;
  readonly projectId: Id;
  readonly service: "git-upload-pack" | "git-receive-pack";
  readonly run: (path: string) => Promise<void>;
}): Promise<void>;
```

This is the exact `GitSession` shape consumed by
`services/operations/ssh/server.ts`. The SSH producer remains responsible for
driving the bounded Git subprocess and delaying receive-pack report status
until this promise resolves.

## Mechanism

The session authenticates the current SSH fingerprint, resolves the actual
project default branch, authorizes `git.read` or `git.push`, and initializes
missing named root history through the existing narrowly scoped Viewer-safe
`GitRepository.head` path.

Every callback receives a physically separate temporary bare repository.
`exportNamed` supplies only finalized `refs/heads/*` ancestry through the
repository port; no API-local canonical path, alternates, private checkpoint
refs, or hidden history objects are exposed.

HTTP and SSH now share `services/core/git/transport.ts` for quarantine ref
diffing, branch-only/default-branch checks, commit/tree validation, strict
fsck, dirty-browser and stale-head rejection, immutable pack import, sorted
branch lease acquisition, current actor/access checks, and one composed
Git/source journal publication. HTTP retains its existing token behavior and
passes `tokenHash`; SSH passes no synthetic HTTP credential.

`GitJournal` persists optional `sshFingerprint` beside the existing
`tokenHash`. It rechecks that the fingerprint still belongs to the original
active actor before repository publication, after repository CAS during SQL
finalization, and again during recovery with newly acquired branch fences.
Authorization is also re-evaluated for every named change at those journal
boundaries. Revocation or access loss therefore leaves publication pending and
unreadable rather than exposing refs or source metadata early.

Successful receive-pack imports immutable objects, publishes named refs and
prepared hidden checkpoints in one repository intent, then atomically
finalizes source records, named-head metadata, staging cleanup, receipts,
events, and intent removal. The temporary public/quarantine root is removed in
`finally` for success and failure.

## Direct regression coverage

`tests/core/git/session.test.ts` uses actual Git CLI callbacks and covers:

- clone plus fetch from finalized named ancestry;
- denial of a real private checkpoint object in the cloned object database;
- receive-pack push followed by matching named Git and browser source;
- a key revoked before a later session, with the callback never invoked;
- exact SSH fingerprint revocation after named repository CAS, leaving old
  metadata and an unreadable published repository intent;
- rollback after repository CAS, persisted fingerprint evidence, restart,
  fresh-fence recovery, and exactly-once source/ref visibility.

The first direct run exposed two test-fixture issues rather than production
defects: a status request created unrelated repository work while an intent
was deliberately pending, and an overly broad repository hook revoked the key
during validation checkpoint publication instead of named CAS. The tests were
corrected to inspect durable metadata directly and trigger only on
`refs/heads/*`. The final direct run passed **4 tests, 0 failures, 18
expectations in 5.10 seconds**.

## Final verification

The required final-code command:

```text
bun test tests/core/git tests/integration/git.test.ts
```

exited 0 with **33 pass, 0 fail, 153 expectations across 11 files in 108.75
seconds**. This includes the existing real HTTP clone/fetch/push, quarantine,
hidden-ref, ACL/token, branch, compile, staging, rollback, fence, and recovery
regressions plus the new direct session cases.

Both commands exited 0 with no output:

```text
bun node_modules/typescript/bin/tsc --noEmit -p tests/core/git/tsconfig.json
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings \
  services/core/git tests/core/git tests/integration/git.test.ts
```

The programming-skill no-excuse script could not load its TypeScript 7
`unstable/*` APIs from this repository's pinned TypeScript 5.9.3 and exited 2
before scanning. A scoped equivalent search over every owned changed
TypeScript file found no `any`/`unknown` assertions, ignore directives, enums,
mutable exports, explicit `any`, throw literals, or empty catches. LSP
diagnostics for production changes were clean; the strict project compilation
is the authoritative test-file diagnostic.

Scoped `git diff --check` exited 0. Pure LOC is 85 for `transport.ts`, 41 for
`session.ts`, 162 for `session.test.ts`, 95 for `http.ts`, 18 for `index.ts`,
and 245 for `journal.ts`. `journal.ts` is in the 200-250 warning band and
should be split before a future substantial feature, but remains under the
hard ceiling. Each new module has one responsibility: transport publication
or SSH session lifecycle. No untrusted generic object crosses the boundary,
no tagged variant was added, no type escape hatch or defensive duplicate
layer was introduced, and tests contain no sleeps or polling.

Final cleanup found no `/tmp/quire-git-ssh-*` or `/tmp/quire-git-test-*` roots.
No upload-pack, receive-pack, or owned Git session process remained; the only
process match was the cleanup probe itself. Every fixture closes its runtime
and removes its unique root.

## Integration boundary

The core export is ready for the active operations SSH producer. This lane did
not edit or run that producer's in-progress fixtures and does not claim real
sshd, deployment, or scale acceptance. The producer must independently run
its end-to-end SSH suite and report those results to the parent.
