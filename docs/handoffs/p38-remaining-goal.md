# P38 remaining mandatory goal work

October 28, 2026. Bounded read-only reconciliation except this report; no
runtime, browser, test, build, ledger edit or commit. This is not final acceptance.
Sources were changing during inspection. Later named FINAL receipts can supersede
this cutoff; source presence alone cannot.

Paths are repository-relative. H means `docs/handoffs/`; M means
`docs/feature-matrix.md`, using its exact row IDs. M retains all elected
requirements, including its row-specific next actions; status counts are not
completion percentages. H/p26-remaining-acceptance.md is historical, not the
current blocker list.

## Six original success criteria: current disposition

The six groups below preserve the original goal's obligations rather than
turning every implementation lane into a new success criterion.

| Criterion | Current disposition |
| --- | --- |
| Runnable browser at literal `http://localhost:5173`; blank/template projects, file create/rename/edit, reopen/reload persistence | Core persistence is accepted by H/p11-editor-acceptance.md and its functional packet, indexed in H/p26-remaining-acceptance.md. Required origin remains blocked by unrelated FastShort (H/p24-product-validation.md). Clean-bootstrap template provision and P34 creation/import recovery remain open below. |
| Real valid/invalid LaTeX, actual PDF and source-linked diagnostics | Accepted core/native and managed-baseline proof: P11 plus P21-P25 raw receipt index in H/p26-remaining-acceptance.md. P27/P28 additionally prove actual diagnostic-to-reviewed-fix-to-PDF. Missing selected-engine/output/navigation tails are narrower, not another generic compiler gate. |
| Actual search, bibliography, comments/review/history, import/export/settings; two-session convergence and Viewer denial | Accepted scoped workflows exist; P29 remote references and recorded-actor history, P30 thread context/cancellation, and P36 ZIP continuation extend them. P31 typing isolation/proposals exist but independent verification FAILS readonly undo. Remaining elected workflows/controls below prevent complete closure. Do not repeat accepted core convergence/Viewer denial. |
| Supplied visual identity at desktop/mobile, without blank/overlap | P11 and later scoped captures establish populated responsive surfaces; P20/P21 replace older identity/intro failures. Whole-product source-section comparison and remaining affected screen/browser/accessibility gates are unaccepted. Scoped captures do not establish complete D10 or reference-pixel parity. |
| Every research capability mapped honestly; no fake controls/vendor results | Inventory is reconciled: 164 primary IDs and 15 separate Q rows. Mapping is not implementation acceptance. Preserve every elected remainder and external/private-contract boundary; update stale M/P26 prose only through named receipts. |
| Relevant static/tests/production build, accurate setup, exact owned cleanup | P25 root types/lint/all bundles passed, but predate P27-P37 changes. Scoped checks stand; current integrated validation, setup corrections and final owned process/cache/watcher cleanup remain. No current global build is inferred. |

## Immediate native blockers and exact next work

### 1. Confirmed P31 readonly-draft defect

H/p31-source-tracking-verification.md is now **FINAL FAIL**, superseding the
brief's pending-verdict state. `source/editor.ts:122` installs unguarded
`yUndoManagerKeymap`; readonly facets at line 80 do not prevent its direct Y.Text
undo. Changes propagate through the editor listener and `SourcePanel.tsx:83`
into retained recovery text. Paths here begin
`apps/web/src/features/editor/`.

The native Chromium probe reached offline `contenteditable=false`, pressed
Ctrl+Z, and observed the dirty draft disappear from sessionStorage:
`docs/evidence/p31-source-tracking-verification/readonly-undo-corrected.log`,
`readonly-undo.test.ts`, `offline-undo.png`. The run later failed awaiting redo;
revoked-role undo was not reached. Gate standard and emulated history actions
on current editability, retain private history, and verify only failed/changed
readonly scenarios. This is local draft loss, not unauthorized server persistence.
Keep accepted typing isolation, proposal authors/decisions and normal-source
regressions (producer final 23/244) rather than replaying them wholesale.

### 2. Custom signed environment acceptance still failed

H/p37-admission-recovery.md supersedes older P27 status messages. Exact XML:
`docs/evidence/p27-custom-environment/installed-pristine-targets.xml`,
one failure/31 assertions, 220.69 seconds. Browser cleanup at
`tests/ui-product/environment-admission/browser.ts:97` masked the original
action; P37 fixes diagnostics only, with `helper-static.log` exit 0.
Retained control state has zero update commands: promotion/provisioning was
not reached. Twelve build probes are not worker adoption.

After P34 settles the released dialog, recover the original browser failure
and complete build -> signed admission -> replacement worker -> real PDF,
then revoked/wrong-role/unbuilt denials. Preserve current authority/fresh-target
fences. No replacement installed run is accepted. P37 independently records
exact roots/listeners absent, six units not-found/inactive, derived image absent;
do not clean them again by wildcard or reinterpret absence as workflow success.

