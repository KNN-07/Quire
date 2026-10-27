# P1 compiler handoff

Owner: C. Native baseline: Bun 1.3.14. Authored paths are exclusively `services/compiler/`, `workers/compiler/`, `tests/compiler/`, this handoff, and `docs/evidence/p1-compiler/`. No commits, root configuration, composition, shared contracts, original inputs, discovery files, or baseline migrations were changed.

## Integration exports

`services/compiler/index.ts` exports:

- `register(context: ModuleContext): Promise<void>` and `migrations` (`030-c-compiler`).
- `startWorker(context): Promise<void>` and `stopWorker(context): Promise<void>`.
- `CompilerService`, implementing the existing `CompilePort` without DTO replacements.
- `CompilerLeases`, including operator-only `bearer()` and job-specific `capability()`.
- `nativeEnvironmentId`, `probeEnvironment`, and `defaultLimits`.
- `runRemoteWorker(options)` and `workerMain(env?)`.

Compose `{ id: "030-c-compiler", lane: "C", order: 30, register, migrations }` after account/core registration. Registration provides `compiler`, installs all 14 C handlers, probes the actual native environment, and starts the external-lease reaper. It does not start a local queue consumer. For local execution, `await startWorker(runtime)` after `createRuntime`. Before closing SQLite, drain HTTP, `await stopWorker(runtime)`, then close the runtime. Stop clears the reaper, aborts owned job trees, and awaits active jobs and comparison work.

Alternatively, run a separate native process:

```sh
QUIRE_COORDINATOR_URL=http://127.0.0.1:3301 \
QUIRE_WORKER_BEARER="$operator_provisioned_worker_bearer" \
QUIRE_WORKER_ID="$worker_uuid" \
bun workers/compiler/main.ts
```

`QUIRE_WORKER_ENVIRONMENT_IDS` optionally supplies comma-separated environment UUIDs; the default is the native environment UUID. Provision the bearer through the operator process: narrow `runtime.services.get("compiler")` with `instanceof CompilerService`, then call `new CompilerLeases(compiler).bearer()`. Never expose that bearer to browser clients. SIGINT/SIGTERM abort the worker's current namespace and await cleanup. Each worker probes its local toolchain and rejects a coordinator/source-manifest digest mismatch. Use one queue-consumption topology rather than starting unrelated local and external consumers against the same queue.

## Registered endpoints

| Endpoint name | Method and path | Actual behavior |
| --- | --- | --- |
| `environmentsList` | GET `/api/environments` | Authenticated, executed native probe and content fingerprint; no fabricated releases. |
| `compileCreate` | POST `/api/projects/:p/compiles` | Scope, identity, CSRF, write authorization, immutable core snapshot, project policy budget, durable idempotency. |
| `compileGet` | GET `/api/compiles/:id` | Current ACL and durable status/artifact/diagnostic data. |
| `compileCancel` | POST `/api/compiles/:id/cancel` | Write authorization, actual version check, cancellation, descendant termination for local jobs. |
| `compileLog` | GET `/api/compiles/:id/log` | Authorized full bounded raw log bytes; empty while no finished log exists. |
| `artifactContent` | GET `/api/artifacts/:id/content` | Artifact-to-job-to-project ACL, real immutable bytes, MIME, digest ETag and download disposition. |
| `compileCacheDelete` | DELETE `/api/projects/:p/compile-cache` | Write authorization/version check; deletes generated cache references, not source or retained job artifacts. |
| `synctex` | POST `/api/compiles/:id/synctex` | Actual isolated `synctex view/edit`, snapshot file IDs, top-left PDF-point rectangles. |
| `pdfDiff` | POST `/api/projects/:p/pdf-diffs` | Immediate durable operation; asynchronously compiles selected snapshots, renders pages, compares pixels and produces PDF/PNG artifacts. |
| `workerLease` | POST `/internal/workers/lease` | Worker bearer, atomic claim, attempt/fencing token, 30-second lease and capability response header. |
| `workerHeartbeat` | POST `/internal/jobs/:id/heartbeat` | Bearer and live fencing check; renews lease for 30 seconds. |
| `workerSource` | GET `/internal/jobs/:id/source.zip` | Bearer plus job capability/fence, immutable blob ZIP with file identities and environment fingerprint. |
| `workerArtifact` | PUT `/internal/jobs/:id/artifacts/:name` | Capability, live fence, matching If-Match and SHA-256, immutable publication, real PDF rendering validation. |
| `workerComplete` | POST `/internal/jobs/:id/complete` | Live fence, exact owned artifact set, snapshot-linked diagnostics, atomic terminal state/preview/worker release/completion receipt; durable replay. |

