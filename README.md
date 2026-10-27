# Quire

A LaTeX writing workspace, being built from the supplied Quire editor design and a comprehensive functionality research inventory.

## Status

The native Bun/React/Vite application now includes local authentication,
persistent projects and files, governance, collaboration/review/history,
Git smart HTTP, bibliography/templates, real isolated LaTeX compilation and
project/account/administration pages.

This is an implementation checkpoint, **not the complete editor yet**. The
source/visual/PDF workspace, external adapters and most operations workflows
remain under development. The scale profile is not available yet. There are
176 registered API contracts and 69 explicit later-phase
`501 NOT_IMPLEMENTED` contracts; no external-provider success is simulated.

With Bun 1.3.14 installed:

```sh
bun install
bun run db:migrate
bun run seed
bun run doctor
bun run dev
```

The shell runs at `http://localhost:5173`, proxying the API at
`http://127.0.0.1:3001`. Local seed prints generated credentials once and persists
users plus a real example Git repository in `.data`. Use those generated
credentials to sign in. Configuration is documented in `.env.example`.

Native compilation requires the actual TeX tools, BibTeX/Biber, SyncTeX,
Poppler PDF tools, Bubblewrap and a working systemd user service/cgroup
environment. A cold compiler readiness probe takes about 45 seconds on the
development workstation; startup does not substitute assumed readiness.

Verified native checks:

```sh
bun run typecheck
bun run lint
bun test tests/contract tests/core tests/accounts tests/compiler tests/integration
bun test tests/operations/overview
bun run build
```

See `docs/handoffs/p1-acceptance.md` for the native acceptance evidence and its
remaining boundaries, `docs/feature-matrix.md` for the complete requirement
inventory, and `docs/architecture/storage-portability.md` for the next
PostgreSQL/Redis/S3 phase.

## Product inputs

- `Quire — LaTeX Editor.html`: the supplied visual reference.
- `research.zip`: the supplied functionality research.
- `docs/discovery/`: implementation-oriented design and requirements reports.

The product targets persistent projects, LaTeX editing and real PDF compilation,
file organization, references, collaboration, review, and version recovery.
External services will require explicit configuration rather than simulated
results.
