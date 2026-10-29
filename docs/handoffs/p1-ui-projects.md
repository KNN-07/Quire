# P1 projects UI

Owner: projects product UI lane. Date: October 26, 2026.

## Integration contract

Exports from `apps/web/src/features/projects/index.tsx`:

- `ProjectsPage`, with `{ readonly path: string; readonly client:
  ReturnType<typeof createClient>; readonly navigate: (path: string) => void;
  readonly onSessionChange: () => Promise<void> }`.
- `NewProjectDialog`, `NewProjectDialogProps`, `NewProjectMode`, `ProjectsPageProps`.
  The dialog takes the injected client and navigate, controlled open/onClose,
  onCreated(Project), optional initialMode and initialTemplate.

The router supplies its CSRF-aware client. No competing global client, package,
router, primitive, global stylesheet, migration or server registration is authored.
Registered endpoints: **none**; this is the assigned UI consumer lane, not K/X.
No `register(ModuleContext)` no-op is exported.
`ProjectsPage` navigates successful projects to `/projects/:id/edit` and settings
to `/settings/profile` or `/settings/connections`. Router composition is required.

Consumed endpoint names: `projectList`, `projectCreate`, `projectGet`,
`projectPatch`, `projectCopy`, `projectBulk`, `projectDelete`, `projectLeave`,
`projectTags`, `tagsList`, `tagCreate`, `tagPatch`, `tagDelete`,
`templatesList`, `organizationsList`, `environmentsList`, `connectionsList`,
`importCreate`, `operationGet`, `operationDownload`.

The lead-owned `ProjectSummary` and per-item bulk-version corrections in
`p1-contract-deltas.md` are required. List rows use ownerName/tagIds/role.
No raw Git secret crosses this UI; saved ready grant IDs are selected.

## Screen brief and layout

Primary action: New project on the dashboard, the mode-specific creation action
inside the dialog. Priorities: project results, filters, template discovery.
Required content: five project lists, title/owner/edited/Git/compiler columns,
project selection, bulk archive/trash/restore/download/tag controls, tag CRUD,
copy/rename/leave/permanent delete, template search/category/selection,
five creation tabs, project name/workspace, compiler/environment/example,
ZIP selection/drop, repository URL/branch/saved credential, error and job states.
Left out on purpose: fabricated counts, workspace names, fake Git ahead/behind
and collaborator timestamps, artificial template data. Neutral document
illustrations match the reference's schematic grammar; they are not compiled previews.

