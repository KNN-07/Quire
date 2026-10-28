# P3 capability matrix reconciliation

Date: October 27, 2026. Documentation-only checkpoint; parent owns ongoing integration. **Not release approval, full-product acceptance, or commercial parity.** Writes are limited to `docs/feature-matrix.md` and this file. Discovery, original inputs, application code and retained evidence are unchanged.

## Result and exact accounting

`docs/feature-matrix.md` retains every original primary ID/stem, target/disposition, owner and planned suite cell and adds actual implementation, scoped retained verification and explicit gaps. Inputs read in full: `docs/discovery/core.md`, `docs/discovery/services.md`, `docs/discovery/design.md`, and all three `docs/evidence/capability-audit/{core,services,design}.md` reports. Their historical checks were not rerun.

| Inventory | Exact rows | Unique | Missing / extra / duplicate |
| --- | ---: | ---: | --- |
| Core authoring A01-A27 | 27 | 27 | 0 / 0 / 0 |
| Core projects P01-P30 | 30 | 30 | 0 / 0 / 0 |
| Core compilation C01-C29 | 29 | 29 | 0 / 0 / 0 |
| Services collaboration (all suffixes) | 16 | 16 | 0 / 0 / 0 |
| Services integrations/AI (all suffixes) | 16 | 16 | 0 / 0 / 0 |
| Services administration/deployment (all suffixes) | 23 | 23 | 0 / 0 / 0 |
| Design D01-D23, exact stems | 23 | 23 | 0 / 0 / 0 |
| Primary total | **164** | **164** | **0 / 0 / 0** |
| Existing cross-cutting Q01-Q15, separate | 15 | 15 | 0 / 0 / 0 |
| Inventory including Q | **179** | **179** | **0 / 0 / 0** |

There are **141 research IDs + 23 design screens**. Services' 10 cross-domain labels and 21 credential/operating inputs are retained in their audit and reconciled below, not converted into extra primary IDs. Hidden panels belong to existing screens: D16 has six panels and D22 has nine, all retained in the row/panel mapping rather than sampled from default captures.

| Domain | UI | BE | EXT | PART | GAP | BOUND | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Core | 9 | 38 | 10 | 21 | 1 | 7 | 86 |
| Services | 4 | 13 | 7 | 30 | 0 | 1 | 55 |
| Design | 4 | 0 | 0 | 19 | 0 | 0 | 23 |
| Total | **17** | **51** | **17** | **70** | **1** | **8** | **164** |

These counts describe evidenced layers, not 164 closed workflows. PART includes missing behavior, assembly and/or required clean acceptance; GAP is the elected privileged project undelete. UI is a producer/native browser slice; BE is native/backend evidence; EXT is an executable adapter under controlled fixtures; BOUND implements an explicit bounded disposition. No row is promoted to whole-product PASS.

## Reconciliation decisions and current receipts

The old blanket "X/U/O unimplemented" statement is removed. Actual adapters/AI, source/visual/Git/review/PDF producers, persistent scale storage, backup drills, environment images/probes, worker lifecycle and signed updates are acknowledged at the layer proved. A backend fixture is not browser acceptance; an isolated browser is not root-route acceptance; no provider credential certifies code not yet written.

Directly reread `apps/web/src/router.tsx` and `apps/server/src/composition.ts`: editor routes remain unavailable and the default module set still omits the aggregate external factory, updates and support. `services/adapters/index.ts` implements that factory; its existence is not default-host start/close/scheduler integration. These are current assembly gaps, not external secrets.

Retained failing/nonfinal evidence remains visible:

