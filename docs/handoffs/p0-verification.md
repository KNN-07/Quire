# Independent P0 verification

Result: **PASS for the assigned P0 checks**, on native Bun **1.3.14**
(`0d9b296a`), October 26, 2026. No producer files were edited, staged,
committed, or pushed. This result does not accept any P1/P2 feature or any
T01-T22 suite beyond the foundation assertions actually exercised below.

The retained run started at `2026-10-26T21:09:41.393Z` and finished at
`2026-10-26T21:09:54.062Z`. Its command,
`bun docs/evidence/p0-verify/run-checks.mjs`, exited **0**. Full machine-readable
results and cleanup receipts are in `docs/evidence/p0-verify/results.json`.

## Inputs and scope

Read `docs/implementation-plan.md`, relevant matrix rows including Q10, Q11,
Q13 and Q15, both available producer handoffs
(`foundation.md`, `visual-primitives.md`), package/configuration files, actual
composition/dev/seed/migration/client/public UI implementations, and the
foundation contract tests. The plan's P0 exit requires a running skeleton,
persisted users/example, shared schemas/client, and the early visual contract.
The matrix's complete authoring, authentication, compile, collaboration,
deployment and 23-screen targets remain later-phase work.

Both producer handoffs and the shared test harness exist; neither was replaced
with a stub. Existing installed dependencies were used without changing the
package graph or lockfile. A fresh dependency installation was not performed
or claimed.

## Observed checks

All paths in the Evidence column are beneath `docs/evidence/p0-verify/`.

| Check | Observed result | Evidence |
| --- | --- | --- |
| `bun run typecheck` | PASS, exit 0; actual `tsc --noEmit` | `typecheck.log` |
| `bun test tests/contract` | PASS, exit 0; **38 pass, 0 fail, 63 assertions, 8 files**, one run | `contract.log` |
| `bun run build` | PASS, exit 0; Vite 140 modules, native server bundle 126 modules | `build.log` |
| Installed React public UI types | PASS, exit 0; strict independent TypeScript consumer | `react-exports.log`, `react-exports.tsx` |
| `bun run db:migrate` | PASS, exit 0; isolated application-composition migration | `migrate.log` |
| `bun run seed` | PASS, exit 0; 6 users and example project persisted | `seed.log` |
| Second `bun run seed` | PASS, exit 0; 0 new users, no repeated password output | `seed-repeat.log` |
| SQLite close/reopen | PASS; independent connections, original source/blob, identities and foreign keys checked | `sqlite-reopen.json` |
| Actual seeded Git | PASS, exit 0; `git --git-dir <owned-data>/git/00000000-0000-4000-8000-000000000020.git show main:main.tex` | `seed-git.log` |
| Schema/client handoff consistency | PASS; 83 named schema exports present, 232 registry entries and unique method/path pairs | `schema-client.json` |
| `bun run dev` and proxied HTTP | PASS; both readiness events observed; supervisor exited 0 after SIGTERM | `dev-start.log`, `dev.log`, HTTP receipts |
| Mounted desktop/mobile shell | PASS; real API-connected status, no page errors or horizontal overflow; screenshots inspected | `browser.json`, `shell-1440.png`, `shell-390.png` |
| Cleanup | PASS; browser closed, root removed, owned API/web listeners absent | `results.json` cleanup object |

The contract run covers checked client/HTTP health, explicit 501 for
unimplemented authentication/realtime, module/lane injection, byte and multipart
transport, structured conflict/ETag metadata, schema boundaries, portable
transaction serialization/rollback, durable events, migration-change refusal,
blob corruption, native CLI persistence, actual Yjs/Git consistency, and the
installed LaTeX tokenizer. It is foundation coverage, not feature acceptance.

## Shared interfaces and React/style integration

The native verifier imports the installed `@quire/contracts` workspace package,
not a copied DTO definition. Every explicitly named `*Schema` identifier found
in the foundation handoff resolves: **83 present, zero missing**. The actual
`endpoints` object and `endpointRegistry` each contain **232** entries; all
method/path pairs are unique. `createClient().url()` resolves the real health
contract to `/api/health`. The repository typecheck compiles the contract
suite's mapped `RequestOf` and `ResponseOf` types for every registered endpoint.
The real HTTP contract test checks the generated client against a listening
server, rather than only asserting export names.

The separate consumer imports all eleven visual components and their documented
props/types from `apps/web/src/ui`: `BrandMark`, `Button`, `IconButton`, `Modal`,
`Field`, `Tabs`, `EmptyState`, `Spinner`, `ToastRegion`, `Icon`, and `AppHeader`,
plus `IconName`, `TabItem`, and `Toast`. Forwarded button, input and header refs,
ordinary HTML attributes and JSX composition compile against installed React
**19.2.9** and `@types/react` **19.2.18**. The precise TypeScript invocation is
retained in `react-exports.log`; it uses strict and exact optional property
checking with the installed React declarations.

The consumer imports both documented stylesheets. The real application build
also resolves those styles and emits all four local font assets plus an
11.89 kB stylesheet. Desktop/mobile screenshots show the styled mounted shell.
The optional `tokensLoaded` observation in `browser.json` is an empty string
because the verifier queried nonexistent `--q-font-ui`; the actual source names
the font token `--q-font-sans`. That field is not a failed production export
and was not used as a passing stylesheet assertion.

