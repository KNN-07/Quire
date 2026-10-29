# P50 Mendeley groups verification - FINAL

Independent audit completed 2026-10-28 by child `st_01a1839b`.

## Verdict

**PASS, bounded to the source snapshot and explicit-refresh scope below.** Accept personal versus authorized-group selection, durable original group identity, explicit manual refresh through both link and adapter-action routes, paginated bulk reads, read-only linked bibliography preview, and separate editable individual Copy/Cite.

Scheduled Mendeley linked refresh is **outside the corrected acceptance scope**, not a missing P50 deliverable or a failing gate. The parent explicitly corrected the original scheduling assumption to durable original-group EXPLICIT refresh; the producer FINAL and `commands.md` record the same decision. No linked-bibliography scheduler existed before this work.

This is not final global P49/core integration certification, successful live Mendeley authentication, or ReadCube parity. The required implementer handoff exists, is explicitly FINAL, and its inspected SHA-256 is `60a31d4882ffada27a3cb0eb0f8f220ce5751d8a63a3d352f4d5e3ea212d4081`.

## Prioritized findings and residual issues

1. **Provider compatibility residual: stricter group responses than the retained OpenAPI minimum.** `services/adapters/references/mendeley.ts:14` requires a UUID `id`, nonempty `name`, and one of four `role` values. The retained Group schema requires only `name` and `access_level`; its `id` is a string and its `role` enum is optional. The owned provider supplies all fields the implementation requires. Missing role/ID or a non-UUID ID would fail closed rather than leak credentials or switch libraries, but broader live response compatibility is not proved. No successful live provider execution is claimed.
2. **Integration boundary: current root static/build passes are accepted, not whole-product runtime certification.** P53 `docs/handoffs/p53-integrated-validation.md` and its raw logs establish root typecheck/lint exit 0 and production build exit 0 after production edits. The auditor extracted all 1,342 before/after fingerprint rows, confirmed 671 matching pairs, and independently compared all 671 current production inputs with zero drift. The four final preview-test inputs also match P53's static receipt. This removes a missing current static/build gate; no broad rerun was needed. The existing greater-than-500-kB bundle warning remains. Independent P49 acceptance and a full repository/runtime suite remain separate; this audit does not certify them.
3. **Evidence limitations, not hidden passes.** The final preview follow-up's fresh LSP calls timed out; the retained focused TypeScript/type-aware lint and subsequent P53 root checks exited 0. The auditor's new evidence probe has clean LSP diagnostics. The native cancellation/error boundary proof uses a separate harness mounting the real component/session/API, not the full editor shell for those transitions. Full-shell screenshots and both actual linked Open paths are separately exercised. Finite caps, duplicate IDs, repeat pages, malformed identity, and foreign links fail closed; an arbitrarily large or malformed provider library is not accepted as a successful import.

No blocking source defect was found within the bounded accepted scope. These residuals must accompany any downstream acceptance statement.

## Source and primary contract review

All paths below are relative to `/home/norman/Repos/Quire`. Original provider evidence root is `docs/evidence/p50-mendeley-groups/`; independent evidence root is `docs/evidence/p50-mendeley-groups-verification/`.

The contract attribution is to retained primary vendor resources, not an invented export API. I inspected `contract/groups-v2.openapi.json`, its GET operation/media-type entries, the document GET `group_id`/`view`/response entries, and `contract/consultation.md`. The retained consultation identifies the exact official API-doc resources and older official pagination/methods/core-resource guides, including the initial failed guide URL and retrieval dates. OpenAPI is `3.0.0`, resource version `"1"`. The documentation resource key is `/groups-v2`; the actual GET path is `/groups/v2`. Group-list Accept is `application/vnd.mendeley-group-list+json`; individual group Accept is `application/vnd.mendeley-group+json`. Documents use `application/vnd.mendeley-document.1+json` and the documented `group_id` query, whose absence means personal documents. No vendor documentation or live account was contacted during this audit.