### 3. Onboarding/import and new-registration continuation

H/p34-onboarding-import-decision.md requires persisted attempt identity before
dispatch, operation recovery after response loss/reload, no duplicate import,
and actual operation-to-editor completion. Current
`services/accounts/identity/onboarding.ts` persists choices/stage and validates
durable project-create receipts; this is implementation, not FINAL acceptance.
At inspection `projects/NewProjectDialog.tsx:24-30,50-58` has no onboarding
continuation props and keeps operation/attempt in component state/ref.
Paths begin `apps/web/src/features/`. The released narrow hooks are still
required; local-file reselection before upload can be explicit, but an existing
server operation must resume.

H/p36-import-continuation.md separately accepts actual plural ZIP
`result.projectIds` -> Open imported project -> exact bytes after reload
(1/11). It does not close P34 recovery. H/p34-pricing.md accepts pricing and
existing-account return (3/64); registration/verification/start must preserve
the validated billing `returnTo`, followed by the dependent combined verdict.
Its historical TS2322 is superseded by `docs/evidence/p34-pricing/parent-types.log`;
P31's separate `parent-integration-types.log` also exits 0. Do not retain that
type error as current or call clean types onboarding acceptance.

### 4. Clean bootstrap: real default environment, no seeded template

README's migrate/seed/doctor/dev sequence is real. `scripts/seed.ts:131-176`
creates users/orgs, an unavailable native environment placeholder and a real
Git-backed example; it never creates template/version rows or catalog roles.
`services/compiler/index.ts:52-58` replaces that placeholder using the real
startup probe in `environment.ts:9-35`. Thus native availability is not
fixture-only or assumed; installed tools/systemd/bwrap must actually pass.

But the documented clean setup does not supply a selectable template.
`services/core/catalog/templates.ts:37-58` reads stored visible versions;
catalog creation/publication is a separate authorized workflow. No template
bootstrap exists in `scripts/`; service inserts are in that catalog writer.
Deliver a real documented template provisioning/publication path and prove
clean setup can create/open a template project, without bypassing publication
authority. Fixture template seeding is insufficient.

README correctly describes ports, generated credentials, native prerequisites,
pinned Bun and Node Vite. `scripts/dev.ts` and `apps/web/vite.config.ts:12`
confirm Node Vite, Bun API and strict 5173. Reconcile its broad old
installation-update status with P21-P25/custom-admission limits and link usable
template setup. `docs/runbooks/toolchains.md` still says Bun 1.3.14 versus
README/package 1.4.4; workers runbook has the same historical runtime wording.
Correct current instructions without rewriting historical receipts.

## Other mandatory elected remainders

These are bounded work packets, not new assertions that every listed backend is
absent. M's exact rows supply source/receipt pointers and required next actions.
No elected requirement is waived by this grouping.

| Packet | Concrete remainder and evidence authority |
| --- | --- |
| Governance contracts | M C33b public-without-link/anonymous writes; C40a prospective sharing/personal connector licensing; A53a/b department/IdP/reconfirmation/product projection; A54b ownership/billing self-delete; A55a legacy provenance/independent recovery; A55b automatic termination trigger/schedule; A55c SAML reminders/unlink-one/all; A56a optional tracking/processor disclosure. `services/accounts/identity/account.ts:39-72` actually requires reassignment of every owned project, so the self-delete mismatch is a contract decision, not missing mail credentials. Preserve P12-P18 invitations, audit ZIP, eligibility scheduler and managed release. |
| Native AI/reference contracts | M I43 new Dropbox directory -> project; I44b Mendeley bulk-group selection; I46 authorized autonomous content search/tool eligibility; I49a selection-length/settings/inline completion; I49b unsupported-claim highlighting and selected-publication insertion; I50a upgrade-reset disposition; I50b managed/default policy and composed administration transitions. D06 separately elected inline remote completion is not P29 explicit panel search. `services/adapters/references/{providers,retrieval}.ts` explicitly bound ReadCube/Dimensions: approved private auth/search/export/paging/refresh/revoke contracts **and implementation**, not just secrets. |
| Remaining connected screens | M P07 institutional curation; D03 completed-run step presentation; D05 personal billing/usage and invoice/payment/cancellation consumers; D08/D12 SAML/break-glass/certificate/SP-SCIM details; D15 landing source sections; D16 stored-option observable effects; D17 actual artifact/tab links; D18 update/provider/health observations; D19 actual scale-browser response rendering; D21 GitHub sync/history-squash/compiler/environment import choices. P32 fixes reported adapter rendering but scale is DTO projection, not deployed proof. |
| D22 operations consumers | M's nine-panel subtable remains the exact checklist: remaining groups management; worker bounds/drain/remove with real process observations; environment build/progress/default/retire; templates submit/approve/publish/unpublish/visibility; backup due scheduling/retention; support mounted download/configuration; audit filters/export/SIEM consumer. P28 closes AI controls; P21-P25 close tested baseline updates/recovery, not arbitrary releases. P35 queue refresh/paging/Add worker navigation is accepted seeded-reader proof, not new worker execution/health. |
| Narrow workflow evidence | M A07 cross-file/exclusion search; A08 actual compile key/Mac mappings; A09 two-user bindings; A11 two-mode symbols; A13 table-to-real-compile; A17/C23/P26 citation/edit/build/generated download; A22 spelling-versus-charged AI; A25 declared non-Latin/font/engine chain. P01-P08 creation/copy/transfer/catalog/import settings, P10 boundary reasons, P13 rename review-metadata continuity, P14 unsupported-format compile failure, P15-P18 URL/typed-link/main denial, P19-P23 selected-set/tags/trash/leave/delete, P27-P29 conversion/Viewer/link revoke retain their precise M remainders. P34/P36 close only named subsets. |
| Compiler and cross-route tails | M C01-C04 selected engines/DVI/main/reversible pin; C07 image/draft difference; C11/D13 populated bidirectional SyncTeX/comparison; C16 cached/pre-rendered workflow (guidance already exists); C18/C19 local-class/uploaded-font consumer; C21 configured plain profile; C24 `.Rtex` and explicit cache policy; C27 exact `.pdf/.md5/.dpth` preservation; I47 mounted Undo/recompile tail; A12/A14/I48 equation/table image/prompt insertion/compile. Accepted isolated/producer outputs do not establish each composed chain. |
| Remaining role/recovery/provenance evidence | M C33a/C34a/b/C35/C36a/C37/C38 retain specific link/guest/moderation/chat/history/selective-review restoration permutations, not another generic collaboration run. P24 specifically lacks PostgreSQL deleted-project recovery-route execution. P30 `docs/evidence/p2x-publisher/archive-current-inspection.md` cannot identify the archive-generating invocation or correlate submit/status lifecycle IDs; recover exact receipts or record missing, never fabricate correlation or send externally. |

