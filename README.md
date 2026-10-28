# Quire

A LaTeX writing workspace, being built from the supplied Quire editor design and a comprehensive functionality research inventory.

## Status

The native Bun/React/Vite application includes local authentication, persistent
projects/files, a shared Source/Visual editor, real isolated LaTeX compilation,
PDF navigation/diagnostics, collaboration, review/history, Git, bibliography,
templates and project/account/administration pages. Library forms/import/DOI,
image insertion/paste and bounded current-file offline recovery have scoped
browser acceptance evidence.

This is an implementation checkpoint, **not whole-product acceptance**.
Portable PostgreSQL/Redis/S3 storage and a real two-API/remote-worker profile
have passed independent acceptance. Controller-owned installation updates,
all-role recovery and the remaining capability-specific gaps are tracked in
`docs/feature-matrix.md`. External adapters require their documented
configuration; controlled-provider tests do not claim live vendor success.

With Bun 1.4.4 and Node.js compatible with Vite's
`^20.19.0 || >=22.12.0` requirement installed:

```sh
bun install
bun run db:migrate
bun run seed
bun run doctor
bun run dev
```

The repository also installs Bun 1.4.4 as a local development tool. After
installation, use `bun run …` package scripts or `./node_modules/.bin/bun …`;
these use the pinned runtime without replacing the workstation's global Bun.
A bare `bun test` can still select an older global runtime.

The default development URL is `http://localhost:5173`, proxying the API at
`http://127.0.0.1:3001`. Local seed prints generated credentials once and persists
users plus a real example Git repository in `.data`. Use those generated
credentials to sign in. Configuration is documented in `.env.example`.
Vite runs on Node.js so its HTTP/WebSocket proxy uses the supported Node
network stack; the API and compiler workers run on Bun.

Native compilation requires the actual TeX tools, BibTeX/Biber, SyncTeX,
Poppler PDF tools, Bubblewrap and a working systemd user service/cgroup
environment. A cold compiler readiness probe takes about 45 seconds on the
development workstation; startup does not substitute assumed readiness.

Verification commands:

```sh
bun run typecheck
bun run lint
bun run test tests/contract tests/core tests/accounts tests/compiler tests/integration
bun run test tests/operations/overview
bun run build
```

The full build includes controller-owned installation artifacts in
`dist/installation`. Use `bun run build:installation` to build just those
entrypoints. Provisioning, signed release metadata, controller/status/recovery
commands and current acceptance limits are documented in
`docs/runbooks/installation.md`.

See `docs/handoffs/p11-editor-acceptance.md` for the native editor workflow
and desktop/mobile evidence, `docs/handoffs/p10-native-verification.md` for
Library/media/offline acceptance, and `docs/feature-matrix.md` for the complete
requirement inventory and explicit limits. `docs/handoffs/p1s-verification.md`
and `deploy/portable/README.md` document the accepted PostgreSQL/Redis/S3
boundary and configuration.

## Product inputs

- `Quire — LaTeX Editor.html`: the supplied visual reference.
- `research.zip`: the supplied functionality research.
- `docs/discovery/`: implementation-oriented design and requirements reports.

The product targets persistent projects, LaTeX editing and real PDF compilation,
file organization, references, collaboration, review, and version recovery.
External services will require explicit configuration rather than simulated
results.