No missing public UI/schema export or client/server contract failure was
observed. The full visual primitive interaction matrix was not rerun here;
this assignment independently checked import/type/build integration and the
mounted foundation shell.

## Isolated persistence

The run owned `/tmp/quire-p0-verify-77nEtH` and used:

```text
TMPDIR=<root>/tmp
BUN_INSTALL_CACHE_DIR=<root>/cache
XDG_CACHE_HOME=<root>/cache
QUIRE_DATA_DIR=<root>/data
QUIRE_HOST=127.0.0.1
QUIRE_PORT=34381
QUIRE_WEB_HOST=::1
NODE_ENV=development
```

An ephemeral random `QUIRE_SEED_PASSWORD` was supplied and removed with the
data root; retained output redacts it. The first seed created six Argon2id
users, the second created zero. A connection was opened and closed, then a
second connection compared the persisted identities/password hashes. An
actual password verification succeeded. The reopened DB contains one
`Latent Dynamics Note` project, seven file/tree entries, and all five foundation
migration IDs with digests. `PRAGMA foreign_key_check` returned `[]`.

Reopened `document_states.text`, the disk content-addressed blob, and the
original `tests/fixtures/example/main.tex` agree. Main source is 453 bytes and
SHA-256 is
`392c2b10d1f883ac1a73ca0f77efe11c044a71a8e979877ca8df405d8b0f12ab`.
The separate Git command read the actual bare repository's `main:main.tex`.
The contract suite additionally verifies Yjs state/source equality, the actual
Git source, key/blob reopen and seed idempotence.

## HTTP and browser

Unrelated listeners already owned IPv4 port 5173 and port 3001. They were not
stopped. Following the foundation handoff's arrangement, this run bound Vite
to **[::1]:5173** and its own API to **127.0.0.1:34381**. Raw GETs used the IPv6
loopback with `Host: localhost:5173`; Chromium loaded the actual
**http://localhost:5173** origin with localhost explicitly resolved to ::1.
This prevents mistaking the unrelated IPv4 application for Quire.

`GET http://localhost:5173/`:

```text
HTTP 200
content-type: text/html
cache-control: no-cache
etag: W/"255-D7JYrFgl1LhpukxnuV1Kajq7i6U"
content-length: 597
```

The complete body in `http-shell.json` has the actual Vite development
bootstrap, `<title>Quire</title>`, `<div id="root"></div>` and module
`/src/main.tsx`. Chromium then mounted `Quire workspace`, navigation, the
truthful unimplemented-feature notice and `API connected (bun-1.3.14)`.

`GET http://localhost:5173/api/health`:

```text
HTTP 200
content-type: application/json;charset=utf-8
cache-control: no-store
x-request-id: ee32908d-7a08-49a6-8ece-0633106df46c
```

```json
{"data":{"status":"ok","runtime":"bun-1.3.14","database":"sqlite","at":"2026-10-26T21:09:51.791Z"},"requestId":"ee32908d-7a08-49a6-8ece-0633106df46c"}
```

This body passes the installed health/result schemas. The actual registered
health handler executes SQLite `SELECT 1`; browser status comes from the
shared client's real request, not a hardcoded success.

At **1440x900** and **390x844**, the DOM scroll widths equal 1440 and 390,
respectively, with zero page errors. Both retained screenshots were inspected:
nonblank content, legible wrapping, usable navigation, no clipped or
overlapping shell text. This is shell QA, not D01-D23 acceptance.

## Warnings, limitations and cleanup receipts

- The successful build emits Vite's existing warning for a **528.50 kB**
  minified JavaScript chunk exceeding 500 kB. It was neither suppressed nor
  treated as a build failure.
- The LSP freshness request for the independent TSX consumer timed out after
  3000 ms. The actual strict TypeScript CLI compilation completed with exit 0;
  no clean LSP result is claimed.
- The dev log includes `error: "vite" exited with code 143` during requested
  SIGTERM shutdown. The supervisor exited **0**, both owned listeners
  disappeared, and the browser had already completed its successful checks.
- Full lint/format, doctor capability probes, installation, complete product
  browser suites, compiler/sandbox, external integrations and scale/restore
  checks were not run by this P0 verification. No result for those is implied.

`results.json` records `browserClosed: true`, `devExitCode: 0`,
`rootRemoved: true`, `ownedApiListenerRemaining: false`,
`ownedWebListenerRemaining: false`, and a successful exit-0 `ss -ltnp` receipt.
The original IPv4 5173 and 3001 listeners remain outside this lane's ownership.
The result-file monitor completed; its cleanup lookup found no remaining
terminal session. An initially unnecessary command monitor was explicitly
killed. No owned data, Git repository, cache or application service remains.
Generated repository `dist/` build artifacts remain as normal ignored build
outputs; authored files and retained evidence are confined to this lane's
allowed paths.

The repository currently ignores `docs/evidence/`. The lead must explicitly
retain `docs/evidence/p0-verify/**` when preparing an authorized commit; this
lane did not stage or change ignore configuration.
