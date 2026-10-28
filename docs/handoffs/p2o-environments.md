# P2O environment provisioning

Status: VERIFIED within owned scope, October 27, 2026. Final project-local
Bun 1.4.4 checks, packaged real probe, cleanup and hash inventory completed
exit 0. No owned blocker remains. This is not whole-product acceptance.

## Delivered scope

- `services/operations/environments/`: lane O/order 60 registration, explicit
  SQLite/PostgreSQL migration, immutable executed manifests, operator
  list/create/default/retire/build routes, optimistic versions and receipts.
- `deploy/compiler/`: provisioned Docker toolchain and actual default,
  restricted and R/knitr profiles, fixtures and confined entrypoint.
- `workers/compiler/docker.ts`: immutable-image execution, ordinary-file
  materialization, read-only source/root, private bounded workspaces, isolated
  network, dropped privileges, process/memory/CPU/output/deadline limits and
  whole-container cancellation.
- `scripts/ops/environments.ts`: authenticated operator HTTP commands and
  real offline image probes.
- `tests/operations/environments/`, `docs/evidence/p2o-environments/` and
  `docs/runbooks/toolchains.md`: real-port tests, terminal evidence, artifacts
  and operator instructions.

Current provisioned image:
`sha256:1ffb2fe8f831d4296f2de1c993a491444a9f6706e5498151ff41783468448258`.
Its observed release is **TeX Live 2025**, not TeX Live 2026. The retained
bootstrap tag is `quire-p2o-environments:st_01a17c2c`. Original native TeX Live,
baseline inputs and original migration files were not edited by this lane.

## Lifecycle and integration

Build returns a durable queued operation with HTTP 202. Identical-key replay
returns that operation; actual work runs after the context's serial turn
inside `context.admission.background`, including failure cleanup and terminal
persistence. The live lease is tested against an actual conflicting kernel
flock while failed-work cleanup is held open. Progress events correspond to
actual preparation, child start, probing and terminal transitions.

The original operator session/role is checked again at execution and
publication. Image identity and manifest receipt are immutable; failed probes
are not advertised as available. Default changes preserve project pins.
Default, live-project-pinned and active-compile-job environments cannot retire.

Exported hooks are `register`, `migrations`, `resolveEnvironment`, `runProfile`,
`probeImage`, `manifestFromProbe` and `stopEnvironmentBuilds`. Registration
binds the parent-owned compiler environment provider. Root shutdown must await
`stopEnvironmentBuilds(runtime)` before adapter close; it aborts and drains
builds and create probes. Parent reports this root hook is consumed. Real
HTTP Docker compile dispatch is covered here; parent owns remote-worker,
whole-application and shared Core/compiler integration.

Invalid selected drafts now reach actual Docker TeX without documentclass
syntax preflight. Main identity, editability, link policy and source limits
remain. The affected regression verifies a nonzero result and a source-linked
line-1 diagnostic rather than an `INVALID_MAIN` rejection.

## Capability evidence and boundaries

| Rows | Evidence provided by this lane |
| --- | --- |
| C18 | Actual installed packages and local class/nested style lookup in executed engine fixtures. |
| C19 | Xe/Lua Unicode/fontspec fixtures, uploaded-font image/PDF and negative pdfLaTeX fontspec constraint. No arbitrary math-font claim. |
| C20 | Real confined project latexmkrc execution, dot-rc precedence, generated proof file and selected-engine precedence. |
| C21 | Actual plain-TeX substitution, PDF text and same confinement boundary. |
| C22 | No-shell default and controlled restricted minted/TikZ helpers; denied shell syntax and escape fixtures. |
| C23 | Actual BibTeX/Biber reruns, resolved PDF text and `.bbl` output. |
| C24 | Installed R/knitr produces deterministic generated text/PDF; Rnw replaces only private working input. No persistent R-cache guarantee. See Core contract below. |
| C25 | Actual installed modern minted toolchain and rendered tokens; no legacy uploaded-custom-lexer guarantee. |
| C26 | Actual 2D/3D pgfplots/TikZ externalization and generated figure PDFs. |
| C27 | Generated work/cache is job-local and not an implicit source mutation. Parent owns the broader persistent cache-clear/project workflow. |
| C28 | Browser/Pyodide runner is U-owned and is not implemented or claimed by this lane. |
| C29 | Availability derives from executed worker actions, content and confinement, never PATH discovery alone. No PythonTeX service claim. |

The tagged LuaLaTeX fixture retains real PDF/log/metadata evidence. Tag
presence and rendering are structural evidence only: veraPDF and assistive
technology validation are not performed, and no PDF/UA certification is made.

### Actual knitr Core contract

Parent completed Core main-file eligibility: exact `main.Rnw` is admitted
when the selected persisted environment is Docker with the knitr helper.
`createFromFiles` accepts explicit main path, engine and environment before
publication. UTF-8 editability already applies; no MIME workaround is needed.
The parent's nine-test receipt is `docs/handoffs/p2x-core-interchange.md`.

