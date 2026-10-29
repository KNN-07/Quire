# P40 clean-bootstrap starter template: independent verification

Status: **FINAL PASS, bounded**. October 28, 2026.
Verifier task: `st_01a182c0`.

The documented migrate/seed initialization supplies a real published Starter
Article, stored snapshot/source blobs and source ZIP. Acceptance is not based
on a UI-only catalog item or test-only/manual publication. The producer
handoff `docs/handoffs/p40-bootstrap-template.md` was initially non-FINAL;
verification waited for its subsequent FINAL result and corrected receipts.

## Prioritized findings

No blocking source or bootstrap-behavior findings remain in this scope.

1. **Resolved evidence defect:** previous passing browser runs did not show
   the mobile article outcome. `3b492940-9f39-4ce8-a889-51ad06f9e986` showed
   Assistant; `3fd54c0f-46f9-4e1e-b7ad-79dbe0b784b1` showed Project tools.
   Independently opening all eight captures in the accepted
   `1fd6c92d-5295-44c0-bbad-c56f690d0534` run confirms both drawers are closed
   and the real Source article is visible at 1440 and 390 pixels, light/dark.
2. **Acceptance limit:** the native case uses actual application composition
   and Node/Vite on owned OS-assigned loopback ports. It does not execute the
   literal default `localhost:5173` setup, `scripts/dev.ts` wrapper or `doctor`
   CLI. This is scoped bootstrap/service/browser acceptance, not certification
   of the entire README command sequence on every clean workstation.
3. **Acceptance limit:** catalog success is not compiler readiness or a
   successful template compile. Native admission asserts an actually probed,
   available, selectable environment before dialog creation; screenshots say
   "Not compiled." No compiler artifact or production credential readiness is
   accepted here.

## Source and stored-state trace

- `package.json` maps `db:migrate` and `seed` to the real scripts.
  `scripts/migrate.ts` applies `applicationMigrations()`.
  The CLI branch in `scripts/seed.ts:143` creates its runtime with the same
  application migrations, runs the existing foundation seed, then imports and
  invokes `seedStarterTemplate`. The imported foundation-only `seed(runtime,
  password)` contract remains unchanged.
- `scripts/seed-template.ts:14` rejects production/non-loopback configuration
  and requires the existing operator ID to be active, unsuspended and
  undeleted. It does not promote an account or add catalog grants.
  `services/core/catalog/templates.ts` and `publication.ts` retain the
  ordinary create/author, curator approval and publisher authorization checks.
  The operator can satisfy both separate transitions; this is not a claim of
  separate human approvers.
- The helper creates a private operator-owned native source project from
  `scripts/templates/article/main.tex`, then calls normal template creation
  and draft -> submitted -> approved -> published transitions.
  `Templates.create` snapshots real project content; template versions bind
  that snapshot. `CoreProjects.create` reads its snapshot blobs when an
  ordinary user creates from the published version.
- `services/core/base/operations.ts:47` exports the exact snapshot via the
  normal source ZIP writer. `recordOperation` stores a succeeded
  `source-export` operation with blob, project and snapshot provenance and
  registers the blob reference. There is no fabricated compiler artifact.
  Archive download retains actor/project/history authorization.
- Durable seed-only source/template receipts and the completed export marker
  make successful reseeding initialization-only. The completion branch returns
  before transitions or ZIP generation, preserving subsequent managed changes.
  Foundation seeding inserts only missing users and does not reset passwords.
  Local users share a development password on initial creation; README
  explicitly excludes these accounts from production provisioning.

## Original receipt provenance and coverage

All receipt paths below are under `docs/evidence/p40-bootstrap-template/`.
These are producer originals read independently, not verifier reruns.

