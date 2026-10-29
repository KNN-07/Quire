# P60 remaining goal reconciliation - FINAL

October 28, 2026. Read-only assessment except this report. No source, test,
matrix, original-input or runtime changes; no tests, builds, browser launches,
service launches or commits. Paths below are repository-relative.

## Decision

Do not close the four broad implementation tasks wholesale. Split their
remaining native work, explicit contract decisions, bounded acceptance work,
and external/operator gates as below. Do not restart the implementation from
P38 or interpret 27 PART rows as 27 missing features. Conversely, MOUNT is
not complete-product acceptance.

The current ledger has 164 primary IDs: 72 MOUNT, 9 UI, 31 BE, 17 EXT,
27 PART and 8 BOUND. The original design-disposition column is historical,
not another current status. The 15 Q rows and nine D22 panels are separate
cross-checks, not additional primary capabilities.

### Recommendations for the four open tasks

| Open task | Recommendation and observable closure condition |
| --- | --- |
| Implement accounts organizations permissions and governance workflows | **Continue narrowly.** Preserve accepted invitations, access requests, organizations/licensing/audit ZIP, benefits, institution domain admission/expiry, managed release, opt-in lifecycle and P57 deletion. Resolve/implement separate public/anonymous access, the prospective-sharing contract, remaining institutional claim/reconfirmation/product policies, and SAML link administration. Close only when those elected behaviors have actual controls, durable transitions and independent authorization evidence, or the user explicitly changes their scope. Legacy/passwordless release limitations are a separate contract choice, not evidence that P18 failed. |
| Build reference project account and administration screens | **Continue.** Finish the actual missing import/settings/AI/identity/curation/usage consumers and truthful deployment copy identified below. Then close the named composed and visual proof gaps, including all D22 panels rather than the overview alone. Do not rebuild accepted Source/Visual/PDF, account linking, pricing/onboarding, queue, architecture or benefits slices. |
| Implement configured external adapters and reviewed AI | **Continue native AI and consumer work; retain external gates separately.** Dropbox folder creation/recovery, Mendeley explicit group refresh, citation review/insertion and publisher correlation are no longer missing. Autonomous authorized project search, inline interactions, unused preferences and remaining tool presentation are native work. ReadCube and Dimensions need approved executable contracts **and subsequent implementation**, not merely keys. Existing implemented providers need authorized live configuration only for their live claims. |
| Implement deployment recovery and operational administration tools | **Close the already proved systemd-local-v1 native/same-host scale baseline subwork; keep the broad task open for specific consumers/contracts.** P21-P25/P37 prove controlled lifecycle, restored inventory, rollback, signed promotion/replacement-worker PDF, restart authority and custom admission/revocation. P47 closes the PostgreSQL recovery route. Remaining work is the truthful deployment surface, backup form/scheduler visibility, actionable admission errors, unclosed operational panel chains and explicit production logging/monitoring contract. Arbitrary multi-host, ingress/TLS, live storage and other platforms remain configuration/platform acceptance, not reasons to redo the baseline. |

## Six core success criteria

| Criterion | What remains unmet; concrete next action |
| --- | --- |
| **G1. Runnable at exactly `http://localhost:5173`; blank/template and persistent files** | Native creation/persistence and the clean published Starter Article are accepted by P11, P34/P40/P44. Literal-origin acceptance is still unmet: the latest parent probe finds unrelated FastShort on 5173, and no authority to stop it was obtained. Obtain the owner's explicit port handover; then launch Quire by the documented strict-port path and record blank/template, file create/rename/edit, reload/reopen at that exact origin. A new ephemeral-port run cannot close this gate. |
| **G2. Real valid/invalid LaTeX, PDF and source diagnostics** | The core criterion is already demonstrated in retained native/mounted evidence, including P27/P28 and P58. It is **not** a new missing compiler. Remaining elected subcases are selected engine/main/environment, DVI/output, SyncTeX, cache-companion and supported extended authoring chains below. Keep invalid-source/last-good-PDF semantics and P58 final-pass diagnostics; inspect only an uncovered or affected tail. |
| **G3. Search, bibliography, review/history, import/export/settings with independent roles** | Accepted core search, convergence, Viewer denial, review/history, libraries and citation workflows stand. Complete the native gaps N1-N11 and the genuinely unclosed composed tails below. P54/P58 already provide an actual bibliography insertion/reload/BibTeX/PDF chain. Do not repeat it merely because A17/C23 still say “missing composed workflow.” |
| **G4. Supplied desktop/mobile visual identity without blank/overlap** | Scoped 1440/390 and light/dark inspections stand, including P56. Whole-product/source-section comparison and named accessibility/browser/platform verdicts remain unaccepted. Compare populated actual screens to `docs/discovery/design-source/*.source.html` and retained design captures; fix observed differences, not hypothetical pixel defects. Include alternate panels and settled states. |
| **G5. Every research capability honestly implemented/verified or configuration-bound; no fake actions** | Mapping is complete, behavior is not. Native controls and policy contradictions below cannot be excused by credentials. Private APIs must stay unavailable until their contracts and implementation exist. Reconcile stale matrix prose precisely; retain explicit Quire deviations and avoid vendor sample prices, quotas, versions, replicas, health or citation truth claims. |
| **G6. Relevant checks/build, accurate docs/self-review and owned cleanup** | P59 closes the current integrated static/build gate for its recorded inputs. It does not run all tests or prove whole-product runtime use. Remaining delivery work is accurate current setup/screen wording, disposition of residual contracts, final self-review and an exact owned-resource ledger after any subsequent work. Reuse scoped passing tests unless affected input changes. No new runtime resource was created by P60. |

