# P74 installed Pandoc conversion

November 13, 2026. Implementation owner: `st_01a1d599`.

Parent retention and cleanup supersede temporary paths below: all raw logs and
downloaded archives are retained under `.omo/evidence/p74/conversion/`.
The temporary run root and task-owned Pandoc image were removed after
verification. Reproduction requires rebuilding and supplying an immutable image.

The installed converter now uses controller-owned `pandoc-probe` and
`document-convert` recipes. The signed profile supplies the immutable image.
Neither environment variables nor the environment-build ledger grant conversion
authority. The existing direct-development Docker path remains supported.

The supplied image is
`sha256:93b748053b3129df98ad47625f6e341b439ad393399ed50ca40e02ed3fc04bac`.
Its `/usr/bin/pandoc` entrypoint was inspected. Only the two conversion kinds
override that entrypoint, with command text selected by the controller.

## Authority and lifecycle

- Strict request schemas admit only the validated source, main file and format
  enums. Arbitrary argv, filters, output locations and image overrides reject.
- The live authenticated role must select exactly one signed Docker profile;
  probe and conversion must select the same profile. A different image cannot
  inherit another profile. The broker independently enforces role, kind, Docker
  backend, resource ceilings and signed image authority.
- Sources are staged under the committed SQLite/PostgreSQL generation's work
  directory and sealed by the existing controller source inventory.
- Containers retain network isolation, read-only root/source, UID 65534,
  capability removal, no-new-privileges, memory/swap/CPU/PID bounds and noexec
  work/tmp mounts. Probe uses 15 seconds and 32 PIDs; conversion uses 60 seconds,
  512 MiB, 64 PIDs and 64 MiB workspace.
- Runner and broker share exact ceilings: 16 KiB probe stdout, 64 MiB conversion
  stdout and 64 KiB stderr. Conversion additionally enforces the configured
  expanded upload limit before ZIP decoding.
- Close tracks and aborts standalone probes and conversions from their first
  asynchronous operation. It awaits controller stop/output release before
  staging cleanup. Installed roles never spawn a Docker cleanup command.
- The conversion runner fixes Docker CLI `GOMAXPROCS=1`. The real probe-close
  test exposed `runtime/cgo: pthread_create failed: Resource temporarily
  unavailable` in `docker wait`: two Go clients and Bun share the helper's
  signed 32-task probe budget. Limiting their parallel runtime workers fixes
  the cause without increasing the sandbox or helper PID grant.

## Real HTTP surface

The focused supervisor fixture reuses the supplied image and provisions an
isolated release, independent controller ledger, authenticated API roles,
systemd units and real Docker execution. Its API listens on an ephemeral
loopback socket. Requests use the real login, session and CSRF flows.

The final installed HTTP case passed in 62.07 seconds. It performed
Markdown HTTP import, DOCX/Markdown/HTML HTTP exports and
downloads, and multipart DOCX reimport. It checked preserved Markdown and DOCX
bytes and unchanged project source after exports. DOCX contained
`word/document.xml`; Markdown and HTML retained `Installed Pandoc evidence`.
All six successful probe/conversion launches were released, their containers
absent, their units without live PIDs, and their staging directories removed.

The imported project was `7b56e30c-bd8a-4704-82c9-d82dea97c14f`; DOCX reimport
created `86164701-28a1-4df8-9180-9e1ef4ce8a79`. The actual downloaded archives,
retained under `/tmp/quire-p74-conversion-st_01a1d599/`, are:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `installed-docx.zip` | 9488 | `536582c6510525359a8e24445a1316ffa5b3acdc5960ef0a4f6c294f527cf202` |
| `installed-markdown.zip` | 699 | `8923abe70da7a88221562c16cab8a93dee2c5dfa434d118167b5c3a8a654bfd4` |
| `installed-html.zip` | 1905 | `e3187fd0635b95095d159231aa5910bb586f7521c3b5b2ffb758a80b4ce72851` |

Each archive contains `converted/document.<format>` and `manifest.json`.
Direct artifact inspection also found the title in DOCX's `word/document.xml`
and HTML's heading. The actual Markdown document is:

```markdown
---
---

# Installed Pandoc evidence

Preserved **structure** and $x^2$.
```

The probe returned 389 bytes. All six probe/conversion launches had code 0 and
released state.
The same HTTP fixture then rejected wrong-role, native-backend, unsigned-profile,
unsigned-image and excessive-resource requests. A signed but absent image
produced an interrupted, unstarted launch with no container, then released.

Final scoped TypeScript, type-aware deny-warning lint, and installed bundle
build completed successfully. The final affected direct conversion, fixed recipe
and isolated lifecycle/profile checks passed 8 tests, 39 assertions, zero
failures in 4.66 seconds. The wrapper additionally ran four lifecycle and two
profile-selection cases in separate processes.

The real delayed probe close passed with `canceled:true`, `interrupted:false`,
code 137 and released state. Its container and unit were stopped before the
converter's source directory disappeared. The delayed conversion produced the
same verified cancellation outcome. These payloads are immutable fixture-image
programs coordinated through Docker start events and authenticated broker
payload-start acknowledgements, with no timing sleeps in the test coordinator.

Final real installed suite: **3 pass, 0 fail, 95 assertions, 114.67 seconds,
exit 0**. `installed-bounded.log` is the final complete execution receipt.
The noisy conversion fixture emitted beyond each ceiling. The runner canceled
both executions before retaining the offending chunk: stdout retained
67,051,520 bytes (ceiling 67,108,864); stderr retained 16,384 bytes (ceiling
65,536). Neither execution could become a successful conversion.

