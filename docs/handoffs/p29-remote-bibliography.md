# P29 remote bibliography

Status: FINAL for the P29 owned implementation and recorded loaded-source evidence.
Parent-owned follow-up: [P30 Local Library cancellation](p30-library-cancellation.md), separate FINAL with passing affected validation.
Owner: `st_01a181f9`. Date: October 28, 2026.

## Delivered scope

The actual mounted editor Bibliography panel now has a separate remote
provider search, deliberate query submission, metadata/result selection,
editable bibliography targeting, Copy and Cite. It uses the existing
authenticated search route and authorized citation writer. Local key search
and the account Library remain separate.

Owned source:

- `apps/web/src/features/editor/tools/BibliographyPanel.tsx`
- `apps/web/src/features/editor/tools/RemoteReferencePanel.tsx`
- `tests/ui-editor/remote-bibliography/{fixture.ts,workflow.test.ts,tsconfig.json}`
- `docs/evidence/p29-remote-bibliography/`
- This handoff.

No shared writer, contract, backend, assistant, index, environment, input
fixture or policy file was edited. No commits were created.

## Mechanism and authority

`RemoteReferencePanel` submits `endpoints.referencesSearch` only after Search
provider is activated. It sends the entered query, selected provider and
project ID; it does not automatically transmit typed queries or document
text. Crossref, arXiv, Semantic Scholar and Mendeley are options, not
availability claims. Dimensions is explicitly unavailable and disabled.

Returned title, authors, year, DOI, URL and actual provider/providerId are
shown without relabeling source identity. Literal journal/date are shown
only when supplied by returned BibTeX. The selected BibTeX can be inspected.
The citation key is parsed from that exact BibTeX by the existing
`bibliographyKeys`; no title-based citation/key is invented.

Query/provider changes and Cancel synchronously clear results and selection,
abort the request and advance its generation. Responses and errors are
accepted only for the latest non-aborted generation. A keyed project/branch
panel and unmount cleanup cancel old context. Search and write operations
have separate feedback; live provider errors are preserved.

The parent was told no shared edit was required:
`createToolsActions({...props, refreshWorkspace}).citation(publication,target)`
already supplies the authorization seam. The refresh callback matches
`LibraryPanel`: insert through `insertCommand` at the existing authoring
selection and flush that source handle before structural refresh. Copy
does not insert source text. The bibliography selector permits only editable,
unlinked `.bib` files and requires an explicit choice when several exist.

`createToolsActions.ready(true)` flushes and rereads effective project
access. `services/core/catalog/index.ts` authenticates and authorizes
`files.write`; `catalog/citations.ts` checks it again inside source
serialization, validates the target and writes through `commitSource`.
The new panel does not replace or bypass any of those checks.

`services/adapters/references/index.ts` authenticates the search and
`PublicationRetrieval.search` authorizes project read access before and
after retrieval. Its `retain` stores the raw HTTP response in the native
content-addressed blob store and persists provider/provider ID, endpoint,
retrieval instant, digest and exact publication JSON in
`reference_provenance`. The UI consumes the existing public Publication DTO;
it does not invent or claim a returned provenance DTO.

The local project-record loader now ignores only its own aborted
AbortController request. Other local-load failures are rethrown; remote
provider/search failures are unaffected.

## Verification and retained evidence

All commands used project-local Bun 1.4.4, not shell-default Bun 1.3.14.
The new tests mount the real native application and browser. An owned
loopback HTTP vendor serves real Crossref wire records; there are no
successful API response mocks. A wrapper observes completion while returning
the native handler's actual response unchanged.

Run 3, before the cancellation-only local-load fix, is retained as
loaded-source evidence: `browser-run-3.log` records 2 pass, 0 fail,
61 expectations, exit 0. Strict scoped TypeScript and typed deny-warning
lint also exited 0. Its workflow evidence is under
`cce3eb79-0700-42dd-bc1f-e3bb690e0edf`; boundaries are under
`73d110cd-a9d9-4af8-8141-dd9c5e764bb9`.

The browser tests exercise actual provider metadata, two editable targets,
explicit target selection, exact copied BibTeX, an untouched other target,
source unchanged by Copy, citation insertion at source start, durable
reload, exact raw retrieval blobs and matching retained publication identity.
They also exercise Viewer-readable search with disabled UI writes and a
native HTTP 403, actual unconfigured-provider HTTP 503/error text, disabled
Dimensions, held-response query cancellation/latest-only results, provider
change, real project-to-project switch and project unmount/remount.

After the owned load fix, run 4 passed the boundary selection again. Its
new capture assertion was too broad: it included the separate Local Library
loader. Run 5 reran only the affected Copy/Cite selection with alert ownership
recorded, passing with 55 expectations, 0 failures and exit 0. Final strict
TypeScript and typed deny-warning lint also exited 0. The original full
run 3 remains unchanged; no duplicate live run was started.