- Tools `tests/ui-editor/tools/evidence/native-final.txt`: **18 pass, 2 fail, 97 assertions**; desktop Rnw harness dynamic import and Python browser lifecycle fail. Earlier focused Python success is narrower, not a replacement aggregate.
- PDF `tests/ui-editor/pdf/evidence/blocked-receipt.txt`: latest known complete browser run `bash_83` has **7 pass, 2 fail, 74 assertions**. Three lifecycle/four comparison cases pass; retained invalid-source preview/reload remains failed. Subsequent controller change has no clean complete receipt; `bash_85` outcome unknown.
- Assistant is newer than the audits: `docs/handoffs/p3-assistant.md` is **FINAL owned handoff, full integration gate blocked**, not "in progress" or full PASS. `tests/ui-editor/assistant/evidence/native-verified.log` records **14 pass/4 fail**; current directory has 20 cases after later additions. Focused SSE 1 pass/2 assertions, post-clear review 2 pass/4 assertions, strict/lint and standalone generation/accept/undo visual matrix pass. Native `EBADF` FD ownership failures in `packages/runtime/src/{repository-process,native-admission}.ts` remain reported. Standalone assistant supplies no compile controller; it does not close Error Fix/recompile assembly.
- `docs/handoffs/p3-connections.md`, `docs/handoffs/p2o-environments.md`, `docs/handoffs/p2o-backup-integration.md` and `docs/evidence/p2o-launch-recovery/deployment-pending.md` retain their nonfinal scopes. No pending child result is accepted.

Historical P1 logs were missing when some audits ran but are now present. This pass reread `docs/evidence/p1-integration/{browser,full-suites}.log` and `docs/evidence/p1-core-base/{compile-permission-tests,dashboard-tests}.log`; the matrix corrects the obsolete "missing raw log" boundary while treating their results as historical input, not new current-tree runs. Source/visual clean receipts and native protocol/storage/compiler receipts are preserved without rerunning unchanged suites.

Zotero's dedicated-key HTTP admission and Dropbox policy setter are landed per `docs/handoffs/p2x-http-admission.md`; the earlier core audit's Zotero route-gap sentence is superseded. ReadCube/Dimensions remain missing private protocols and executable implementations. The review anchor source is `apps/web/src/features/editor/review/anchors.ts`, correcting the audit's grouped .tsx shorthand.

## Missing behavior inventory with owner paths

**44 actionable groups** follow. Groups share IDs when independent obligations overlap; they are not 44 mutually exclusive primary rows. Exact per-row evidence and all remaining acceptance boundaries stay in the matrix. This list does not turn absent browser evidence into absent producer code or silently change the elected disposition.

