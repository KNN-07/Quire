# Remaining acceptance reconciliation

October 28, 2026. Bounded evidence audit, not a final code gate or whole-goal
completion. Only this handoff was written; no tests, builds or browsers were
started. Original HTML/ZIP, production sources, tests and parent ledgers were
not changed.

## Evidence authority and cutoff

Paths below are repository-relative unless absolute. `H/` means
`docs/handoffs/`; `E/` means `docs/evidence/p7-installation-integration/`.
Both abbreviations are exact path prefixes, not additional files.

Original parent transcript:
`/home/norman/.omo/agent/sessions/--home-norman-Repos-Quire--/2026-10-26T18-05-13-405Z_01a17963-4d3c-715c-a44c-212374491a0a.jsonl`.
The following original tool-result records were read and reconciled with the
actual raw logs/JUnit, rather than accepting handoff titles as test results:

| Accepted slice | Exact raw evidence under E/ | Original parent JSONL line; completed exit |
| --- | --- | --- |
| Actual native all-role rollback | `p21-native-fixed.log`, `p21-native-fixed.xml` | 15698; 0; 1 case/35 assertions |
| Same-host PostgreSQL/S3/Git/Redis rollback | `p21-scale.log`, `p21-scale.xml` | 15889; 0; 1/28 |
| Affected authority/crash/prepared-health regressions | `p21-authority-regressions.log`, `p21-authority-regressions.xml` | 15794; 0; 5/79 |
| Full native restored inventory before activation | `p22-native-inventory.log`, `p22-native-inventory.xml` | 16061; 0; 1/33 |
| Full scale restored inventory, corrected teardown | `p22-scale-inventory-fixed.log`, `p22-scale-inventory-fixed.xml` | 16191; 0; 1/38 |
| Signed promotion and replacement-worker PDF | `p23-promotion.log`, `p23-promotion.xml` | 16270; 0; 1/36 |
| Installed build/probe/publication | `p23-environment-build-source.log`, `p23-environment-build-source.xml` | 16352; 0; 1/8 |
| Promoted floor/receipt across restart and transport | `p25-restart-authority.log`, `p25-restart-authority.xml` | 16508; 0; 4/27, 115.18 seconds |
| Root types, typed lint, all production bundles | `p25-product-validation.log` | 16536, monitor completion 16533; 0 |

These are separate selections, not a new whole-repository test aggregate.
Both inventory runs compare 150 tables, six blobs and one Git repository.
P25's build is now completed, not in flight: all web/API/repository/compiler/
installation/SSH bundles regenerated. The existing 1,919.01-kB web chunk warning
remains. Parent P25 cleanup has an original exit-0 monitor at line 16519.
Earlier failures and the P21/P23 teardown-time manager warning remain history;
successful tests do not erase them.

## Original success criteria