G1, G3, G4, G5 and final delivery aspects of G6 remain open. G2's core
behavior and P59's static/build component of G6 are satisfied within their
recorded scope; this distinction prevents six redundant blanket reruns.

### P59 authority

`docs/evidence/p59-integrated-validation/validation.log` records
`bun run typecheck && bun run lint && bun run verify:matrix && bun run build`,
Bun 1.4.4, 19:14:18Z-19:15:37Z and `P59_EXIT=0`. The command section
contains successful TypeScript, type-aware deny-warning lint, complete
164-ID mapping, browser assets and web/server/repository/compiler/installation
bundles. The 2,234 before/after input fingerprints are identical as supplied
by the parent evidence audit. This report read the command/result section
and manifest boundaries; it did not independently rehash every current file.
The existing greater-than-500-kB Vite chunk warning remains disclosed.

P59 supersedes “current integrated static/build pending” in P46/P52/P55/P57/P58.
It does not retroactively pin a historical test execution, replay P46 against
changed shared core, run a PostgreSQL migration, or certify live providers.
The P54 historical implementation-hash limitation remains a provenance
limitation, not a newly established source defect.

## Required native work and exact contract decisions

Each N entry is a distinct remaining behavior or contradicted user option,
not a demand for general feature parity. The IDs identify its research/design
authority. “Decision” means the narrower implementation is coherent but does
not itself authorize dropping the separately elected requirement.

### N1. Separate public and anonymous authorization

**C33b, Q03; blocks G3/G5.** In
`services/core/base/access.ts`, `authorizeRead` falls back to `linkAccess`,
which always requires `x-project-token` or `?share`. The mutation fallback
requires a real principal and an Editor token; it then admits that authenticated
user as a link-derived member. `services/accounts/identity/policy.ts` exposes
`anonymousRead` and `anonymousEdit`, but the latter never enables anonymous
writes in this path.

Token-shared authenticated writes are a coherent, guarded contract, not a
broken anonymous implementation. They do **not** satisfy the explicit
separate public-without-link/anonymous read-write configuration in
`docs/discovery/services.md` C33b and the current matrix. Smallest next step:
define the intended public exposure and permitted anonymous mutation actions,
then connect those policies to read/download/HTTP/realtime/Git boundaries with
deny-wins enforcement. If only token/authenticated writes are desired, obtain
an explicit scope decision removing the separate elected behavior and remove
or clearly disable the misleading unused option. Do not silently manufacture
an anonymous user or weaken named membership checks.

### N2. Prospective sharing and account tool policy

**C40a/A51a; blocks G3/G5 until reconciled.**
`services/accounts/identity/policy.ts:forProject` reads current organization
and policy-set rows on every authorization. `organizations.ts` publishes
policy changes to affected projects. `base/access.ts:role` invalidates
link-derived membership when current sharing is no longer `anyone`.
This is live, retroactive deny-wins restriction, not an existing-share
snapshot. No prospective sharing snapshot is retained in these call paths.

The choice is precise: grandfather already granted sharing while restricting
new sharing, or retain immediate revocation/tightening for existing access.
Implement snapshot/grant semantics only if the first is retained; otherwise
explicitly reconcile the elected prospective clause and describe immediate
effects in organization controls. Security restrictions and project benefits
must remain separate.

Personal connector premium licensing is different: the implementation plan
explicitly elects unlocked local/server capabilities and independent personal
credentials. Do not add vendor premium gates just to turn this cell green.
Replace the vague licensing Next with that explicit Quire disposition, retaining
any actually elected account/tool policy dimension rather than copying prices.

### N3. Institution claim, reconfirmation and product projection

**A53a/A53b, I50b; blocks G3/G5.** The actual institution portal is
`apps/web/src/features/marketing/institution.tsx`. Enrollment in
`services/accounts/governance/members.ts` checks verified email domains and
stores `basis='verified-domain'` with a checked timestamp. The reconciler in
`governance/lifecycle.ts` handles persisted expiry/domain loss. It does not
configure reconfirmation periods or renew eligibility through IdP claims.

Federation already maps configured email/name/groups and group role/AI
ceilings in `services/adapters/federation/{configuration,provisioning}.ts`.
Do not describe domain/attribute mapping as wholly absent. The missing
connection is institution-specific eligibility/department-or-role policy,
reconfirmation configuration/renewal and explicit institution product
projection, distinct from team management and independently licensed/admin
memberships. `initialPolicy` and `defaultPolicy` are uniformly AI-off; there
is no managed-versus-other default branch.

Smallest next step: define persisted institution eligibility policy, trusted
claim inputs, reconfirmation due/renewal transitions and Quire capability
variants; expose the controls and feed the existing scheduler/policy engine.
Use native verified claims first; actual domain ownership and live IdP
revalidation are external gates. Names/numeric vendor plans are not required.
If uniform opt-in AI-off is the elected alternative, document that choice
explicitly rather than inventing an institution entitlement.

### N4. SAML link lifecycle and missing administration consumers

**A55c/D12, related A55a/C40b; blocks G3/G5.**
`services/adapters/federation/index.ts` registers login/ACS, configuration,
tests, metadata, SCIM, break-glass enrollment and certificate rotation.
`admin.ts` implements the latter backend actions. There is no corresponding
organization per-user SAML reminder or unlink-one/unlink-all lifecycle in
that registration. Consumer OAuth unlink is not its substitute.

`apps/web/src/features/admin/Identity.tsx` has real SAML fields,
test/save and metadata download; `IdentityAccess.tsx` selects a recovery
operator and edits group mappings. It has no password-enrollment action for
the existing break-glass endpoint or dedicated rotation workflow. Test output
is displayed as an operation, honestly not a completed login. Smallest next
step: connect break-glass enrollment and rotation, complete actual SAML
handshake continuation and per-user link/reminder/unlink administration with
current authority/version/session fences. Review SP/SCIM display/copy
requirements against `ScimToken.tsx`; metadata download and token generation
are already present, not absent backend capabilities.

