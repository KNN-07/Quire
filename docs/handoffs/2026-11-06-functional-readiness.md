# Functional readiness assessment, November 6, 2026

Assessment baseline: `da5cec2441385d6cddba67e543fe820cc63c9832`, repository Bun
1.4.4. This is a read-only product investigation plus this report. Production
code and tests were not edited. Landing/logo and Pages work belong to the lead.

**Verdict: retain a bounded development/pilot claim; unconditional product
readiness is not established.** Real dashboard, PDF, collaboration and Git
workflows execute, and current types and capability mapping pass. Remaining policy, provider,
institutional administration and accessibility obligations are substantial.
Mapping reports `behavioralAcceptance:false`; its 164 mapped IDs comprise
77 MOUNT, 8 UI, 31 BE, 17 EXT, 23 PART and 8 BOUND. MOUNT is scoped evidence,
not acceptance of every operation on a screen.

## Findings, ordered by priority

1. **P1 acceptance gate: the representative runtime selection is not green.**
   Two websocket collaboration cases and all three Git HTTP/CLI cases passed,
   but the SSE revocation case failed with `AbortError`. The test explicitly
   aborts transports and then cancels their readers at
   `tests/integration/collaboration.test.ts:143-144`; the server's abort and
   cancel paths are `services/core/review/events.ts:50-59,144`.
   The independent SSE-only run reproduced the same exception after five
   assertions. This suggests a cleanup/test-runtime interaction, but its root
   cause is unproven. Do not infer an authorization leak or broken live
   collaboration from this exception. Establish whether cancellation rejects
   after abort and preserve the revocation and outsider-isolation assertions
   when correcting it.

2. **P2 functional mismatch: Anonymous editing is configurable but anonymous
   mutations are denied.** The organization form exposes "Anonymous editing"
   at `apps/web/src/features/account/organizations/organization.tsx:163`.
   Policy intersection retains `anonymousEdit` at
   `services/accounts/identity/policy.ts:26`, while
   `services/core/base/access.ts:110-111` rejects mutations without a principal.
   Tokenless access also fails at `services/core/base/access.ts:69-71`.
   This confirms the unresolved contract in `docs/feature-matrix.md:230`;
   it does not demonstrate unauthorized access. Decide the supported public/
   anonymous matrix, then implement it or make the unavailable option explicit.

3. **P2 incomplete workflows: institutional administration, language controls,
   and billing need bounded closure.** The current ledger still requires
   institution claim/reconfirmation and product-policy completion
   (`docs/feature-matrix.md:273-274`), SAML reminders/unlink administration
   (`:279,337`), selection-length and inline language interaction acceptance
   (`:259`), and personal billing/usage plus full configured invoice/payment/
   cancellation acceptance (`:330`). These are documented remaining obligations,
   not newly reproduced defects. Complete one composed user journey per elected
   requirement and record durable results rather than promoting route presence.

4. **P2 provider boundary: some advertised integration families remain
   unavailable or require live acceptance.** ReadCube bibliography dispatch
   explicitly returns `PROVIDER_UNCONFIGURED` at
   `services/adapters/references/bibliography.ts:41`; Dimensions does the same
   at `services/adapters/references/retrieval.ts:35-37`.
   An approved endpoint/authentication/schema contract is required before those
   paths can be implemented. Existing configured adapters still need authorized
   live model, identity, bibliography, Git, SMTP and merchant acceptance.
   Controlled protocol fixtures do not establish vendor interoperability.
   Preserve truthful unavailable states and exercise only provisioned providers.

5. **P2 release evidence: cross-browser, assistive technology, PDF conformance
   and whole-product visual acceptance remain open.**
   `docs/feature-matrix.md:119-120,290` explicitly retains tagged-PDF fixture/
   validator/human-review work and Firefox/Safari/Edge/ESR and accessibility
   gates. Operator panels and scale-browser presentation also remain bounded
   (`:343-344,347`). Run named-browser and keyboard/screen-reader journeys,
   record validator versions/findings, and verify the chosen deployment topology.
   Chromium viewport checks cannot close these gates.

## Current executable evidence

Commands ran from the repository root with its local binary. Each execution
owned a fresh `mktemp -d /tmp/quire-readiness...-XXXXXX` root and exported
`TMPDIR` to it, `XDG_CACHE_HOME=$ROOT/cache`,
`BUN_INSTALL_CACHE_DIR=$ROOT/bun-cache`, and
`PATH=$PWD/node_modules/.bin:$PATH`. Roots and cache directories were created
before execution; logs were streamed with `tee` outside those roots.

```sh
./node_modules/.bin/bun --version
./node_modules/.bin/bun run verify:matrix
./node_modules/.bin/bun run typecheck
./node_modules/.bin/bun test --timeout 120000 \
  ./tests/integration/collaboration.test.ts \
  ./tests/integration/git.test.ts \
  ./tests/ui-product/projects/workspace-dashboard/browser.test.ts
./node_modules/.bin/bun test --timeout 180000 \
  ./tests/integration/p1/application.test.ts -t "persists source"
./node_modules/.bin/bun test --timeout 30000 \
  ./tests/integration/collaboration.test.ts -t "replays only authorized SSE"
```

