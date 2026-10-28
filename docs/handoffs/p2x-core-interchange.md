# Core interchange integration seams

`CoreProjects.createFromFiles` accepts optional `mainPath`, `engine` and
`environmentId`. These choices are applied before the first source publication.
A missing explicit main is rejected rather than silently selecting another root.
The environment must exist and not be retired.

Core exports `provideExternalLinks(context, adapter)` and the `ExternalLinks`
interface from `services/core/base`. One composed adapter supplies URL and
bibliography create/refresh handlers. Core retains its single HTTP routes,
actor authorization, versioned source boundary and HTTP replay receipt.
The adapter receives that receipt and must attach it to actual source publication.
Interchange owns registration of the composed adapter and its real external
route tests; this seam alone is not acceptance of those service workflows.

Multipart source uploads now retain `File.type`, instead of assigning every
uploaded image `text/plain`. The upload receipt digest includes MIME alongside
path and content digest. `bash_135` reproduced the original PNG metadata failure.
`bash_136` passed seven real upload/restart/content/replay and crash-recovery
tests, plus touched-file type-aware lint. The subsequent additional changed-MIME
request regression is tracked separately and is not included in that receipt.

Native Bun 1.3.14 probe `bash_141` established that multipart parsing derives
`File.type` from the filename rather than retaining the wire Content-Type:
the same `image/jpeg` header parses as `image/png` for `figure.png`,
`image/jpeg` for `figure.jpg`, and `application/octet-stream` for `figure.bin`.
Quire currently persists this parsed File metadata. The additional replay test
therefore changes the multipart filename while retaining the destination path
and bytes, and asserts that the parsed MIME actually differs before checking
the conflict. Earlier attempts which changed only the wire type were not tests
of a changed parsed input; their failures are retained in `bash_138` through
`bash_140`. This runtime limitation is not presented as raw-header preservation.
The corrected `bash_142` passed the actual HTTP replay-conflict test (nine
assertions) and touched-file type-aware lint, exit code 0.

`bash_137` passed seven explicit-import/source tests, touched-file type-aware
lint, and the complete repository TypeScript check, exit code 0. LSP reported
no errors for the changed core link route. Actual tests prove selected-root and
compiler-settings persistence after restart, missing-root rejection before
publication, invalid-draft persistence, relative-anchor correctness and stale
snapshot rejection.

Standalone `main.Rnw` is now eligible at import, settings selection and source
publication when its selected persisted environment uses Docker and advertises
the knitr helper. Ordinary TeX eligibility remains independent. The shared core
helper is `services/core/base/main-file.ts:mainPathAllowed`; Git and editor
owners were notified to align their gates.

Receipt `bash_143`: nine core import/source tests passed, touched-file type-aware
lint passed, and full repository TypeScript passed, exit code 0. Tests cover
Rnw rejection without knitr, standalone publication without a dummy main.tex,
editable state after restart and settings persistence. These are core boundary
tests using a persisted fixture manifest, not evidence of actual knitr execution.
The environment owner retains actual Docker compilation acceptance; the editor
owner retains real main-document selection acceptance.
