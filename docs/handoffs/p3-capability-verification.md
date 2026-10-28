# P3 independent capability coverage verification

Date: October 27, 2026. Verifier: `st_01a17d29`.

## Verdict

**PASS: exact inventory coverage and scoped implementation/evidence honesty. FAIL: complete upstream-final-report availability.** Under the assignment's rule that missing upstream reports are FAIL, the combined evidence-completeness verdict is **FAIL**: `docs/handoffs/p2o-deployment.md` is absent. The matrix already describes deployment as nonfinal; this is an evidence-chain failure, not a newly discovered false deployment-success claim.

The three required capability-family audit reports and `p3-capability-matrix.md` are present. Every one of the **164 primary source IDs** has exactly one populated matrix row and one corresponding family-audit row. There are **0 missing, 0 extra and 0 duplicate primary IDs**. All **23 exact design stems** match. No backend-only, controlled-provider or isolated-browser result inspected here supports whole-application or live-provider acceptance, and the current matrix does not claim otherwise.

The audit checks below total **14 PASS / 1 FAIL**. Separately, primary inventory accounting is **164 PASS / 0 FAIL**; these are coverage results, not 164 passing product workflows. Product completion is deliberately not this audit's verdict.

No application suite, build, service, provider, deployment or screenshot capture was run. Existing captured evidence remains valid for its recorded input and scope. Only this report was written; no code, discovery input, matrix or existing evidence was changed.

## Inputs and method

Authoritative source inventories:

- `docs/discovery/core.md`, including its requirement classes and native-tool/unsupported-behavior boundaries.
- `docs/discovery/services.md`, including all suffixes, cross-domain labels, security invariants and external operating artifacts.
- `docs/discovery/design.md`, including all 23 screen stems and the six settings/nine operations panels.

Compared against `docs/feature-matrix.md`, `docs/handoffs/p3-capability-matrix.md` and the three `docs/evidence/capability-audit/{core,services,design}.md` reports. Text was read in bounded chunks rather than treating a truncated first read as complete.

Mechanical checks parsed Markdown row first cells, retained service suffixes, compared sets and multiplicity, checked nonempty seven-cell primary rows, and recomputed status counts. The first four matrix cells were also compared with `git show HEAD:docs/feature-matrix.md`: all 164 are unchanged. This proves preservation against the repository baseline, not that the shorter matrix wording replaces the full discovery acceptance scenarios.

Reference checks expanded brace groups and the documented E/K/X/N/W/O aliases. Symbol suffixes such as `access.ts:checkCapacity` were removed before filesystem checks; these are symbol references, not missing filenames. All **447 distinct explicit normalized matrix paths** exist. All **69** screen artifacts, three per stem, exist: decoded source, renderable nested bundle and retained reference capture. Their union is **516 distinct paths**. The handoff's broader **528** contextual-path count was not independently reproduced; this report certifies the explicit-path count above, not an unexplained alternative cardinality. Short contextual filenames remain resolved through the named family ledgers.

Load-bearing implementation and receipt inspection covered each inventory family and the shared assembly seams. It included actual test assertions and fixture entrypoints, not just test filenames or success-oriented handoff titles. Retained reference/editor-unavailable/mobile-Git images were opened directly; no new visual acceptance was inferred from them.

## Check ledger

| Check | Result | Independently observed |
| --- | --- | --- |
| Core exact IDs | PASS | 86 expected, 86 matrix rows, 86 unique; no missing/extra/duplicate. |
| Services exact IDs and suffixes | PASS | 55 expected, 55 matrix rows, 55 unique; groups 16/16/23. |
| Design IDs and stems | PASS | D01-D23 once each; all 23 stems match source order and spelling; no suffixed design IDs. |
| Original matrix prefix preservation | PASS | All 164 first-four-cell prefixes match repository HEAD. |
| Primary row shape | PASS | All 164 rows have seven populated cells. |
| Cross-cutting rows | PASS | Q01-Q15 each occur once, separate from the 164 primary rows. |
| Required family audits | PASS | Core/services/design reports all present; 86/55/23 unique mapped rows, no source-set differences. |
| Status accounting | PASS | Recomputed 17 UI, 51 BE, 17 EXT, 70 PART, 1 GAP, 8 BOUND. |
| Explicit implementation/evidence paths | PASS | 447 normalized explicit paths, zero missing. Symbol-qualified references resolve to existing files. |
| Design source/capture references | PASS | All 69 artifacts exist for the 23 exact stems. |
| Cross-domain/security obligations | PASS | All 10 exact cross-domain labels retained in services audit and handoff; all 15 security invariants accounted for, including invariant 15 in handoff prose/Q10 rather than a fifteenth services-audit table row. |
| External inputs and dispositions | PASS | All 14 matrix external keys retained; all 21 source operating-artifact categories have corresponding services-audit entries, with some labels shortened rather than preserved verbatim. |
| Implementation and receipt scope | PASS | Real producer/backend/operations code and scoped retained receipts exist across all families; known failures remain visible. |
| Claim calibration and supersession | PASS | No full-editor/live-provider PASS asserted; newer assistant handoff and landed HTTP-admission corrections supersede stale upstream wording explicitly. |
| Referenced final producer report availability | **FAIL** | `docs/handoffs/p2o-deployment.md` absent; interim deployment ledger explicitly awaits it and retains failed gates. Do not substitute that interim ledger for a final producer report. |

