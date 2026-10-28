# Native interchange and isolated document conversion

`createInterchangeModule({ http?, converter?, remoteImport?, bibliographyLinks? })` returns
`{ module, close }`. Register `module` after core and shared adapters; call and
await `close()` before runtime shutdown. It owns `importCreate` and installs
the existing core `provideProjectExporter` delegate. Do not register another
project-export or source-download route.

## Configure installed tools

Native ZIP, TeX snippet/data URL and direct public URL imports need no provider
credential. Conversion needs an installed Docker daemon and an immutable local
Pandoc image, not host execution:

```sh
docker build -t quire-pandoc:local -f services/adapters/interchange/Dockerfile .
export QUIRE_PANDOC_IMAGE="$(docker image inspect quire-pandoc:local --format '{{.Id}}')"
bun test tests/adapters/interchange
bun x tsc --noEmit -p tests/adapters/interchange/tsconfig.json
bun x oxlint --type-aware --deny-warnings services/adapters/interchange tests/adapters/interchange
```

The Dockerfile installs Debian's packaged Pandoc. It does not claim the latest
upstream version. `PandocConverter.probe()` executes the configured image's
actual `pandoc --version` in isolation; readiness is degraded until that probe
succeeds. Missing configuration names `QUIRE_PANDOC_IMAGE`; missing/unreachable
tools and invalid images fail without a host fallback. No images are pulled
at conversion time (`--pull=never`).

Converters use no network, a read-only root and source mount, unprivileged user,
no capabilities/new privileges, 512 MiB memory, one CPU, 64 PIDs, 64 MiB work
tmpfs and 16 MiB temporary tmpfs. Wall budget is 60 seconds, stdout is capped
at the configured expanded upload limit, stderr at 64 KiB. Every conversion
has a unique container and temporary source root, removed on every outcome.
Only fixed operator-built tools run; uploaded Lua, shell, Perl, R or TeX shell
commands are never selected as conversion executables.

## Imports

`POST /api/imports` requires identity, CSRF and `Idempotency-Key`. JSON supports
`snippet`, `data-url`, `url`; multipart uses a `File` in `source`.
`kind` is `zip`, `docx`, `markdown` or `open-in`. `git`/`github` dispatch to the
actual shared `ConfiguredAdapter` contributions with the current actor-owned
encrypted grant and version. A `remoteImport` callback can override assembly,
but no remote clone/source mechanics are implemented twice.
`POST /api/import-uploads` accepts multipart `file` with an idempotency key and
returns `{id,filename,mime,bytes,sha256,expiresAt}`. Authenticated
`GET /api/import-uploads/:id` and `.../:id/content` retrieve only that actor's
actual persisted metadata/bytes. Pass its ID through `source.kind="upload"`.
Staging survives restart; another actor receives 404. Each file is bounded by
the configured upload limit; outstanding actor uploads are limited to four times
that byte limit and the configured upload entry count. IDs expire after 24 hours
and return actionable 410 errors. Retry an expired upload with a new key.
Staging records retain original blob references; expiry does not delete shared
content-addressed bytes. Apply operator retention/GC when reclaiming expired data.

ZIP uses core's strict central-directory/path/size/count/CRC/special-entry
validation and source/Git creation. DOCX is validated as an archive before
Pandoc. DOCX and Markdown produce standalone editable `main.tex`, preserve
original bytes under `originals/`, and retain extracted media. Open-in detects
DOCX/Markdown from declared MIME/filename, ZIP from its signature, otherwise
requires editable TeX with a documentclass. Independent keys create independent
projects. Source recovery stores an internal project receipt in core's existing
durable Git intent, so retry after source publication resumes that project.

JSON and multipart accept optional `mainPath`, `engine` and `environmentId`.
These are passed to core `createFromFiles` before the first source publication.
Missing selected roots or retired/missing environments reject instead of silently
selecting a fallback. Open-in plain TeX is explicit through `engine="plain"`.
Without selections, core chooses its first valid TeX main, pdflatex and preferred
installed environment.

## URL and Google Drive manual refresh

`fetchSource` and `UrlLinks.create/refresh` use shared `SafeHttpClient`: validated
DNS is pinned, every redirect is checked, private/loopback/link-local/metadata
targets are denied, and bytes/time are bounded. Explicit loopback fixture
origins are constructor-only test configuration. Do not enable them in production.

Only public direct downloads are supported: a Drive `webContentLink` or
Workspace `exportLinks` URL must return actual supported file bytes.
Authentication/consent/confirmation HTML fails with `IMPORT_LANDING_PAGE`.
There is no Drive OAuth, two-way sync, permission bypass or invented live
account success. A private Drive file requires manual upload, or a separately
implemented authenticated Drive API contract and encrypted grant.

`UrlLinks` keeps URLs and last-refresh timestamps in the existing file link
metadata. Refresh fetches outside SQL, then uses core's fenced source
publication and optimistic branch/digest checks. Missing source, remote errors
and conflicts preserve child bytes. Linked TeX remains noneditable and cannot
be selected as main. The module installs core's `provideExternalLinks` delegate,
retaining the existing single HTTP routes and source/replay boundaries.
For bibliography links, construct references before interchange and pass
`createInterchangeModule({ bibliographyLinks: references.links })`. The
dispatcher selects by the file's actual link kind on refresh; it never presents
a URL download as an authenticated bibliography provider. Missing reference
composition reports `BIBLIOGRAPHY_LINKS_REQUIRED`.

## Exports

Source ZIP is unchanged and stays owned by core. `submission` exports actual
source under `source/`, plus PDF and generated `.bbl` under `generated/`,
with separate manifest arrays. It requires an actual successful compiler job
for the exact requested snapshot. A project containing `.bib` requires an
actual `.bbl`; no synthetic bibliography or placeholder PDF is created.
Export never sends to a publisher or any external account.

DOCX, Markdown and HTML exports run actual Pandoc over immutable snapshot
bytes and return a ZIP containing `converted/` output/assets plus `manifest.json`.
All downloads use the existing actor-owned operation download route and current
project ACL. Exports recheck ACL/policy during final SQL publication.

Loss boundaries are returned in the manifest: layout/fonts/pagination,
custom macros/classes, scripts/filters, comments and tracked changes are not
promised lossless. The original input is source; converted output is generated.
Historical snapshot main selection currently depends on the project's current
main-file setting, so a removed/changed main is an actionable `INVALID_MAIN`.

Migration `066-x-interchange-uploads` adds actor-owned staged metadata referencing
the existing blob store, with explicit SQLite STRICT/INTEGER and PostgreSQL/BIGINT
definitions. Applied prior migration rows/digests/timestamps survive restart.
No shared port cast, dependency, original-input modification, existing SQLite
SQL change or existing digest rewrite is introduced.

`createRemoteGitIntegration()` now defaults to `registerImportRoute=false`.
Register its migration/recovery module and contributions alongside interchange;
interchange owns `importCreate`. Standalone remote suites may opt into the remote
route explicitly. Shared grants, actor-aware ports and real remote source/Git
publication are reused, with no duplicate clone implementation.
