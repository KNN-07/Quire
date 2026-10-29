# P49 Dropbox folder verification - FINAL

Date: 2026-10-28. Independent auditor: child `st_01a18399`.

## Verdict

**PASS, bounded to native SQLite/blob/Git storage, the real browser application, and the owned loopback Dropbox protocol fixture.** The required explicit folder import, durable original-folder binding, safe publication/retry boundaries, and existing UUID enrollment are supported by source inspection and raw passing receipts. No P0/P1 source defect was found. One nonblocking P2 recovery limitation remains below.

This is not a live Dropbox certification, PostgreSQL/distributed-concurrency result, OS crash/power-loss test, PDF compilation result, or assurance about unrelated workspace changes. No live provider operation, implementation edit, or commit was made by this auditor. The producer handoff `docs/handoffs/p49-dropbox-folder-project.md` was already FINAL and was read, but its summary was not used as the sole proof.

## Prioritized source findings

1. **P2 - a prepared import cannot resume after its grant/configuration version changes, even if authority is subsequently restored.** `services/adapters/dropbox/folders.ts:169-184` persists the original versions and compares them on every recovery; `:220-240` retries without refreshing that prepared authority. Thus a grant/configuration change leaves the reservation as a tracked, fail-closed recovery failure rather than offering a supported reauthorization/reprepare path. `tests/adapters/dropbox/folder-project.test.ts:142-165` and `docs/evidence/p49-dropbox-folder-project/native-final.log:48-68` prove denial and retained recovery failure, not eventual successful reauthorization. The permanent mismatch after a later monotonic version increase follows from the source comparison; that later restoration sequence was not runtime-probed. This does not duplicate or expose a project and does not invalidate the bounded safety verdict. It does limit recovery availability; no self-service cleanup/resume UI is claimed.

No additional blocking source finding remains. In particular, prior failed browser/core fixture runs remain visible in producer logs and are superseded by matching final receipts, not represented as passing runs.

## Evidence chain and reuse

All paths below are repository-relative; commands ran in `/home/norman/Repos/Quire`. HEAD was `17a8dd43e2f6662dad590de746339d24fe6181d4`. The workspace had unrelated concurrent changes; this report is not a repository-wide sign-off.

At 17:45:52 UTC, all **37** entries in `docs/evidence/p49-dropbox-folder-project/final-hashes.log` matched current bytes, including the 27 source/test/configuration inputs and 10 successful browser images. Raw check output is `docs/evidence/p49-dropbox-folder-verification/current-state.log`. Representative final hashes:

- `services/adapters/dropbox/folders.ts`: `b2d0825fd2297e99d53303812cc700eca3e02f5031b9cc5bd0b537119631c5ed`.
- `services/adapters/dropbox/sync.ts`: `8e883a89c3cfe192241b753db33fcf68c1fe87ff4a16406289e1d3adcf5fb123`.
- `services/core/base/source-composition.ts`: `1a91d6e98455a1c54848eef4b27cacdd96f27b50061b6ce88738aa2608ba9474`.
- `tests/adapters/dropbox/folder-project.test.ts`: `ded0053c1a15f795cc33a87e1b73d5dd509d0e0aa9e63178993aab2685186c3d`.

Raw producer receipts were opened and checked:

