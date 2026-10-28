# P9 supervisor recipe compatibility delta: FINAL

October 28, 2026. Owner: `st_01a17e6f`.

**PASS for the requested fixed recipe boundaries and the necessary binary
Docker output correction. Caller adoption remains the integration owner's
gate; this is not all-role installation acceptance.**

The new native metadata case passed 20 assertions in 60.12 seconds. The two
PDF recipe/schema cases passed 39 assertions in 49.80 seconds. These are two
focused passing commands, not a claimed single combined suite run. The one
affected existing Docker controller-loss case passed 3 assertions in 18.52
seconds. All commands exited 0 on project-local Bun 1.4.4 (38afee6c8).
Scoped strict TypeScript and type-aware deny-warning lint exited 0.

`p9-supervisor-recipes.evidence.json` records commands, source fingerprints,
cleanup identities, and the failed attempts that led to the correction.
The historical `p9-supervisor-execution.md` and its evidence JSON remain
byte-for-byte unchanged. No caller adapter, root dependency/script, or
derived-image admission logic was changed.

## API for the caller owner

The strict work schemas and signed profile kind enum now accept:

```ts
{ kind: "pdf-diff-render", source: { path, digest } }
{ kind: "pdf-diff-compile", source: { path, digest } }
```

Both use the existing request limits and controller-sealed source. The signed
profile must explicitly allow the new kind for the calling role. Neither
accepts argv, a shell string, environment variables, extra flags, or arbitrary
input/output paths.

`pdf-diff-render` reads fixed `from.pdf` and `to.pdf` inputs, renders both at
72 DPI to PPM and PNG, and returns a regular ustar stream containing the
existing consumer's `from-N.ppm`, `to-N.ppm`, `from-N.png`, and `to-N.png`
filenames. Diagnostics remain on stderr.

`pdf-diff-compile` reads fixed `diff.tex` and its referenced source PDFs,
invokes pdflatex with shell escape disabled, and returns a ustar stream
containing `diff.pdf` and `comparison.png`. The PNG is the first page scaled
to 1600 pixels on its longest dimension. This matches the two fixed commands
in `workers/compiler/pdf-diff.ts`; it does not substitute `pdf-validate`.

The unchanged `{ kind: "environment-metadata", source }` native branch now
runs the complete existing probe from `services/compiler/environment.ts`:
all eight tool version commands, the seven executable/configuration hashes,
the TeX package/configuration tree hash, actual PDF generation and pdfinfo,
and the final machine sentinel `QUIRE_NATIVE_PROBE_OK`. Its stdout remains
the raw bytes consumed by the native environment identity calculation.
The Docker metadata branch is unchanged.

The API names were sent through the parent broker before verification so the
caller owner could adopt them without taking ownership of driver files.

## Binary Docker output correction

The real PDF case exposed an existing transport incompatibility. A native
render archive was 2,928,640 bytes, while the Docker `logs` path returned
8,748,668 bytes. The test timed out while reading that output. Binary
archives cannot use the logging path as their payload transport.

`execution-runner.ts` now captures raw `docker start --attach` stdout/stderr.
Before triggering start, `observeContainerStart` in `execution-docker.ts`
subscribes to the exact container's daemon start event over the configured
Unix socket. Buffered events cover the daemon's response-header/subscription
gap. The event reader is bounded and abortable; an exact observed start is
required before `execution.started` acknowledgement.

The existing Docker wait path still supplies the actual container exit code.
The attachment's exit code must agree; legitimate nonzero payload outcomes
are retained rather than converted into output-transport failures. The
controller still proves exact container removal and unit/cgroup absence.
There is no new caller-facing manager endpoint or command forwarding API.

Production edits are limited to:

- `services/operations/installation/execution-model.ts`
- `services/operations/installation/execution-recipes.ts`
- `services/operations/installation/execution-docker.ts`
- `services/operations/installation/execution-runner.ts`

## Proof and cleanup

The tests use actual authenticated role requests and owned systemd executions.
Native metadata checks every expected tool family, all seven real file
digests, the tree-digest line, successful PDF inspection, and the sentinel.

The PDF case generates a real one-inch input PDF, then exercises both recipes
on native and Docker backends. It decodes the returned archives using the
production archive reader and checks PPM/PNG names, 72-DPI dimensions, PNG
signatures, PDF output, and the 1600-pixel comparison preview. The comparison
document explicitly rejects enabled shell escape. Missing PDF input returns
actual exit code 1 on both backends without an archive or invented
interruption result. Strict schema tests reject argv and arbitrary file
fields. This is a focused binary/format proof, not a large-document benchmark.

The newly affected controller-death case verifies that restart removes the
owned Docker child while preserving its absent payload report and recording
interruption. The unchanged P7 baseline, derived-image build, and application
integration suites were not rerun.

All five roots from passing and failed attempts are absent. The 21 recorded
units from passing runs are unloaded; both failed-run unit prefixes have no
loaded units. All five recorded containers are absent, checked against a
live Docker daemon. No images were created. The timed-out fixture was
explicitly inspected and cleaned by its exact recorded ownership.

Six delta source fingerprints matched after verification, and both historical
P9 receipt hashes remained unchanged.

## Reproduce the affected checks

```sh
./node_modules/.bin/bun test tests/operations/installation/supervisor-recipes.test.ts
./node_modules/.bin/bun test tests/operations/installation/supervisor-execution/executions.test.ts \
  --test-name-pattern "controller death retains exact Docker inventory"
./node_modules/.bin/bun ./node_modules/typescript/bin/tsc --noEmit \
  -p tests/operations/installation/supervisor-recipes-tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/operations/installation/execution-{model,recipes,docker,runner}.ts \
  tests/operations/installation/supervisor-recipes.test.ts
```

The existing real-process fixture requires the user systemd manager, native
TeX/bwrap tools, Docker, and its provisioned compiler image. No prerequisite
or host policy was installed or repaired.
