# P2U named Git workspace - FINAL

October 27, 2026. Implemented and verified on native Bun 1.3.14.
This completes the assigned local Git UI/backend contract. Configured external
GitHub/GitLab/generic-remote adapters and the AI assistant remain later-phase
requirements; the panel reports their actual unavailable/configured state and
does not render functional-looking no-op remote actions.

## Ownership and preserved inputs

Authored changes are confined to:

- Git-specific schemas/routes in `packages/contracts/src/projects.ts` and
  `packages/contracts/src/routes-core.ts`.
- `services/core/git/**`.
- `apps/web/src/features/editor/git/**`.
- `tests/core/git/**`, `tests/ui-editor/git/**`.
- This handoff.

The parent’s adjacent `suggestionsList` route is preserved. The verified
`services/core/git/session.ts` whole-session mutation-admission wrapper is
unchanged. Existing P1S Git edits elsewhere in the Git subtree were preserved
rather than rewritten. Original HTML, research archive, sibling UI producers,
root dependencies and Git history were not changed. No commit or push was made.

## Exact contract delta

`GitStatus` retains `head`, `branch`, `ahead`, `behind`, `files`, `hunks` and
`staged`, and adds:

```ts
readonly upstream: string | null;
readonly base: GitOid;
```

New exported DTOs:

```ts
type GitBranch = {
  readonly name: string;
  readonly head: GitOid;
  readonly current: boolean;
  readonly upstream: string | null;
  readonly base: GitOid;
  readonly ahead: number;
  readonly behind: number;
};

type GitConflictFile = {
  readonly fileId: Id;
  readonly path: string;
  readonly binary: boolean;
  readonly base: string | null;
  readonly ours: string | null;
  readonly theirs: string | null;
  readonly merged: string | null;
};

type GitConflict = {
  readonly id: Id;
  readonly scope: Scope;
  readonly from: string;
  readonly head: GitOid;
  readonly fromHead: GitOid;
  readonly base: GitOid;
  readonly version: number;
  readonly files: readonly GitConflictFile[];
};

type GitComparison = {
  readonly kind: "working" | "staged";
  readonly base: Snapshot;
  readonly target: Snapshot;
};
```

Changed/new routes:

```ts
gitBranches:
  GET /api/projects/:p/git/branches?branch=
  -> readonly GitBranch[]

gitMerge:
  POST /api/projects/:p/git/merge
  -> { kind: "merged"; operation: Operation }
   | { kind: "conflict"; conflict: GitConflict }

gitConflictResolve:
  POST /api/projects/:p/git/conflicts/:id/resolve
  { scope, from, head, fromHead, expectedVersion, resolutions }
  -> Operation

gitComparisonCreate:
  POST /api/projects/:p/git/comparisons
  { scope, head, expectedVersion, target: "working" | "staged" }
  -> GitComparison
```

Conflict resolutions are exhaustive per path and discriminated as `ours`,
`theirs`, `delete`, or `{choice:"text",text}`.

## Backend behavior

### Real ahead/behind

Non-default branches compare against the project’s live default named branch.
`services/core/git/ancestry.ts` builds the reachable commit graph through the
injected repository object port using allowed `git log` reads. Ahead and behind
are set differences of real ancestry; `base` is the nearest common ancestor.
The default branch truthfully reports no upstream and zero/zero.

No design count, remote fiction, canonical local repository path or newly
allowlisted repository command is used.

### Structured merge conflicts

`git merge-tree --write-tree --messages --stdin` produces either a real merged
tree or conflict stages. Conflict responses include each file’s stage-1 base,
stage-2 current side, stage-3 incoming side and Git’s merged-marker text where
the blobs are textual. Binary conflicts require choosing a side or deletion.

The conflict ID is deterministic over scope, both heads, base and paths.
Resolution re-runs the merge and rejects unless all of these still match:

- current named HEAD;
- incoming branch HEAD;
- branch source revision;
- deterministic conflict ID;
- every conflicted path exactly once.

Resolution builds a private temporary index, validates the resulting tree
through `treeInputs`, creates a two-parent commit, then publishes named Git and
browser source through the existing fenced `GitJournal`. Temporary merge
repositories are always removed.

### Working/staged rendered comparisons

`gitComparisonCreate` first applies the same HEAD and branch-revision
preconditions as staging/commit. Working comparison uses the current immutable
live snapshot. Staged comparison rebuilds the exact per-user staged tree,
including staged bytes preserved across later browser edits.

Named HEAD and staged trees are materialized through existing source
publication/snapshot ports in deterministic internal
`quire-compare-<stable-id>` scopes. These scopes create no public named refs and
do not appear in the branch list. The returned snapshots feed the existing
real compiler `pdfDiff` operation; no PDF or result is fabricated.

### Main-file eligibility and log boundary

Git tree hydration now calls the shared `mainPathAllowed` helper. It preserves
main file identity, editability and unlinked status while allowing exact
`main.Rnw` only for a persisted Docker environment advertising `knitr`.

Git `%aI` author dates are normalized to UTC `Z` before parsing the shared
`Instant` contract.

## UI export and behavior

Production entry:

```ts
import { GitPanel } from
  "apps/web/src/features/editor/git";
```

It implements:

- actual branch selection and creation;
- real status plus ancestry-derived ahead/behind;
- stage all, per-file and per-hunk stage/unstage;
- per-hunk and selected-file discard;
- commit message and optional exact staged-tree compile gate;
- real named log and branch list;
- merge and structured source/binary conflict resolution;
- unified and split source comparison;
- working/staged rendered PDF comparison and real PDF download;
- smart-HTTP clone URL, username guidance and one-time Git token creation;
- configured remote push/pull/fetch only when a ready grant exists;
- honest adapter reason when remote adapters are not installed;
- explicit disabled write controls for Viewer or offline state.

Primary action: commit the staged source.

Information priorities:

1. actual source differences and rendered comparison;
2. branch, changed files and staging state;
3. named history, merge and clone/remote details.

Left out on purpose: sample ahead counts, sample GitHub linkage, fake rendered
paper, placeholder push/pull success, decorative metrics, and assistant UI.

Required content retained: branch, actual upstream relation, changes, stage
all/hunk/unstage/discard, commit message, compile gate, history, branches,
merge/conflicts, clone URL/credentials, unified/split/rendered comparison.

Layout: Git workspace - source-control list plus comparison detail and history
support -> list-detail with supporting aside
(https://github.com/changeroa/StyleGallery); scroll owners:
`.git-sidebar`, `.git-diff__scroll`/`.git-rendered`, `.git-history`; anti-patterns:
document-level shell scrolling, nested same-direction scroll owners, fixed
816px mobile panes and horizontally scrolling primary mobile content.

At 390px the screen exposes Changes/Diff/History tabs and one readable panel.
At 1440px it uses the reference three-region hierarchy. Light and derived dark
tokens come exclusively from existing shared variables.

## Verification

Retained terminal receipt:
`tests/ui-editor/git/evidence/verification.txt`.

Backend:

```sh
bun test tests/core/git tests/integration/git.test.ts
```

Exit 0: **38 pass, 0 fail, 182 expectations, 82.56s**.

Browser:

```sh
bun test --parallel=4 tests/ui-editor/git
```

Exit 0: **4 pass, 0 fail, 73.32s**. Each file ran in a fresh Bun worker.
This avoids the inherited native-admission epoll descriptor being reused after
a previous application in the same worker closes; assertions were not retried,
skipped or weakened.

The browser suite observed real hunk/commit state, preserved unstaged source,
real PDF-diff artifacts, named branch creation, one-time token creation,
actual CLI clone, structured conflict completion and server-enforced Viewer
denial.

Static/build:

```sh
bun node_modules/typescript/bin/tsc --noEmit -p tests/core/git/tsconfig.json
bun node_modules/typescript/bin/tsc --noEmit -p tests/ui-editor/git/tsconfig.json
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings \
  services/core/git packages/contracts/src/projects.ts \
  packages/contracts/src/routes-core.ts apps/web/src/features/editor/git \
  tests/core/git tests/integration/git.test.ts tests/ui-editor/git
bun <frontend-skill>/scripts/perfection/check-draft-guard.ts \
  apps/web/src/features/editor/git
bun run build
```

All exit 0. Draft guard: 8 files clean. Production web/server/repository/compiler
bundles build successfully. Vite retains its non-failing existing >500 kB main
chunk warning; no behavior was removed to hide it.

Repository-wide `bun run typecheck` is blocked only by the concurrent
out-of-scope adapter test change at
`tests/integration/adapters/harness.ts:18:66` (`Result<T>` data narrowing).
Both owned strict TypeScript targets are clean.

Fresh inspected captures:

- `tests/ui-editor/git/evidence/git-1440-light.png`
- `tests/ui-editor/git/evidence/git-1440-dark.png`
- `tests/ui-editor/git/evidence/git-390-light.png`
- `tests/ui-editor/git/evidence/git-390-dark.png`

The captures show no blank principal region, viewport overflow, clipping or
overlap. Mobile uses one primary panel and 44px controls. Dark and light retain
readable change colours and focusable controls. The parent still performs the
phase’s final independent assembled-browser QA.

## Cleanup and review

All final fixtures awaited browser, web/API listeners, compiler/runtime and
temporary roots. Intentionally interrupted intermediate runs left two owned
orphan Vite helpers; only those exact PIDs and only this run’s 17:04+ temp roots
were removed. Final receipt: `GIT_OWNED_TEMP_ROOTS_ABSENT`.

Pre-existing 15:xx helper processes and existing IPv4 5173 plus IPv4/IPv6 3001
listeners remain untouched.

Post-write review:

- files have one named responsibility;
- largest new backend file is 233 pure lines;
- `useGitWorkspace.ts` is exactly 250 pure lines and is in the warning band:
  the next added action should split the loading state from action orchestration;
- boundaries parse existing Zod contracts;
- merge results are discriminated and handled exhaustively;
- no `any`, type assertions, non-null assertions, suppressions, swallowed errors,
  fake counts, fake PDF, duplicate Git authority or no-op actions were added.

External remote adapters and assistant implementation remain required later
work and are not claimed complete here.