The standalone application regression passed: it publishes only `main.Rnw`,
requests a real compiler HTTP job and checks `QUIRERNWRESULT55` in the authorized
downloaded PDF. Evidence is `standalone-knitr.pdf` and `standalone-knitr.json`.
The alternate selected `main.tex` plus
uploaded `main.Rnw` workflow remains directly tested. Both preprocess only
private working input; source files are not replaced in the project.

## Verification and retained evidence

The broad background-admitted suite passed 36 tests, zero failures, in
335.82 seconds. `tests-broad-before-core-followups.log` retains its terminal
output. Later parent-requested invalid-draft/Core-Rnw changes receive focused
coverage rather than repeating the unchanged broad suite.

The first affected Docker invalid-draft regression passed three assertions.
The contemporaneous shared Git owner changes temporarily prevented strict
compilation (`routes.ts` merge return/export mismatch); their terminal output
is retained in `typecheck-shared-git-inflight.log`, not labeled green.
The two Docker follow-ups passed together before the fixture-context type
correction, then passed again with the corrected ModuleContext. Their terminal
receipts retain the contemporaneous static/fixture failures separately.
The additional implicit-default-version test passed after explicitly creating
its initial default instead of assuming the seed selected one. Both promoted
and demoted defaults now advance their confirmation versions.
Final owned gates completed exit 0 under project-local **Bun 1.4.4**:
admission-wrapper regression, strict TypeScript, type-aware deny-warnings
lint, bundled CLI build, actual bundled CLI image probe and cleanup/hash
audit. Local bins were selected with
`PATH="$PWD/node_modules/.bin:$PATH"` and the verifier/audit were launched
with `bun run`. Terminal `CHECKS_EXIT=0 AUDIT_EXIT=0` was observed. No
unchanged broad suite was rerun.

Layered behavior receipts are the earlier 36-pass broad suite, two actual
Docker application follow-ups and the additional passing default-version
case (`versions-terminal.md`). The final `tests-final.log` is specifically
the Bun-1.4.4 native-admission regression, not a claim that all 39 distinct
cases were rerun on the new runtime. `typecheck-final.log`, `lint-final.log`
and `packaging-final.log` contain current-runtime exit-0 receipts.

`tests-pre-background-failed.log` preserves the superseded 31-pass/4-fail
run: expired request ownership prevented terminal writes. The explicit
background-admission wrapper is the material correction, not a timeout
increase or retry. Earlier real failures and repairs are retained in
`initial-tests.md`, `cleanup-recovery.md` and the failed reports/logs.

`default-report.json`, `restricted-report.json`, `knitr-report.json`, actual
PDFs, build receipt, operation/dispatch records and negative-build evidence
are in `docs/evidence/p2o-environments/`. `packaging-final.log`, `cleanup.json`
and `artifacts.json` retain the completed packaging, cleanup and SHA-256
inventory for 45 artifacts. Historical failures remain failures; no assertion
was skipped or relaxed.

Final owned source fingerprint before/after was
`41e9f4ba1266f2e04c5b265a26587dec02fc65595350186e47237a99c4beeeae`,
with `unchanged:true`. No owned containers, custom-build tags or matching
temporary directories remained. Ephemeral listeners were closed by awaited
fixture disposal. One exact bootstrap image remains intentionally; shared
images, caches and production directories were not pruned.

Executed worker manifest artifact: `worker-environments.json`.

| Profile | Environment ID |
| --- | --- |
| default | `82483981-0386-41e0-8b1e-b97d4da70b54` |
| restricted | `cd23a37b-b165-4143-8480-b55a1a64b2f8` |
| knitr | `dde2b77c-9e05-4754-8a00-a2d1e0d93c33` |

These are executed local manifest artifacts, not a production registration.
Register matching IDs through the operator API and provision the exact image
on a worker before using `QUIRE_WORKER_ENVIRONMENTS_FILE`.

No deployment, commit, shared image prune, host toolchain installation or
production-directory mutation was performed.

Owned post-write size review found no 200-line warning or 250-line defect:
the largest implementation was `build.ts`, 179 nonempty/noncomment lines.

## Post-write architecture review

1. Changes stay within the environment lane and explicitly authorized Docker worker file.
2. SQL transaction callbacks use their transaction executor, including account and environment locks.
3. Public inputs and persisted rows cross Zod boundaries; no type-error suppression was added.
4. Environment identity, executed receipt and image are immutable; mutable selection metadata is versioned.
5. Manifest/profile states have explicit engine/helper policy and exhaustive discriminant handling.
6. Queue ownership and the native background lease cover real work through cleanup and terminal persistence.
7. Current session authority is rechecked before execution and publication, not inferred from an old request.
8. Host effects remain in SQL/blob/Docker/filesystem boundaries; no unsandboxed execution fallback exists.
9. Temporary state has context/job ownership and awaited disposal; audit container ownership is explicit.
10. Tests exercise real ports and tools, correlate events before actions, and use no timing sleeps.
11. Evidence separates actual artifact/content proofs from installed-tool discovery, parent integration and certification.