| Criterion | Current disposition and evidence | Concrete remaining action |
| --- | --- | --- |
| Runnable product at literal `http://localhost:5173` | **Blocked externally by unrelated local service**, not a Quire implementation failure. Parent read-only probe identifies FastShort; `H/p24-product-validation.md`. Ephemeral-origin receipts cannot satisfy this criterion. | Obtain explicit authority resolving the occupied origin; then perform actual Quire acceptance there. The timed-out port question permits neither stopping FastShort nor substituting a port. |
| Persistent projects, files and editor | **Accepted scoped implementation**, not missing wholesale. `H/p11-core-ledger.md`, `H/p11-editor-acceptance.md`; actual functional XML `docs/evidence/p2u/runtime/native-parent-79686ce7-5469-4ceb-a853-d2698bf17f76.xml` and `functional-observations.json` in that directory preserve revision/epoch/source observations. | Retain accepted persistence/reload proof; do not rerun it solely to move a broad todo. Remaining composed creation/import choices are narrower screen gates below. |
| Actual compilation, PDF and linked errors | **Accepted scoped implementation.** P11 functional XML exercises valid/invalid compilation and retained PDF; P21/P23 receipts above prove managed real compilation across rollback/promotion. | Finish only uncovered selected-engine/output/navigation cases identified by matrix C01-C04/C11/P26, not another generic compiler run. |
| Two-session collaboration and role denial | **Accepted scoped implementation.** P11 functional packet and `H/p2u-transport.md` distinguish actual sessions, durable convergence and Viewer wire denial. | Preserve these receipts. Public-without-link/anonymous-write semantics are a separate unresolved elected policy, C33b. |
| Search, bibliography, comments, review, history, import/export, settings | **Working scoped workflows; richer elected operations remain.** P11 XML, `H/p10-native-verification.md` and current matrix supersede absent-route/generated-image claims. | Complete the concrete native controls below; obtain only missing composed chains, not blanket producer reruns. |
| Accounts, organizations, permissions and governance | **Substantial implemented/accepted scope, broad todo not wholly closed.** P12 notices, P13 organizations, P14 invitations/audit ZIP, P15 admission, P16 eligibility, P17 recipients, P18 managed release/UI, P21 discovery/LDAP supersede earlier absences. | Resolve remaining policy/lifecycle contracts below; do not reimplement accepted organization invitations, audit ZIP, management consent/release or eligibility scheduling. |
| External adapters and reviewed AI | **Controlled adapters/approval exist; live configuration is distinct.** `H/p2x-verification.md`, current matrix EXT rows. ReadCube/Dimensions are not working adapters awaiting only credentials. | Keep private-contract implementation gaps explicit; finish native AI consumer controls separately from provisioning authorized providers. |
| Deployment, recovery, operational administration | **Accepted bounded systemd-local-v1 recovery/promotion/restart**, supported by raw receipts above. Compose/Helm signed updates explicitly unsupported; no arbitrary multi-host guarantee. | Close custom-worker admission/usability and operational scheduling/monitoring/consumer gaps below. No repeat of accepted rollback/inventory/promotion/restart cases. |
| Supplied visual identity, desktop/mobile, usable principal controls | **Scoped editor and later account packets accepted, whole-product gate open.** `docs/evidence/p11-editor-acceptance/index.json` indexes 28 cases/68 images; P20/P21 supersede phone identity/intro concerns. | Finish missing source-required screens/controls, then affected desktop/mobile review and required-origin acceptance. Do not call raw intro text missing: P21 pixel comparison disproved it. |
| All 164 capabilities mapped honestly | **Inventory criterion met, capability completion not implied.** Parsed `docs/feature-matrix.md`: 164 unique primary IDs; 62 MOUNT, 10 UI, 32 BE, 17 EXT, 35 PART, eight BOUND. | Reconcile stale installation prose and preserve row-specific boundaries. PART is neither 35 absent implementations nor 35 universal blockers. No vendor parity inferred. |
| Relevant tests/types/build and setup/run docs | **Current root static/build checks complete**, P25 raw receipt above. `README.md` and `docs/runbooks/installation.md` provide development and controlled-installation instructions. Scoped successful tests stand. | Record a final evidence reconciliation after remaining changes. No new complete-suite PASS exists; P30 artifact provenance and P24 PostgreSQL recovery-route proof remain missing receipts. |
| Clean owned QA resources and preserved inputs | **Scoped cleanup exists, final cleanup incomplete.** P21-P25 name exact owned scopes; `H/p12-orphan-cleanup.md` closes old orphans while retaining active TMPDIR caches. | Parent must audit final owned processes/units/containers/roots, remove owned research/runtime caches without deleting active infrastructure, and stop persistent handoff/input watchers after completion. Do not touch FastShort or originals. |

## Native gaps versus evidence gaps

### Priority 1: published custom environments need a usable admitted path

This is a **native integration/admission gap**, not a missing vendor secret.
`tests/integration/installation/environment-build.test.ts` stops after asserting
`available: true` and a matching manifest; it never selects that environment
for a managed worker or compiles a project with it.

The source-defined boundary is concrete:

* `tests/integration/installation/native-fixture.ts:96-118` pins controller and
  worker environment IDs to the base environment. Building a new ID does not
  change that signed list.
* `apps/server/src/installation-role.ts:155-164` rejects requested IDs outside
  the signed worker list. `services/operations/workers/profiles.ts` selects
  available registry manifests, optionally restricted by controller IDs.
* `services/operations/installation/caller-execution-context.ts:27-41` selects
  the caller's signed profile and sends a derived image ID for controller
  resolution. `execution-broker.ts:92-110` in that directory inherits the
  successful build's original profile ID and checks the requesting role.
  The fixture's build profile permits API roles, not `compiler-worker`.
  Thus merely admitting the new environment ID would not authorize that
  worker's derived-image probe/compile. This is source-derived, not a newly
  executed failure.

The model can express explicit signed shared-role/image profiles, or a later
signed release admitting the exact image and IDs; neither path is established
by P23's consumer proof. Deliver and document a usable signed admission path,
then prove build -> admitted pool -> new worker -> real PDF, plus unbuilt,
wrong-role and revoked-profile denial. Preserve current authority fences.
Ensure project pickers distinguish toolchain availability from execution
admission; `NewProjectDialog.tsx` currently filters on manifest availability,
not signed worker usability. The runbook's warning is truthful but is not this
missing consumer acceptance.

### Priority 2: source-confirmed missing native screen operations

All paths here start at `apps/web/src/features/`. These are inspected current
controls, not inferred omissions from a PART label.