Version was 1.4.4. Mapping and root typecheck both exited 0. The combined
runtime selection exited 1: 5 pass, 2 fail, 40 assertions. Five passing cases
cover real socket convergence/restart, access revocation and actual Git
clone/fetch/push, dirty-source quarantine and private-ref/ACL boundaries.
The failures were the SSE exception above and browser launch looking inside
the deliberately empty isolated cache. The installed compatible browser was
then located at the explicit path below for a dashboard-only rerun.

The HTTP/PDF selection passed: 1 pass, 0 fail, 2 filtered, 11 assertions,
exit 0 in 59.98 seconds. Its genuine PDF was 41,667 bytes with SHA-256
`3febb61e46060107efe88d9f931525e87246d26002ad4ca05c7653dc51dce592`.
The independent SSE selection exited 1: 0 pass, 1 fail, 2 filtered,
5 assertions, 1.086 seconds.

```sh
export QUIRE_TEST_CHROMIUM=/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
./node_modules/.bin/bun test --timeout 180000 \
  ./tests/ui-product/projects/workspace-dashboard/browser.test.ts
```

The corrected browser invocation passed: 1 pass, 0 fail, 52 assertions,
exit 0 in 52.74 seconds. It exercised workspace filtering and pagination,
selection reset, reload/back navigation, editor navigation, unknown-workspace
404, Viewer isolation, and desktop/mobile layouts in both themes. All four
geometry records report no horizontal overflow or search/workspace overlap.
I opened the current 1440px light and 390px dark full-page captures in
`docs/evidence/p28-workspace-dashboard/final/inspect1440-light.png` and
`inspect390-dark.png`; neither is blank or overlapping. The fixture's empty
template area is not evidence that the separate bootstrap-template workflow
is broken. This rerun resolves the initial browser-launch prerequisite failure;
the SSE failure remains reproducible.

The dashboard selection uses the actual composed application, HTTP
authentication, persisted workspace data, and Chromium through the existing
fixture (`tests/ui-integrations/application.ts:14-57`), rather than the older
protocol-only dashboard preview. The HTTP selection creates a project/file,
restarts the application, checks bytes and Viewer denial, and requires a
genuine downloaded PDF (`tests/integration/p1/application.test.ts:8-63`).
Native startup probes the sandboxed toolchain and hashes the installed TeX
tree (`services/compiler/environment.ts:9-29`); executable presence alone is
not readiness.

## Retained evidence and limits

Raw logs outside the temporary roots:

- `/tmp/quire-readiness-20261106-st01a1af03.log`
- `/tmp/quire-readiness-http-20261106-st01a1af03.log`
- `/tmp/quire-readiness-sse-20261106-st01a1af03.log`
- `/tmp/quire-readiness-browser-20261106-st01a1af03.log`

All four execution wrappers recorded `CLEANUP_EXIT=0`. A final filesystem
check confirmed these owned roots absent:

```text
/tmp/quire-readiness-20261106-dRx1Ud
/tmp/quire-readiness-http-20261106-RoOOtj
/tmp/quire-readiness-sse-20261106-r4J0Xz
/tmp/quire-readiness-browser-20261106-nUBT6U
```

The browser fixture also emitted adapter/runtime/web closure,
`CONNECTIONS_CLEANED` and `WORKSPACE_CLOSED` receipts. Final process inspection
found no command referencing these roots or either initially observed owned
compile unit. No owned server/browser/probe process remains. `git diff --check`
exited 0 and `git status --short --untracked-files=no` was empty before this
report's final text update. Existing unrelated untracked files were untouched.
No commits were made. The report is the only source-controlled artifact added;
browser fixture screenshots and the logs retain the execution evidence.

No full suite, fresh lint/build, production deployment, installed update/
rollback, live provider, paid transaction, external mail or human accessibility
run was attempted. PostgreSQL/Redis review/scale test URLs were absent.
`bwrap`, `pdflatex`, `xelatex`, `lualatex` and `latexmk` were on PATH;
`tectonic` and `Rscript` were not. Alternative engines, knitr, images and
portable storage therefore receive no new acceptance from this assessment.

Historical failures were checked for supersession. P71 automatic inline
references are accepted in `docs/handoffs/p71-inline-accepted.md:3-19`.
P72's two search findings and earlier citation failures are superseded by
`docs/handoffs/p72-project-search-accepted.md:3-16`; current
`services/adapters/ai/project-search.ts:49-56` includes match-column positioning
and path credential checks. The old missing failure-recovery copy is also
present now at `apps/web/src/features/editor/assistant/RunProgress.tsx:47-50`.
Those historical findings are not current blockers.

## Final dashboard outcome and teardown receipt

Finalized November 6, 2026 at 04:06:54 UTC from the settled browser log:
**PASS, 1 test, 52 assertions, 0 failures, `BROWSER_EXIT=0`, 52.74 seconds.**
The log records adapter/runtime/web shutdown, `CONNECTIONS_CLEANED`,
`WORKSPACE_CLOSED`, and `CLEANUP_EXIT=0`. Final teardown inspection confirmed
all four owned roots listed above absent and no processes referencing them.
No owned application, browser or compiler process remains to stop. Settled
tests were not rerun during this finalization. The reproducible SSE failure
remains a separate finding; dashboard success does not erase it.
