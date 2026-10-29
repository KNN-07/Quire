# Compiler environments

The accepted native environment is still `texlive-2025-native`, ID
`00000000-0000-4000-8000-000000000030`. Do not rename it to another release.
Native execution is permitted only for its actual startup-probed digest.
Other installations use immutable Docker image IDs, never a mutable tag or
an arbitrary host root. A failed executed probe leaves a manifest unavailable.

## Provision an isolated image

Requirements: repository-pinned Bun 1.4.4, a Linux Docker engine with cgroup v2, the
default seccomp profile, and network access during the explicit image build.
No tool is installed into the host's system or user directories.
The executed build evidence uses Docker 29 with its containerd image store.
Retain a local repository tag for each base image: Dockerfile bases are
qualified as `repository:tag@sha256:<immutable image ID>`, not the bare ID
(which BuildKit interprets as a repository named `sha256`). Execution uses
only the immutable ID, and a mutable tag alone is never accepted.

```sh
bun scripts/ops/environments.ts bootstrap quire-toolchain:2025
docker image inspect quire-toolchain:2025 --format '{{.Id}}'
bun scripts/ops/environments.ts probe sha256:<actual-image-id> default
bun scripts/ops/environments.ts probe sha256:<actual-image-id> restricted
bun scripts/ops/environments.ts probe sha256:<actual-image-id> knitr
```

`deploy/compiler/Dockerfile` pins Ubuntu 26.04 and a Python 3.13 helper runtime
by digest, TeX Live 2025 binaries/base, latexmk 4.87, Biber 2.21, R 4.5.2 and
knitr 1.51 by package version. The image records its actual package inventory,
Python runtime and helper script hashes. The final **image ID** pins all
transitive packages; rebuilding against the distribution archive may produce
a different ID and therefore requires new environment IDs and new probes.
The bundled minted wheel is not compatible with Python 3.14's argparse API;
the isolated Python 3.13 runtime is intentional. The host Python is untouched.

The three helper profiles share an immutable installed image, but have
different manifest IDs and executed capabilities:

| Profile | Helpers | Shell policy |
| --- | --- | --- |
| default | BibTeX, Biber, SyncTeX | `-no-shell-escape` |
| restricted | Same, plus `latexminted` and `quire-tikz` | `-shell-restricted`, exactly those two helper commands |
| knitr | Same as default, plus actual R/knitr | explicit `main.Rnw`/`main.Rtex` preprocessing, then no-shell TeX |

Every profile probes pdfLaTeX, LaTeX/DVI conversion, XeLaTeX, LuaLaTeX, plain
TeX, local classes/styles, Unicode fonts, resolved BibTeX/Biber content, actual
PDF text/rendering, and confinement. Restricted profiles additionally compile
minted code and actual two/three-dimensional externalized TikZ plots. The
TikZ wrapper accepts only `output-figure` plus decimal digits and invokes a
fixed `main.tex` using pdfLaTeX without shell escape. It does not accept engine
flags, TeX fragments or arbitrary commands. Use the fixture's explicit
`\tikzset{external/system call={quire-tikz \image}}` configuration.

Knitr accepts exact root `main.Rnw` or `main.Rtex`, or an editable `main.tex`
alongside one of those inputs. With `main.tex` selected, `main.Rnw` takes
precedence if both R inputs exist; select the R input explicitly to remove
that ambiguity. Knitr detects the input chunk syntax. The preprocessor replaces
only the private working copy, never the read-only source mount or stored
blob. Generated files and R caches are job-local, never an
implicit persistent project mutation. Each job starts clean. Ordinary chunk
caching is unsupported: the configured knitr option hook rejects enabled
`cache` options with `QUIRE_KNITR_CACHE_UNSUPPORTED` and directs the author
to `cache=FALSE`. This is a supported-workflow check, not a security boundary
against R code deliberately replacing knitr's hooks. Even such code executes
only within the disposable job; no cross-job R cache is retained. R chunks and
project latexmkrc files are executable code inside the same isolated boundary,
not configuration asserted safe for host execution. System latexmkrc is read
before project `.latexmkrc` (preferred over `latexmkrc`); selected engine and
shell policy flags are applied afterward. Draft and stop-on-first-error settings
are preserved. A partial PDF from a failed job is not successful output.
Core publication accepts exact editable `main.Rnw` or `main.Rtex` when its selected persisted
environment uses Docker and advertises knitr. Import must explicitly choose
that main and environment. The alternate selected `main.tex` plus uploaded
`main.Rnw` workflow also remains supported; both preprocess private working
input rather than changing the stored project.