### Exact ID accounting

The following are source IDs, not sampled representatives:

```text
Core authoring (27)
A01 A02 A03 A04 A05 A06 A07 A08 A09 A10 A11 A12 A13 A14
A15 A16 A17 A18 A19 A20 A21 A22 A23 A24 A25 A26 A27

Core projects (30)
P01 P02 P03 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14 P15
P16 P17 P18 P19 P20 P21 P22 P23 P24 P25 P26 P27 P28 P29 P30

Core compilation (29)
C01 C02 C03 C04 C05 C06 C07 C08 C09 C10 C11 C12 C13 C14 C15
C16 C17 C18 C19 C20 C21 C22 C23 C24 C25 C26 C27 C28 C29

Services collaboration (16)
C31 C32a C32b C33a C33b C34a C34b C35 C36a C36b C37 C38
C39a C39b C40a C40b

Services integrations/AI (16)
I41a I41b I42a I42b I43 I44a I44b I45a I45b I46 I47 I48
I49a I49b I50a I50b

Services administration/deployment (23)
A51a A51b A52a A52b A52c A53a A53b A54a A54b A55a A55b A55c
A55d A56a A56b A57a A57b A58a A58b A59a A59b A60a A60b

Separate cross-cutting rows (15)
Q01 Q02 Q03 Q04 Q05 Q06 Q07 Q08 Q09 Q10 Q11 Q12 Q13 Q14 Q15
```

| Screen ID | Exact source stem | Coverage |
| --- | --- | --- |
| D01 | `01-editor` | PASS |
| D02 | `02-git` | PASS |
| D03 | `03-ai-agent` | PASS |
| D04 | `04-history` | PASS |
| D05 | `05-billing` | PASS |
| D06 | `06-editor-tools` | PASS |
| D07 | `07-projects` | PASS |
| D08 | `08-sign-in` | PASS |
| D09 | `09-pricing` | PASS |
| D10 | `10-review` | PASS |
| D11 | `11-compile-logs` | PASS |
| D12 | `12-admin-identity` | PASS |
| D13 | `13-pdf-diff` | PASS |
| D14 | `14-onboarding` | PASS |
| D15 | `15-landing` | PASS |
| D16 | `16-settings` | PASS, all six panel obligations retained |
| D17 | `17-self-hosting` | PASS |
| D18 | `18-admin-console` | PASS |
| D19 | `19-architecture` | PASS |
| D20 | `20-share` | PASS |
| D21 | `21-new-project` | PASS |
| D22 | `22-admin-operations` | PASS, all nine panel obligations retained |
| D23 | `23-reset-password` | PASS |

The D16 panels are Profile, Sign-in & SSO, Editor, AI assistant, Git & integrations and Notifications. The D22 panels are Users & groups, Compile workers, TeX Live images, AI provider, Templates, Storage & backups, Updates, Support and Audit log. Counting their default screenshots alone would not satisfy coverage.

### Recomputed strongest-evidenced-layer totals

| Inventory | UI | BE | EXT | PART | GAP | BOUND | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Core | 9 | 38 | 10 | 21 | 1 | 7 | 86 |
| Services | 4 | 13 | 7 | 30 | 0 | 1 | 55 |
| Design | 4 | 0 | 0 | 19 | 0 | 0 | 23 |
| Total | 17 | 51 | 17 | 70 | 1 | 8 | 164 |

UI/BE/EXT are not closed-workflow statuses. PART/GAP explicitly identify 71 rows with missing behavior, integration or required clean acceptance; other rows still carry scoped remainders. No product-PASS count is derived from these labels.

## Independent implementation and receipt findings

