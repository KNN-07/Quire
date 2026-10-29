# P50 Mendeley groups - FINAL

Completed 2026-10-28. Mendeley personal/group selection now creates a durable, read-only linked bibliography and explicitly refreshes the original selected group after browser reload or runtime restart. The provider and native application were exercised only against an owned loopback vendor; this is not a claim of successful live Mendeley authentication.

## Final preview defect and bounded fix

The discovered UI defect was a linked bibliography's Open bibliography button calling `navigation.openFile`, although the editor document transport correctly rejects `editable: false` files. Both the Mendeley linked-file buttons and `BibliographyPanel` linked citation entries now use the same authorized `fileContent` read-only preview. Ordinary editable `.bib` entries still use the existing editable navigation. Neither transport guards nor core permissions were relaxed.

The preview follow-up also closes the asynchronous ownership gap: changing actor, effective role, project/branch, scoped request token, selected source file, linked file identity, path, or digest creates a fresh preview instance. Client changes, unmount, explicit cancellation, and close abort the active request. A completion must still own the active controller and remain unaborted before it can display decoded bytes. Opening again clears old bytes before issuing a new authorized read, and access errors are displayed through the existing Feedback path.

The final native run after this hardening passed in one invocation: **1 full workflow, 0 failures, 44 assertions**, exit `0`, 2026-10-28T17:37:39Z through 17:38:41Z. It re-exercised group selection, original-group refresh, personal compatibility, Owner/Viewer behavior, actual Copy and Cite, ordinary editable bibliography navigation and durable editing, both linked Open paths, and the preview boundaries. A separate small browser producer harness mounts the actual preview with the actual session client and native application: it holds real already-authorized content responses without replacing their bytes/status, changes selected file and then authenticated actor, observes both request aborts, and proves old bytes never reappear. The outsider's subsequent real project read returns the platform's deliberately masked `404` and a visible `Project access required` alert, with no preview content. The preview region exposes zero editable inputs/contenteditable/select controls.

Latest evidence: `docs/evidence/p50-mendeley-groups/714b389c-d35f-44fb-80bb-172bf561b879/`. `preview-boundaries.json` records both aborted stale requests, distinct actual personal bibliography bytes, denied access status/alert, and zero preview mutation controls. The full native editor's `preview-1440-light.png`, `preview-1440-dark.png`, `preview-390-light.png`, and `preview-390-dark.png` all show the actual linked BibTeX bytes and were visually inspected. The blocking mobile Assistant dialog is explicitly closed through its button before opening Project tools; no CSS hides dialogs. `preview-access-denied.png` is the separate component-harness error state, not a native-shell screenshot.

The final focused preview TypeScript and type-aware lint commands exited `0`; raw outputs are `preview-final-tests.log` and `preview-final-static.log`. Fresh LSP diagnostics timed out twice after 3 seconds in this follow-up; the complete focused `tsc` and type-aware lint checks succeeded instead. The earlier provider checks remain the accepted evidence for unchanged provider code and were not broadly replayed.

`preview-post-hashes.log` records the final UI/test files and unchanged guard/dependency hashes: editor `transport/index.ts` remains `5b11afcaaf1024503e3d664f81a1567b65af41e13f5131d3ad5fc51bcec94a8e`, `session-controller.ts` remains `2d85e795d4d15e043a3d138b5ec36a0850a9ce4d57af8683550fff2acf840cfd`, and the parent-owned action contract remains `14df8b1c5616771c0352a23608cda66a85b1191ae1b15ecb84d94f0af3c8cf0a`. Scoped diff whitespace checks exited `0`.

Latest cleanup is complete: `/tmp/quire-assembly-vcyZHe` is absent, the browser is disconnected, owned loopback web/API/vendor ports `46009`, `44491`, and `44781` are closed, and the page-error list is empty. `cleanup.json` retains these results. The preview follow-up's failed first run also cleaned every owned resource; its actual masked 404 corrected a new test's mistaken 403 assumption. A branded-ID test type error and one shadowed callback name were corrected without suppressions. Raw intermediate results remain in `preview-run-1-tests.log`, `preview-run-1-types.log`, and `preview-run-2-static.log`.

## Delivered behavior

- `services/adapters/references/mendeley.ts` lists the authenticated user's paginated V2 groups, validates current group identity/access before group reads, and reads V1 documents with the selected `group_id`. Bulk pagination follows provider next links, checks the selected library stays unchanged, rejects foreign origin/resource links, repeated pages and duplicate IDs, and never substitutes personal documents after a group error.
- `selection.ts`, `bibliography.ts`, and `links.ts` accept a provider-specific Mendeley selection alongside the existing Zotero shape. Both the `bulkBib`/`refresh` operations and native core/interchange link routes persist the group UUID in `reference_links.selection_json`. Refresh consumes that persisted identity, not the current form choice. New personal links explicitly persist `{ "provider": "mendeley", "libraryType": "personal" }`; legacy Mendeley null selections still resolve to the personal library.
- `MendeleyBibliography.tsx` adds account/library selection, authorized group discovery, linked-file creation, read-only opening, and explicit refresh to the actual editor Bibliography tool. The form is a new-link selector, not a retargeting control for existing links.
- `MendeleyBibliographyPreview.tsx` opens immutable linked bytes through the authorized `fileContent` route. Linked `.bib` files cannot use the editable document transport; the new preview avoids that transport rather than marking bulk files editable. `BibliographyPanel.tsx` also routes linked citation entries' Open bibliography buttons to this read-only preview.
- Individual provider search and Copy/Cite remain the existing independent editable-copy flow. Native proof copies an actual Mendeley result to a separate `.bib`, opens it through the real source editor, types into it, observes its durable save, and confirms the linked group bytes remain unchanged.
- Existing Owner checks, live grant claims/configuration checks, source journal, immutable blobs, branch revisions, HTTP receipts, and publication finalization remain authoritative. The native Viewer can list its own authorized groups, but bulk linking is disabled; the server independently returns 403 for attempted Viewer linking.