Final diagnostics: scoped TypeScript **exit 0**, type-aware deny-warning lint
**exit 0**, installed controller/role bundle build **exit 0** (708 modules).
`pandoc-types.log`, `lint.log` and `build.log` retain their outputs. The earlier
Digest-brand test error was fixed by parsing the source with
`ExecutionSourceSchema`; no suppression was added.

## Reproduction

Run from the repository root with repository-local Bun 1.4.4. Set `TMPDIR` and
`XDG_CACHE_HOME` beneath an owned run directory. The cancellation test creates
small fixture images from the supplied Pandoc image using local unique base
tags, then removes its tags and Docker client cache. It installs no packages
and builds no TeX image.

Both installed test files read and validate `QUIRE_PANDOC_IMAGE`. There is no
task-specific image digest in repository tests. Running without the variable
fails immediately with `Set QUIRE_PANDOC_IMAGE to an installed immutable Pandoc
image ID`, before provisioning resources. The digest below records this run's
operator input.

```sh
export RUN_TMP=/tmp/quire-p74-conversion-st_01a1d599
export TMPDIR="$RUN_TMP/tmp"
export XDG_CACHE_HOME="$RUN_TMP/cache"
export QUIRE_PANDOC_IMAGE=sha256:93b748053b3129df98ad47625f6e341b439ad393399ed50ca40e02ed3fc04bac
export QUIRE_INTERCHANGE_EVIDENCE="$RUN_TMP"
mkdir -p "$TMPDIR" "$XDG_CACHE_HOME"

./node_modules/.bin/bun test --timeout 240000 \
  ./tests/operations/installation/supervisor-execution/pandoc.test.ts \
  ./tests/operations/installation/supervisor-execution/pandoc-cancellation.test.ts
./node_modules/.bin/bun test --timeout 180000 \
  ./tests/adapters/interchange/conversions.test.ts \
  ./tests/adapters/interchange/imports.test.ts \
  ./tests/adapters/interchange/link-routes.test.ts \
  ./tests/adapters/interchange/recovery.test.ts \
  ./tests/adapters/interchange/remote.test.ts \
  ./tests/adapters/interchange/selection.test.ts \
  ./tests/adapters/interchange/uploads.test.ts \
  ./tests/adapters/interchange/urls.test.ts \
  ./tests/operations/installation/pandoc-lifecycle.test.ts \
  ./tests/operations/installation/pandoc-recipes.test.ts \
  ./tests/operations/installation/supervisor-execution/source.test.ts
./node_modules/.bin/tsc --noEmit -p tests/operations/installation/pandoc-tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/adapters/interchange \
  services/operations/installation/execution-model.ts \
  services/operations/installation/execution-recipes.ts \
  services/operations/installation/execution-broker.ts \
  services/operations/installation/execution-runner.ts \
  services/operations/installation/execution-docker.ts \
  services/operations/installation/caller-execution-context.ts \
  tests/operations/installation/pandoc-*.ts \
  tests/operations/installation/supervisor-execution/pandoc*.ts \
  tests/operations/installation/supervisor-execution/main.ts \
  tests/operations/installation/supervisor-execution/fixture.ts
./node_modules/.bin/bun build \
  apps/server/src/installation-main.ts apps/server/src/installation-role.ts \
  --target=bun --outdir="$RUN_TMP/build"
```

The lifecycle and profile-selection test wrapper executes its module
substitutions in separate child processes, preventing contamination of other
test files. These deterministic coordination tests supplement real installed
execution; they do not substitute for it.

## Boundaries and inherited evidence

The scoped regression run passed 38 tests, 115 assertions, zero failures in
23.53 seconds. An earlier broad interchange command was stopped while the
unrelated submission-export test awaited a real TeX compile. That test is
unverified here; no test was changed, skipped or weakened to obtain a green
result. Its compiler provisioning remains outside this task.

Parent-loss and controller-restart behavior reuse the existing independently
accepted evidence in `p9-supervisor-execution-verification.md` and
`p9-supervisor-execution.evidence.json` (October 27, 2026), including actual
controller death, Docker inventory reconciliation and empty cgroups.
`p9-supervisor-stop-race.evidence.json` retains the October 28 unloaded-unit
race proof. Those are historical receipts, not new P74 restart executions.
P74 exercises the affected runner/broker paths through actual conversion,
explicit cancellation, output collection and resource teardown.

Initial cancellation fixture attempts failed before controller startup because
the production Docker command helper intentionally uses `/nonexistent` as HOME,
and because Docker build interprets a bare image ID as a repository reference.
The test now owns its Docker client cache and uniquely tags the supplied local
image before building. Production execution remains pinned to immutable IDs.

The diagnosed helper-thread failure is retained in `probe-thread-failure.log`.
Intermediate failing logs are diagnostic history; the authoritative final
installed receipt is `installed-bounded.log`. The successful scoped regressions
are in `regression-scoped.log` and `final-focused.log`.

## Cleanup and delivery

The final resource audit checked the exact retained cleanup receipts: 10
supervisor roots were absent, 75 owned units were inactive with `MainPID=0`
and no remaining cgroups, and all 33 recorded container IDs were absent.
No live process referenced the owned run root. The derived lifecycle-image
tags and their temporary base tags were absent.

The stopped broad regression left three temporary remote-Git fixture directories
under the owned `TMPDIR`; these were removed after the process audit. The owned
`tmp/`, `cache/` and bundle `build/` directories were removed. Only logs and the
three actual HTTP-downloaded archives remain in
`/tmp/quire-p74-conversion-st_01a1d599/` for parent review.

The supplied `quire-pandoc:ulw-20261113` image remains present and unchanged for
parent integration QA. No commit was created. There is no blocked conversion
evidence; the unrelated TeX submission regression and broader parent integration
gate retain the boundaries stated above.

No shared adapter, publisher contract or account UI file was edited by this
task. Parent integration QA and the eventual commit remain separate.