| Family / boundary | Actual inspection and retained evidence | Permitted conclusion |
| --- | --- | --- |
| Authoring | `visual/upload.ts` validates PNG MIME and the exact PNG signature, then performs scoped multipart upload. `tests/ui-editor/visual/browser.test.ts` uses real HTTP/WS persistence but a separate source textarea. `tests/ui-editor/visual/evidence/final-receipt.txt` records 17 pass/0 fail/77 assertions. Source bindings and tools receipt were also read. | Native visual producer behavior is real; non-PNG conversion, source clipboard support and assembled dual-mode acceptance are not established. |
| Projects/catalog | `services/core/base/projects.ts` copies actual source and applies pending suggestions, while `patch` authorizes `settings` for name changes. `project-routes.ts` transfers/deletes real persistent projects. Base raw logs record 50/0 and 42/0; catalog verification records final 37/0/61 assertions. | Real native implementation, not fabricated project cards. Owner-only rename, transfer entitlement/capacity and separate privileged project undelete remain gaps; account restore/file recovery are not project undelete. |
| Compiler | `workers/compiler/build.ts` invokes actual latexmk engines, retains generated artifacts and validates PDF output. `sandbox.ts` uses systemd resource limits and bwrap confinement. `tests/compiler/engines.test.ts` checks extracted PDF text, actual DVI and bibliography content. Compiler handoff records historical 44/0/128 and real-role HTTP 8/0/36. | Actual compiler PDFs/isolation, not fixture success bytes; no complete current browser, arbitrary package or accessibility certification follows. |
| Collaboration/Git | `AccessStore.checkCapacity` counts only Editors; `HistoryStore.dto` computes accessibility before reading labels. Retained review receipt ends 32/0/173 assertions; Git producer receipt records backend 38/0/182 and four browser tests. | Real collaboration/Git with concrete capacity and labeled-history defects. A mobile isolated Git capture is not mounted-editor acceptance. |
| Integrations/AI | `createApplicationAdapters` constructs real module contributions and start/close/scheduler lifecycle. `references/providers.ts` explicitly denies unavailable ReadCube/Dimensions contracts. Raw receipts: references 38/0/138, AI 44/0/148, interchange 33/0/92, publisher 10/0/31. | Executable controlled protocols and genuine conversion/compiler artifacts. No live inference, reference account, sync or publisher delivery; private unavailable contracts also need implementation, not only secrets. |
| Administration/operations | Backup handlers require immutable content version 0; `restoreConfirmation` requires `RESTORE <id> TO <target>`. The UI instead uses collection metadata version and literal `RESTORE`. Historical scale receipts are 400 native and three scale tests; workers record 20/0/94, updates 29/0/82; actual backup drill/recovery JSON was read. | Native storage, restore, worker and update evidence exists. Backup consumer mismatch and current all-module/deployment closure remain real; historical scale is not a current production gate. |
| Design/product consumers | `billing.tsx` discards the hosted checkout destination; `identities.tsx` discards Link redirect metadata and reloads after unlink. Actual P1 browser script explicitly expects the unavailable editor after creating a project. Reference editor, unavailable-route and isolated mobile-Git captures were opened. | Account/project/operator native slices and dedicated fixtures are narrower than the supplied full design and root-route workflows. |
| Shared assembly | `apps/web/src/router.tsx:71` renders the unavailable heading for edit/Git/agent/history/review/logs/PDF-diff. `apps/server/src/composition.ts` has native modules but no aggregate external factory, updates or support registration/lifecycle. | Default application assembly remains missing, not credential-blocked. The matrix states this accurately. |

### Retained failing and nonfinal gates

- **Tools:** `tests/ui-editor/tools/evidence/native-final.txt` ends **18 pass / 2 fail / 97 assertions**. Desktop Rnw dynamic import and the Python browser lifecycle fail. Earlier focused Python success is real but cannot overwrite this later aggregate.
- **PDF:** `tests/ui-editor/pdf/evidence/blocked-receipt.txt` records `bash_83`, **7 pass / 2 fail / 74 assertions**. Lifecycle/comparison cases pass, but retained-invalid-PDF discovery/reload fails, including mobile 500 responses. The subsequent controller edit is not a clean rerun; `bash_85` is unknown.
- **Assistant:** `tests/ui-editor/assistant/evidence/native-verified.log` ends **14 pass / 4 fail / 49 assertions**, including actual EBADF and browser/server errors. `p3-assistant.md` is a final owned handoff with a blocked full gate, not an unfinished handoff or a green aggregate. `tests/ui-editor/assistant/surface.tsx` supplies `compile={null}` and no diagnostics, so its visual review matrix cannot certify Error Fix/recompile.
- **Deployment:** `docs/evidence/p2o-launch-recovery/deployment-pending.md` retains 11 passing native tests but failed owned types/lint, SSE and later bundle proof, and explicitly awaits the absent final producer report. Earlier bundle success does not override the later signer failure.
- **Other nonfinal scopes:** `p3-connections.md`, `p2o-environments.md` and `p2o-backup-integration.md` retain in-progress/nonfinal labels. Their actual passing slices still stand; pending final receipts are not silently accepted.