No shared routes/core files were edited by this child. The parent-owned dependency is the `groups` addition to `AdapterActions.mendeley` in `packages/contracts/src/routes-adapters.ts`, SHA-256 `14df8b1c5616771c0352a23608cda66a85b1191ae1b15ecb84d94f0af3c8cf0a`. The generic connection-action route already accepts the operation.

## Contract and boundaries

The current primary OpenAPI resources were consulted before implementation: OpenAPI `3.0.0`, resource `info.version: "1"`, actual `/groups/v2` operations with group-list/group JSON media types, and `/documents` with its explicit `group_id` parameter. Complete snapshots of these resources, the older official methods guide, official core-resource overview, and pagination guide are retained under `docs/evidence/p50-mendeley-groups/contract/`. `consultation.md` records exact URLs, timestamps, the documentation-index/path distinction, the initial 403 guide URL, and differences between older narrative documentation and the current resource definitions.

Scheduled linked-bibliography refresh does not exist and was not added. The parent corrected the original scheduling assumption and explicitly limited this phase to persistent original-group explicit refresh. Existing Zotero `librarySync` scheduling is untouched; its source hash is unchanged. ReadCube's private approved partner contract remains unavailable and is not solved by this feature. No provider group joining, creation, external write, or live account was used.

## Verification

From `/home/norman/Repos/Quire`, with repository `node_modules/.bin` first in PATH and pinned Bun `1.4.4`, the final focused command passed once: **5 tests, 0 failures, 70 assertions**, raw exit code `0`, 2026-10-28T17:24:16Z through 17:25:17Z.

```sh
PATH="$PWD/node_modules/.bin:$PATH" ./node_modules/.bin/bun test tests/adapters/references/mendeley-groups.test.ts tests/ui-product/mendeley-groups/workflow.test.ts
```

The tests cover paginated authorized group discovery; different personal/group bibliography bytes; group document pagination; selected identity across runtime restart/browser reload; explicit refresh using the original group; typed bulk action refresh; forbidden/removed groups; foreign-origin selections and pagination; repeat-page rejection; Viewer denial; changed provider config/grant fences; disabled/revoked grant rejection; unchanged source on failure; read-only bulk preview; and independent durable editing of the individual copy.

Both focused TypeScript configurations, type-aware lint over all changed source/test files, and scoped `git diff --check` exited `0`. Language-server diagnostics were clean. Commands, UTC times, pre/post hashes, monitor IDs, raw passing output, and honest failed intermediate runs are retained in `docs/evidence/p50-mendeley-groups/commands.md`, `final-tests.log`, `final-static.log`, `post-hashes.log`, and the two `run-2-*` logs. Intermediate failures were corrected, not skipped: mobile Assistant drawer interception, waiting for actual editable transport readiness, and an unbranded test digest.

The initial accepted native group evidence is `docs/evidence/p50-mendeley-groups/a9cff4ae-d524-4b3f-bdd5-50b1383bfd2b/`:

- `workflow.json`: real native request paths/media types, account/project/file/link IDs, persisted group selection, exact initial/refreshed BibTeX and blob hashes, and independent copy identity.
- `viewer.json`: actual Viewer group discovery response and disabled bulk-link control.
- `1440-light.png`, `1440-dark.png`, `390-light.png`, `390-dark.png`: all four inspected. Group selection and linked-file controls are visible, readable, and not overlapped; no horizontal page overflow was observed.
- `cleanup.json`: final owned-resource cleanup, with all checks true and no browser page errors.

Initial accepted native identities: project `94dedf71-89ba-4bf5-b8f8-02ce91e5d8b0`, group `9da69ed0-9d44-3d5f-b999-970f41c94c35`, file `2a20e215-a791-464b-879b-8d1d2700ff65`, link `bf5e5bce-e47b-4978-87a7-35ba88aaf231`. The group bibliography changed from blob `691950e52562134656213eb4f1189261bd7453574624723b5d554bf3c7b72875` to `a50521677ed6b1e49e9df64dd66d5e444dc1a9022a34782ecf0221fca357c337` after the provider source changed, retaining the same file/link/group identity.

## Cleanup and ownership

The initial accepted native data directory `/tmp/quire-assembly-HszJIb` is absent. Its web/API/vendor listeners on loopback ports `37253`, `37307`, and `37819` are closed, and its browser is disconnected. Each previous failed native run also retained successful cleanup evidence. Deterministic adapter fixtures dispose their temporary runtime, provider listener, and data root through async disposal. The latest preview follow-up cleanup is recorded above.

Port 5173 was neither used nor stopped. No shared processes, pre-existing user files, Dropbox/P49 files, governance/P46 files, originals, README files, or feature matrix were edited. Existing unrelated changes in the shared workspace were preserved. No commit was created. No requested explicit-refresh behavior remains deferred; live Mendeley service authentication and scheduled linked refresh are the disclosed boundaries above.