| Work group | Requirement IDs | Owner and paths | Missing behavior / action |
| --- | --- | --- | --- |
| Editor routes | A01-A11, A13-A17, A21, A25-A27, C03, C06-C13, C28, C31-C39b, I41a-b, A60b, D01-D04, D06, D10-D11, D13, D20 | F/U: `apps/web/src/router.tsx`; `apps/web/src/features/editor/workspace.tsx` | Mount real service-connected routes, slots, file/branch/epoch recovery, header/save/cursor status and Share modal; isolated frames are not assembly. |
| Adapter and operator host | A12, A14, A18-A22, P09, P15-P16, P26-P27, P30, C14, I42a-I50b, A52b-c, A54a, A55c, A57a-b, A58a, A60a, D03, D05, D08, D12, D16-D18, D22 | F/X/O: `apps/server/src/composition.ts`; `services/adapters/index.ts`; `services/operations/{updates,support}/` | Mount aggregate factories/migrations/start/close with admission and scheduler ownership; integrate updates safety, support/SIEM and governed-AI overview readiness. |
| Compile shortcut | A08 | U: `apps/web/src/features/editor/source/bindings.ts`; `apps/web/src/features/editor/pdf/controller.ts` | Wire actual compile keyboard action; verify full documented map. |
| Figure insertion routes | A15 | U/X/K: `apps/web/src/features/editor/tools/FigurePanel.tsx`; `services/core/base/links.ts`; `services/adapters/interchange/links.ts` | Add complete other-project/generated-output/direct-URL picker/insertion, then real compile per supported format. Generic APIs alone are not this UI. |
| Clipboard images | A16 | U: `apps/web/src/features/editor/source/`; `apps/web/src/features/editor/visual/upload.ts` | Source-mode clipboard upload/insertion missing; visual handler accepts PNG but does not convert supported non-PNG images to PNG. |
| Rich and DOI reference UI | A18-A19, I45a, D06 | U/X: `apps/web/src/features/editor/tools/{BibliographyPanel,LibraryPanel}.tsx`; `services/adapters/references/index.ts` | Connect remote search/choose/cite and DOI lookup; journal/date/provider-specific rich field selection missing. Article-oriented form does not establish full BibLaTeX forms. |
| Private and group references | A20, I44b, I49b | X: `services/adapters/references/{mendeley,providers}.ts` | Mendeley bulk group selection absent. ReadCube and Dimensions are unavailable contracts, not executable adapters awaiting only secrets; obtain approved protocols then implement and verify. Alternatives remain labeled. |
| Tagged authoring and accessibility | A23-A24, Q11 | C/U/F: `tests/compiler/tagged-pdf.test.ts`; `deploy/compiler/fixtures/tagged/main.tex` | Add image-description, semantic/presentation-table and both MathML SE/AF fixture coverage. Human screen-reader and named external validator/date/version review unperformed; tagging is not certification. |
| Institution curation | P07 | K/A/V: `services/core/catalog/{templates,publication}.ts`; `apps/web/src/features/marketing/institution.tsx` | Dedicated featured/curated institution portal selection and republish/role acceptance not established by visibility alone. |
| Project rename authority | P11 | K: `services/core/base/projects.ts`; `services/core/base/access.ts` | Settings allows Editor rename; source selects owner-only project rename. Resolve mismatch without silently rewriting disposition. |
| Rename review-data boundary | P13 | X/K: `services/adapters/dropbox/rebase.ts`; `services/adapters/remote-git/pull.ts`; `services/core/git/trees.ts` | Exercise rename/delete-create comments/suggestions/history continuity and disclose actual loss. Conflict copies do not establish metadata preservation. |
| Privileged project undelete | P24 | A/K: `services/accounts/governance/admin-mutations.ts`; `services/core/base/project-routes.ts` | Distinct deleted-project/document operator undelete and unauthorized-denial behavior absent; account restore/history file recovery are different features. |
| Optimization guidance | C16 | U/C: `apps/web/src/features/editor/pdf/panel.tsx`; `services/compiler/service.ts` | Add user-facing optimization/pre-render/cached-asset workflow; draft and first-error controls do not establish guidance or larger quota. |
| Knitr workflow boundary | C24 | O/C: `services/operations/environments/execution.ts`; `deploy/compiler/compile.sh` | Inspected gate lacks .Rtex and explicit cache=TRUE unsupported/rejection acceptance; global cache FALSE default alone does not constrain chunk overrides. |
| Access-request notifications | C32a | K/A: `services/core/base/{access-routes,invitations}.ts` | Owner badge/email producer missing and arbitrary requester role upgrades insufficiently constrained; SMTP cannot manufacture absent notifications. |
| Capacity and owner entitlements | P03, C32b, C35, C39a, C40a-b, A51a | K/A: `services/core/base/{access,project-routes}.ts`; `services/accounts/identity/policy.ts` | Count Reviewers with Editors, recompute/reselect existing writable roles at downgrade/transfer, project-owner benefits separate from personal connectors, notify transfer parties, and implement prospective sharing snapshots. Current actor/org intersection omits owner projection. |
| Public and anonymous matrix | C33b | K: `services/core/base/{access,effective-access}.ts` | anonymousEdit is stored but no write path honors it; public no-link policy is not a separate executable matrix. Implement selected boundary or obtain explicit disposition. |
| Digest scheduling | C36b | A/F: `services/core/review/notifications.ts`; `services/accounts/governance/notifications.ts`; `apps/server/src/composition.ts` | Host flushNotificationDigests; delivery consumes outbox rather than unflushed digest items. |
| Labeled history access | C37-C38 | K: `services/core/review/history-store.ts` | Accessibility ignores labels and denies old labeled versions under finite window; fix consistently for timeline/ZIP/compare/restore. |
| Offline contract | I41b, A60b, Q08 | U: `apps/web/src/features/editor/transport/document.ts` | Actual 300,000 ms is five minutes, not configured ten minutes. Finish recovery/conflict/save-as-new/discard and restricted file-switch/compile/comment/AI behavior. |
| Dropbox folder discovery | I43 | X: `services/adapters/dropbox/{sync,merge}.ts` | New remote project directory does not create a project; sync currently merges existing UUID roots only. Personal connector entitlement projection is also missing. |
| Assistant project search | I46 | X/U: `services/adapters/ai/{context,provider}.ts`; `apps/web/src/features/editor/assistant/` | Only explicitly selected files/ranges read; authorized search of other project content and Assistant-versus-TeXGPT eligibility absent. |
| Language controls | I49a | X/U: `services/adapters/ai/{provider,service}.ts`; `apps/web/src/features/editor/assistant/Preferences.tsx` | Selection-length operation gating and general language-tool enable/floating-menu/shortcut/sentence-completion settings contract incomplete. |
| Citation Reviewer workflow | I49b, D03 | U/X: `apps/web/src/features/editor/assistant/`; `services/adapters/references/retrieval.ts` | Dedicated unsupported-claim highlighting/selected-publication insertion and full run-step visualization not established by result/run metadata; Dimensions private behavior remains absent. |
| AI transitions and alerts | I50a-b | A/X: `services/accounts/governance/organizations.ts`; `services/adapters/ai/store.ts` | No member-email producer on AI toggle or upgrade allowance reset. UTC reset/50 default/dispatch charging and configurable group defaults are Quire rules, not 5/10/Max parity. |
| Organization invitations and audit ZIP | A52a | A: `services/accounts/governance/{members,reports}.ts` | Pending email invite/acceptance missing (memberCreate requires existing active account); audit single inline CSV is not ZIP of paginated CSV files. |
| Institution eligibility | A53a-b | A/F: `services/accounts/governance/{members,lifecycle}.ts` | Direct memberCreate bypasses self-enrollment boundary; eligibility reconciliation not scheduled; Basic/AI owner/tool entitlement variants not projected. |
| Managed release and SSO lifecycle | A55a, A55c | A/X: `services/accounts/governance/managed.ts`; `services/adapters/federation/admin.ts` | Release retains membership/federation identities rather than completed SSO-unlink/independent entitlement transition. Accepted-managed transferee predicate and per-user SSO reminder/unlink-one/all missing. |
| Account deletion contract | A54b | A: `services/accounts/identity/account.ts` | Reassignment-only deletion differs from source owned-project deletion; active-subscription cancellation prerequisite absent. Resolve elected behavior explicitly. |
| Privacy controls | A56a | A/V/X: `apps/web/src/features/marketing/`; `services/accounts/identity/account.ts` | Cookie-choice/optional analytics/ad gating acceptance and processor-disclosure-versus-provider review not established. No infrastructure/legal warranty inferred. |
| Identity linking consumer | A54a, D16 | V: `apps/web/src/features/account/identities.tsx` | Link Location is discarded; unlink reload follows all-session revocation. Complete correct redirect/session navigation and connected browser proof. |
| History and tracking presentation | D04, D10 | U: `apps/web/src/features/editor/review/{history,review-view,suggestions,threads}.tsx` | Missing author-colored inline additions/deletions, author filter/legend, tracking toggle, file-tab counts/source comment anchors and thread-to-assistant action; plain comparison/proposal grid is not the supplied surface. |
| Checkout and usage | D05, A52b | V/A/X: `apps/web/src/features/account/billing.tsx`; `services/adapters/billing/quotes.ts` | Consumer ignores hosted Checkout result.url; personal billing and usage view absent. Twelve-month project-open license report not established. |
| Projects workspace header | D07 | V/K: `apps/web/src/features/projects/ProjectsPage.tsx`; `services/core/base/project-list.ts` | Dashboard workspace chooser/filter/avatar absent; creation workspace field is not equivalent. |
| SSO and LDAP consumer | D08, D12 | V/X: `apps/web/src/features/account/auth-options.tsx`; `apps/web/src/features/admin/Identity.tsx` | Organization/domain chooser/Back and LDAP login consumer absent; admin LDAP test lacks bind username/password inputs. Complete SAML handshake/break-glass/rotation consumer evidence. |
| Pricing comparison | D09 | V: `apps/web/src/features/marketing/pricing.tsx` | Source full six-group comparison reduced to five-topic local/hosted table; configured catalog-to-billing flow open. No invented commercial plans/prices required. |
| Logs AI action | D11, C14 | U/X: `apps/web/src/features/editor/pdf/logs.tsx`; `services/adapters/ai/context.ts` | Fix with AI callback/affordance missing despite diagnostic backend; assemble real propose/apply/recompile/undo with log consent. |
| Onboarding persistence | D14 | V/A: `apps/web/src/features/account/{auth,starting-point}.tsx` | Progress/writing kind currently component/query state rather than persisted bounded-flow resume. Complete template/import-to-mounted-editor. |
| Stored settings effects | D16 | V/U: `apps/web/src/features/account/preferences.tsx`; `apps/web/src/features/editor/` | Verify actual compile gate/viewer/cursor/AI inline/branch/shared-chat/clear effects after assembly. Chinese dictionary must remain honestly unavailable; connections handoff still nonfinal. |
| Self-host artifacts consumer | D17 | V/O: `apps/web/src/features/marketing/self-hosting.tsx`; `deploy/`; `scripts/ops/` | Screen artifact-pending states stale relative to existing deployment files; bind actual local docs/bundles/Compose/Helm/air-gap once final receipts exist. |
| Overview and topology | D18-D19, A57a | V/O: `apps/web/src/features/admin/{Overview,Architecture}.tsx`; `services/operations/overview/index.ts` | Missing per-job queue/Add worker/update/instance/auth/backups/provider strip; no probed health guarantee. Diagram stays local rather than active scale rendering. Governed AI readiness seam needs integration. |
| New-project import choices | D21 | V/K/X: `apps/web/src/features/projects/NewProjectDialog.tsx` | Two-way GitHub sync disabled; full-history/squash absent; compiler/template choices not uniform. Real import through durable completion to editor remains open. |
| Nine-panel operations consumers | D22 | V/O: `apps/web/src/features/admin/{Backups,Provider,Updates,Support,Audit}.tsx` | Backup ETag/collection-version vs immutable 0 and RESTORE vs full confirmation mismatch; provider logging/citation/confidential controls absent; host support/SIEM/update/scheduler lifecycle and all-panel native browser proof open. |
| Password strength | D23 | V/A: `apps/web/src/features/account/auth.tsx` | Live strength feedback absent; actual minimum/confirmation/single-use token checks already exist. |