P18's legacy provenance, verified independent-password recovery, owning-adapter
and release-fence restrictions are accepted safe boundaries
(`identity/managed-release.ts`, P18 FINAL). They are **not** fresh release
bugs. A separate explicit choice remains if “complete” requires legacy
remediation, passwordless recovery or re-enrollment: implement auditable
ownership assignment, independently usable recovery, and explicit renewed
authority. Never infer ownership from issuer equality, treat a local outbox
as delivered recovery, or reset a release fence automatically. Preserve the
accepted release/delete/reassign distinction and P46 opt-in schedule.

### N5. Curated institutional template portal

**P07, related P05/P06/D07/D22; blocks G3/G5.**
`services/core/catalog/templates.ts` implements published public or
organization visibility and independent copies; `publication.ts` implements
author submission, curator approval and publisher publication of pinned
versions. `apps/web/src/features/admin/Templates.tsx` exposes those
transitions and New draft. The institution portal only offers enrollment;
there is no featured/curated template selection consumed there.

Smallest next step: add the specifically elected institution curation/featured
selection and role path and consume its approved versions in the portal.
Do not confuse ordinary organization visibility with curation, reimplement
publication, or fabricate eight sample templates. Full native multi-role
publication/resubmission remains a composed proof task, not absent backend.

### N6. New-project/import choices and misleading no-credential option

**P08/D21/I42a; blocks G3/G5.**
`apps/web/src/features/projects/NewProjectDialog.tsx` offers compiler and
environment controls only in `blank`. Template/import modes cannot edit them;
onboarding can forward saved import settings but does not supply an ordinary
editable selector. GitHub two-way sync is a disabled checkbox. Full history
is asserted; no history/squash choice is provided. Backend
`interchange/imports.ts` supports main/engine/environment for native imports,
but `RemoteImport` and `interchange/remote.ts` forward only repository,
branch, grant, name and workspace.

The form also offers “No credential (public repository),” while
`sharedRemoteImporter` unconditionally returns `GIT_GRANT_REQUIRED` without
a saved grant. This is a source-established option/contract contradiction,
not lack of a live GitHub credential.

Smallest next step: carry the elected main/compiler/environment and
history/sync choices through the real import contract and resulting project,
or explicitly resolve a scope change. Either implement credential-free public
clone under safe policy, or require the actual saved connection before submit
and stop advertising it as a usable option. Keep P34 persisted attempt/replay
and P36 plural-result continuation unchanged.

### N7. Automatic inline reference completion

**D06/I45a; blocks G3/G5.**
`apps/web/src/features/editor/source/completion.ts:texCompletion` reads local
index citation/label keys and command snippets only.
`tools/RemoteReferencePanel.tsx` provides explicit provider query/selection/
Copy/Cite. The latter is accepted, but is not the separately elected inline
remote completion.

Smallest next step: connect configured authorized remote completion to the
actual citation completion interaction with cancellation, provenance,
explicit editable destination/insertion and truthful unavailable states.
No guessed ReadCube API or fabricated key is acceptable. This can be proved
with an owned implemented-provider fixture before live access.

### N8. Autonomous authorized project-content search

**I46/D03; blocks G3/G5.**
`services/adapters/ai/context.ts:collectSelectedContext` collects explicitly
listed file IDs/ranges. `provider.ts` sends one nonstreaming completion
request and explicitly denies model tools/network/filesystem access.
`execution.ts` performs configured citation retrieval, not autonomous project
content search. Existing manual project search is not a model search tool.

Smallest next step: add a bounded server-mediated project-search capability
whose every query/result rechecks the invoking user's project/branch/file
authorization, feeds actual selected results into reviewed generation, and
does not grant the provider direct access. Assistant/TeXGPT commercial
eligibility is a separate disposition: the present policy governs modes,
not product-specific paid tools. Do not import hosted tiers without election.

### N9. Language-tool selection and actual inline completion interactions

**I49a/D16; blocks G3/G5.**
`assistant/Composer.tsx` exposes every tool in a select. Its range validation
only rejects a missing/empty requested range; `ai/context.ts` checks identity,
offsets and the 256-KiB context cap, not operation-specific selection lengths.
An `inline-completion` run remains an explicit panel request. No actual
floating selection menu, sentence completion interaction or dedicated
shortcut is supplied by that code.

Smallest next step: specify supported operation/range eligibility, enforce it
at the server boundary and expose the elected contextual/inline interaction
with explicit review and preference gating. Use the research contract's
actual rules; do not invent numeric limits or retired standalone tools.

### N10. Preferences that persist without their promised effects

**D16/I49a, D21 and Git settings; blocks G3/G5.**
`apps/web/src/features/account/preferences.tsx` exposes these active controls:

- `aiBranch`: “Put agent changes on a new Git branch.” Actual
  `assistant/Review.tsx` initializes a separate empty branch string and sends
  only its manually entered `newBranch`; `ai/decisions.ts` honors that explicit
  parameter. Neither consumes this preference.
- `shareAiChat`: “Show the assistant to collaborators.” Actual
  `assistant/Conversation.tsx` uses explicit Create/Open shared conversation;
  the saved preference is not its input.
- `errorAssist`: “Offer Fix with AI on compile errors.” Actual
  `editor/index.tsx` always passes `onFixDiagnostic` and `pdf/logs.tsx`
  displays it based on editing/file/loading state, not this preference.
- `defaultEngine`: ordinary creation initializes `pdflatex` directly in
  `NewProjectDialog.tsx`, rather than the saved default compiler.