Compile creation, cancellation, cache mutation and snapshot-comparison compilation use the project port's `"compile"` mutation intent. Core base now classifies it as Editor/Owner-only, as documented in `docs/handoffs/p1-core-base.md`. The temporary `"write"` workaround for the earlier cross-lane classification bug has been removed. Existing-job reads authorize `"read"` through `CompilerService.get`; PDF, raw-log and SyncTeX reads reuse that same read seam. Integrated real-session/core-role tests cover Viewer launch/cancel/cache rejection and allowed existing-job/PDF/log/SyncTeX reads.

## Containment and lifecycle

The backend is **bwrap inside a systemd user-service cgroup**, not bwrap alone and not an unsandboxed fallback. The required working prerequisites are the user manager/user bus, cgroup v2 memory and task controllers, unprivileged bwrap namespaces, and the installed TeX/Poppler runtime. Explicit Docker configuration fails with `COMPILER_BACKEND_UNAVAILABLE` until O provisions its digest-pinned image.

Every tool invocation has private user, PID, network, IPC, UTS and cgroup namespaces; further user namespaces are disabled; capabilities are dropped; no-new-privileges is set; systemd kills the entire control group. An `env -i` launcher clears the supervisor's environment before bwrap, in addition to clearing the executed tool environment. Only enumerated TeX/runtime/font/config paths are mounted read-only. There is no host root, home, repository, host temporary directory, user bus, host network or writable shared cache mount. `/proc` is private, `/dev` is minimal/read-only, `/src` is an immutable materialized snapshot, and writable `/tmp` resolves inside `/work`.

Verified default controls apply to the entire service tree: `MemoryMax=1073741824`, `MemorySwapMax=0`, `TasksMax=128`, `CPUQuota=100%`, `RuntimeMaxSec` from project policy (180 seconds by default, maximum 600), and one 536870912-byte tmpfs for all writable workspace/cache/temp paths. Two local queue slots are enforced. Snapshot materialization is also rejected above the workspace byte budget. The bounded output transport retains at most 64 MiB archive data and 8 MiB raw log data; exceeding that bound stops the unit with `OUTPUT_LIMIT`. Trusted snapshot/blob transfer and coordinator SQLite/blob publication occur outside the untrusted tool cgroup; they do not execute project code.

Cancellation waits for `systemctl stop` and the launcher exit. An explicitly stopped unit can return exit code 0; `SandboxResult.canceled` prevents mistaking that for successful validation. Local crash recovery uses deterministic job unit names, stops stale units, and marks interrupted jobs `WORKER_RESTARTED`. External heartbeats run every 10 seconds; expiry produces `WORKER_LEASE_EXPIRED` and fences subsequent writes. External cancellation is observed at the next heartbeat or artifact boundary, and stops the remote process tree; the polling bound is 10 seconds.

Only a real, successfully rendered PDF updates the latest-successful pointer. Partial output remains attached to a failed job, never promoted. Publication selects the highest source revision/newest admitted successful job, so late older completion cannot replace a newer preview. Cache keys include project/branch, actual source file IDs/paths/digests, settings and environment fingerprint. Cache clear preserves immutable snapshots and retained job artifacts.

## Tools, output and UI integration

Actual profiles exercised are pdfLaTeX, LaTeX/DVI with `dvipdfmx`, XeLaTeX, LuaLaTeX, explicitly selected plain TeX, BibTeX, Biber, local class/style files, uploaded Unicode fonts, draft image omission, first-error/continue behavior, real PGF 2D/3D plots, and explicitly configured TikZ externalization. `/etc/LatexMk` loads first, preferred `.latexmkrc` or fallback `latexmkrc` loads afterward, and the selected engine remains explicit. Project rc is executable Perl **inside** confinement. Default TeX uses no shell escape. The externalization fixture explicitly selects its isolated child compiler and actual source path; the canonical output job name is `output`.