## Verification still missing, distinct from absent behavior

Seven verification groups remain; they reuse existing focused suites where applicable rather than requesting redundant unchanged-suite reruns:

1. **Mounted editor/browser**: A01-A27, C03/C06-C13, C28, collaboration and D01-D04/D06/D10-D11/D13/D20 need real assembled 1440/390 light/dark navigation, file/branch/epoch recovery, role/offline and modal focus evidence. A11 symbols in both real modes and A13 visual-table-to-real-compile remain explicit acceptance; standalone tools/source textarea does not establish them.
2. **Current changed PDF/tools/assistant input**: preserve failures above; resolve actual runtime/fixture defects and produce clean required current gates. No fresh suite was started by this documentation assignment.
3. **Native product/admin consumers**: P01-P30/I42-I45 and D05/D07-D09/D12/D14/D16-D23 need configured native browser workflows, including selected-set/tag operations, publication, import, account linking and all nine D22 panels. Historical fixture matrices cover narrower contracts.
4. **Compiler/environment**: C05/C17-C27/A59a need final environment/profile packaging gates; exact uploaded .pdf/.md5/.dpth cache-clear/rebuild browser evidence remains C27. Real existing TL2025/image/PDF/helper receipts do not imply multiple releases or arbitrary package compatibility.
5. **Current aggregate recovery/deployment**: A56b/A58a-b/A59b need final default-host adapter/full-module backup and scale/controller/scheduler/platform/log/upgrade safety evidence. Historical P1S 400 native/three scale and native worker replacement receipts are real, not this current assembled production gate.
6. **Supported browsers/accessibility**: A24/A60b/Q11 and all screens need declared Firefox/Safari/Edge/ESR selection, focus/keyboard/contrast and human assistive-technology/PDF validation. Chromium mobile emulation is not that matrix or certification.
7. **Live configured third parties**: implemented AI/reference/remote Git/Dropbox/identity/federation/billing/SMTP/publisher adapters still require authorized configured inputs and actual live receipts. Code/consumer/scheduler gaps above must be completed separately. No live send, charge, login, sync, inference or publisher submission is claimed.

