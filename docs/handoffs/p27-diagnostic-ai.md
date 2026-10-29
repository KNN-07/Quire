# P27 diagnostic AI: FINAL scoped handoff

October 28, 2026. Owner: `st_01a181c7`.

The actual editor diagnostic cards now open the existing reviewed ErrorFix
workflow. The targeted native workflow, denial checks, stale-result boundary,
types, typed deny-warning lint, inspected captures and owned cleanup passed.
This is scoped UI completion with the concrete shared seams below reported to
the parent; it is not a claim of atomic server revision binding.

## Delivered behavior

`editor/pdf/logs.tsx` supplies a per-card **Fix with AI** action through the
optional PDF-panel callback. It is disabled while the log is loading, for
Viewer/review-only access, and when the diagnostic has no linked editable file.
Existing navigation, filters, excerpts and downloads remain mounted. Excerpts
now slice the returned log bytes before decoding, matching diagnostic byte
offsets rather than slicing a decoded UTF-16 string.

`editor/index.tsx` carries the selected diagnostic, compile revision, recorded
excerpt and unique intent key into the existing Assistant route. The composer
preselects Agent/ErrorFix and only the diagnostic's linked file, displays the
actual job/revision/excerpt, and leaves diagnostic transmission consent
unchecked. Provider terms consent remains the existing independent decision.
Clicking the card itself sends no provider request and changes no source.

Generation flushes acknowledged local source and checks current authoritative
branch revision and edit access. It sends the diagnostic ID through the existing
typed endpoint; the server resolves its authorized project/branch log bytes.
The existing before/after proposal review, source links, explicit acceptance
and accepted-fix recompilation are reused. No automatic edit path was added.

Existing run storage is namespaced by diagnostic intent so a new card cannot
restore an unrelated proposal, while **Open source** before approval retains the
same pending proposal across Assistant remounts. **Clear diagnostic context**
returns to the normal composer. Aborted responses are ignored. Pending
diagnostic proposals are checked against authoritative branch revision before
publication; a late proposal after a collaborator source change is discarded
with a visible explanation.

## Settled checks

All receipts below are in `docs/evidence/p27-diagnostic-ai/`.

| Command / evidence | Observed result |
| --- | --- |
| `./node_modules/.bin/bun test tests/ui-editor/diagnostic-ai` | `tests-reviewed.log`: exit 0, 3 pass, 0 fail, 53 assertions, 122.71 s |
| Changed capture/verifier target, `bun test tests/ui-editor/diagnostic-ai/workflow.test.ts` | `captures-settled.log`: exit 0, 1 pass, 33 assertions, 70.91 s |
| `./node_modules/.bin/tsc --noEmit -p tests/ui-editor/diagnostic-ai/tsconfig.json` | `types-settled.log`: raw exit 0 |
| `./node_modules/.bin/oxlint --type-aware --deny-warnings apps/web/src/features/editor/pdf apps/web/src/features/editor/assistant apps/web/src/features/editor/index.tsx tests/ui-editor/diagnostic-ai` | `lint-settled.log`: raw exit 0 |

The complete suite passed in one run on project-local Bun 1.4.4
(`38afee6c8`). Its unchanged denial/stale checks were reused after the final
capture readiness change; only the changed workflow verifier and static checks
were rerun. These are separate receipts, not an invented combined run.

The workflow drives a genuine undefined LaTeX command through the native
compiler, clicks its actual card, and checks the exact diagnostic ID and selected
`main.tex` context. Missing diagnostic consent and missing provider consent
produce zero provider requests. After both decisions, the received diagnostic
equals the recorded compiler log byte slice and the received file equals the
actual broken source. Server source remains exact before approval, including
after opening the proposal's real source link. Acceptance changes only the
reviewed command; the real compile succeeds and PDF.js renders its PDF.

The denial scenario exercises actual `AI_UNCONFIGURED`, `AI_POLICY_DENIED`
(AI-off) and `AI_DISABLED` responses, with zero provider requests and unchanged
source, then opens the same diagnostics as a named Viewer and checks every
Fix action is disabled. Provider PUT does not accept an `enabled` field and
always enables configuration; the disabled-provider fixture therefore seeds
the real `adapter_provider_configs.enabled=0` storage state. It does not claim
an operator disable UI or public disable endpoint.

