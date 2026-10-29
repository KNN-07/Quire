# P28 workspace dashboard

Status: **FINAL**. October 28, 2026. Scoped workspace filtering is implemented and verified; no commit was created.

## Delivered behavior

The dashboard now has an authenticated Workspace chooser with **All workspaces**, **Personal projects (no workspace)**, and the actor's actual team/institution memberships. Personal means `projects.workspace_id IS NULL`, not "owned by me"; it therefore includes directly shared personal projects. Ownership remains a separate filter.

Storage was traced through `services/core/base/projects.ts`, `source.ts`, `store.ts`, `access.ts`, and the persisted seed. `projects.workspace_id` references an organization, while `members.organization_id` supplies workspace membership. Organization membership does not grant project access: the existing owner/project-member gate remains mandatory.

The new paginated `GET /api/project-workspaces` returns only `{ id, name, kind }` for memberships, with `private, no-store`. It deliberately does not reuse the governance organization directory: that directory includes operator-wide access and a larger policy DTO. Being an installation operator alone grants no dashboard workspace names or workspace-filter access.

`GET /api/projects` now accepts `workspace=all|personal|<UUID>` and defaults to `all`. A UUID requires current workspace membership before any candidate or cursor processing; unknown and unauthorized UUIDs both return `404 NOT_FOUND: Workspace not found`. This filter intersects existing project visibility, actor-local state, ownership, search, tags, sort, and cursor processing. Policy-revoked link memberships are excluded before pagination, so they cannot contribute an item or a next cursor.

All workspaces preserves existing directly shared projects even when the recipient is not a member of their organization. Such recipients cannot enumerate that organization's name in the chooser or use its workspace filter. Explicit workspace selection is a membership context, not an additional sharing grant.

The selected workspace is retained in the dashboard URL. Changing it, including browser Back, clears the page cursor, bulk selection, project action dialog, and transient action error. Reload restores the workspace; existing owner/tag/search behavior is preserved. A denied UUID shows an unavailable choice and the actual native error, with no project rows. Project buttons retain real editor navigation.

## Owned changes

- `apps/web/src/features/projects/ProjectsPage.tsx`
- `apps/web/src/features/projects/projects.css` (four workspace/header rules only)
- `services/core/base/project-list.ts`
- `services/core/base/project-routes.ts`
- `packages/contracts/src/routes-core.ts` (workspace-list endpoint and project-filter field only)
- `tests/core/workspace-dashboard/{fixture.ts,filter.test.ts,tsconfig.json}`
- `tests/ui-product/projects/workspace-dashboard/{browser.test.ts,tsconfig.json}`
- `docs/evidence/p28-workspace-dashboard/**` and this handoff

The pre-existing contract edits, invitations changes, NewProjectDialog admission work, account organization policy, assistant/provider work, installation files, global feature matrix, original inputs, and unrelated shared-tree changes were preserved. No migration was needed.

## Settled checks

All commands ran from `/home/norman/Repos/Quire` using project-local Bun **1.4.4**, revision **38afee6c8**. Raw logs and separate exit receipts live under `docs/evidence/p28-workspace-dashboard/`.

| Check | Exact command | Result / raw receipt |
| --- | --- | --- |
| Focused native and existing dashboard regression | `./node_modules/.bin/bun test tests/core/workspace-dashboard tests/core/base/dashboard.test.ts` | **11 pass, 0 fail, 94 expectations**, exit 0; `native-final.log`, `native-final.exit` |
| Actual mounted browser | `./node_modules/.bin/bun test tests/ui-product/projects/workspace-dashboard/browser.test.ts` | **1 pass, 0 fail, 52 expectations**, exit 0; `browser-02.log`, `browser-02.exit` |
| Strict core/dashboard types | `./node_modules/.bin/tsc -p tests/core/workspace-dashboard/tsconfig.json --noEmit` | exit 0; `types-core-final.log`, `types-core-final.exit` |
| Strict browser types | `./node_modules/.bin/tsc -p tests/ui-product/projects/workspace-dashboard/tsconfig.json --noEmit` | exit 0; `types-browser-02.log`, `types-browser-02.exit` |
| Typed lint | `./node_modules/.bin/oxlint --type-aware --deny-warnings apps/web/src/features/projects/ProjectsPage.tsx services/core/base/project-list.ts services/core/base/project-routes.ts packages/contracts/src/routes-core.ts tests/core/workspace-dashboard tests/ui-product/projects/workspace-dashboard` | exit 0; `lint-final.log`, `lint-final.exit` |
| Changed production file LSP diagnostics | ProjectsPage, project-list, new native test | no errors |
| Scoped whitespace and owned cleanup | recorded command output | exit 0; `cleanup.log` |