## Shared and overlapping source IDs

Primary rows are deliberately not collapsed. A12/A14/A22/C14 overlap I46-I50b; A17-A20 overlap I44a-b/I45a-b/I49b; P03/P04 overlap C39a/C40b/A55a-b; P13 overlaps I42a/I43; P25-P30 overlap I42b/A56b; C17-C29 overlap A59a-b/A60b. D screens clarify those implementations without replacing original capabilities. Q01-Q15 retain cross-cutting obligations.

The Services discovery's ten exact cross-domain labels remain mapped:

| Exact source label | Implementation/evidence and remaining boundary |
| --- | --- |
| F07,F29,F45 | I44a/I44b/I45a/I45b; native Library/citations and REF distinguish editable copies/read-only manager links. Real BibTeX/Biber in ENV/IC formats final output, not reference search. Assembled editor citation acceptance pending. |
| F08,F50 | I49a/I50a; account preferences keep interface/dictionary/model distinct; consent/ledger AI tests. No Grammarly direct integration claimed; full language controls remain I49a gap. |
| F10,F41,F42 | Core `limits.ts`/`unicode.ts`, remote import validation and IC binary/Unicode tests distinguish invalid/NUL text from binary retention. Quire non-BMP editing is explicit matrix disposition, not reference restriction parity. |
| F11,F35,F37 | Core `projects.ts`/`copy-edits.ts`, R copy tests: applied pending edits, new owner/source and fresh history/review/ACL/chat/tags/link metadata. Default environment selection is Quire's installed registry, not a fabricated newest TeX Live. |
| F12,F20,F57 | `services/core/catalog/{templates,publication}.ts`; `tests/core/catalog/{templates,template-copy-policy,lifecycle}.test.ts`, catalog handoffs/S. Approved/versioned/public/private/institution visibility is distinct from live share; no updating already-made copies. Gallery assembled browser acceptance remains separate. |
| F14,F43 | Dropbox `merge.ts` preserves explicit rename conflicts/copies (D); source anchors/history are not metadata-perfect rename guarantees. Remote Git rejects unsupported entries; no inferred exhaustive hosted file-role parity. |
| F15,F16,F60 | Core `links.ts`, IC URL links and safe fetch: read-only/manual refresh, linked `.tex` cannot be main, parent missing preserves child bytes. Public direct Drive URL only, not OAuth/native sync. Default adapter mounting pending. |
| F17-F20,F56,F58 | B/IC/BK separate archive/trash/leave/delete/export/submission/full backup. `services/adapters/publisher/` is a separate destination contract; a ZIP/PDF receipt never proves publisher delivery. |
| F22,F26,F28,F59 | Installed environment pins, actual native/Docker worker profiles, IC exact-snapshot exports and ENV executed helpers. No generalized shell escape/default claim across deployments, no arbitrary host commands via latexmkrc. |
| F30,F60 | ENV actual R/knitr/minted/plots; browser Pyodide is a distinct experimental U lane, not unrestricted server Python/PythonTeX API. Opt-in bundled-runner/assembled capture acceptance is not supplied by a compiler PDF. |