| Receipt | Observed result and boundary |
| --- | --- |
| `core-final.log` | Bun 1.4.4; 2 pass, 0 fail, 38 assertions; `CORE_FINAL_EXIT=0`. Empty owned root executes actual `bun run db:migrate` and `bun run seed`, both code 0. |
| Same core run | Template `c993eaa0-0c96-4fd4-8306-f4594a32fb75`, version `d8a494e5-6d14-47f1-9bde-721bd4b22c7f`, published version number 3, snapshot `4004e89c-876c-472d-9e14-e2badc274a33`, export operation `9a142444-9079-4f09-9e66-a697d49db30f`, ZIP blob `c461beb86d25c2a3b6014e7c109dea5a819e69965df6af9110ca7e0935e4c50c`. |
| Core assertions inspected | Exact bundled bytes in snapshot blob and decoded ZIP; public discovery; ordinary-user owned copy; approve/publish/metadata denials; concealed source/archive 404; foreign workspace 403; anonymous create 401 with valid request header. |
| Core repeat-seed assertions | Unchanged blob rows, physical inventory and snapshots; one built-in template/version/export; preserved independent project edit, user-managed private draft and operator-unpublished starter; no catalog grants or unreferenced stored blob rows. Foundation-only compatibility and refusal to elevate an existing ordinary operator-ID account also pass. |
| `native-accepted.log` | 1 pass, 0 fail, 24 assertions; `NATIVE_ACCEPTED_EXIT=0`, 51.95 seconds. Actual CLI bootstrap precedes native application startup; no fixture publishes a template afterward. |
| Native accepted identity | Template `78aaef22-0b7e-48cd-9169-31f756e0e314`, version `d7510ced-f904-4801-bf42-09f61de95eb6`, snapshot `6d582718-5205-4a0b-83bc-73068d643ddd`, user project `a13541e9-5492-4140-b153-52288db77fe0`. |
| Native browser assertions inspected | Ordinary `outsider@quire.local` uses actual Projects gallery/dialog selection and creation; mounted editable CodeMirror receives an appended comment. Exact durable save event and revision are awaited; document endpoint returns exact original plus edit after save, reload, reopen, and repeat CLI seed. Blob/template/version counts remain stable. |
| `static-current.log`, `static-accepted.log` | Scoped core/native TypeScript and typed lint exits 0; accepted browser capture source has its own static exit 0. |
| `cleanup-prior.log`, `cleanup-visual-prior.log`, `cleanup-final.log` | Named failed/prior/final owned roots and owned listeners absent; final checksums OK; cleanup exits 0. Accepted root `/tmp/quire-p40-bootstrap-template-u52wLp`, web port 44693 and API port 43069 are covered. Native disposal and explicit root-absence assertion complete before passing output. |

The core fixture, browser fixture, native test and relevant normal service
implementations were read. Browser save/readiness signals subscribe before
the triggering action, rather than relying on fixed sleeps. Earlier failed
`core.log`, `core-corrected.log`, `native.log` and `native-corrected.log` were
also read: they retain request-header/status expectation corrections and the
invalid entry/edit-readiness failures, rather than concealing those attempts.
Their passing successors do not require production authorization changes.

## Source identity and visual evidence

Current bytes independently match all five entries of
`core-final-pre-run.sha256` and all nine entries of
`native-accepted-pre-run.sha256`. Key SHA-256 identities are:

```text
714ea9f39270ec8effc069f4301e8783640a4d2a1ecbda10a84685fc29f34a9a  scripts/seed.ts
6fc256c298ee852f30041fe300cdc3464cc2cf4f4ca5bdbf40ea2a710f79efcc  scripts/seed-template.ts
9bdef393f93ae72bed95f9cc0c9573bf6a2177a1a2c7e3ef1805a78d6db937bd  scripts/templates/article/main.tex
e3b9a95af8447724f9921d5af9720794850fd020b3e9d5d2735e9c3443f16f7e  tests/core/catalog/bootstrap-template/bootstrap.test.ts
86d408998ec605e2dcd6ecee1c326ac2d8308e0fecf38f3b3b508c4f2a0ec5f4  tests/ui-product/projects/bootstrap-template/browser.test.ts
```

The current catalog/publication/project service hashes also match producer
pre-edit `baseline.md`; normal service policy was not weakened for this seed.
Independent inspection details are retained in
`docs/evidence/p40-bootstrap-template-verification/inspection.md`.

All eight accepted `selection-{1440,390}-{light,dark}.png` and
`outcome-{1440,390}-{light,dark}.png` were opened. Selection shows Starter
Article, CC0-1.0/public metadata and the create action without page overflow.
Desktop outcomes show the original article and saved appended edit. Mobile
outcomes show the article in the normal scrollable source viewport; the edit
line is below the captured region, so its exact persistence comes from the
document assertions, not a claim that the mobile image displays every line.

## Remaining limits and verifier scope

This is independent source/receipt/capture inspection, not a fresh execution
of passing tests. Temporary runtime databases were intentionally removed, so
historical stored-state claims are grounded in the identified executed
assertions and original logs, not a currently retained database.

Clean sequential initialization and successful repeat seed are covered.
Concurrent seed processes, arbitrary corruption, and interrupted initialization
recovery are not separately exercised. No new global suite, production bundle,
installation, scale-profile deployment, literal default-origin launch, actual
PDF compile or external service acceptance is claimed.

Only this handoff and the verifier evidence directory were written. No
production/test/global ledger edits, commits or passing-check replays occurred.