`MendeleySelectionSchema` and the existing Zotero schema are strict. The former requires `provider: "mendeley"` and the appropriate personal/group shape. The bibliography union is parsed again against the active provider before reading, so a valid Zotero shape cannot become a Mendeley selection. The URL route rejects other origins, credentials, query/fragment, arbitrary group paths, and invalid UUIDs. Explicit personal selection is persisted; legacy null Mendeley selection remains personal.

Both `BibliographySync.refresh` and `BibliographyLinks.refresh` reload `reference_links.selection_json`, not the current UI selector. The former scopes the row to grant/owner/project and checks link version/digest/current source identity. The latter additionally matches branch/file/digest and obtains the row's original grant. Neither refresh accepts a replacement selection. The selected group is re-read for current identity/access before documents are fetched. A failed/removed group stops the operation without substituting personal results.

`Mendeley.read` follows complete next links, verifies the selected `group_id` remains the same (or remains absent for personal), and rejects repeat pages, more than 100 pages, and duplicate document IDs. Group discovery similarly caps/rejects repeated pages and duplicate group IDs. Shared `nextLink` rejects origin, resource-path, and userinfo changes before the next credential-bearing request. Shared `SafeHttpClient` additionally rejects cross-origin redirects carrying headers and TLS downgrade. The audit's in-memory probes exercise the real schema, next-link, JSON, and bulk-read code; they are not real-network redirect tests.

Owner authorization is enforced in actions and link routes, then checked again before publication. Link writes claim the owned, ready grant, check expiry/configuration, assert the claim, and fence grant/config/owner/link identity in finalization statements. Adapter actions reassert the grant claim, configuration capability/version, owner authority, and cursor in the final transaction; source-journal recovery also revalidates authority. The retained provider negative test covers Viewer denial, disabled grants, configuration/grant changes during retrieval, forbidden/removed groups, unchanged source, and empty source intents after failures.

Bulk files stay `editable: false`. The read-only preview uses authorized `fileContent` after fresh access checking; it does not relax document transport guards. Its identity includes actor, role, scope, request headers, source document, linked file, digest, and path. Client changes/unmount/close/cancel abort active requests; stale completions cannot display bytes. Ordinary individual bibliography entries retain editable navigation and use separate unlinked copies.

## Raw execution evidence and reuse decision

The auditor confirmed repository Bun **1.4.4** at `2026-10-28T17:44:30Z`. `source-snapshot.log` retains the actual hash command, output, and exit sentinel. All relevant P50 provider/test hashes match `post-hashes.log`; final preview/UI/test/guard hashes match `preview-post-hashes.log`. Thus unchanged passing provider/native cases were reused instead of broadly replayed.

| Command / receipt | Raw outcome |
| --- | --- |
| `PATH="$PWD/node_modules/.bin:$PATH" ./node_modules/.bin/bun test tests/adapters/references/mendeley-groups.test.ts tests/ui-product/mendeley-groups/workflow.test.ts`; original `final-tests.log`, 17:24:16Z-17:25:17Z | Bun 1.4.4; exit 0; 5 pass, 0 fail, 70 assertions |
| `PATH="$PWD/node_modules/.bin:$PATH" ./node_modules/.bin/bun test tests/ui-product/mendeley-groups/workflow.test.ts`; original `preview-final-tests.log`, 17:37:39Z-17:38:41Z | Bun 1.4.4; exit 0; 1 pass, 0 fail, 44 assertions |
| Focused provider/UI `tsc --noEmit` and type-aware `oxlint --deny-warnings`; original `final-static.log`, `preview-final-static.log`, exact commands in `commands.md` | Each exit 0 |
| Parent `bun run typecheck && bun run lint`; `docs/evidence/p53-integrated-validation/static.log`, 17:41:08Z-17:42:19Z | Root static exit 0; final four preview-test hashes match current inputs |
| Parent `bun run build`; `docs/evidence/p53-integrated-validation/build.log`, 17:39:33Z-17:39:40Z | Exit 0; all 671 before/after/current production fingerprints match; existing chunk-size warning retained |
| Auditor `PATH="$PWD/node_modules/.bin:$PATH" ./node_modules/.bin/bun test docs/evidence/p50-mendeley-groups-verification/focused.test.ts`; independent `focused-tests.log`, 17:47:04Z-17:47:05Z | Exit 0; 3 pass, 0 fail, 26 assertions; monitor `mon_VADDB74J1T428AGE` |
| Scoped `git diff --check`; independent `source-snapshot.log` | Exit 0 |