All **15 discovery security invariants** remain obligations: authorize every surface; separate access dimensions; role boundaries; no request/link elevation; transition recomputation; reversible versus destructive lifecycle; convergence versus recovery; credential isolation; safe external fetch; disclosure consent; robust federation; privileged audit; real compile isolation; explicit complete backup; no counterfeit integration success. Services audit numbers 1-14 cover the first 14; its credential/limitations/fixture boundaries plus matrix Q10 and external ledger retain invariant 15 explicitly. Capacity, owner-policy, labeling, scheduling, consumer and restore gaps above are not removed by historical security fixtures.

## External prerequisites and explicit dispositions

The matrix retains all **14 exact external keys**: X-AI, X-RETRIEVAL, X-REF, X-DOI, X-GIT, X-DROPBOX, X-IDENTITY, X-BILLING, X-PUBLISH, X-URL, X-TOOLS, X-A11Y, X-DEPLOY, X-MAIL. Services audit retains all **21 discovery external-artifact rows**: email; native Git bridge; GitHub; Dropbox; Zotero; Mendeley; ReadCube; DOI; AI tools; Dimensions; Google login; ORCID; SAML; LDAP; billing; vendor private images; S3; database/Redis/backup/routing/TLS; Drive/URL; open-in/owned compiler; native audit/permissions/history/chat/institution portal.