## Reuse pre-rendered TikZ assets

For the supported restricted Docker helper, use root `main.tex`, pdfLaTeX and
the configured restricted environment. A minimal preamble is:

```tex
\usepackage{tikz}
\usetikzlibrary{external}
\tikzexternalize
\tikzset{external/system call={quire-tikz \image}}
```

Compile normally once. In Logs, download the matching generated files for
each figure: `output-figure0.pdf`, `output-figure0.md5`, and
`output-figure0.dpth`, then the corresponding set for subsequent figures.
The helper supports these root basenames, not arbitrary prefixes or commands.
Use Files > File actions > Upload files to persist those exact bytes in the
project. Downloaded artifacts alone are not project files.

Change the externalization line to:

```tex
\tikzexternalize[mode=only graphics]
```

Recompile to include the uploaded PDFs without regenerating their figures.
Clearing generated cache removes reusable job results, not uploaded source
assets. Each subsequent job still uses a fresh isolated working directory;
the persistent copies are materialized from the project's immutable blobs.

Only-graphics mode does not refresh stale figures. If figure source,
numbering or names change, return to normal externalization and regenerate
and replace the complete matching asset set. Missing assets fail rather than
silently manufacturing a figure. This workflow does not expand quotas,
promise particular timing improvements or make arbitrary TeX constructs
compatible with externalization.

## Operator API and CLI

Register `services/operations/environments` as lane O, order 60, with its
exported migrations, after compiler registration. Production entrypoints must
use the real SQL/blob/repository runtime. The same asynchronous SQL works on
SQLite and PostgreSQL; this module adds migration `060-o-environments` without
altering original migration bytes.

The CLI uses the existing authenticated HTTP API; it never bypasses identity,
CSRF or optimistic confirmation. Supply these variables privately:

```text
QUIRE_OPERATOR_URL=http://127.0.0.1:3001
QUIRE_OPERATOR_ORIGIN=http://localhost:5173
QUIRE_OPERATOR_COOKIE=<current session cookie>
QUIRE_OPERATOR_CSRF=<current session csrfToken from /api/me>
QUIRE_OPERATION_KEY=<unique stable key for create/build retries>
```

```sh
bun scripts/ops/environments.ts list
bun scripts/ops/environments.ts create request.json
bun scripts/ops/environments.ts default request.json
bun scripts/ops/environments.ts retire request.json
bun scripts/ops/environments.ts build request.json
```

The request file is the shared endpoint input shape, for example:

```json
{"params":{"id":"<environment UUID>"},"query":{},"body":{"expectedVersion":0}}
```

Creation uses `{"params":{},"query":{},"body":{"manifest":{...}}}`, with the
shared manifest fields except `available`/`probeAt`; both are determined by
execution. Release and package digest declarations must equal the actual
probe. IDs cannot be overwritten. Successful and failed manifests remain
inspectable. Reusing a create/build key with different input returns a conflict.

List response header `x-environment-versions` maps each ID to its current
`version`, `isDefault` and `retiredAt`; use the current version when confirming.
Default changes do not rewrite current project settings or historical snapshots.
Retirement is blocked for the default, any live project pin, or queued/running
jobs. Retired environments cannot execute.

Build body:

```json
{"baseId":"<available UUID>","packageList":[],"fontUploads":[],"mirror":"https://archive.ubuntu.com/ubuntu/"}
```

Builds return a real queued operation with `202` immediately. Subscribe to
`operation.changed` before submission, or poll the existing operation read
route for progress and terminal state. Retries of the same key return the
same queued/running/terminal operation. Actual builds are serialized by the
context-owned supervisor.
Queued execution acquires `admission.background` only after its serial turn;
the lease covers execution, failure cleanup and terminal persistence, not
the expired HTTP request context.
The operation's download is the real JSON build/probe/manifest receipt in the blob store, with
`operatorOnly:true`. Fetch it through existing operation read/download routes.
Image tags `quire-environment-build:<operation UUID>` retain actual image
artifacts; compiler execution always uses their immutable image ID.
The application must await exported `stopEnvironmentBuilds(runtime)` before
closing runtime adapters. It rejects new work, aborts and drains active
builds and create probes, and records canceled build outcomes. Operator
session and role are checked again before queued execution and publication.

