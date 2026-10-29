# P49 Dropbox folder project creation - FINAL

Status: complete for the scoped native SQLite/blob/Git application and owned loopback Dropbox contract fixture. No live Dropbox success or distributed/PostgreSQL runtime verification is claimed. No commits were created.

## Delivered behavior

Account settings -> Git & integrations -> Dropbox policy & sync now offers **Discover Dropbox folders**, **Inspect selected folder**, main-file/name selection, **Import folder as project**, and **Open imported project**. A user must explicitly import a direct child of the registered `Apps/Quire` App Folder. Discovery and inspection do not create projects.

The existing `POST /api/connections/:id/actions` operation route now supports:

- `discoverFolders`, with empty parameters.
- `inspectFolder`, with `folderId`.
- `importFolder`, with `folderId`, `name`, and an explicitly selected `mainPath`.

These use existing connection version checks, idempotency keys, grant claims and operation receipts. Imports preserve nested source paths and exact binary bytes, reject unsafe/colliding paths and unsupported cloud/symlink content, enforce repository upload/file/text limits, and require an editable `.tex` main containing `\documentclass`. Empty or binary-only folders return an error without creating a project. `.quire-generated` remains excluded.

Migration `064-x-dropbox-folders` adds separate durable preparation reservations and actual folder bindings. A reservation fixes the future project ID before Git preparation. The project, branch, repository metadata, source/documents/snapshot, original folder ID/path, sync baseline, and successful operation receipt publish in one SQL transaction. Grant/configuration/actor/policy changes and an injected late operation-receipt failure publish none of those project records.

Successful repeat imports return the existing project. Concurrent imports are fenced by existing grant/branch claims; explicit retry resolves to the same identity. Prepared rollback recovery reopens the same persisted source/Git intent and reconciles the original operation receipt. Failed/denied preparations remain tracked recovery records, not visible orphan projects or bindings.

Existing UUID-directory enrollment still works and is recognized in discovery as the original project rather than offered as another import. Imported projects immediately join existing two-way synchronization and scheduling. Reads resolve the persisted folder ID; writes use documented folder-ID-relative paths. A same-path replacement cannot receive an in-flight write. A moved original folder pauses synchronization rather than silently rebinding or renaming remote content. Disconnect/reconnect retains the original binding. Existing conflict preservation, generated-output opt-in and archive rules remain in the same sync engine.

## Decision and authorized scope

Explicit discovery/import was chosen over automatic creation, because finding provider content is not consent to create a project.

Calling `CoreProjects.createFromFiles` during adapter preparation was rejected: it would expose a project before the adapter's final authority checks and successful receipt. The parent explicitly authorized the additional paths `services/core/base/projects.ts`, `services/core/base/source-composition.ts`, and `tests/core/base/dropbox-creation.test.ts`. The minimal extraction adds validated `prepareCreation`; optional internal creation metadata lets existing prepared-source finalization publish creation atomically. It checks source/owner/project/branch/publication identities, existing IDs, active actor and current workspace membership.

All other changes remain within the assigned Dropbox adapter/tests, account Dropbox control and adjacent component, adapter contracts, evidence directory and this handoff. `services/adapters/index.ts`, governance/account organization code, README, matrix, and other runbooks were not edited by this task.

## Verification receipts

All commands ran from `/home/norman/Repos/Quire` with `PATH="$PWD/node_modules/.bin:$PATH"` and pinned Bun `1.4.4 (38afee6c8)`. Raw output, UTC start/end, exit values, IDs and per-run hashes are under `docs/evidence/p49-dropbox-folder-project/`.

| Receipt | Result |
| --- | --- |
| `native-final.log`, 17:25:02-17:25:15 UTC | 13 new native tests, 81 Bun assertions, 0 failures, exit 0; exact bytes/Git, original-directory binding, repeat/concurrent/lost-response/restart recovery, late authority denial, invalid/empty/binary/unsupported content and limits, replacement races, UUID reuse guard |
| `native-affected.log`, 17:15:23-17:15:59 UTC | 41 affected Dropbox tests, 0 failures, exit 0; old API, binary/content hashes, source synchronization, conflicts, generated output, scheduler/lifecycle and recovery |
| `authority-core.log`, 17:22:55-17:23:07 UTC | 14 tests, 0 failures, exit 0; archive behavior, policy/claim fencing, ordinary creation/template/import and atomic creation |
| `native-core.log` | All 5 existing prepared-source composition tests passed; this earlier mixed run also retained two new test-fixture failures corrected in later receipts |
| `final-checks.log`, 17:29:12-17:29:39 UTC | Final 3 core creation tests pass; both scoped TypeScript projects and scoped type-aware lint pass; exit 0 |
| `browser-native.log`, 17:26:05-17:27:02 UTC | Real browser workflow passes, 21 assertions, 0 failures, exit 0 |
| `root-checks.log`, 17:30:43-17:31:55 UTC | `bun run typecheck` and `bun run lint` both pass, exit 0 |

