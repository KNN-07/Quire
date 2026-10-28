# P2U preview discovery - FINAL

October 27, 2026. Native Bun 1.3.14. Compiler discovery and its read chain are implemented and verified; editor browser QA remains the parent's independent responsibility.

## Exported contract

`endpoints.compilePreview`: `GET /api/projects/:p/compile-preview?branch=<branch>`.
`RequestOf<typeof endpoints.compilePreview>` uses `params: { p: Id }`, `query: { branch: string }` (validated by `BranchSchema`), and `body: undefined`.
`ResponseOf<typeof endpoints.compilePreview>` is:

```ts
{
  readonly job: CompileJob | null;
  readonly preview: {
    readonly artifact: Artifact;
    readonly snapshot: Snapshot;
    readonly stale: boolean;
  } | null;
}
```

The standard result/request-ID envelope is unchanged. The existing injected `createClient` accepts this endpoint directly; no handwritten UI DTO is needed.

`services/compiler/preview.ts` exports:

```ts
branchPreview(context: ModuleContext, request: Request, scope: Scope):
  Promise<ResponseOf<typeof endpoints.compilePreview>>
```

The latest ordinary job is selected by descending durable `queue_order`, scoped to project/branch and `compiler_requests.preview=1`. The published artifact comes only from existing `compiler_previews`. Its own source snapshot is returned separately from the latest job. Staleness means the latest job is not that successful PDF's job, is not successful, or current branch source revision exceeds the PDF's snapshot revision. Missing state is explicitly nullable. Reads share the compiler transaction lock; no second preview table, migration change, browser-storage authority, or dependency was added.

## Authorization and compatibility

Preview, `compileGet`, `compileLog`, and `artifactContent` now use canonical `ProjectPort.authorizeRequest(request, scope, "read")`. Named Viewers, anonymous permitted links, and signed nonmember Viewer/editor links can follow discovery through actual PDF download. GET never enrolls a member. Revoked tokens, disabled sharing, and disabled anonymous reading are checked on each read. These responses use `Cache-Control: private, no-store`.

The parent supplied the additive `ProjectPort.authorizeRequest(request: Request, scope: Scope, action: string): Promise<Id | null>` signature, canonical admitted-link enforcement, and optional `x-project-token` shared client header. The compiler fixture implements the new port method. The typed-client regression exercises all four actual read endpoints and verifies that a later call without a token remains unauthenticated.

Existing `compileGet` ETag, `x-last-successful-artifact-id`, and `x-preview-stale` behavior is preserved and tested. Compile, cancel, cache, and SyncTeX restrictions remain unchanged; link-only readers cannot compile. Historical/PDF-diff requests (`preview=0`) cannot become the latest ordinary job or published preview.

## Terminal evidence

All commands ran from `/home/norman/Repos/Quire`:

| Exact command | Terminal result |
| --- | --- |
| `QUIRE_COMPILER_EVIDENCE_DIR=tests/compiler/evidence-preview bun test tests/compiler/preview.test.ts` | Exit 0; initial 8 pass, 60 assertions. |
| `QUIRE_COMPILER_EVIDENCE_DIR=tests/compiler/evidence-preview bun test tests/compiler/preview.test.ts tests/compiler/preview-access.test.ts` | Exit 0; 17 pass, 138 assertions, 95.93 seconds. |
| `bun test tests/compiler/preview-access.test.ts` | Final exit 0; 10 pass, 86 assertions, 64.31 seconds, including the subsequently added typed-client case. |
| `bun test tests/compiler/http.test.ts tests/compiler/jobs.test.ts tests/compiler/portable.test.ts tests/compiler/migration.test.ts tests/contract tests/integration/p1/application.test.ts` | Final exit 0; 84 pass, 213 assertions, 70.06 seconds. |
| `bunx tsc --noEmit -p tests/compiler/tsconfig.json` | Final exit 0. |
| `bunx oxlint --type-aware --deny-warnings packages/contracts/src/routes-compiler.ts services/compiler/index.ts services/compiler/preview.ts tests/compiler/preview.test.ts tests/compiler/preview-access.test.ts tests/compiler/http.test.ts tests/compiler/fixtures.ts` | Final exit 0. Initial type-only-import lint error was corrected before the final run. |
| `git diff --check -- packages/contracts/src/routes-compiler.ts services/compiler/index.ts services/compiler/preview.ts tests/compiler/preview.test.ts tests/compiler/preview-access.test.ts tests/compiler/http.test.ts tests/compiler/fixtures.ts` | Exit 0. |
| `sha256sum tests/compiler/evidence-preview/preview-reloaded.pdf` | Exit 0; digest below. |

The final access-test/type/lint chain also emitted `PREVIEW_TYPED_CHAIN_AND_GATES_EXIT_0` (owned session `bash_21`). The final affected suite is `bash_18`; lifecycle/token suite is `bash_11`. Every owned run and watcher has a terminal receipt. The portable suite intentionally logs its injected publication rollback and passes its atomic-rollback assertion; this is not a suppressed failure.

Fresh directory diagnostics: `services/compiler` scanned 10 files with zero errors; `tests/compiler` scanned 22 files with zero errors. Contract-file diagnostics were clean. Earlier file-level stale/freshness-timeout diagnostics were superseded by these fresh directory checks and the final native strict typecheck.

Coverage comprises 18 distinct new tests: uncompiled branch; queue ordering; real runtime/client reload; success then failure retaining the previous PDF; newer working source; real Git branch isolation; named Viewer and outsider; historical-only and historical-after-ordinary exclusion; anonymous/signed Viewer/editor links; revocation; sharing-policy changes; anonymous-read-policy changes; actual generated-client discovery/download without credential carryover. Async completion listeners are installed before their actions and bounded by failure deadlines; no sleeps or polling are used to make tests pass.

Assembly reports the actual current registry: **248 total, 179 implemented, 69 remaining**, including the parent's two access endpoints. Assigned registry tests already derive their expectations, so no count-test edit was necessary.

## Retained artifact and cleanup

`tests/compiler/evidence-preview/preview-reloaded.pdf` is the genuine 90,004-byte sandboxed compiler output, downloaded after closing/reopening the runtime. `pdftotext` verified the seeded paper text. SHA-256:

`fa43d7703fec6df5d9e00e1af06aa7e78a1885f271c882c8db463d3ca05b18ce`

Evidence job `671915ef-fb53-4494-93e1-db4885d6733a`; artifact `d224595c-333c-4c90-8a91-76b2ce61890d`. The temporary service database was intentionally removed by the fixture; the retained PDF and terminal receipts are the evidence.

All test listeners used owned ephemeral ports. Fixture disposal stopped owned HTTP servers/workers, removed subscriptions/deadlines and temporary roots, and closed runtime adapters. All owned watcher sessions exited 0. No process belonging to another task, IPv4 5173/3001 listener, original HTML, research archive, or original migration SQL was altered. No commit or push was made.

Post-write review: each touched file owns contract definitions, route registration, branch discovery, fixture setup, or a focused HTTP behavior suite. SQL/HTTP boundaries remain Zod-parsed; variant handling is exhaustive. No new assertions/casts, suppressions, redundant defensive layers, one-caller abstractions, parameter bloat, negative flags, post-action production verification, or production logging were introduced. All touched source files are below 200 pure lines (maximum 173).

This handoff completes compiler preview discovery only. Parent browser QA, editor composition, external adapters, and the later AI assistant implementation remain required; none is claimed complete here.