- `compileBeforeCommit`: “Compile before every commit.” Actual
  `editor/git/GitPanel.tsx` renders an initially unchecked per-commit checkbox;
  `git/operations.ts:commitStaged` forwards only that submitted `compileFirst`
  value. The saved account preference has no service-side consumer.

The source search across actual web and service consumers found the first
two only in the form/default values, and `errorAssist` additionally in another
preference form; it did not reveal an effective behavior consumer. The
manually supported branch/shared-conversation operations are real and must
remain explicit privacy/authority decisions. Smallest next step: wire the
preferences to those decisions without automatically disclosing private chat,
or remove/disable/relabel the ineffective promise under an explicit contract.
Apply the saved compile gate to the actual commit path rather than merely
retaining a separate optional checkbox.
The accepted policy-at-Send boundary for diagnostic AI does not make an
“Offer” checkbox functional. Verify each changed preference's actual effect,
not just PATCH/reload equality.

### N11. Actual run-step presentation

**D03; blocks G4/G5.**
`assistant/AssistantPanel.tsx` presents run status, ID, version, error,
messages, sources and review controls, not completed execution steps.
The implementation's own `assistant/DESIGN.md` excludes fabricated steps.
That exclusion is correct but does not supply the elected run presentation.

Smallest next step: expose actual context/retrieval/dispatch/validation/review
events and display their true states. Never replay a decorative five-step
script or invent durations. The exact reference five-step treatment needs a
comparison/disposition; a provider that performs fewer real stages must be
represented honestly.

### N12. R/knitr extension contract

**C24; blocks G3/G5.**
`services/operations/environments/execution.ts` permits `.tex` or exactly
`main.Rnw` for the knitr profile, rejecting `.Rtex`.
`deploy/compiler/compile.sh` knits only `main.Rnw` and sets global
`cache=FALSE`. That default is not an explicit chunk-level `cache=TRUE`
denial or proof that overriding chunk options are harmless.

Smallest next step: implement the elected `.Rtex` route under the same
isolated profile, and enforce/disclose the exact unsupported cache policy;
alternatively obtain an explicit support-boundary decision for `.Rtex`.
Keep the real Rnw PDF and picker evidence; no generic knitr rerun is needed.

### N13. Optimization workflow: narrower than “missing guidance”

**C16/C26/C27; blocks G3/G5 only for the elected remainder.**
`pdf/logs.tsx` already contains visible Compile optimization guidance about
draft images, large images, recursion, externalization and cache/source
separation. The matrix's blanket “no user-facing optimization guidance”
is stale as a source-absence claim.

What is not supplied there is the bounded pre-render/reuse-cached-assets
workflow described by the row. Smallest next step: connect/document that
supported workflow using the actual externalization/output and persistent
asset mechanisms, and record its consumer path. Do not invent speed claims,
increase quotas or rebuild the already functioning toggles.

### N14. Deployment page contradicts completed artifacts

**D17/A58a/Q13; blocks G4/G5/G6.**
`apps/web/src/features/marketing/self-hosting.tsx` still labels Compose/Helm
“Deployment artifact pending,” says no signed offline bundle is claimed,
uses Bun 1.3.14 twice, and calls the scale profile an integration requirement.
These statements are older than the FINAL deployment/environment and
P21-P25/P37 receipts and the pinned Bun 1.4.4 setup.

Smallest next step: link the actual repository artifacts and runbooks, show
the verified native/Compose/Helm/offline commands and their prerequisites,
update runtime wording, and distinguish the supported systemd-local-v1 signed
update driver from unsupported Compose/Helm signed updates. Do not advertise
a public chart repository, image tag, download URL or release that does not
exist. README/runbook corrections in P46 are not corrections of this screen.

### N15. Backup-policy form and scheduler contract

**D22 storage/backups, A58b; blocks G3/G5/G6.**
`apps/web/src/features/admin/Backups.tsx:BackupPolicy` says to leave cron
empty for manual-only and permits retention `min={0}`. Actual
`services/operations/backups/policy.ts` accepts literal `disabled` or a
daily UTC cron, and 1-36,500 retention days. Arbitrary destination text also
cannot relocate backups: it must equal the provisioned private root.
The first two are confirmed advertised-input/backend contradictions.

The scheduled backup mechanism **exists**:
`backups/index.ts:runScheduledBackup`, `scripts/ops/backup.ts --action
scheduled --operator ...`, and `docs/runbooks/recovery.md` specify an
operator-installed private timer and enrolled-operator authority. A saved
schedule does not install that timer. This is not an absent scheduler and
does not justify an invented principal or hidden default API timer.

Smallest next step: normalize manual-only form input to `disabled`, match
retention bounds, explain the fixed destination and UTC daily syntax, and
make the external timer prerequisite visible beside scheduling. Configure
and observe due/duplicate/retention execution under real operator ownership
for the intended deployment; keep existing Verify/Restore acceptance.

### N16. Actionable environment admission denials

**D18/D22, A59a; blocks G3/G5 usability completion.**
P37 FINAL explicitly records unbuilt/wrong-role requests failing closed as
HTTP 500 `INTERNAL_ERROR`; pre/post-admission and revoked selection correctly
return 409 `ENVIRONMENT_NOT_ADMITTED`. Current
`admin/Environments.tsx` surfaces response messages and correctly separates
probe/build from signed admission.

Smallest next step: preserve all authority/signing checks while mapping these
expected unbuilt/wrong-role denials to actionable typed errors; verify only
the affected route/UI errors. The successful signed build/adopt/PDF/revoke
chain is not missing and must not be rerun as a generic installation task.

### N17. Usage presentation and billing scope decision