## External and human gates

The literal-origin decision requires user authority; the timed-out port question
authorizes neither stopping FastShort nor substituting an ephemeral origin.
After resolution perform required-origin acceptance, reusing accepted unchanged
workflows rather than re-certifying the baseline.

M's 14 X prerequisite rows remain: authorized model/modalities/processing terms;
Git/reference/Dropbox/identity registrations, grants and callbacks; merchant
catalog/webhook/tax configuration; destination submission contract; permitted
direct bytes; SMTP sender/domain/recipient; production destination/TLS/storage/
signing/platform inputs; exact immutable tool assets. Controlled fixtures do not
prove live vendors. ReadCube/Dimensions are also implementation gates above.
M A23/A24 require missing tagged image/table/SE-AF fixtures, named PDF validator
and actual human screen-reader findings; A60b retains named Firefox/Safari/
Edge/ESR and browser/mobile/Labs gates. Do not silently replace these with Chromium.

## Broad tasks that can close from retained evidence

Close the **tested baseline** native binding/recovery, controlled launch,
compiler/worker supervision, full inventory, signed promotion/PDF and restart
floor/receipt tasks using H/p26's exact P21-P25 raw log/XML/exit index
(150 tables, six blobs, one Git repository). Do not reopen obsolete P7 blanket
supervisor failures. P25 validation can close its historical increment only;
current integrated production build remains open.

Scoped screen defects can close by named later receipts: P27 LDAP;
P27/P28 diagnostic revision/selector; P28 independently accepted AI policy and
workspace; P29 independently accepted references/history; P30 thread/cancellation;
P32 reported architecture; P33 avatar; P34 pricing; P35 queue reader; P36 ZIP
result continuation. Broad accounts/adapters/operations/workflow todos cannot
close wholesale while the table above remains.

After changed lanes settle: targeted failed/changed checks, current root
types/lint/production bundles, evidence reconciliation, remaining visual/origin
gates, then exact owned delivery/cache/process/watcher cleanup. H/p26-owned-cleanup.md
and P37 are scoped cleanup, not final cleanup. Preserve supplied HTML/research,
production assets, unrelated services and active shared infrastructure.

## Reference details that are not standalone workflow blockers

Do not invent sample prices/entitlements/counts/TL2026, five replicas, provider
health, SVG network links, throughput/RPO/SLA, universal glyph/macro/format
compatibility or vendor-edition parity. M BOUND/Q10/Q14 preserve those limits.
Exact SVG/pixel identity and original per-character ownership are not proven
by adapter DTOs/history snapshots; P29's elected granularity is recorded applying
actors, distinct from proposal authors. P31 does implement real draft typing,
not merely previews, but its readonly defect still blocks its own acceptance.

These limits do not waive elected source sections, tracking controls, run-step
presentation or accessibility work. P28's disclosed logging retention (no
general TTL/purge) and diagnostic policy enforced at Send rather than card
availability are bounded contracts, not evidence of vendor parity or an
authorization bypass. Seek a specific requirement before expanding them into
unbounded new work.