| Receipt under `docs/evidence/p49-dropbox-folder-project/` | Actual result and reuse boundary |
| --- | --- |
| `native-final.log` | 17:25:02-17:25:15 UTC; exact `bun test tests/adapters/dropbox/folder-project.test.ts` command, matching pre/post scoped hashes; 13 pass, 0 fail, 81 assertions, exit 0. |
| `native-affected.log` | Exact seven-file affected command; 41 pass, 0 fail, exit 0. Its folder implementation/test hashes are older, so this is reused for the unchanged API/sync/conflict/generated/recovery/lifecycle tracks, not substituted for `native-final.log`. |
| `authority-core.log` | Exact policy/fencing/core command; 14 pass, 0 fail, exit 0. The core composition/test hashes are older; final core creation coverage comes from `final-checks.log`, with final composition coverage independently rerun below. |
| `final-checks.log` | Final matching core hashes; 3 creation tests pass, 0 fail; combined check receipt exit 0. It does not print individual TypeScript/lint command lines; those commands are enumerated in the producer handoff, so the receipt proves the combined successful run rather than a separately instrumented exit per subcommand. |
| `root-checks.log` | Literal `bun run typecheck && bun run lint`; exit 0, 17:30:43-17:31:55 UTC. |
| `browser-native.log` | Exact browser command; matching pre/post source/harness hashes; 1 pass, 0 fail, 21 assertions, exit 0. Real API operation/request IDs, source contents, provider path, root and listener ownership are recorded. |

The subsequent parent-integrated increment is also reused: `docs/handoffs/p53-integrated-validation.md`, `docs/evidence/p53-integrated-validation/build.log`, and `docs/evidence/p53-integrated-validation/static.log`. The auditor read the complete build receipt in bounded chunks and independently compared all 671 before/after hash pairs: identical. Its literal `bun run build` finished with `P53_BUILD_EXIT=0` at 17:39:40 UTC. All 19 P49 production paths in that receipt, including the parent-authorized `services/core/base/projects.ts` and `services/core/base/source-composition.ts`, matched current bytes at 17:52:11 UTC. The newer root typecheck/lint receipt finished with `P53_STATIC_EXIT=0` at 17:42:19 UTC, after the four final P50 preview-test inputs; their recorded hashes also match current bytes. The existing bundle-size warning remains unsuppressed. Exact comparison results are retained in `docs/evidence/p49-dropbox-folder-verification/integrated-reuse.log`. No broad build/static check was repeated. These integrated receipts complement the final P49 core creation regressions and independent composition run; they add no live/distributed Dropbox claim.

