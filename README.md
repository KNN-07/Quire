# Quire

A LaTeX writing workspace, being built from the supplied Quire editor design and a comprehensive functionality research inventory.

## Status

The Bun/React/Vite foundation is runnable. Feature routes return explicit
`501 NOT_IMPLEMENTED` errors until their service modules are implemented.

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
users plus a real example Git repository in `.data`; authentication itself is not
implemented yet. Configuration is documented in `.env.example`.

Verified foundation checks:

```sh
bun run typecheck
bun test tests/contract
bun run build
```

See `docs/handoffs/foundation.md` for frozen exports, registration, fixtures,
browser verification, and the current implementation boundary.

## Product inputs

- `Quire — LaTeX Editor.html`: the supplied visual reference.
- `research.zip`: the supplied functionality research.
- `docs/discovery/`: implementation-oriented design and requirements reports.

The product targets persistent projects, LaTeX editing and real PDF compilation,
file organization, references, collaboration, review, and version recovery.
External services will require explicit configuration rather than simulated
results.