The tagging fixture generates actual tagged PDF 2.0 and Lua-generated MathML. Its source uses `DocumentMetadata` phase-III, `unicode-math`, and `tagpdfsetup{math/mathml/luamml/load=true}` on LuaLaTeX. The non-Lua fixture verifies that pdfLaTeX does not falsely produce a Lua MathML artifact. These are executed authoring fixtures, not PDF/UA or assistive-technology certification.

Main artifacts are `output.pdf`, `output.dvi` when applicable, `output.synctex.gz`, and `build.log`; generated bibliography and nested generated helper files are retained. Internal temp/font-cache trees are excluded. Diagnostics carry actual file IDs/lines and raw UTF-16 string offsets into the decoded `build.log`; the underlying downloadable bytes are UTF-8.

No shared DTO changes were made. Integration should consume these response headers:

- `compileGet` ETag uses the shared `"vN"` format and supplies the version for cancellation.
- `x-last-successful-artifact-id` and `x-preview-stale` on `compileGet` identify the preserved preview and whether it is older/unrelated to the requested current result.
- `x-artifact-partial` marks PDF artifacts from unsuccessful jobs.
- Internal lease responses supply `x-job-capability`; source/upload require it. Upload additionally requires `x-content-sha256` and `"v<fencingToken>"` If-Match.

For U: use `createClient(...).callWithMetadata(...)` for compile-job and artifact reads, then consume the readonly `metadata.headers` record. Read `metadata.headers["x-last-successful-artifact-id"]` and `metadata.headers["x-preview-stale"]` from `compileGet`, and `metadata.headers["x-artifact-partial"]` from `artifactContent`. The header values are the actual response strings: compare boolean headers with `"true"` or `"false"`; do not use boolean coercion (`"false"` is a nonempty string). An absent header remains absent, not a synthesized false value. `client.call(...)` returns only the result and therefore is not the metadata-bearing path for these viewer labels.

The compiler continues to emit boolean headers with `String(boolean)`. ETag and `metadata.expectedVersion` behavior are unchanged, and no compiler DTO change is needed. Lead reproduced the earlier shared-client header loss over real HTTP (4 passed/2 failed), fixed `metadata.headers` preservation, and owns its ongoing contract/type verification. This handoff-only update did not change compiler code or rerun engine checks.

Diff operation results contain `artifactId`, `previewArtifactId`, actual PNG/PPM `pages`, top-left 72-dpi/PDF-point bounding `regions`, `fromJobId`, `toJobId`, and `mode`. Regions are conservatively labeled `"visual difference"`; no semantic/reflow confidence is invented. Unequal page counts are supported; identical renders produce no changes. Historical comparison compilation does not replace the editing preview. The standard `operations` row has standard result JSON for F's operation GET composition.

The native manifest hashes actual TeX/package/config contents and tool binaries, not just PATH discovery. Its readiness probe includes real PDF generation and inspection. One probe is shared across coordinator runtimes in a process; each external worker independently probes. Restart the coordinator and workers after an operator changes native TeX installation contents.

## Integration dependencies and boundaries

- F must compose the module/migration and worker start/stop lifecycle. Root composition and package configuration were deliberately not edited.
- Real HTTP tests compose the public `services/accounts/identity` and `services/core/base` registrations, real sessions/CSRF and real Git-backed core snapshots. Independent compiler tests use a seeded immutable-snapshot project port, never fake tools/PDFs.
- The frozen `CompileJob` DTO has no version/latest-successful fields; the headers above carry them without changing shared schemas. A future DTO addition belongs to F.
- Native environment UUID `00000000-0000-4000-8000-000000000030` is probed as the actual installed TL2025 native environment. There is no claim of a second installed release, Docker image, Pandoc/R/knitr, minted helper profile, or legacy lexer support. O must provision those isolated runtimes/manifests; F must expose any additional helper-profile selection/policy fields. Existing browser Pyodide work belongs to U, not this server worker.
- Browser PDF.js controls/layouts are U's scope. This lane verifies actual HTTP bytes, CLI execution, SyncTeX and rendered PDF differences; it does not claim U's browser-screen acceptance.

## Failure history retained

Failures were fixed rather than suppressed:

1. Initial bwrap startup rejected `--disable-userns` without explicit `--unshare-user`; the actual namespace arguments were corrected.
2. Initial engine runs produced 3 passes/2 failures: missing font/paper runtime configuration broke XeTeX and default Ghostscript conversion. Enumerated font/paper paths were added and LaTeX now explicitly uses installed `dvipdfmx`.
3. DVI converter evaluation was initially lost through systemd command environment expansion. `--expand-environment=no` preserves literal Perl/shell configuration.
4. BibTeX's `/etc/alternatives/bibtex` target was absent from the jail; the specific read-only symlink target was added. Early failed fixture runs also exposed lease-reaper shutdown against closed SQLite; stop now clears its timer.
5. The first HTTP cache-clear test incorrectly supplied stale project version 0 after a core snapshot mutation; it now reads the actual project version.
6. The first full run retained at `run-NUuz7nYM` ended **24 passed, 1 failed, 69 assertions, 88.31 seconds**. Its cancellation assertion incorrectly required a nonzero manual-stop exit code; actual cancellation and inactive unit state are now asserted.
7. Initial externalization failed because TikZ tried to input the canonical output name instead of the source name; the executed fixture explicitly configures its actual source path. Its corrected targeted run passed.
8. Early strict checking exposed two account-profile errors outside this lane and initially omitted foundation SQL ambient declarations from the owned config. The ambient declaration is now included; sibling account errors were not edited here and subsequently disappeared from the strict check.
9. Type-aware lint rejected awaiting a closure-mutated nullable local as statically non-thenable. Cancellation now stores its promise in explicitly mutable lifecycle state with narrowing.
10. LSP reported stale imported signatures and two 3-second diagnostic freshness timeouts during concurrent editing. Fresh strict TypeScript results, not those stale signatures, determine the final type-check result.
11. Early owned diagnostics also caught missing `Ok.version`, widened `ok` literals, byte-array generic mismatches and optional idempotency input typing. These were corrected, not suppressed.
12. The first shell LOC measurement had an incorrectly escaped awk pattern (`Unmatched (`); its zero counts were rejected. Final counts were computed from complete reader results.

## Static and architectural review

Final LSP scans reported **0 diagnostics** across all three owned TypeScript directories (9 service files, 6 worker files, 15 test/support files). The strict owned project includes the foundation SQL ambient declaration:

```sh
node_modules/.bin/tsc --noEmit --project tests/compiler/tsconfig.json
node_modules/.bin/oxlint --type-aware --deny-warnings services/compiler workers/compiler tests/compiler
```

Both commands completed with exit **0** after the final code edits. Root-wide checks/build and unrelated lane suites were not rerun by C.

The post-write size review measured every owned TypeScript file. `services/compiler/service.ts` is **208 pure LOC**, in the 200-250 warning band; extract its cache/preview publication policy before the next feature grows that file. Every other owned source/test file remains below 200 pure LOC; none exceeds 250.

The required self-review was completed:

1. Each file has one named owner: job lifecycle, job persistence, native environment, diagnostic parsing, navigation, comparison, worker leases, worker protocol, sandbox, archive decoding, snapshot build, remote worker, or worker entrypoint.
2. HTTP/worker/source-manifest/SQL boundaries parse into the existing branded/readonly contracts; no untyped domain input is passed onward.
3. Engine, source-kind and SyncTeX direction dispatch use exhaustive switches.
4. There are no `any` annotations, unchecked assertions, non-null assertions, type/lint suppression directives, or replacement shared DTOs.
5. Null/error checks represent real boundary absence, cancellation and fencing states, not defensive revalidation of guaranteed values.
6. Single-use engine selection was inlined; remaining exported entrypoints and adapters correspond to actual module/process boundaries.
7. Tests exercise real tools and observe actual outputs, role rejection, raw diagnostics, durable status, pixel changes and resource failures; no prompt/prose pins or fixed test sleeps were introduced.
8. Functions stay within three parameters; build/worker inputs are genuine shared role-boundary values, not untyped argument bags.
9. Production cleanup trusts removal/stop contracts. The isolation test's inactive-unit assertion explicitly verifies the requested cancellation behavior.
10. Mutable lifecycle state uses positive names; no negative-form feature flags were added.
11. Existing structured `console.error` practice is retained at failure boundaries with stable messages and job/operation IDs plus error codes; project source and worker bearer values are not logged.