Native cases prove personal/shared/team/institution visibility; hidden same-organization projects; independent ownership and private tags; owner-name search; actor-local archive/trash; deterministic pagination and foreign/hidden cursor rejection; persistent results across runtime restart; membership-only workspace pagination; unauthenticated reads; malformed filters; identical unknown/unauthorized denials; operator isolation; and link-policy revocation before cursor counts. The eight existing dashboard tests retain actor-specific tags, detail DTO/ETag, per-item bulk versions, stale/duplicate/unauthorized preflight, transactional rollback, and source-download nonmutation.

The browser uses the existing `connectionApplication`, real application modules, actual persisted memberships/projects and Git-backed creation, authenticated Chromium, and no successful-response mocks. There are 51 allowed team projects, two personal projects (one shared), and one allowed institution project; two additional hidden projects remain excluded. It verifies exact rendered row sets against native responses; a real 50+1 team page transition; selection clearing on page/workspace changes; absence of the old cursor on a new workspace request; workspace reload and Back; institution isolation; editor navigation; denied UUID error/empty rows; and a nonmember's directly shared project with no organization option. It uses response/DOM subscriptions, not sleeps.

## Visual proof

Inspected all four final full-page captures:

- `final/inspect1440-light.png`
- `final/inspect1440-dark.png`
- `final/inspect390-light.png`
- `final/inspect390-dark.png`

The 1440 captures use a 1440 x 1000 viewport; the 390 captures use 390 x 844. Workspace and search controls are visible, nonoverlapping, and within the viewport; the measured document widths are exactly 1440 and 390. Both personal project rows remain readable in light and dark. `browser-02.log` retains the measured rectangles and exact allowed project responses. Desktop uses the project table; mobile retains the existing responsive table treatment. These are scoped workspace proofs, not a whole-product or entire-D07 approval.

## Retained failed receipts

Earlier runs remain intact rather than being relabeled green:

- `native-01` and `native-02`: new test assertions initially compared the full response to an envelope without its runtime `requestId`. Corrected to compare the typed data payload.
- `types-*-01` and `lint-01`: corrected a readonly item accumulator, branded test IDs, fixture tuple typing, a shadowed local, and a duplicate geometry field.
- `browser-01`: reached workspace/page/reset/reload/navigation and captured all four initial frames, then failed the same envelope assertion. Its fixture still disposed. Initial captures remain at the evidence root, separate from `final/`.
- `native-03`: two workspace cases passed, but the additional real link-grant setup omitted its required `If-Match`. The corrected grant/revocation case passed independently in `native-revocation-04`, then the complete focused 11-case selection passed in `native-final`.

There was no blanket whole-repository rerun. The final browser was not rerun after the later native-test-only `If-Match` correction.

## Cleanup and integrity

Both browser fixture roots are absent:

- `/tmp/quire-ui-integrations-t6W3n1` (earlier failed browser run)
- `/tmp/quire-ui-integrations-OGVbC4` (passing final browser run)

Their web/API ports 43743, 38823, 45463, and 40783 are closed. The passing browser asserts removal of its fixture root after async disposal; native fixtures use the existing async-disposable harness. No shared server was stopped and no unrelated files were removed.

`artifacts.sha256` records every retained log, exit receipt, and image. `sources.sha256` records the final owned implementation/tests/configuration and this handoff. Full-file hashes of shared files identify the inspected tree; they do not attribute pre-existing changes to this task.

No requested workspace behavior remains deferred. PostgreSQL-scale execution, avatar work, creation-dialog admission, whole-product visual approval, and unrelated historical acceptance rows were not claimed.