Only implemented boundaries are credential prerequisites: Quire-owned remote OAuth grants/apps, readable Zotero keys, configured permitted metadata/model endpoints/modalities and consent, institution trust/bind mapping, merchant keys/webhook/prices, authorized SMTP sender, publisher destination contract/receipt and deployment signer/TLS/stores. ReadCube/Dimensions need approved contracts **and code**, not secrets alone. Pandoc/R/Pyodide/TeX profiles are installation/provisioning obligations, not terminal credential excuses. Human validator review is unperformed validation, not native implementation authorization. Native project/organization/Git operations need no SaaS secret.

Original bounded choices stay unchanged: Quire Yjs/branches/label completion/non-BMP/dark/SCIM/OIDC additions; no Reviewer links; Drive manual URL import, not sync; source search, not claimed PDF search; UTC AI policy rather than inventing 24h/72h agreement; both SAML signatures; one Quire server rather than vendor edition emulation; PostgreSQL/local substitutions explicitly labeled. Vendor prices/plans/quotas/legal/support/retention/warranties, retired password Git/X/Writefull named actions, future vendor enterprise metrics, arbitrary RTL/glyph/retouch/PythonTeX and general accessibility guarantees are not fabricated acceptance. Selected mandatory native behaviors remain gaps rather than being reclassified as vendor policy.

## Documentation verification

Mechanical comparison checks the three discovery ID sets against the matrix's 164 primary rows, exact original four-cell preservation, all 23 source stems, and Q01-Q15 once each. All primary rows contain implementation, retained evidence and status/gap cells. Repository-relative code/document/evidence paths (including brace-expanded file sets and Core aliases) and each D source/reference capture are existence-checked. Short contextual filenames and evidence keys resolve through their scoped ledgers/audits; suite labels are plans, not claimed new results.

Results: 141 research IDs and all 23 design rows match exactly; zero missing, extra or duplicate primary IDs; all 164 original four-cell prefixes preserved; all 164 rows have seven populated cells; Q01-Q15 and all 14 external keys retained. All 528 distinct resolved paths exist, including the 69 decoded-source/renderable-bundle/reference-capture paths for the 23 screens. Persisted documents match the authored buffers apart from read-tool chunk whitespace; Markdown table widths are consistent. `git diff --check` for the two assigned files exits 0.

No application suite, build, service, provider, deployment, migration or capture was started. No code/prose test added, original input modified, git commit created or external write performed. Documentation checks establish inventory/reference integrity only; the retained producer failures and missing behavior remain open for parent integration.