Only missing/suspect focused checks were run. The retained auditor probe is `docs/evidence/p49-dropbox-folder-verification/focused.test.ts`; its SHA-256 is `75ad7f0b11eb0e667ceab90d9571a148e169f0b6f4f1ca224e618c948a214cf8`.

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
./node_modules/.bin/bun test docs/evidence/p49-dropbox-folder-verification/focused.test.ts tests/core/base/source-composition.test.ts
```

`docs/evidence/p49-dropbox-folder-verification/focused.log` preserves raw output, command, hashes, operation/request IDs and exit: Bun 1.4.4, **8 pass, 0 fail, 35 assertions, exit 0**, 17:44:37-17:44:41 UTC. These are three new boundary probes plus the five existing prepared-source composition tests at the final implementation hash. No passing unchanged broad suite was rerun.

## Requirement verification

### Explicit creation and original-folder identity

`services/adapters/dropbox/index.ts:51-57` registers discover/inspect/import as separate actions. `apps/web/src/features/account/dropbox-folder-project.tsx` sends real native actions, requires folder/main/name selection, and derives its open-project link from the successful operation result. Neither discovery nor inspection creates project records.

`services/adapters/dropbox/folders.ts:49-65,128-206` and migration `064-x-dropbox-folders` distinguish a prepublication reservation from a successful binding. Bindings persist `(grant_id, folder_id, project_id, path)` with uniqueness constraints. `services/adapters/dropbox/sync.ts:58-66` retrieves that binding, validates original folder metadata by ID, and lists by ID; `api.ts:24-30,121-135` uses folder-ID-relative writes/deletes with revision checks, `strict_conflict: true`, and `autorename: false`. The branch/root passed into merge/generated-output logic is the persisted original path, not a synthesized project UUID directory.

The native original-folder test (`tests/adapters/dropbox/folder-project.test.ts:43-91`, raw `native-final.log:24-32`) verifies nested source, exact binary bytes, actual Git checkpoint contents, fresh-runtime restart, both sync directions, and no write to `/<project UUID>/...`. Same-path replacement and an in-flight replacement upload both fail with 409 while leaving replacement bytes intact (`native-final.log:80-87`); the latter asserts the actual write argument is `<original folder ID>/paper/main.tex`.

Independent probe evidence additionally proves disconnect -> fresh runtime -> `initialSync` reconnect keeps the original binding and imports an original-folder edit. Its project is `1e4a70f9-3d09-4a4a-89a6-b1f40e339a5a`, bound to `id:folder-36de4807-3d1a-41f6-8048-5b0ebda5edf4`. The moved-folder probe changes only the returned stable-ID metadata location, receives `DROPBOX_FOLDER_MOVED`, observes no provider writes, and retains `/Audit` locally. This is a controlled metadata contract case, not a live remote move.

There is no remote folder-rename call in these paths; a moved original pauses rather than silently rebinding.

### Retry, concurrency, restart and current authority

`services/adapters/shared/operations.ts:31-105` validates grant ownership, acquires the grant claim, checks request digest/idempotency and cursor, and repeats grant/actor/project/configuration checks inside the successful receipt transaction. `folders.ts:131-184` reserves one future project identity and holds a branch lease before preparation; its saved payload binds actor, grant/configuration versions, project and folder ID.

`folders.ts:193-207` publishes project/source metadata, original binding and sync baseline in the same caller-owned SQL transaction as the successful operation/cursor receipt. `services/core/base/source-composition.ts:28-92` checks the actual repository intent/checkpoint, branch lease, owner/source/project identities, active user and workspace membership before source finalization. A Git preparation/reservation is not asserted to be a visible project.

The final native tests prove:

- Concurrent import receives `GRANT_BUSY`; discarded-success-response replay after fresh runtime returns the same original operation/project, and a new-key repeat still leaves exactly one project/binding.
- Injected failure on the final successful-operation update rolls back project/branch/repository/file/snapshot/binding counts together; restart reconciles the original receipt to the same reserved project ID.
- Policy denial, disabled/version-changed grant, changed provider configuration and suspended actor after preparation prevent publication; restart does not expose those projects. These are negative authority cases, not merely preflight parameter rejection.
- Stale grant and deny-wins policy fail before provider I/O.

Exact raw cases and IDs are in `native-final.log:33-68,88-91`. Existing policy/fencing/recovery receipts also cover in-flight grant-ciphertext revocation, late policy denial, conditional-delete races, stale cursors, uncertain uploads, conflict preservation, and prepared-source recovery. A replay of an already durable receipt performs no new project publication or provider dispatch; it is not a claim of renewed authority.

### Binary, path, limits and main-file handling

`folders.ts:67-109` validates selected scope, normalized project-relative paths, case-insensitive collisions, downloadable/symlink metadata, upload entry and aggregate byte limits, exact revision downloads and an editable `.tex` candidate containing `\documentclass`. `api.ts:108-118` verifies download identity/revision/size/content hash. `services/core/base/projects.ts:78-112` and `limits.ts:6-45` apply file-count, editable-byte and aggregate-text limits and validate the explicitly selected main during creation. Oversized/non-UTF-8/NUL data is not silently decoded as editable text; binary blob bytes remain intact. Generated namespaces are excluded.

The final native receipt covers empty/binary-only folders, traversal, non-downloadable metadata, binary-as-main rejection, corrected reservation selection, byte/entry limits before downloads, nested paths, binary bytes and Git bytes. The independent probes close missing runtime coverage for symlink rejection (422), case collision (409), and aggregate editable-text limit (413), asserting no new project/binding for all three. No fabricated project is returned on these failures.

### Existing UUID enrollment

`folders.ts:54-58,75-79` recognizes existing `dropbox_sync` UUID enrollment and prevents duplicate folder import. `native-final.log:92-99` records actual `initialSync` and later sync to the seeded UUID root, discovery returning its existing project ID, and `DROPBOX_ALREADY_CONNECTED` on attempted import. The test asserts unchanged project counts and no new folder binding.

### Protocol and native browser evidence

`tests/adapters/dropbox/provider.ts` was inspected directly: it provides real loopback OAuth/bearer checks, paginated list/continue with root and recursion scoping, stable folder IDs, immutable revision downloads, content hashes, folder-ID-relative writes, strict revision conflicts and conditional deletes. Its route barriers are exact event promises, not sleeps. The fixture is an owned contract implementation, not Dropbox itself.

The auditor also read the public Dropbox File Access guide and request/response path-format reference on 2026-10-28. Those describe stable IDs, revision references, application-root-relative paths and the `id:<folder>/child` form, consistent with the source. Documentation GETs did not use any provider account or live file API. Reference locations are also recorded in `docs/evidence/p49-dropbox-folder-project/README.md`; no undocumented live-vendor success is inferred.

The actual browser test and raw receipt were read. They authenticate normally, complete owned OAuth, discover/inspect/import, open the actual editor, assert original source, insert text, await the exact `document.saved` event/revision, reload, reopen via Projects and sync edited bytes back to the original folder. Project `eb2888e6-feb0-4956-9f91-e4d7f0a8ef6f`, import operation `cc11c58a-1d8e-4672-ad8c-5084a8f8d5e2`, and later sync `d3c2d904-b72b-4657-8909-672574cb7e43` match the raw receipt.

All eight required PNGs were independently opened and visually inspected, not just listed or hashed. Exact directory:

`docs/evidence/p49-dropbox-folder-project/6f73bcc0-46f0-451b-9b2f-67b7ea07a7fe/`

Files: `selection-1440-light.png`, `selection-1440-dark.png`, `selection-390-light.png`, `selection-390-dark.png`, `editor-1440-light.png`, `editor-1440-dark.png`, `editor-390-light.png`, `editor-390-dark.png`.

Desktop/mobile forms show readable folder/main/name/import controls without overlap; mobile uses vertical scrolling. Editor screenshots display the original paper and persisted edit in both themes, with a wrapped mobile header/source and saved status. They explicitly show "Not compiled"; no compiled-PDF success is claimed.

## Cleanup and final scope

Producer cleanup was not accepted solely from prose. `browser-native.log` records `P49_CLOSED` and asserted `P49_ROOT_ABSENT /tmp/quire-p49-folder-1njmtA`; `native-final.log` records 13 exact `DROPBOX_CLEANED` roots/listeners. The auditor independently checked all 13 roots, the successful browser root and the earlier failed-run root `/tmp/quire-p49-folder-TFG9Yl`: all absent. The exact producer 29 ports and auditor six ports had no listener match at 17:45:52 UTC. The earlier failed-run PID removal is a historical producer receipt in `cleanup.md`; this auditor verified present absence, not the past signal delivery.

The independent probes disposed `/tmp/quire-p2x-base-5g0BvP`, `/tmp/quire-p2x-base-j8fYah`, and `/tmp/quire-p2x-base-ipxPxd`, with exact API/provider ports in `focused.log`. All three roots were checked absent. The five existing core tests use the `await using` cleanup in `tests/core/base/harness.ts`; a 17:48:18 UTC `find /tmp -maxdepth 1 -name 'quire-p1s-core-base-*' -print` returned no roots. Those five tests do not emit individual root IDs, so there is no invented per-root historical receipt.

`current-state.log` retains a failed first process-filter quoting attempt and the corrected 17:46:03 UTC command with `NO_OWNED_PROCESS_MATCH`, exit 0. Hash, root and listener checks were unaffected by that process-filter error. Unrelated FastShort still owns port 5173; nothing unrelated was stopped or removed.

Only this report and `docs/evidence/p49-dropbox-folder-verification/` were written. The retained probe is evidence, not a production implementation change. **Final bounded verdict remains PASS with the P2 recovery-availability limitation above; no owned probe resources remain.**
