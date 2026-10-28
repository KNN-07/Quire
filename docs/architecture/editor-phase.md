# Editor implementation phase

Preparation checkpoint, October 27, 2026. This is an execution boundary, not
implementation evidence. Start after portable-storage acceptance; preserve
its final test input until the independent verifier finishes.

## Confirmed starting surface

`apps/web/src/router.tsx` currently renders an explicit unavailable message
for all seven project editor routes. No editor feature directory exists.
The router already owns navigation, session refresh and a CSRF-aware typed
client from `apps/web/src/session.ts`. Successful project creation already
navigates to `/projects/:id/edit`.

The root manifest already pins CodeMirror 6, its search/lint/completion
packages, Vim/Emacs extensions, Yjs, y-codemirror.next and PDF.js. Reuse
those versions; any additional dependency is a foundation-owned change.
Shared primitives are exported by `apps/web/src/ui/index.ts`.
The product UI contract is recorded in `docs/handoffs/p1-ui-projects.md`.

Existing compiler contracts expose `compileCreate` and `compileGet` by job
ID. The editor needs authorized discovery of the current branch's active
job and last successful ordinary preview after reload, without relying on
browser storage or accidentally selecting a PDF-diff job. Resolve this
contract explicitly before the PDF consumer starts; inspect actual compiler
persistence first rather than inventing a second source of truth.

Confirmed implementation: `services/compiler/service.ts:240` publishes
`compiler_previews` from successful ordinary requests (`preview=1`), ordered
by source revision, queue time and queue order. Historical/diff requests are
excluded. `services/compiler/index.ts:55` authorizes a known job and exposes
the last artifact and stale status in response headers. The new discovery
route should reuse this state and authorization, return typed nullable job/
preview data for an uncompiled branch, and preserve the existing header API.
Its tests must cover reload, no job, failed latest compile retaining an old
PDF, branch isolation, unauthorized access and exclusion of PDF-diff work.

The collaboration wire schema is `packages/contracts/src/events.ts`, not a
separate realtime module. Updates carry file ID, epoch, client ID, sequence
and Yjs bytes. Save state must wait for the matching server `ack` carrying
revision; sending a frame is not persistence evidence. Sync uses a state
vector, and errors can carry recovery text. The UI must retain unacknowledged
local work on disconnect and expose recovery on epoch/access rejection rather
than replacing it silently.

## Components and write boundaries

The editor run has six components: shared workspace state, authoring,
files/tools, compilation/PDF, collaboration/review, and named version control.
Assistant UI is composed after the adapter phase publishes its real contract.
Its later delivery remains required, not replaced by an unavailable button.

Every producer owns its tests and one bounded handoff under
`docs/handoffs/p2u-<node>.md`. Every handoff records exact exported signatures,
commands, exit codes, screenshots and owned-resource cleanup. No producer
edits a sibling directory, root dependencies or the application router.

| Node | Exclusive authored paths | Input and deliverable |
| --- | --- | --- |
| contract | `apps/web/src/features/editor/shared/**`, `tests/ui-editor/shared/**` | Freeze injected client/session, project/branch/file state, source selection and navigation interfaces. Specify panel contracts before parallel consumers. |
| transport | `apps/web/src/features/editor/transport/**`, `tests/ui-editor/transport/**` | Persistent Yjs acknowledgments, reconnect, epochs, current authorization and presence through the existing real protocol. |
| source | `apps/web/src/features/editor/source/**`, `tests/ui-editor/source/**` | CodeMirror, syntax/completion, outline, local search/replace, keymaps, source diagnostics, preference application and Unicode. |
| visual | `apps/web/src/features/editor/visual/**`, `tests/ui-editor/visual/**` | Lossless interval editing, source islands, math, tables/TSV, figures and source-preserving round trips. |
| tools | `apps/web/src/features/editor/tools/**`, `tests/ui-editor/tools/**` | File tree mutations/uploads, project search, symbols, bibliography insertion, settings and approved optional browser execution. |
| pdf | `apps/web/src/features/editor/pdf/**`, `tests/ui-editor/pdf/**` | Actual compilation lifecycle, last-good preview, PDF.js/browser viewer, SyncTeX, diagnostics/logs/artifacts and rendered comparison. |
| review | `apps/web/src/features/editor/review/**`, `tests/ui-editor/review/**` | Sharing, anchored threads, proposals, chat, history comparison/labels and restore using server-enforced roles. |
| git | `apps/web/src/features/editor/git/**`, `tests/ui-editor/git/**` | Real staging/hunks, branches, commits/compile gate, clone credentials and merge/conflict UI. Remote actions consume configured adapter results. |
| assemble | editor root entry/layout/styles only; root router through F | Compose the actual reference workspace and project routes from the exported panels. No parallel edits to consumer files. |
| verify | `tests/ui-editor/acceptance/**`, `docs/evidence/p2u/**` | Independent real-service desktop/mobile browser acceptance; report findings without silently editing producer code. |