**D05, related I50a/A52b; blocks G4/G5 until disposed.**
`account/billing.tsx` is explicitly organization-only, with actual catalog,
quote, checkout, invoice details, Payments and cancellation. It has no
reference Usage section. The original
`docs/discovery/design-source/05-billing.source.html` contains daily AI use,
collaborator use and compile allowance; its amounts/“24x”/server-speed claims
are illustrative and must not be copied.

Smallest native step: show real scoped usage/limits from authoritative
receipts and policies, with unknown/unlimited states and no invented
percentages. Monthly AI reporting in `AiStore.usage` is not a daily effective
allowance meter.

Organization billing is a coherent documented alternative: backend
`governance/billing.ts` keys operations by organization, P45 preserves the
honest no-organization state and P57 explicitly preserves organization billing
on account deletion. It is not a broken personal cancellation flow. However,
the matrix still labels personal billing as unclosed. Resolve precisely
whether that is a retained elected feature or a historical reference
disposition. If retained, implement a personal account/merchant/entitlement
lifecycle; otherwise explicitly reconcile D05/X-BILLING. P57 is not approval
to silently delete that requirement.

Likewise I50a's current 50/day UTC shared ledger is coherent
(`ai/admission.ts`, `ai/README.md`); billing transitions do not reset it.
There is no personal paid AI upgrade to reset. Recommend recording **no
purchase-triggered reset in the unlocked Quire contract**, rather than adding
vendor tiers. If an upgrade-reset behavior is explicitly retained, define the
qualifying native transition and implement/test that transition alone.

## All 27 PART rows: disposition after source inspection

This inventory is exhaustive for the current PART set. It does not discard
open behavior in MOUNT/BE/EXT rows (notably N10/N17).

| PART ID | Current decision |
| --- | --- |
| A20 | ReadCube contract plus implementation gate; not a missing Zotero/Mendeley implementation. |
| A23 | Maintained tagged fixtures/validator/human proof gap, detailed below; no source-editor inability to type accessible TeX is established. |
| A24 | Human assistive-technology and external PDF validator gate, not certification inferred from compilation. |
| P07 | Native curation consumer N5. |
| P13 | Rename/review metadata outcome/disclosure proof, not a proven loss bug; see next section. |
| C16 | Existing guidance corrects blanket absence; remaining pre-render/cache workflow N13. |
| C24 | Native extension/cache contract N12. |
| C33b | Genuine separate authorization behavior N1. |
| C40a | Prospective-sharing decision N2; personal credentials/unlocked licensing remain separate. |
| C40b | Accepted P18 release; remaining cross-org tool combinations are proof, legacy/recovery/re-enrollment require explicit N4 scope. |
| I44b | P50 Mendeley group/explicit-refresh/preview accepted; ReadCube contract/implementation and provider response compatibility remain separate. |
| I46 | Native authorized content search N8; tool-plan eligibility disposition, not copied vendor plans. |
| I49a | Native selection/inline interactions N9 and ineffective preferences N10. |
| I50b | Defaults disposition N3 plus remaining composed organization AI/chat transitions; notification producer accepted. |
| A53a | Institution-specific policy controls N3; domain/IdP primitives already exist. |
| A53b | Existing scheduler/preservation accepted; reconfirmation/product connection N3. |
| A55c | SAML link administration N4; live IdP prerequisites remain external. |
| A56a | P51/P52 default disclosure accepted; deployment policy/processors/terms/network review are operator gates, not an invented analytics toggle. |
| A58a | Blanket host failure stale; baseline accepted, N14-N16 and operational panel proof remain. |
| A60b | Named-browser/platform/accessibility proof; literal origin is an operator gate. Short offline accepted, not a request to build general offline use. |
| D07 | Workspace/avatar/template/bootstrap accepted; exact origin and selected dashboard/catalog workflows remain proof. P34 onboarding is no longer missing. |
| D12 | Native consumers and SAML lifecycle N4; protocol configuration is not all missing. |
| D15 | Actual landing source-section/visual/accessibility comparison remains proof; no uninspected pixel defect is asserted. |
| D17 | Actual stale deployment surface N14. |
| D18 | Truthful dynamic overview already exists; remaining original presentation comparison and N16 errors, not synthetic health/replicas. |
| D19 | P32 reported-component implementation accepted; configured-scale browser and reference comparison remain proof, not absent diagram/topology code. |
| D21 | Native import choices/contradicted public option N6; persisted ZIP recovery already accepted. |

## Remaining bounded proof, not established product defects

These are the complete distinct remaining evidence packets from the matrix's
explicit bullets after the supersessions above. Conditional phrases such as
“if required,” “when input changes,” and “every permutation not claimed” are
not an instruction to replay passing suites. First link existing matching
evidence; execute only the specifically unproved elected outcome. An observed
failure may then justify a source change.

