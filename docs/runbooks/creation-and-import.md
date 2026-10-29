# Project creation and import choices

New project exposes compiler and executable environment choices for blank,
template, ZIP, GitHub and generic Git creation. Template/import modes also
accept an optional exact main-document path. These choices are published
with the project rather than patched afterward.

Fresh blank/example creation starts from the account's saved compiler.
Other fresh modes retain their existing pdfLaTeX fallback unless you select
another compiler or restore an explicit onboarding draft. A template version
does not currently carry immutable compiler metadata; the dialog does not
infer settings from its mutable source project.

## Main document and environment

- Supply the exact path within the template/archive/repository, such as
  `chapters/paper.tex`. A missing explicit main is rejected rather than
  silently replaced with another file.
- Leave the path empty to use the existing compatible-main discovery.
- Exact root `main.Rnw` and `main.Rtex` require a configured Docker knitr
  environment. See `toolchains.md`.
- Plain TeX needs actual plain source; the supplied blank/example seeds are
  LaTeX. Import plain source and select a supporting environment instead.
- Toolchain readiness and signed worker admission are distinct. A managed
  deployment must admit the selected image before it can execute it.

## Git history and remote connection

This installation requires a ready saved connection for remote imports,
including public repositories. Configure the provider and save the user's
GitHub connection or repository-bound generic Git credential in Settings.
Credentials remain encrypted and are never embedded in project source.

**Import full Git history** retains commits, branches and tags. Clearing it
creates an independent project with one source snapshot instead. The
repository may still be fetched for inspection; this is not a shallow-fetch
or bandwidth guarantee.

**Keep remote connection for pull and push** creates the project binding
used by the existing explicit remote actions. It does not install automatic
background synchronization. Retaining that connection requires full history;
an independent snapshot cannot keep a binding to unrelated remote ancestry.
You may retain full history without retaining the project binding.

An unbound project does not delete the account's saved credential. Manage
that credential separately in Settings.

## Submission and recovery

Choices lock while creation/import is pending and after an import result is
available. Use Open imported project to inspect or edit the resulting
project. A completed project can change compiler settings through Project
settings; changing an old submitted form is not a settings update.

Onboarding retries retain their frozen request and original idempotency key.
If the original ZIP must be attached again, its required-file input remains
available while the other frozen choices stay locked. A legacy saved attempt
that omitted compiler/environment values is described as using service
defaults, not shown as a newly chosen explicit setting.

Repeated independent imports through one saved connection are separate
operations. Import/clone do not share a moving project cursor; existing
project-bound pull/push cursors remain protected.
