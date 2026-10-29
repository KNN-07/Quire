# P36 native ZIP operation continuation

October 28, 2026. FINAL scoped native ZIP continuation fix.

`InterchangeImports.create` publishes native ZIP/DOCX/Markdown/Open-in operations
through `recordOperation`, with a single imported ID in `result.projectIds`.
`OperationStatus.tsx` previously read only singular `result.projectId`, leaving
successful ZIP imports without their Open imported project action.

The consumer now accepts exactly one valid plural project ID for `*-import`
operations, while retaining the existing singular result contract. A source
export or bulk operation with projectIds does not acquire an import action.
The reserved `NewProjectDialog.tsx` and core writer were not edited.

The new native browser scenario uses a real ZIP and existing upload dialog,
expects the actual plural operation result, clicks Open imported project,
checks exact document bytes before/after reload, then verifies a real bulk
source-export operation offers download rather than import continuation.
Four responsive-theme captures are produced.

Touched-source hashes, strict TypeScript and typed deny-warning lint are
retained in `docs/evidence/p36-import-continuation/verification.log`;
`P36_STATIC_EXIT=0` and `P36_TEST_EXIT=0` are observed. The browser passed
one test with 11 assertions in 51.39 seconds under
`mon_TT6B3YPG1B3A9M10`, session `bash_400`, completed exit 0.
The actual ZIP operation was `ffe1881e-a842-42cf-b66b-716fb0d13115`, with
project `00464c4b-1f2b-410f-81f0-92a15a4cc565`; the separate export kind was
`bulk-download` and did not offer the import action.

Parent opened all four 1440/390 light/dark captures in
`docs/evidence/p36-import-continuation/89979385-2639-45eb-a159-f5d633c4cd6e/`.
The real succeeded ZIP result and Open imported project action are visible
within the actual dialog, without overlap. Clicking it reached the editor;
exact imported source bytes survived reload.

The root `/tmp/quire-ui-integrations-tgaa1K` is independently absent and
owned web/API ports 35377 and 43627 refuse connections. This correction is separate from
P34's persisted import attempt/reload recovery requirement; it does not
claim that saving an operation result alone supplies resumable onboarding.