Literal acceptance commands:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
./node_modules/.bin/bun test tests/adapters/dropbox/folder-project.test.ts
./node_modules/.bin/bun test tests/adapters/dropbox/folder-project.test.ts tests/adapters/dropbox/api.test.ts tests/adapters/dropbox/sync.test.ts tests/adapters/dropbox/conflicts.test.ts tests/adapters/dropbox/generated.test.ts tests/adapters/dropbox/recovery.test.ts tests/adapters/dropbox/lifecycle.test.ts
./node_modules/.bin/bun test tests/adapters/dropbox/policy.test.ts tests/adapters/dropbox/fencing.test.ts tests/core/base/dropbox-creation.test.ts
./node_modules/.bin/bun test tests/core/base/dropbox-creation.test.ts
./node_modules/.bin/tsc --noEmit -p tests/adapters/dropbox/tsconfig.json
./node_modules/.bin/tsc --noEmit -p tests/ui-product/dropbox-folder-project/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/dropbox services/core/base/projects.ts services/core/base/source-composition.ts packages/contracts/src/routes-adapters.ts apps/web/src/features/account/dropbox-policy.tsx apps/web/src/features/account/dropbox-folder-project.tsx tests/adapters/dropbox tests/core/base/dropbox-creation.test.ts tests/ui-product/dropbox-folder-project
./node_modules/.bin/bun test tests/ui-product/dropbox-folder-project/browser.test.ts
./node_modules/.bin/bun run typecheck && ./node_modules/.bin/bun run lint
```

Native fixtures use real persistent SQLite, blobs, Git objects and source documents, real HTTP/OAuth against owned loopback listeners, and stable seeded actors. Restart means a fresh runtime reopened on the same persistent data; it is not an OS hard-kill claim. Every new native request and synchronization receipt, including errors, is recorded with its actual request/operation IDs in `native-final.log`.

## Actual browser evidence

The browser authenticated normally, completed native OAuth against the owned provider, discovered `/Browser Research`, selected `paper/main.tex`, imported, opened the actual editor, edited, waited for the exact source-save event/revision, reloaded, reopened from Projects, and sent the edited bytes back to the original provider path using native **Sync project now**.

- Project: `eb2888e6-feb0-4956-9f91-e4d7f0a8ef6f`.
- Folder: `id:folder-c0405bb2-6e88-415f-932d-3865a4676a10`, path `/Browser Research`.
- Main file: `5d9adb21-5896-436a-b040-8e1dceef345c`.
- Import operation: `cc11c58a-1d8e-4672-ad8c-5084a8f8d5e2`; request `761a7e1e-0877-40dd-bc3f-0212851e1f30`.
- Subsequent sync operation: `d3c2d904-b72b-4657-8909-672574cb7e43`; request `63ddcd28-7b7c-4027-9e66-7605e68cdc9e`.
- Final source retained the original document and appended `% Native edit persists in the imported Dropbox project.` exactly.

Eight required screenshots were opened and visually inspected in `docs/evidence/p49-dropbox-folder-project/6f73bcc0-46f0-451b-9b2f-67b7ea07a7fe/`: `selection-{1440,390}-{light,dark}.png` and `editor-{1440,390}-{light,dark}.png`. Controls and source were visible, readable and non-overlapping; document scroll width did not exceed the viewport. The mobile form scrolls vertically and the editor wraps its header/source normally.

## Evidence, failures and cleanup

`pre-change.sha256` captures the original owned production files at 16:55:29 UTC, HEAD `17a8dd43e2f6662dad590de746339d24fe6181d4`. `final-hashes.log` captures all final source/test inputs and successful PNG hashes at 17:34:13 UTC. Native-final, browser-native and final-checks receipts retain matching pre/post hashes for their scoped inputs.

Earlier failures are retained rather than overwritten: missing contract barrel exports were fixed with scoped direct imports; the new core fixture explicitly bootstraps its real template; the authority barrier was moved to the actual post-preparation event; Bun matcher typing was replaced with awaited native assertion promises. Browser harness failures came from observing a Vite JavaScript response as JSON, expecting CDP to expose streamed request bodies, and waiting for a hidden `<option>` to have layout. Final tests observe exact API routes/operation kinds and visible DOM/event signals without sleeps.

`cleanup.md` records the exact owned roots/listeners and the one failed-run Vite child cleaned explicitly. The successful browser root was asserted absent; all 13 final native roots were checked absent, and no final owned listener/process remained. Port 5173 and unrelated FastShort were untouched. No real provider account, production data or unrelated workspace change was modified.

Primary Dropbox File Access, list-folder, request/path formats, and Dropbox-owned `files.stone` were consulted before the provider contract changes; the exact URLs and API decisions are in the evidence README. App Folder registration named Quire remains an operator prerequisite. Import targets the user's personal workspace, uses existing policy/authority rules, and invents no commercial entitlement.