For native-base extension, explicitly configure `QUIRE_ENVIRONMENT_BASE_IMAGE`
to the provisioned Docker image ID; native system directories are never
modified. For an existing Docker base, its recorded immutable ID is used.
Additional packages must be explicit versions of `texlive-*` or `fonts-*`.
No arbitrary command, package script upload, URL, or shell option is accepted.

`QUIRE_ENVIRONMENT_MIRROR` defaults to exactly
`https://archive.ubuntu.com/ubuntu/`. Only that exact configured public HTTPS
archive URL is admitted. No credentials/query/fragment/custom port/IP literal
is accepted. Package builds resolve public IPv4 addresses, reject reserved
networks, pin the build hostname with `--add-host`, disable HTTP redirects and
use the distribution archive signing key. There is no arbitrary URL downloader.
The configured archive must provide the resolute suites; this is not a CTAN
or user-controlled tlmgr endpoint.

`fontUploads` are existing font file IDs in the operator's own project's
default branch, not arbitrary blob digests or filesystem paths. Maximum 16
fonts, 8 MiB each, standalone `.ttf`/`.otf`. The sfnt table directory, all
offsets, immutable blob digest and actual confined fontconfig parsing are
checked before building. Fonts are installed only in the new image.
Use fontspec with Xe/Lua for OpenType uploads; pdfLaTeX does not gain native
OpenType/fontspec support.

## Workers and confinement

Provision the exact image on each Docker worker. Export an explicit local
manifest list to `QUIRE_WORKER_ENVIRONMENTS_FILE`; worker startup executes its
own probes before advertising any supported ID. Coordinator-provided image
identifiers are not an instruction to pull arbitrary remote images.

The Docker sandbox copies ordinary snapshot files only (no links or special
files), then mounts that copy read-only. It runs UID/GID 65534, dropped
capabilities, no-new-privileges, seccomp, isolated networking, read-only root,
1 CPU, bounded memory without swap, process count and tmpfs disk, wall deadline
and output caps. Cancellation force-removes the entire named container before
returning. `/work` and `/tmp` are private; host home, repository and Docker
socket are absent. No unsandboxed fallback exists.
Image-declared Docker `VOLUME` mounts are rejected before creation because
anonymous writable volumes would bypass the tmpfs workspace quota.

## Tagged PDF and validation limits

`deploy/compiler/fixtures/tagged/main.tex` uses the installed LaTeX
2025-11-01 format, DocumentMetadata phase-III/title and LuaHBTeX 1.22.0, with
language/title/author and PDF 2.0. The actual fixture is rendered and inspected;
retained PDF metadata reports `Tagged: yes`, `Suspects: no`, one readable page.
This is structural evidence, not a PDF/UA certification. veraPDF and
assistive-technology checks are not installed/performed by this profile.
No MathML or universal package compatibility is claimed. In particular,
minted's upstream package page marks tagged-PDF compatibility separately;
the tagged fixture does not combine minted with tagging.

Official references consulted: Docker resource constraints
(`docs.docker.com/engine/containers/resource_constraints/`), minted's package
and source documentation (`ctan.org/pkg/minted`, `github.com/gpoore/minted`),
and knitr (`yihui.org/knitr/`). Actual installed versions and executed probe
reports take precedence over PATH discovery or an upstream release label.
The installed knitr API was checked against
`github.com/yihui/knitr/blob/v1.51/man/knit.Rd`; the HTTP command uses the
official Ky 1.14.3 API, not its unreleased main-branch documentation.

## Verify and clean owned resources

```sh
bun test tests/operations/environments
bun node_modules/typescript/bin/tsc --noEmit -p tests/operations/environments/tsconfig.json
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings services/operations/environments workers/compiler/docker.ts scripts/ops/environments.ts tests/operations/environments
```

The fixture image tag is `quire-p2o-environments:st_01a17c2c`; set
`QUIRE_TEST_ENVIRONMENT_IMAGE` to an explicitly provisioned immutable image ID
when using a different owned fixture. Tests use only `quire-environment-*`
containers and uniquely named `quire-environment-*`/`quire-environments-http-*`
temporary directories and loopback listeners. They remove those resources;
the explicit bootstrap image is a retained artifact until its owner removes
its exact tag. Never prune shared Docker images, volumes or caches.