| Required operation | Actual source boundary | Next action |
| --- | --- | --- |
| Remote bibliography search, D06 | `editor/tools/BibliographyPanel.tsx` searches project records/local Library, not connected-provider search. | Connect authorized remote search/provenance to existing adapters. |
| Author-aware history/source review, D04/D10 | `editor/review/history.tsx` compares Before/After; the matrix retains missing inline author changes/filter/legend/anchors and review coordination. | Implement the elected presentation; verify the affected source/review journey. |
| Per-diagnostic AI action, D11 | `editor/pdf/logs.tsx` has source navigation/excerpt/output downloads, no AI callback. | Wire the existing consented reviewed-fix workflow from the diagnostic card. |
| Dashboard workspace, D07 | `projects/ProjectsPage.tsx` queries owner/state/tag/search, without workspace control/query. | Add real workspace selection/filtering, then verify isolation and navigation. |
| Import settings/sync/history choices, D21 | `projects/NewProjectDialog.tsx` disables GitHub two-way selection, assumes full history, changes engine/environment only for blank creation. | Implement required choices and operation-to-editor completion, not invented provider sync. |
| LDAP administration test credentials, D12 | `admin/Identity.tsx` submits provider secrets/draft/nonce, no user-bind test credentials. P21 sign-in does not fix this admin path. | Supply safe test inputs and actual mounted test/save acceptance. |
| AI policy controls, D22 | `admin/Provider.tsx` edits endpoint/model/mode/allowance, not request logging/citation-search/confidential policy. | Expose elected controls; preserving hidden values is not editing them. |
| Profile-aware architecture/overview, D18/D19 | `admin/Architecture.tsx` fixes diagram nodes to local storage; `admin/Overview.tsx` lacks required queue/job actions. | Bind actual topology and complete live observations/actions without synthetic health. |

### Priority 3: unresolved contracts and narrowly missing evidence

These remain open in `docs/feature-matrix.md`; their absence of closing proof
is **not** independent proof that every corresponding implementation is absent.

* **Governance:** C33b anonymous/public behavior; C40a prospective sharing;
  A53a/b reconfirmation/department/IdP/product scopes; A54b self-delete
  ownership/billing policy; A55b automatic lifecycle trigger; A55c SAML
  reminders/unlink administration; A56a optional-tracking enforcement.
  `services/accounts/identity/account.ts:39-72` actually requires owned-project
  reassignment, so the deletion-contract mismatch is real, not mail setup.
  Decide/evidence the elected behavior before closing the broad governance task.
* **AI/reference consumers:** I43 new-directory Dropbox creation, I44b Mendeley
  bulk groups, I46 autonomous authorized search/tool eligibility, I49a selection
  gating, I49b unsupported-claim/selected-publication insertion and I50b composed
  policy transitions. Close each bounded native contract, not live inference
  by implication. A20/I44b ReadCube and I49b Dimensions need approved contracts
  **and subsequent implementation**: `services/adapters/references/providers.ts`
  and `retrieval.ts` explicitly reject unsupported private protocols.
* **Screen contracts:** P07 institutional curation; D09 configured comparison
  structure; D14 persisted/resumable onboarding; D15 source-section fidelity;
  remaining D16 option behavior and D22's nine alternate panels. Required
  worker/build/default/retire, template publication, backup scheduling/retention,
  support and audit/SIEM consumers need their own scoped receipts. P14 audit ZIP
  does not prove every audit/SIEM panel.
* **Evidence-only candidates:** A07/A08/A11/A13/A25 composed authoring;
  creation/copy/template/tag/bulk/leave flows P01-P06/P19-P23;
  selected import/link/output flows P08/P17/P18/P26; rename metadata P13;
  populated SyncTeX/comparison D13/C11; C24 `.Rtex`/cache policy;
  PostgreSQL deleted-project recovery P24. Follow each matrix next action.
  C16's blanket missing-guidance claim is stale: `editor/pdf/logs.tsx`
  already contains optimization advice; the cached/pre-rendered fixture remains
  a separate proof obligation.
* **Provenance:** `docs/evidence/p2x-publisher/archive-current-inspection.md`
  verifies current ZIP bytes but explicitly cannot identify their generating
  invocation or correlate separate submit/status IDs. Recover those receipts
  or record them missing; do not invent one P30 lifecycle.
* **External/human gates:** authorized merchant/IdP/OAuth/mail/model/remote
  registrations, credentials, callbacks and licenses; actual assistive-tech/PDF
  validation A23/A24 and named-browser acceptance A60b. These are not new native
  implementation demands or permission to send external submissions.

## Parent ledger disposition

The native binding/recovery and controlled-launch tasks have sufficient bounded
P21-P25 evidence; reconcile their old P7 blockers rather than rerunning them.
Production-build integration is verified at P25. Compiler/worker supervision
is accepted for tested base profiles, not general custom adoption.

Accounts/governance, reference screens, adapters/AI and operational tools retain
the concrete remainders above. Workflow acceptance, final review, whole-product
delivery, temporary-cache cleanup and watcher shutdown remain open. Prioritize
the custom-worker path and native screen gaps while the origin decision is
pending, then targeted missing evidence, final required-origin/visual review,
and exact owned cleanup. Do not declare the complete Quire goal achieved.