### Corrections and supersession required

1. Supply the absent `docs/handoffs/p2o-deployment.md` with the selected final input/receipt assessment, or continue to report the upstream-final evidence gate as FAIL. No rerun or missing report was manufactured here.
2. Do not reuse the older core/design audits' assistant "in progress" language as the current handoff verdict. The matrix correctly supersedes it with FINAL owned handoff/full gate blocked; any later consolidated report must retain that distinction.
3. Do not reintroduce the older core audit's missing Zotero typed-key HTTP-admission claim or missing P1 raw-log claim. The current matrix explicitly supersedes those with landed admission and now-present historical logs.
4. Preserve `apps/web/src/features/editor/review/anchors.ts`, not the older grouped `.tsx` shorthand. The current matrix corrects it.
5. If the reconciliation handoff's exact 528-path count is important, retain its resolver/expanded manifest. This independent audit obtained 447 explicit normalized paths plus 69 source artifacts, union 516; no missing explicit path was found, and different contextual-reference counting is not evidence of a missing file.

No primary ID, screen stem, original matrix prefix or populated primary-cell correction is required by this audit.

## Current gap inventory

The reconciliation handoff's **44 groups** are all retained below. They overlap and must not be added to produce a primary-row count. These are implementation/contract/consumer gaps already honestly represented, not reasons to fail an otherwise correct coverage row. Owner paths and per-row acceptance details remain in the matrix and reconciliation handoff.