The foundation owner supplies any server/contract delta as a separate
serialized prerequisite with its regression tests. Foundation also owns
the router mount and final package/build changes. Compiler changes belong
to the compiler owner, not a PDF component worker.

## Dependency topology and routing

Before launching, translate this preparation into one phase-scoped DAG with
all stages defined:

1. `contract` freezes interfaces; independently resolve the preview endpoint
   through foundation/compiler ownership.
2. `transport` consumes the shared contract.
3. `source`, `visual`, `tools`, `review` and `git` consume the frozen shared
   and transport contracts. `pdf` also consumes the verified preview delta.
4. `assemble` consumes every producer handoff and mounts the exported UI.
5. `verify` depends on assembly and runs the full phase acceptance surface.

Contract design is `deep-high` because it crosses UI and transport ownership.
Transport is `deep-low` because convergence and authorization must follow
the existing server protocol. UI producers and assembly are
`unspecified-high` with frontend/visual QA skills, following the existing
project routing decision; each spans multiple interacting controls and
cannot be replaced by a mechanical file edit. Independent verification is
`unspecified-low` with browser/visual QA skills. Maximum producer wave width
is six; default model slots may queue it without changing ownership.

Execution correction: the configured `unspecified-high` route could not start
its model (`plan_unresolved`, unavailable `anthropic/claude-opus-5-5`).
After the run settled, the six UI producers and assembly were amended in
place to the available `deep-low` route, retaining frontend/visual QA skills,
the same scopes and acceptance requirements. The completed contract, preview
and transport results were reused; their passing checks were not repeated.

Read all feature rows assigned U in `docs/feature-matrix.md`, the original
design and decoded design sources before writing node briefs. Allocate every
row to a producer and acceptance scenario explicitly; the table above does
not narrow the required capability inventory. Preserve original inputs.

## Acceptance boundary

Main-file syntax validation belongs to creation/explicit selection, not each
keystroke. Once selected, an editable main may contain incomplete or invalid
LaTeX; persistence/checkpoints/Git preserve those bytes and the actual compiler
produces diagnostics. The parent regression and correction are recorded in
`docs/handoffs/p2u-invalid-drafts.md`.

Use real native application data and isolated compiler workers, not a
success-only API fixture. Subscribe to exact events before actions and use
bounded signal timeouts, not sleeps. Keep fixture component checks separate
from actual service acceptance.

- Create blank and published-template projects, mutate files, edit, reload
  and reopen; compare persisted bytes and project state.
- Compile valid source, inspect actual PDF text/pages, introduce invalid
  source and inspect source-linked diagnostics without relabeling an old
  PDF as a successful new result.
- Exercise search, bibliography, review, restore, import/export and settings;
  compare two independent browser sessions and require Viewer writes to fail.
- Exercise the source/visual/PDF layouts, tree, Git and sharing through the
  actual controls. Test unsupported visual source preservation.
- Inspect 1440x900 and 390x844 captures in light/dark themes, keyboard focus,
  drawers and modal controls. No blank, clipped or overlapping principal UI.
- Retain browser action logs, screenshots, HTTP results, real PDF and command
  receipts. Record exact research IDs covered and remaining external gates.
- Run related tests, strict diagnostics, lint and production build for the
  final input once. Clean only owned browsers/processes/temporary resources.

The run is accepted only on these observations. A terminal DAG status or an
interim child response waiting for another producer is not acceptance.