Final workflow, alert classification and screenshots:
`d9bb8ba0-9e54-49d0-8c9e-bf7917093027/`.
Final unchanged boundary selection:
`9ae45928-959b-401e-a9a9-dd68dce752e2/boundaries.json`.
Final raw commands/exits:
`browser-run-5.log`, `types-run-5.log`, `lint-run-5.log`; the last passing
boundary run is in `browser-run-4.log`.

All four final `inspect1440/390` light/dark screenshots were opened and
inspected. Remote query controls, selected result metadata and Copy/Cite
actions are visible without overlap or horizontal overflow; recorded root
scroll widths equal 1440 and 390. Screenshots exercise the actual desktop
workspace and mobile Project tools modal, not isolated components.

The final workflow cleanup verifies `/tmp/quire-assembly-vvOBe2` absent,
browser closed, and web/API/vendor listeners on 40481/43711/37345 closed.
The last boundary cleanup verifies `/tmp/quire-assembly-hWvKeD` absent,
browser closed, and web/API/vendor listeners on 42085/37891/36751 closed.
Each earlier fixture also has a retained `cleanup.json`; no owned fixture
root, browser, provider or application listener is left running.
`source.sha256` records the five source/test versions exercised by P29;
its `fixture.ts` checksum is historical after the parent's P30 assertion.
The other four source/test files are unchanged from P29's passing checks.
`evidence.sha256` covers the retained P29-owned evidence and this final
handoff, excluding the parent's newly generated follow-up capture directory.

Exact commands:

```sh
./node_modules/.bin/bun test tests/ui-editor/remote-bibliography
# Final affected selection after run 4's already-passing boundary test:
./node_modules/.bin/bun test tests/ui-editor/remote-bibliography --test-name-pattern "native remote search"
./node_modules/.bin/tsc --noEmit -p tests/ui-editor/remote-bibliography/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings apps/web/src/features/editor/tools/BibliographyPanel.tsx apps/web/src/features/editor/tools/RemoteReferencePanel.tsx tests/ui-editor/remote-bibliography
```

`verification-history.md` preserves earlier failed checks and corrections.
The original schema runtime stack remains verbatim in
`a4849da4-97b3-4bb0-947c-b513d4c063ae/cleanup.json`. That was a fresh
native/Vite fixture; its collector did not timestamp the navigation phase.
An HMR cause is not established. Both fresh run 3 fixtures have empty runtime
error arrays, including reload and project switch. Shared contracts were
not changed by this lane.

Final run 4 and run 5 fresh-fixture error arrays are also empty. The
separately owned Local Library effect displayed its own
`signal is aborted without reason` cancellation alert. Final
`alerts-1440/390-light/dark.json` preserves its exact text and section
identity. Direct Bibliography and Remote references feedback are asserted
clean; no Library failure or live provider error was suppressed, and
`LibraryPanel.tsx` was not changed by this lane.

After P29's run 5, the parent made a separate own-AbortController-only
`libraryList` cancellation correction and added the Local Library no-alert
assertion to this lane's capture fixture. The parent's affected selection
passed one test with 61 assertions in 51.71 seconds; strict TypeScript and
typed deny-warning lint exited 0. Its raw receipt is
`docs/evidence/p30-library-cancellation/verification.log`.
The separate [P30 FINAL](p30-library-cancellation.md) is the verifier's
authority for that parent delta, not a rerun by this lane.

The parent inspected all four screenshots in packet
`756a6127-6245-4156-8425-0fb89f00a8a2`; all four alert records and browser
runtime errors are empty. Its root `/tmp/quire-assembly-6nn3hM` is absent,
and owned ports 41251/40423/36781 refuse connections. That result supersedes
the specific Library cancellation alert. P29's original failure records
and original fixture source hash remain historical, not proof of the
parent's correction. No checks were rerun for this pointer update.

## External gates and claim limits

No live public vendor success is claimed. Operators must configure actual
provider endpoints; Semantic Scholar credentials/limits depend on the
deployment and Mendeley needs a registered application plus a ready account
grant with the required scope. Real credential, disabled-provider, rate,
network and contract failures remain service errors, not fake ready results.

Dimensions still requires the institutional license, tenant endpoint,
licensed authentication/response contract and credentials; that contract is
unimplemented and the UI cannot activate it. ReadCube private partner search
and Zotero bulk-manager workflows are not implemented by this search panel.
This closes the bounded A18/D06 Bibliography-panel workflow, not inline
remote completion, vendor authorization provisioning, every provider's live
integration, PostgreSQL execution or a general bibliographic correctness
guarantee.

The whole repository's unrelated changes and broad suites were not edited
or verified. Earlier schema failure evidence remains a historical shared
runtime finding, not a claimed diagnosis.