| Group | IDs | Concrete correction / remaining behavior |
| --- | --- | --- |
| Editor routes | A01-A11, A13-A17, A21, A25-A27; C03, C06-C13, C28; C31-C39b; I41a-b; A60b; D01-D04, D06, D10-D11, D13, D20 | Mount actual service-connected workspace, recovery, header/status, mode/file/branch navigation and Share modal; isolated producers do not close this. |
| Adapter and operator host | A12, A14, A18-A22; P09, P15-P16, P26-P27, P30; C14; I42a-I50b; A52b-c, A54a, A55c, A57a-b, A58a, A60a; D03, D05, D08, D12, D16-D18, D22 | Consume aggregate factories/migrations/start/close, admission, schedulers, updates safety and support/SIEM; fix governed-AI readiness projection. |
| Compile shortcut | A08 | Bind real compile action and verify the documented keyboard map. |
| Figure insertion routes | A15 | Complete other-project/generated-output/direct-URL insertion choices and real compiled outputs. |
| Clipboard images | A16 | Add source-mode image paste and supported non-PNG-to-PNG conversion. |
| Rich and DOI reference UI | A18-A19, I45a, D06 | Wire search/choose/cite and DOI; cover journal/date/provider fields and actual BibLaTeX form scope. |
| Private and group references | A20, I44b, I49b | Implement Mendeley bulk groups; obtain approved ReadCube/Dimensions contracts and implement the absent private protocols. |
| Tagged authoring/accessibility | A23-A24, Q11 | Cover image descriptions, semantic/presentation tables, both MathML SE/AF paths, human assistive technology and named external PDF validator review. |
| Institution curation | P07 | Implement/verify featured curated portal entries, republishing and roles. |
| Project rename authority | P11 | Resolve Editor-allowed settings rename against the elected owner-only source behavior. |
| Rename review metadata | P13 | Exercise rename/delete-create comments, suggestions and history continuity; disclose actual loss. |
| Privileged project undelete | P24 | Implement distinct operator project/document undelete and unprivileged denial, or explicitly revise the elected disposition. |
| Optimization guidance | C16 | Provide actual optimization/pre-render/cached-asset guidance/workflow, not only draft/first-error toggles. |
| Knitr boundary | C24 | Implement/explicitly bound `.Rtex` and chunk `cache=TRUE`; a global cache FALSE default does not constrain overrides. |
| Access-request notifications | C32a | Produce owner badge/email and enforce the selected request-role upgrade matrix. |
| Capacity/owner entitlements | P03, C32b, C35, C39a, C40a-b, A51a | Count Reviewers, recompute downgrade/transfer roles, distinguish owner benefits from personal connectors, notify transfer parties and implement prospective sharing scope. |
| Public/anonymous matrix | C33b | Implement or explicitly dispose anonymous write and public-without-link behavior. |
| Digest scheduling | C36b | Schedule digest flush before delivery consumes outbox. |
| Labeled history | C37-C38 | Keep eligible labeled old versions accessible consistently across timeline/export/compare/restore. |
| Offline contract | I41b, A60b, Q08 | Resolve hardcoded 300,000 ms against selected configurable ten minutes; finish recovery choices and offline restrictions. |
| Dropbox folder discovery | I43 | Create projects from new remote project directories; finish connector entitlement and configured live acceptance. |
| Assistant search | I46 | Implement authorized other-project-content search and selected Assistant/TeXGPT eligibility. |
| Language controls | I49a | Add selection-length gating and selected enable/menu/shortcut/sentence-completion contracts. |
| Citation Reviewer | I49b, D03 | Complete unsupported-claim highlighting, selected-publication insertion and run-step presentation; do not relabel public alternatives as Dimensions. |
| AI transitions/alerts | I50a-b | Add selected upgrade reset and member-email producers; retain explicit Quire defaults and charging policy. |
| Organization invitations/audit ZIP | A52a | Add pending-email invite/acceptance and ZIP of paginated audit CSVs. |
| Institution eligibility | A53a-b | Protect self-enrollment rules, schedule eligibility reconciliation and project selected institution capability variants. |
| Managed release/SSO lifecycle | A55a, A55c | Finish SSO unlink/independent entitlement transition, accepted-managed target constraint and reminder/unlink-one/all. |
| Account deletion | A54b | Resolve reassignment-only implementation versus elected owned-project deletion; enforce selected subscription cancellation prerequisite. |
| Privacy controls | A56a | Establish cookie-choice/optional tracking gates and processor disclosure against configured provider behavior. |
| Identity linking consumer | A54a, D16 | Consume Link redirect metadata and navigate correctly after all-session unlink revocation. |
| History/tracking presentation | D04, D10 | Add author-colored inline changes, filters/legend, tracking toggle, counts/anchors and thread-to-assistant action. |
| Checkout/usage | D05, A52b | Consume hosted checkout URL; implement selected personal billing/usage and twelve-month project-open report. |
| Projects workspace header | D07 | Add actual workspace chooser/filter/avatar; creation workspace field is different. |
| SSO/LDAP consumer | D08, D12 | Add organization/domain chooser/Back, LDAP login and admin bind credentials; prove connected handshake/fallback/rotation. |
| Pricing comparison | D09 | Restore selected full six-group comparison and configured catalog-to-billing flow without invented plans/prices. |
| Logs AI action | D11, C14 | Bind real log-derived propose/apply/recompile/undo and consent; backend diagnostic admission is not a UI action. |
| Onboarding persistence | D14 | Persist bounded-flow resume and complete template/import-to-mounted-editor. |
| Stored settings effects | D16 | Verify actual compile/viewer/cursor/AI/branch/chat/clear effects after assembly; keep missing Chinese dictionary explicit. |
| Self-host artifact consumer | D17 | Replace stale pending states with actual final local docs/bundles/Compose/Helm/air-gap artifacts when final receipts exist. |
| Overview/topology | D18-D19, A57a | Complete queue/worker/update/instance/auth/backup/provider surfaces, active scale diagram and truthful AI readiness. |
| New-project choices | D21 | Complete GitHub two-way sync/history choices, consistent compiler/template selections and durable import-to-editor. |
| Nine operations consumers | D22 | Fix backup version/confirmation mismatch; expose provider logging/citation/confidential controls; finish host workers/lifecycle and all-panel native acceptance. |
| Password strength | D23 | Add live strength feedback; existing minimum/confirmation/single-use behavior is separate. |

### Acceptance debt distinct from missing behavior

All seven verification groups in the reconciliation remain open at their stated scope: mounted editor desktop/mobile light/dark; clean changed PDF/tools/assistant gates; native product/admin consumers including all D22 panels; final compiler/environment packaging and exact persistent externalization assets; current aggregate recovery/deployment; declared browser/accessibility matrix; and authorized live configured third parties.

No unchanged captured passing slice was invalidated merely because another workflow is incomplete. Conversely, passing unit/backend/protocol/isolated-browser results were not promoted to assembled application, live provider, human accessibility or production deployment results. No future correction listed above was performed within this read-only audit.