| Packet / IDs | Narrow next action and actual implementation reference |
| --- | --- |
| Accessible PDF and editor, A23/A24/Q11 | Extend maintained tagging coverage for image descriptions, semantic versus presentation tables and MathML SE/AF engine configuration. `deploy/compiler/fixtures/tagged/main.tex` currently exercises metadata/title/section only. Record selected external validator/version and actual human screen-reader/editor findings; structure tests alone are not conformance. |
| Rename/move metadata, P13 | `adapters/dropbox/merge.ts` detects stable-ID renames and preserves a separate conflict copy instead of silently moving the original; `core/base/source-records.ts` persists source/file/snapshot identities, not a universal review-metadata remap. Observe one actual rename/delete-create through review/history, state exactly what survives, and add explicit loss/conflict disclosure where necessary. Do not assume all renames lose comments or rewrite the merge algorithm without an observed requirement failure. |
| Search, A07; filters A02/A06 | Close only the composed project-search/exclusion/result-navigation chain at its configured threshold, and any specifically uncovered suppression/filter/readonly case. Actual `tools/SearchPanel.tsx` calls the backend and navigates results; absence of a retained aggregate is not absent search. |
| Project copy, P02 | One copy containing pending suggestions, ACL/history/tags establishes applied source and fresh metadata. Do not generalize from a plain copy or replay unrelated persistence. |
| Transfer, P03/C39a; ordinary lifecycle P19-P23/C39b | Actual `ProjectsPage.tsx`, `ProjectActions.tsx`, Share and `admin/TransferProject.tsx` have real actions. Retain exact selected/unselected archive/trash/restore/ZIP, RGB tag/filter, owner-versus-shared visibility, nonowner leave, permanent delete/revocation, and transfer/reselection/notification tails. P57 covers its own transfer/deletion preparation, not every dashboard selection. External notice delivery remains mail-gated. |
| Catalog, P05/P06/D22 templates | Actual Templates/TemplateForm and `catalog/publication.ts` support draft/submit/approve/publish/unpublish/new draft. Prove the remaining separate-role publication/resubmission/visibility/copy/edit narrative with deliberately provisioned roles. P40 closes starter provisioning, not every catalogue role. |
| Nested import and main/settings, P08/P18/C01/C03/C04/D21 | After N6, prove selected nested main/engine/admitted environment through real compilation, linked-TeX main denial, and reversible shared selection using only deliberately provisioned manifests. No second TeX release or TL2026 requirement is inferred. |
| Binary/linked assets, P10/P14/P17/A51b | Preserve native cap/atomicity tests. Close only unproved mounted rejection reasons, truthful unsupported-engine asset failure, and declared `.bib`/class/style/graphic cross-project refresh cases. Real `FilesPanel.tsx` supports URL/project links and refresh; do not claim a missing link UI. |
| URL/Drive/open-in, P15/P16/A60a | Use permitted direct bytes under actual safe-fetch policy through import/refresh/editor/compile. Google Drive is direct-download/manual-refresh, not two-way native Drive. Open-in's backend is implemented in `interchange/imports.ts`; a new private hosted API is not elected. |
| Conversion, P09/P27/I42b | Close chosen real converted-import/export consumer chain with the immutable Pandoc image and declared fidelity errors/originals retained. `interchange/converter.ts` is executable; installed signed roles explicitly lack a supported Pandoc execution recipe. Decide whether conversion is required in that installation profile before implementing that missing supervised recipe; credentials cannot provide one. No arbitrary DOCX layout guarantee. |
| Output/DVI, P26/C02/C13 | Download actual generated `.bbl`/DVI/submission-bundle bytes from the right immutable snapshot. `pdf/logs.tsx` already downloads job artifacts; mere missing composed evidence does not justify a new output implementation. |
| Bibliography, A17/C23 | P54/P58 now close an actual selected-publication -> saved bibliography/source -> reload -> real BibTeX -> PDF chain. Replace the generic missing-chain Next with the specific remaining generated-output download/Biber/other-target case, if elected and genuinely uncovered. Do not rerun the accepted P58 chain. |
| PDF navigation/assets, C07/C11/C27 | Retain real draft image-vs-placeholder observation, mounted forward/reverse SyncTeX caret navigation, and exact uploaded `.pdf/.md5/.dpth` preservation across clear/rebuild. Core producer results are not absent mechanisms. |
| Extended compile, A25/C18/C19/C21/C26 | Close only a specifically missing composed declared Unicode/font/engine, local class/package, uploaded font, plain profile or supported diagram consumer. Existing real engines/fixtures/isolation stand; no arbitrary macro/glyph/package compatibility promise. |
| Named/link role transitions, P28/P29/C31-C38/Q03/Q04 | Retain actual Viewer share/read/download/copy, named-vs-link revoke, chat disable, selected/bulk review and selective/whole-project eligible review restore tails only where not already proved. P11 source convergence/Viewer denial, P29 history, P31/P39 readonly tracking and P4 subscriptions/benefits remain accepted. “Every permutation” is not a fresh mandatory suite. |
| Remote Git, I41a/I42a/D02 | `editor/git/GitPanel.tsx` and `operations.ts:runRemoteAction` already call actual grant-bound pull/fetch/push. Prove one mounted controlled import/manual-conflict/ref result and product token-to-bridge narrative if still missing; then live grants separately. Do not label remote buttons absent or rebuild local Git. |
| References, I44a/I44b | Close actual Zotero selected collection/project refresh and account collection consumer. P50 closes Mendeley personal/group/explicit refresh/read-only preview and individual editable copies. Scheduled Mendeley linked refresh was explicitly removed from P50 scope. Its UUID/required-role response schema is stricter than the retained provider minimum: validate against permitted live responses, then change only the demonstrated incompatibility. |
| AI images/language/error fix, A12/A14/A22/I47/I48 | Real Ask/Agent/tool admission and reviewed writing exist. Close selected table/equation prompt/image -> editable accepted source -> real compile, independent language/dictionary/no-usage separation, and ErrorFix Undo -> recompile tails. P27/P28 accepted Apply -> compile and P54/P58 citation review do not prove every generator tail. |
| AI policy, I50b/A52c/C40b | Actual organization policy controls and deny-wins backend exist in `account/organizations/organization.tsx` and `governance/organizations.ts`; notices are atomically queued. Verify remaining cross-client AI/chat/admin toggle, cross-org/managed/default/consent transition, and in-flight discard combination. This is not a missing organization policy screen or SMTP producer. |
| Billing, D05/A52b | After N17 disposition, exercise actual configured invoice/payment/seat/period/cancellation consumer with signed reconciliation. `billing.tsx`/Payments already implement those actions. Checkout navigation is not payment confirmation; a twelve-month project-open licensing report/vendor metric is not implied by ordinary metrics. |
| Identity/operator, D08/D12/A55d | Close remaining actual SAML/break-glass/cert/SCIM consumers after N4, site/editor closure/federation boundary combinations and revocation checks. P27 LDAP, P21 discovery and account OIDC linking are accepted; live institutions remain external. |
| Populated cross-route visual, D04/D10/D11/D13/D15/D19 | Inspect settled history recovery, real source/review, populated source/Git/history -> PDF diff, landing source sections and configured scale architecture. P32 actual reported components are not network-health probes. Exact source-screen visual identity remains required, but no missing implementation is inferred solely from absent capture. |
| Overview, D18 | `admin/Overview.tsx` already renders real counts, topology and configured capabilities, with unavailable states. Compare missing notice/card/provider presentation against the supplied screen and add only real available observations. Do not fabricate replicas, latency, service health or unavailable metrics to match samples. |

