# P40 clean-bootstrap starter template

Status: **FINAL PASS**. October 28, 2026. Scoped clean-bootstrap template
acceptance, not whole-product or literal-default-origin acceptance.

## Delivered mechanism

README's real `bun run db:migrate` and `bun run seed` entrypoints now provide
**Starter Article**, an original CC0-1.0 `main.tex` with title, abstract, and
introduction. `scripts/seed.ts` calls the new seed-only helper after the shared
foundation seed. Tests and callers that invoke only `seed(runtime, password)`
retain their existing foundation-migration contract.

The helper composes the real native source writer, catalog create,
submit/approve/publish transitions, and source ZIP export. It uses the existing
active development operator; it never promotes pre-existing ordinary accounts
or adds catalog grants. No service, migration, account, editor, installation,
or creation-dialog seam needed modification.

The template references a stored snapshot and source blobs. Its real ZIP
archive is a stored `source-export` operation with blob and snapshot provenance,
not a fake compiler artifact. Contract details are in
`docs/evidence/p40-bootstrap-template/contracts.md`.

## Setup

Use the README sequence with pinned Bun 1.4.4 and supported Node:

```sh
bun install
bun run db:migrate
bun run seed
bun run doctor
bun run dev
```

Sign in as `kien@quire.local` with the once-printed local development password.
On Projects, choose **Use template Starter Article**, then **Create from
template**. The mobile New project dialog also has **From template**.
To choose a development password on initial seed:

```sh
QUIRE_SEED_PASSWORD='your-local-password-at-least-12-characters' bun run seed
```

Use the same `QUIRE_DATA_DIR` on all commands when overriding `.data`.
Repeated seed does not reset existing credentials, overwrite independent
projects/templates, republish an unpublished starter, add versions/snapshots,
or regenerate its archive. Seed is loopback/non-production initialization;
production identity and secrets require separate configuration.

Real TeX/helper/Poppler/Bubblewrap/systemd probes still determine availability.
The unavailable seeded placeholder is not a readiness assertion. A failed
toolchain probe leaves the normal dialog's explicit environment recovery path.

## Passing evidence

All paths below are under `docs/evidence/p40-bootstrap-template/`.

| Gate | Current evidence |
| --- | --- |
| Real documented seed path | `core-final.log`: actual pinned `bun run db:migrate` and `bun run seed` subprocesses on an empty owned directory, each exit 0; normal public catalog returns the published starter |
| Native stored content | Same log: exact original `main.tex` in snapshot/source blob and decoded stored ZIP; published version 3; actual source-export blob and snapshot provenance |
| Idempotence and references | Same log: one built-in template/version/archive before adding the user's separate draft; unchanged snapshot rows, blob rows and physical blob inventory across repeat seed; no orphan stored blob references; user's project edits, private draft metadata and operator-unpublished starter preserved |
| Authorization and migration sequencing | Same log: ordinary-user copy succeeds while approve/publish/metadata/source-project/archive/foreign-workspace/anonymous paths deny; no catalog grants; existing ordinary operator-ID user is not elevated; foundation-only seed remains compatible |
| Native create/edit/reload/reopen | `native-accepted.log`: 1 case, 24 assertions, exit 0 in 51.95 seconds; ordinary `outsider@quire.local` selects the real version in the actual dialog, creates its own project, edits mounted CodeMirror, awaits durable save, reloads/reopens exact text, and repeats CLI seed without losing edits or adding blobs/versions |
| Real environment availability | Native case checks the normal admission API for an available, probed, selectable environment; the startup uses the actual native probe and compiler worker, not a fixture-ready flag |
| Strict types and typed lint | `static-current.log`: core and native scoped `tsc --noEmit` plus typed lint exits 0; `static-accepted.log`: final native source `tsc --noEmit` and owned-path `oxlint --type-aware --deny-warnings` exits 0; LSP diagnostics are clear |
| Exact final cleanup/source identity | `cleanup-prior.log`, `cleanup-visual-prior.log`, `cleanup-final.log`: prior/final owned roots and exact API/web listener ports absent, final pre-run source hashes still match, whitespace check exits 0 |

The native fixture executes the actual migrate/seed CLI commands before
starting the real application composition, compiler worker, and Node/Vite.
It uses owned OS-assigned loopback ports rather than taking over shared
`localhost:5173`; the `scripts/dev.ts` wrapper and `doctor` CLI were not
separately executed. No fixture publishes the starter on the browser's behalf.

### Visual inspection

Final captures are in
`1fd6c92d-5295-44c0-bbad-c56f690d0534/`:
`selection-{1440,390}-{light,dark}.png` and
`outcome-{1440,390}-{light,dark}.png`. All eight were opened and inspected.
The selected article, honest license/public metadata, and creation action
are visible in the dialog. Outcomes show the created article in the real
saved Source workspace, without Assistant/Project tools drawers obscuring it.
There is no horizontal page overflow or blank article surface. Mobile source
scrolls within its normal viewport; exact full text is independently asserted
through the persisted native document endpoint.

### Retained earlier test corrections

- `core.log`: existing directly affected catalog publication/copy cases passed
  11/11. The first new case failed because its anonymous request omitted the
  required idempotency header.
- `core-corrected.log`: that request was corrected; a later assertion then
  exposed the existing concealed-project policy (404 rather than 403).
- `core-final.log`: 2/2 bootstrap cases, 38 assertions, exit 0. Real CLI migrate
  and seed on empty storage, public catalog discovery, exact snapshot/ZIP
  bytes, ordinary-user project creation, publication/metadata/source/archive/
  workspace/anonymous denials, idempotence, managed draft/unpublished state,
  no orphan blob references, and foundation-only compatibility all passed.
- `native.log` retained the initial invalid test-only `?new=template` entry;
  the actual gallery entry replaces it.
- `native-corrected.log` reached real selection and creation; its premature
  edit timed out before an editable transport state. The final test now arms
  the existing DOM readiness signal before creation and awaits it before input.
- `static-native-final.log` checks the corrected readiness subscription.
- `native-final.log`: native create/edit/reload/reopen and repeated CLI seed
  passed (1 case, 20 assertions, exit 0). Inspection caught the default
  Assistant drawer obscuring the mobile source capture.
- `native-visual-final.log`: behavior passed again (1 case, 20 assertions,
  exit 0); inspection then caught the default Project tools drawer exposed
  after closing Assistant on mobile. The final capture test explicitly closes
  both existing panels and asserts that no dialog obscures the article.
- `static-visual-final.log`: strict native TypeScript and typed lint exits 0.

Pre-edit hashes are in `baseline.md`; each test invocation has corresponding
pre-run hashes under `docs/evidence/p40-bootstrap-template`.

## Cleanup and scope

The final native root `/tmp/quire-p40-bootstrap-template-u52wLp` and listeners
`127.0.0.1:44693` / `127.0.0.1:43069` are absent. The fixture awaited browser,
application/worker, Node/Vite, API and storage disposal before removing the
root. All P40 tail monitors were stopped, including final `bash_31` and
`bash_33`; all test/static commands completed before this FINAL publication.
Prior failed/capture-correction roots and listeners are separately checked in
the cleanup receipts. Retained evidence is intentional.

No unrelated shared files, accounts, processes, default ports, accepted
compiler/collaboration suites, global matrix, or original inputs were changed.
No commit was created. README's seed section is the only setup-documentation
edit outside this packet.

No production bundle inputs changed, so an unrelated full production build
was not run for this seed-only increment. This does not claim current global
product validation, live vendor behavior, a template compiler artifact, or
literal-default-origin acceptance.