The completed earlier acceptance run `run-bsHUV3Hh` passed **44 tests, 0 failures, 127 assertions in 196.11 seconds**.

## Final acceptance and cleanup

The full implementation acceptance command was **`bun test tests/compiler`**, native Bun **1.3.14 (0d9b296a)**, with unique TMPDIR, XDG cache, Bun cache and evidence directories. Result: **44 passed, 0 failed, 128 assertions, 11 test files, 198.27 seconds, exit 0**. This run includes atomic terminal publication/completion receipts, live fencing, no-new-privileges, actual core/account HTTP flows and separate native worker CLI. The subsequent permission-contract follow-up is recorded below; no later whole-suite rerun is claimed.

Final retained evidence: **`docs/evidence/p1-compiler/run-Hdm6o5kW/`**. It contains all five engine PDFs, both uploaded-font PDFs, tagged LuaLaTeX PDF, actual generated MathML HTML, side-by-side/overlay PDFs and PNG renders, and actual region JSON. Both comparison modes were visually inspected; the side-by-side render shows changed 42/43 and moved text, and overlay uses a correctly framed single-page canvas.

The first actual content fingerprint/readiness probe took roughly 43-45 seconds on this workstation; an external worker independently performs that probe before leasing. F's startup/readiness harness must await module readiness with a suitable bounded deadline rather than assuming a five-second cold start.

Cleanup receipts:

- Final owned temporary root: `/tmp/quire-compiler-verify-A1FvJJq1`; the runner removed it and emitted `OWNED_TMP_REMOVED exit=0`.
- Previous owned full-run roots `/tmp/quire-compiler-verify-Sc2Fbosg` and `/tmp/quire-compiler-verify-RZJyYhQx` were also removed by their runners; their evidence directories were deliberately retained.
- Final `systemctl --user list-units --all --no-legend --plain "quire-compile-*"` output was empty.
- Final worker-process audit emitted `NO_OWNED_WORKER_PROCESS`. The combined cleanup/evidence fingerprint audit exited **0**.
- Every test-created HTTP listener used port 0 and awaited `server.stop(true)`. No unrelated port 3001/5173 listener was stopped.
- Snapshot workspaces, validation/render directories, planted canaries, fixture databases/Git repositories and per-run caches were removed by owned disposal/finally paths. Retained immutable PDFs/PNG/MathML/JSON under evidence are the intended exception.

Retained evidence is intentionally under the existing `.gitignore` rule `docs/evidence/`. It exists on disk; F must explicitly include selected evidence if it belongs in a commit. C did not change ignore rules or stage/commit files.

## Core permission-contract follow-up

After core base moved `"compile"` into its Editor/Owner action set, compiler creation, cancellation, cache clear and comparison compilation switched from the temporary `"write"` workaround to the semantic `"compile"` intent. Existing-job/PDF/log/SyncTeX reads continue through `CompilerService.get` with `"read"`.

The integrated real-account/core HTTP suite now includes a successful owner compile followed by a genuine Viewer's access to the existing job, actual PDF content, genuine raw log and forward SyncTeX mapping. Existing real-role tests independently reject Viewer launch, cancellation and cache clear with `403 FORBIDDEN`.

Exact follow-up command: **`bun test tests/compiler/http.test.ts`** on native Bun 1.3.14. Result: **8 passed, 0 failed, 36 assertions, 56.54 seconds, exit 0**. Strict owned TypeScript and type-aware Oxlint both exited **0**. Service-directory and test-directory LSP scans returned **0 diagnostics**; an initial single-file diagnostic request timed out at its 3-second freshness deadline before the clean directory scan.

Changed-file size review: service 208, registrar 109, comparison 89, HTTP tests 147 pure LOC. The existing service warning band is unchanged; the change adds no abstraction, DTO, escape hatch, parameter or logging behavior.

Owned follow-up root `/tmp/quire-compiler-permissions-JhECnG0M` was removed. The runner explicitly reported `PERMISSION_TEST_EXIT=0 CLEANUP_EXIT=0`; fixture HTTP servers and compiler workers were awaited during disposal. Detailed receipt: `docs/evidence/p1-compiler/permissions.md`.