### D22: all nine alternate panels

| Panel | What exists and what is actually next |
| --- | --- |
| Users & groups | `Users.tsx` has search/filter/CSV/invite; `UserDialogs.tsx` has add/remove organization-group membership, session revoke and project transfer/recovery. Separate organization roles/licensing live in account organization settings. Missing full independent group/management restriction browser proof is **not** missing membership controls. Verify those paths and institution/managed denials, not a new unrelated group model. |
| Compile workers | `Workers.tsx` exposes real min/max/timeout/sandbox/add/drain/remove contracts. Observe affected mounted actions against actual controller/process state under the supported installation authority. Existing lifecycle proof does not automatically certify every panel transition; no new supervisor is needed. |
| TeX Live images | `Environments.tsx` has manifest/build/progress navigation/default/retire/mirror/fonts and execution-admission status. P37 closes actual build -> signed admission -> worker/PDF -> revocation. Close specifically uncovered queued-operation/default/retire/font/mirror consumer and N16 errors, not the whole installed chain again. |
| AI provider | `Provider.tsx` exposes real connection/model/budget/logging/citation/confidential policy. P28 accepts the changed policy workflow. Keep private Ask/session and retained Agent/shared logging limits; general TTL/purge/export was explicitly not supplied, not a silently implemented guarantee. Only retained elected additions or live provider checks remain. |
| Templates | Full native role-separated lifecycle proof and N5 curation; existing transition buttons/backend are real. |
| Storage & backups | Verify/Restore and isolated-target semantics accepted. Fix N15, then show actual due/duplicate/retention under the operator timer; retained baseline rollback stands. |
| Updates | `Updates.tsx` calls real signed release/schedule/update operations. Replace stale reader-only/HOST-fail summaries with P21-P25/P37 tested baseline. Close any genuinely unproved mounted schedule/automatic-security/progress consumer, not another blanket all-role launch. Actual operator release/signing authority remains required. |
| Support | `Support.tsx` generates and downloads actual operation output; `operations.md` documents durable inquiry/outbox and admitted runner. Close the remaining mounted configuration/download consumer only if unproved. Real recipient and delivery are separate external gates. |
| Audit log | `Audit.tsx` implements actual event/time filters, ZIP export and versioned SIEM configuration. P14 accepts scoped audit ZIP. Close the specific mounted filters/configuration -> owned receiver delivery chain; external SIEM success/SLA cannot be inferred from outbox enqueue. |

## External, operator, contract and platform gates

These do not excuse N1-N17. They also do not justify fake controls or a
vendor-specific implementation guessed from sample responses.

- **Port authority:** hand over 5173 explicitly before required-origin use.
  The prior question timed out; silence is not authorization to stop FastShort.
- **Private contracts:** ReadCube needs approved account auth, revoke,
  search/export/paging/refresh endpoints and schemas, then an executable
  adapter (`references/providers.ts` always reports prerequisites).
  Dimensions needs licensed tenant auth/response/retrieval contract and an
  implementation (`references/retrieval.ts` explicitly rejects it).
  These are contract-blocked native implementations, not “ready if a key is
  pasted.” Implemented alternatives do not silently remove a retained elected
  provider, but no private API may be fabricated to satisfy the row.
- **Implemented provider configuration:** authorized model/modalities/terms;
  Crossref/arXiv/Semantic Scholar/DOI endpoints and permissions; Zotero keys,
  Mendeley registration/grants; GitHub/GitLab repositories/org approval;
  Dropbox App Folder grant; consumer identity registrations, real IdP
  metadata/certificates, LDAP trust/bind; merchant catalog/price IDs/portal/
  HTTPS webhook and authorized sandbox payment; publisher destination
  contract/grant; direct-download URLs; SMTP sender/domain/recipient/TLS;
  support and SIEM receiver. Fixture success is not live vendor acceptance.
- **Deployment:** exact immutable tool images/assets, actual native isolation,
  supported systemd-local-v1 configuration/signing keys, private backup root
  and timer, production domain/TLS/ingress/storage credentials and authority.
  Compose/Helm are real deployment artifacts but unsupported signed-update
  targets. Multi-host/other architectures require their own acceptance,
  not copied same-host receipts.
- **Operational logging/monitoring:** A59b still needs an explicit selected
  production retention/rotation/monitoring contract. Runtime logs and reported
  topology are not that contract. Document ownership and bounds, then verify
  that deployment; do not invent a metrics backend, health SLA, throughput,
  RPO/RTO or multi-node RWX promise.
- **Privacy:** P51 inventories actual storage; P52 proves a default fresh
  privacy-page visit only. Installation policy, processor list, selected
  provider terms and deployed/authenticated network/storage observations
  require actual operator inputs. No application analytics integration was
  found, so a consent switch for nonexistent analytics is not native work.