The additional focused checks close previously missing direct assertions for mixed/cross-provider/extra/missing identity fields, credential/resource/origin next-link escapes, changed group pagination, personal-to-group pagination, repeated document pages, duplicate document IDs, and wrong returned group identity. They use deterministic synthetic transport responses with no sockets, runtime directories, or browser. Only the audited transport's `get` method is replaced; actual parsing and identity/paging logic runs. They do not claim integration publication proof.

`p53-reuse.log` in the independent evidence directory retains the auditor's complete fingerprint-comparison counts and current preview-test hash output. The build/static commands were not rerun: their current matching fingerprints and successful raw exits are sufficient for this bounded audit.

Original intermediate failures remain disclosed in `commands.md` and raw logs: mobile Assistant interception, editable-transport readiness, branded digest/ID type errors, shadowed callback, and the incorrect expected 403 versus actual masked 404. Those are not counted as passing invocations. The final passes are separate, single invocations.

## Native receipts and visual inspection

Latest complete native evidence is `docs/evidence/p50-mendeley-groups/714b389c-d35f-44fb-80bb-172bf561b879/`. I inspected all eight native screenshots: `{1440,390}-{light,dark}.png` and `preview-{1440,390}-{light,dark}.png`. Group selection, linked controls, actual BibTeX bytes, and preview close/refresh controls are visible, readable, and not overlapped. Narrow desktop sidebar text wraps rather than escaping; mobile Project tools fill the drawer width. The Assistant dialog is closed by its real button, not hidden by CSS. The separately inspected `preview-access-denied.png` is explicitly the component harness, not a native-shell screenshot. Screenshot hashes are retained in `receipts-cleanup.log`.

`workflow.json` records project `2bdafb9a-41d0-48d4-a4d4-8a967016ae25`, original group `9da69ed0-9d44-3d5f-b999-970f41c94c35`, file `0a8e7f0e-c5b3-4d91-9634-e91b94e10630`, and link `e39bf659-45ba-4185-8d74-85ab73679d96`. Explicit refresh after browser reload preserves file/link/group and changes blob `691950e52562134656213eb4f1189261bd7453574624723b5d554bf3c7b72875` to `a50521677ed6b1e49e9df64dd66d5e444dc1a9022a34782ecf0221fca357c337`. Provider tests separately prove runtime restart persistence and typed-action refresh.

Native assertions verify both linked Open buttons, exact linked bytes, absence of mutation controls, real individual search/Copy/Cite, and durable editing of a distinct unlinked `editable-copy.bib` without changing linked bytes. `viewer.json` records discovery status 202 with bulk linking disabled; server-side Viewer denial is separately asserted. `preview-boundaries.json` records both stale request aborts, actual distinct personal bytes, zero mutation controls, and denied status 404 with "Project access required."

## Cleanup and audit ownership

The original accepted run owns `/tmp/quire-assembly-HszJIb` and ports `37253`, `37307`, `37819`. The latest preview run owns `/tmp/quire-assembly-vcyZHe` and ports `46009`, `44491`, `44781`. Their raw test logs and per-run cleanup JSON record absent roots, disconnected browsers, closed listeners, and empty page-error lists. The auditor independently checked both roots absent and no listening socket rows for all six exact ports at `17:47:39Z`; command/status output is retained in `receipts-cleanup.log`. Browser disconnection is producer evidence, not a new auditor observation.

The auditor created only this verdict and files under the independent evidence directory. No production or repository test files were changed, no commits were created, no live vendor requests were made, and no shared process or port 5173 was stopped. The focused probe created no owned resource needing cleanup. All audit work is complete within the stated bounded scope.
