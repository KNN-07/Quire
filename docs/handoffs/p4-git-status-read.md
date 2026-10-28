# Git status preserves unchanged source authority

Status: FINAL for the backend correction, October 27, 2026.

The benefits browser trace showed successful access reloads followed by
`STALE_VERSION` on selection saves. Persisted events identified new
`tree.changed` and `history.created` records despite unchanged source revision.
`GitRepository.inspect()` called `live()`, which unconditionally committed a
source checkpoint. The editor's metadata refresh therefore advanced the project
version while its sharing panel loaded that same version.

`services/core/git/repository.ts` now reuses an immutable snapshot matching the
current project, branch and source revision under the existing branch lease.
It creates a checkpoint only when that revision has no snapshot. Named branch
initialization and changed-source publication retain their existing behavior.
No stale-write retry or weaker version check was added.

The new regression in `tests/core/git/status.test.ts` first initializes named
history, then verifies repeated status reads preserve the complete project,
snapshot inventory and event inventory.

Before the correction, `bash_216` / `mon_R5D7XH2TFDKQ8X6H` failed as expected:
two status reads changed project version 3 to 5.

After the correction, `bash_217` / `mon_EPFHSN6FWQ85JD29` completed exit 0:
36 Git tests across 13 files passed, with 165 assertions in 68.02 seconds.
The suite includes staging, divergence, comparison snapshots, SSH and HTTP
transport, revocation, fenced recovery, and actual compile-before-commit.
Type-aware lint on both changed files and root TypeScript also passed.
LSP reported no diagnostics for the production change.

Fixture disposal is exercised by the existing await-using harness. This report
does not claim an additional filesystem audit of every Git fixture directory.
The fresh benefits browser matrix is a separate acceptance gate.
