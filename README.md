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
have passed independent acceptance. The tested `systemd-local-v1` profiles
also have native/same-host scale rollback, restored-inventory, signed promotion,
replacement-worker PDF, restart-authority and custom-environment admission
receipts. This is not arbitrary multi-host or Compose/Helm signed-update
acceptance. Exact evidence and remaining capability-specific gaps are tracked
in `docs/feature-matrix.md`. External adapters require their documented
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
`http://127.0.0.1:3001`. Local seed persists development users, a real example Git
repository, and the published **Starter Article** template in `.data`. Sign in
as `kien@quire.local` using the password printed once by `bun run seed`, then
on Projects choose Use template Starter Article -> Create from template.
The mobile New project dialog also offers From template -> Starter Article.
The original `main.tex` is CC0-1.0 and includes a title, abstract, and introduction.
The seed also retains its snapshot and a stored source ZIP export.

For a known development password, run
`QUIRE_SEED_PASSWORD='your-local-password-at-least-12-characters' bun run seed`
instead. All newly created seed users share that password, including
`operator@quire.local`, the development operator used to submit, approve, and
publish the bundled template through the normal services. Repeated seed leaves
existing passwords, user projects, template versions, and archive blobs intact;
it does not reset credentials or republish templates an operator has unpublished.
Keep the same `QUIRE_DATA_DIR` for migrate, seed, doctor, and dev when overriding
the default. `seed` runs only on a loopback, non-production configuration; these
accounts/passwords are development fixtures, not production provisioning.
Configure production identity and secrets separately using `.env.example`.
The template becomes selectable after seed, but opening a newly created project
directly from the dialog still requires real passed environment probes. If the
toolchain is unavailable, the dialog retains the created project and explains
how to open it and choose an admitted environment; seed does not fake readiness.
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
bun run verify:matrix
bun run ops:restore-drill
```

`verify:matrix` checks that every capability ID in the three discovery inventories
has exactly one matrix entry and a declared disposition. It reports partial,
external and unsupported coverage without certifying runtime behavior.
`ops:restore-drill` runs the existing local SQLite/blob/Git recovery case in
owned temporary fixtures; it does not restore or mutate a live installation.
Configured scale and controller-owned recovery retain their separate runbooks
and acceptance receipts.

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