- **Platforms/humans:** actual Firefox/Safari/Edge/ESR and supported mobile
  browser/accessibility scenarios, external PDF validator and human review.
  P56's Linux-injected Meta/MacIntel run is not real macOS acceptance.
  Supported simple tables and source islands are intentional boundaries;
  arbitrary clipboard/TeX/macro compatibility is not elected by the fixtures.

## Precise stale-Next reconciliation

Update documentation in a later authorized increment; P60 changes only this
report. Keep historical failures and original evidence intact.

| Stale statement | Required replacement |
| --- | --- |
| P38 readonly undo defect | P39 closes default/Vim/Emacs readonly undo/redo and retained draft recovery; preserve the actual private-proposal contract. |
| P38/P27/P37 “custom adoption not reached” historical paragraphs | Lead with P37 FINAL accepted 80-assertion signed adoption/PDF/revocation packet. Keep earlier failed logs as history, with only generic error mapping still open. |
| P38 clean bootstrap has no template | P40 independently accepts published Starter Article provisioning/idempotence and native creation/edit/reopen. Template compile/catalog role tails remain specific. |
| P38/D07 combined onboarding still missing | P34 independent account-entry verdict/P44/P45 close bounded persisted ZIP/onboarding and pricing continuation. D21 non-ZIP settings/sync/history remain. |
| P04/C40b missing complete release UI | P18 management UI and independent release verification close the tested release/delete/reassign narrative. Retain only actual cross-org tool/default/legacy/recovery boundaries. |
| A55b automatic lifecycle missing, or P46 static failures current | P46 accepts explicit opt-in schedule, saved authority/restart/boundaries/recovery. No automatic billing/IdP lapse detector is promised. P59 closes later integrated static/build, not a live PostgreSQL migration or every runtime combination. |
| C17/A58a/A58b/A59b/Q02/Q06/Q12 and D22 Updates blanket HOST failure | P21-P25/P37 close tested native/same-host scale baseline. Keep unsupported profiles, unclosed panel consumers and production configuration separate. |
| P24/C39b/Q12 no PostgreSQL recovery route | P47 proves real PostgreSQL HTTP rollback/retry/restart/authority; local blob/Git/event fixture limits remain. |
| P30 missing correlated archive invocation | P48 closes exactly one controlled compiled ZIP/preparation/submission/replay/status identity chain; live destination/UI acceptance remains separate. |
| I43 missing new folder creation or permanently stale recovery | P49/P55 close native original-folder project import and explicitly confirmed same-grant prepared-snapshot reauthorization. No automatic authority adoption. |
| I44b/X-REF missing Mendeley bulk groups | P50 closes group selection, original-group explicit refresh, preview and separate editable copies. Retain ReadCube and strict-response compatibility; do not resurrect scheduled refresh. |
| I49b/X-RETRIEVAL missing unsupported-claim highlight/publication insertion | P54 closes source-bound model assessments/highlight/selected Copy/Cite/reload/real bibliography PDF. It does not certify scientific truth or Dimensions. |
| A17/C23 missing any composed bibliography compile | P54/P58 supply one; identify only a different unproved output/Biber consumer. |
| A54b self-delete owned-project/billing blanket mismatch | P57 closes deleted-content prerequisites, last-active-admin/operator guards, transfer and unchanged organization billing. Personal billing disposition remains N17, not another deletion defect. |
| A56a missing public disclosure/analytics choice | P51/P52 close default inventory/disclosure. Retain actual installation processors/network/terms; no fake analytics toggle. |
| A08/A09/A11/A13 missing composed shortcut/isolation/symbol/table behavior | P56 independently closes bounded Linux Chromium outcomes. Real macOS and stated platform/input limits remain. |
| Citation build still has final unresolved warnings | P58 final-pass warning aggregation/cache namespace and actual zero-diagnostic native PDF supersede that finding. Raw earlier-pass warnings remain intentionally available. |
| C16 no user-facing guidance | `pdf/logs.tsx` has it. Retain only pre-render/cached-asset consumer proof N13. |
| D12 LDAP/break-glass/backend mapping all absent | P27 LDAP and existing federation endpoints/config mappings are real. Distinguish missing UI completion from implemented backend; N4 names the actual gap. |
| D22 users/groups, worker, backup, support, audit controls absent | The read native panels have actual contract calls. Remaining receipts are proof gaps except specifically contradicted controls N15. |
| P52/P55/P57/P58 current static/build pending | Cite P59 exit 0 and its input boundary; preserve historical producer receipts and P54 pinning limitation. |

## Continuation order and closure

1. Reconcile the explicit decisions: separate public access, prospective
   sharing, institution policy/default variants, personal billing/upgrade reset,
   and legacy recovery/re-enrollment scope. Keep native work not depending on
   those choices moving; no implicit approval for narrower behavior.
2. Implement the concrete bounded native items above. Fix contradicted
   controls before collecting additional successful screenshots. Add only
   neighboring behavioral regressions for changed machine behavior.
3. Link the now-sufficient retained evidence before scheduling any proof
   packet. Run only uncovered/affected composed cases and inspect their real
   surfaces; do not turn every caveat into a new exhaustive suite.
4. Obtain port/operator/provider/platform inputs for their named gates.
   Record configuration-bound outcomes honestly when inputs are unavailable;
   distinguish a missing private implementation from a configured live adapter.
5. Finish original-source visual/accessibility review, accurate instructions,
   self-review and exact owned cleanup. Static/build/test repetition is
   justified by new affected inputs, not by a new handoff number.

This report is decision-complete for continuation, not product acceptance.
All 27 PART rows, the explicit remaining behavior bullets, non-PART native
option contradictions, all nine D22 panels and the six core criteria are
accounted for. No implementation gap is closed by a missing artifact, a
fixture alone or unavailable credentials. No accepted scoped workflow is
reopened solely because an older Next cell survived.