The late-result scenario gates the real loopback provider request, changes
source through another mounted native editor, waits for its actual save event,
then releases the provider. The first editor discards the pending proposal,
preserves the collaborator text, and rejects another send from the obsolete
diagnostic before a second provider call. There are no test sleeps.

## Inspected browser packet

`index.json` selects the final packet
`45709bfd-47c3-48a6-916e-0135d1095d18/`: all three surfaces
(`diagnostic`, `context`, `proposal`) at widths **1440 and 390**, in **light and
dark**, 12 PNGs total. Every selected raw image was opened and inspected.
Diagnostic actions/excerpts and proposal before/after/approval/source controls
are visible, and geometry checks report no document horizontal overflow.
Long context forms use their existing scroll area.

Also inspected: `source-linked-unaccepted.png` and `accepted-real-pdf.png`
from that packet, plus actual denial and late-discard images from
`434aef8f-494f-4c71-a47a-18a1383c44a7/` and
`45286a48-cfe7-4eb3-b36c-14baca5abafc/`.
The final origin was `http://127.0.0.1:33601`; this is the owned native fixture,
not literal localhost:5173.

The earlier mobile capture showed an already-open Assistant drawer instead of
logs, and an earlier review capture retained the composer's old scroll
position. Those were verifier framing errors, not missing production content.
The verifier now opens the actual Logs route, targets the reviewed surface,
and waits for the log-loaded enabled action before capturing. Historical
images and failures remain in their original packets.

The provider is the existing controlled loopback HTTP protocol fixture and
returns a legitimate, explicitly reviewed removal of the actual undefined
command. No live external-vendor inference or availability is claimed.

## Concrete shared seams left to the parent

1. **Atomic revision precondition is absent.** `aiRunCreate` accepts
   `diagnosticId` and `fileIds` but no `expectedRevision`.
   `services/adapters/ai/context.ts` resolves the diagnostic/log by project and
   branch, then separately reads current files; it does not compare the
   diagnostic snapshot revision with those reads in a single transaction.
   Frontend preflight and late-result discard cannot prevent a collaborator
   change in the interval between preflight and server context collection.
   The observed exact-context and stale-result cases passed; a race-free
   same-revision transmission guarantee is not claimed. A shared expected
   revision precondition and atomic diagnostic/file-context validation are the
   missing backend/contracts seam. Those files were not edited.
2. **Effective access exposes no AI-policy field.** Viewer edit capability is
   available for local disabling. AI-off/provider policy remains authoritative
   at Send, where the existing server rejects it before provider transmission.
   A policy-aware disabled card would need a shared effective-AI capability
   read; this task does not infer that authority from provider installation.

Both findings were sent to the parent rather than implemented outside scope.

## Receipts, recovery and cleanup

`evidence.sha256` fingerprints retained raw receipts and evidence;
`sources.sha256` fingerprints this lane's production/test files and handoff.
The initial tee opened before its directory existed: the passing terminal
output is explicitly preserved in `workflow-initial-recovered.log`, not
presented as an originally captured complete log. Initial TypeScript/shadow
errors, an invalid fixture-only disable request, and the source-link lifecycle
regression remain in `types-initial.log`, `lint-initial.log`, `tests-final.log`
and `tests-verified.log`. Later passing receipts do not rewrite those failures.

Each fixture awaits its own browser, provider, application/API and Vite
disposal, and records `cleanup.json` with its exact owned temporary root
absent. The three full-suite roots were `/tmp/quire-assembly-158rUI`,
`/tmp/quire-assembly-MTx1QB`, and `/tmp/quire-assembly-piQ5DF`; the final
capture root was `/tmp/quire-assembly-Ta1MZw`. All four cleanup assertions
passed.

Unchanged accepted assembly/native receipts in `p2u-assemble.md` and
`p11-editor-acceptance.md` were read and reused for their unchanged baseline
scope. No global build, broad route recertification, backend/contracts change,
original-input modification, unrelated-resource cleanup or commit is claimed.