Layout: dashboard - navigation beside results -> fixed-sidenav-shell
(https://raw.githubusercontent.com/changeroa/StyleGallery/main/patterns/viewport-shell/fixed-sidenav-shell.md);
scroll owner: document; anti-patterns: unbounded table width and mobile two-axis scrolling.
Layout: creation - bounded overlay -> imposter
(https://raw.githubusercontent.com/changeroa/StyleGallery/main/patterns/overlay-exceptions/imposter.md);
scroll owner: .q-modal; anti-patterns: offscreen footer and background scroll.
P69 supersedes that creation-only scroll owner with
`.p-create-dialog > .q-modal__body`; the dialog clips overflow and keeps its
header/footer outside the body scroller. Its current probes and captures are
recorded in `docs/handoffs/p69-project-choices.md`. The original P1 verification
below remains historical.
Desktop table reflows into labeled cards at 760px; navigation moves to a modal
drawer. Tokens and actual shared primitives come from the established P0 surface.
There is no before capture because this feature did not exist in the P0 router.

## Verification commands

Run from the repository root using native Bun 1.3.14:

```sh
bun tests/ui-product/projects/run-browser.mjs
./node_modules/.bin/tsc --noEmit --strict --noUncheckedIndexedAccess \
  --exactOptionalPropertyTypes --verbatimModuleSyntax --noFallthroughCasesInSwitch \
  --noPropertyAccessFromIndexSignature --moduleResolution Bundler --module ESNext \
  --target ESNext --jsx react-jsx --skipLibCheck \
  apps/web/src/features/projects/index.tsx tests/ui-product/projects/preview.tsx
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  apps/web/src/features/projects tests/ui-product/projects
bun /home/norman/.omo/binary-runtime/5.1.48/plugin/skills/frontend/scripts/perfection/check-draft-guard.ts \
  apps/web/src/features/projects tests/ui-product/projects/preview.tsx
wc -l apps/web/src/features/projects/* tests/ui-product/projects/*
```

The browser harness bundles real React with the actual client and self-hosted
fonts. An ephemeral loopback HTTP server validates requests and output with the
public registry. It checks CSRF, required idempotency keys, independent resource
versions and If-Match headers. `QUIRE_BROWSER_LIBRARY` can override the local
Omowright module location. The Chromium executable is documented in the runner.

The behavioral checks use Given/When/Then cases and bounded MutationObserver
signals, not sleeps. They distinguish selected-set archive/restore/trash,
title/owner search and sorting, additive bulk tags, copy and confirmed permanent
delete, template version IDs and categories, RGB normalization/tag CRUD, source
ZIP byte requests, conflict selection retention, blank engine settings,
settings retry without duplicate creation, and three real HTTP import errors
with no manufactured project.

Earlier exact failures are preserved in `docs/evidence/p1-ui-projects/failures.md`;
the TypeScript-7-only skill checker is unavailable against this pinned TypeScript
5.9.3 installation. The owned strict compiler and type-aware lint remain required.

No whole-repository build/typecheck, Lighthouse, react-doctor or react-scan score
is claimed. Dependency installation and entrypoint instrumentation belong to the
foundation lane and were prohibited here. The native isolated frontend build is
part of every browser run. Unrelated IPv4 5173/3001 listeners are never touched.
The root ignore rule excludes `docs/evidence/**`; the lead must explicitly retain
this lane's evidence with `git add -f` in its authorized commit. This lane neither
staged files nor created a commit.

## Final results and evidence

- Final strict compiler, type-aware Oxlint, and draft guard commands above all
  exited 0. Draft guard checked nine authored source/preview files and reported
  clean. Final combined run ended `PROJECTS_FINAL_VERIFIED`, exit 0.
- LSP reported zero diagnostics for all six owned TSX files, `api.ts`, and the
  preview. Largest source: `NewProjectDialog.tsx`, 174 raw lines. Largest test:
  `browser-checks.mjs`, 170 raw lines. These conservative counts are below
  both the warning band and pure-line ceiling.
- Native Bun's isolated React build succeeded. Browser run printed
  `PASS 1440 light`, `PASS 1440 dark`, `PASS 390 light`, `PASS 390 dark`,
  then `PROJECTS_VERIFIED`. Desktop is 1440x900, DPR 1; phone is true iPhone-14
  emulation, 390x844, DPR 3. The four cases made 82, 10, 12 and 12 checked HTTP
  requests respectively. Sixteen behavioral outcomes passed.
- All four cases had no horizontal document overflow. All five creation modes
  fit each viewport, all five footers were reachable after scrolling, and the
  background was scroll-locked. Both phone cases drove the visible filter
  drawer to Archived and back to All projects. Error, retry and empty states
  passed in every width/theme case.
- Fifty-eight retained PNGs cover dashboard, dashboard end, all five creation
  modes and their scrolled ends, error/empty states and phone drawers.
  `browser-results.json` contains the exact final matrix, behavioral outcomes
  and cleanup receipt. `failures.md` preserves earlier failures and corrections.

Visual review found no blank output, horizontal overflow, overlapping form
fields, or unreachable creation footer. The primary action remains visible on
the phone dashboard, fields stack, and project rows become labeled cards.
Shared tokens/fonts and light reference geometry are retained. Dynamic API
content replaces sample counts, workspace identity, collaborators and templates;
additional filters, selection and actions are functional requirements, not a
claim of pixel identity with the static sample. Dark/phone layouts are deliberate
extrapolations. No exact pixel-diff or independent-agent visual verdict is claimed
(nested agents were prohibited).

Cleanup: final browser closed, ephemeral loopback HTTP server stopped, and owned
root `/tmp/quire-projects-PaE7zk` recursively removed. The browser profile, build,
generated ZIP, TMPDIR and cache were all beneath that root. Failed runs also
executed the same `finally` cleanup; retained failures do not leave owned
listeners or profiles running. No unrelated listener was stopped. Only allowed
source, tests, this handoff, and retained evidence remain.

## Source review

Each source file owns a bounded UI unit: resource loading, template browsing,
operation display, mutation dialogs, creation, dashboard, or exports. Files are
below 200 raw lines, hence below the 250 pure-line ceiling. API inputs/outputs
cross the shared schema boundary; no replacement DTO, assertion escape hatch,
suppression, secret field or permission bypass was introduced. Mode/action
dispatch is exhaustive. Promise errors become visible scoped errors. No new
logging is introduced. Tests observe browser behavior and real HTTP payloads,
not prose or implementation constants.

## Known integration dependencies

K owns real persistence, authorization and selected-set atomicity. A owns sessions
and organizations. C owns verified environments. X owns import/configuration.
O owns operation status. Fixtures demonstrate protocol/UI behavior, not backend
completion. Real composed API verification remains pending until these modules
and router wiring are integrated.
Completed import operations must expose `result.projectId` as a UUID for the
Open imported project control. Queued operations are refreshed through
`operationGet`; downloadable bulk operations use the known requested action,
not an invented interpretation of the unconstrained operation kind string.

New-project creation uses server defaults and then patches compiler/environment
with the returned project version. If settings fail, the created object is retained
for retry/open rather than silently creating another project. Import errors remain
visible, and accepted imports show the returned operation rather than a fake project.
Operation refresh is explicit; no timing-based polling is used.
Single-resource changes use the version actually shown to the user, so a conflict
is not hidden by silently fetching a newer version before the write. Retrying
post-create settings explicitly reads the already-created resource; it never
repeats project creation. Bulk tag assignment preserves each row's existing
tagIds; because only per-project tag endpoints exist, a later failure reports
the already-completed names rather than falsely claiming batch atomicity.
Unchanged creation retries preserve the same idempotency key, while changed
payloads or file identity receive another key. Credentials reset when switching
import modes, and unavailable connection reads are errors rather than an
invented disconnected state. Tag deletion is independent of unsaved color edits.

The design's raw token input is intentionally a saved connection selector.
The supplied GitHub repository examples and permanently checked sync control
cannot be represented as real imported projects: the UI accepts a repository URL,
reports actual connection state, and directs later sync configuration to Settings.
Actual organization/environment options come from APIs, never the reference's
example Robotics Lab or an uninstalled TeX Live release.
