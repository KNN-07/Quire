# Quire feature and acceptance matrix

Implementation targets, not passing results. Source IDs retain their exact spelling from `discovery/core.md` (86 rows) and `discovery/services.md` (55 rows). `D01-D23` are the decoded screens in `discovery/design.md`. This matrix adds no commercial parity claim. See `implementation-plan.md` for endpoint contracts, ownership and runnable T01-T22 suites.

Disposition: **B** native build; **A** build adapter plus live external prerequisite; **E** build installed/experimental extension; **P** implement configuration/boundary, not vendor marketing policy. Multiple letters retain both obligations. Every row names its primary implementation lane; UI uses U for editor or V for product/admin. Phases: K/A/C/V in P1, X/U/O in P2, F integrates P3 and lead verifies P4.

## Core: authoring

| ID | Target / explicit Quire disposition | Owner | Verification |
| --- | --- | --- | --- |
| A01 | B CodeMirror syntax/completion/theme | U | T03 |
| A02 | B heuristic Code Check; global/file/region suppression | U | T03 |
| A03 | B source/visual shared document; unknown source islands preserved | U | T03 |
| A04 | B tree navigation and keyboard/draggable splitters | U | T03,T20 |
| A05 | B current-file heading outline | U | T03 |
| A06 | B case/regex/word/selection current-file find/replace | U | T03 |
| A07 | B project source search with explicit excluded files | K | T03,T04 |
| A08 | B documented shortcuts and Mac completion mapping | U | T03 |
| A09 | B user-scoped Vim/Emacs emulation | U | T03 |
| A10 | B 10-24px/family/line-height preferences | U | T03 |
| A11 | B symbols/package hints and editable math in both modes | U | T03 |
| A12 | A equation prompt/image generation, common allowance | X | T17; X-AI |
| A13 | B simple visual tables, TSV paste, source editing | U | T03,T07 |
| A14 | A table generation through same AI gateway | X | T17; X-AI |
| A15 | B figure routes/caption/label/width/package insertion | U | T03,T04,T07 |
| A16 | B single-image paste to PNG and visual preview | U | T03 |
| A17 | B editable bibliography/key insertion | K | T13,T07 |
| A18 | A rich/provider reference search | X | T13,T16; X-REF |
| A19 | B/A Library forms/code/upload/DOI and independent project copies | K | T13,T16; X-DOI |
| A20 | A linked bulk versus editable individual imports | X | T16; X-REF |
| A21 | B independent UI language/dictionary/spell controls | U | T03 |
| A22 | A separate AI language/model settings | X | T17; X-AI |
| A23 | B tagged-PDF authoring fixtures, metadata/MathML engine rules | C | T07,T20; X-A11Y |
| A24 | P record actual assistive-tech/PDF validation, no certification claim | F | T20; X-A11Y |
| A25 | B UTF-8/font/engine round trip; binary handling of invalid text | K | T03,T04,T07 |
| A26 | B/P Quire explicitly supports non-BMP editing with surrogate tests | U | T03,T04 |
| A27 | B/P real label completion; no universal RTL/glyph/retouch promises | U | T03,T20 |

## Core: projects

| ID | Target / explicit Quire disposition | Owner | Verification |
| --- | --- | --- | --- |
| P01 | B blank/example/template independent projects | K | T02 |
| P02 | B copy ownership, applied suggestions, fresh metadata/history | K | T02,T06 |
| P03 | B collaborator ownership transfer/recomputed policy | K | T05,T14 |
| P04 | B managed release distinct from delete/reassignment | A | T14 |
| P05 | B template search/independent copy | K | T13 |
| P06 | B submission/approval/version publication/license | K | T13 |
| P07 | B public/private/institution gallery and publisher roles | K | T13,T14 |
| P08 | B nested ZIP/main/engine/environment selection | K | T04,T07 |
| P09 | E real DOCX/Markdown conversion, declared loss boundaries | X | T16; X-TOOLS |
| P10 | B hierarchy and independent atomic limits | K | T04 |
| P11 | B folder/file mutations/project rename/role checks | K | T04,T05 |
| P12 | B deleted-file recovery, not project-delete undo | K | T06 |
| P13 | A external rename metadata conflicts explicitly represented | X | T16 |
| P14 | B binary storage separate from compile compatibility | K | T04,T07 |
| P15 | A URL direct import/manual refresh, SSRF constraints | X | T04,T16; X-URL |
| P16 | A/P Google Drive URL/manual refresh, not native sync | X | T16; X-URL |
| P17 | B read-only cross-project link/manual refresh | K | T04 |
| P18 | B linked `.tex` cannot be main | K | T04 |
| P19 | B tags, bulk assignment, HEX/RGB normalization/filter | K | T02 |
| P20 | B selected-set archive/trash/restore/source ZIP | K | T02,T04 |
| P21 | B explicit title/owner search, sort and ID tie-break | K | T02 |
| P22 | B per-user archive/trash without expiry | K | T02,T05 |
| P23 | B non-owner leave/owner permanent delete/live revocation | K | T02,T05 |
| P24 | B privileged administrative undelete separate from user restore | A | T14,T21 |
| P25 | B source ZIP versus actual PDF | K | T04,T07 |
| P26 | B generated `.bbl`/submission bundle, no implicit send | K | T04,T07,T16 |
| P27 | E real DOCX/Markdown/HTML export, actionable conversion errors | X | T16; X-TOOLS |
| P28 | B live Viewer share/read/download/independent copy | K | T02,T05 |
| P29 | B default private, token exposure/revocation | K | T05 |
| P30 | A destination prepare/manual/direct submission with receipt | X | T16; X-PUBLISH |

## Core: compilation

| ID | Target / explicit Quire disposition | Owner | Verification |
| --- | --- | --- | --- |
| C01 | B four real engines, pdfLaTeX default | C | T07 |
| C02 | B actual PDF, LaTeX DVI and conversion | C | T07 |
| C03 | B validated main document selection | C | T04,T07 |
| C04 | B shared/preserved/reversible environment pin | C | T07 |
| C05 | B/P only installed/probed stable or labeled experimental releases | C | T07,T21 |
| C06 | B automatic/manual compile with immutable snapshot | C | T08 |
| C07 | B draft skip-image behavior | C | T08 |
| C08 | B first-error/continue, no false new successful PDF | C | T08 |
| C09 | B generated-cache clear, source hashes preserved | C | T08 |
| C10 | B real viewer zoom/page/presentation/two viewers/five layouts | U | T09,T20 |
| C11 | B bidirectional real SyncTeX | C | T09 |
| C12 | P source-search scope; do not falsely promise PDF-text search | U | T09 |
| C13 | B diagnostic classes/file links/raw logs/generated files | C | T08 |
| C14 | A logged-error fix, separate from Code Check | X | T17; X-AI |
| C15 | B wall budget/kill process tree/timeout state | C | T08,T18 |
| C16 | B optimization advice/draft without quota inflation | U | T08 |
| C17 | B mandatory restricted isolated compile, no host execution | C | T18 |
| C18 | B real installed/local classes/packages/search paths | C | T07 |
| C19 | B uploaded fonts on Xe/Lua, truthful pdfLaTeX constraints | C | T07 |
| C20 | B actual sandboxed latexmkrc precedence/custom rules | C | T18 |
| C21 | E explicit plain-TeX profile inside same boundary | C | T07,T18 |
| C22 | B/P no-shell default, tested restricted helper profile | C | T18 |
| C23 | B actual BibTeX/Biber reruns and bibliography content | C | T07 |
| C24 | E installed R/knitr workflow, explicit cache limitation | C | T18; X-TOOLS |
| C25 | E actual minted helper profile, no legacy-lexer guarantee | C | T18 |
| C26 | B real 2D/3D pgfplots/TikZ externalization fixtures | C | T18 |
| C27 | B generated cache versus persistent uploaded assets | C | T08,T18 |
| C28 | E opt-in browser Pyodide runner, generated-file approval | U | T03,T18 |
| C29 | P registry reflects executed profiles, not PATH discovery alone | C | T18 |

## Services: collaboration

| ID | Target / explicit Quire disposition | Owner | Verification |
| --- | --- | --- | --- |
| C31 | B durable Yjs convergence/reconnect/presence | K | T05 |
| C32a | B email invite/accept/access-request state and quotas | A | T01,T05,T14 |
| C32b | B/P configurable writable roles; not copied vendor plans | A | T14 |
| C33a | B private default, revoke links, Viewer default/no Reviewer links | K | T05 |
| C33b | B named/token/org/anonymous policy on all transports | K | T05 |
| C34a | B direct API role matrix enforced | K | T05,T06 |
| C34b | B anchors/replies/moderation/tombstones | K | T06 |
| C35 | B tracked proposals, selected/bulk accept/reject and downgrade | K | T06,T14 |
| C36a | B chat and disable; named Viewer allowed/link Viewer denied | K | T05,T15 |
| C36b | B mentions/preferences/digest with controlled clock | A | T15 |
| C37 | B history/labels/source ZIP/access window/fresh copy | K | T06 |
| C38 | B file/project restore and eligible review recovery | K | T06 |
| C39a | B ordinary/admin transfer distinct, leave and quota recompute | K | T05,T14 |
| C39b | B per-user trash versus permanent global deletion | K | T02,T05 |
| C40a | B project/account/org policies separate, prospective sharing | A | T14 |
| C40b | B release/delete/reassign and cross-org AI deny | A | T14,T17 |

## Services: integrations and AI

| ID | Target / explicit Quire disposition | Owner | Verification |
| --- | --- | --- | --- |
| I41a | B actual Git bridge/token/ACL/history materialization | K | T11 |
| I41b | B/P local offline Git plus short disconnect recovery; Quire branches intentional | K | T05,T11 |
| I42a | A GitHub import/export/manual pull-push/conflict branch | X | T16; X-GIT |
| I42b | B/E source/generated interchange and real Pandoc conversion | X | T04,T16; X-TOOLS |
| I43 | A Dropbox two-way cursor sync/archive/conflicts | X | T16; X-DROPBOX |
| I44a | A Zotero bulk/project refresh versus account collection sync | X | T16; X-REF |
| I44b | A Mendeley/ReadCube bulk read-only versus editable individual | X | T16; X-REF |
| I45a | B/A basic key/rich search and deterministic bibliography target | K | T13,T16 |
| I45b | B/A Library forms/code/DOI/upload, copy not live project sync | K | T13; X-DOI |
| I46 | A contextual Ask/Agent/TeXGPT, selected authorized context | X | T17; X-AI |
| I47 | A logged-error propose/regenerate/apply/undo/recompile | X | T17; X-AI |
| I48 | A table/equation prompt/image generation, editable source | X | T17; X-AI |
| I49a | A language operations/settings; no retired standalone tools | X | T17; X-AI |
| I49b | A retrieval-backed Citation Reviewer/provenance, no invented papers | X | T17; X-RETRIEVAL |
| I50a | B/A consent/shared atomic ledger/reset/disable | A | T17 |
| I50b | B group/cross-org deny, audit/notify/in-flight discard | A | T14,T17 |

## Services: administration/deployment

| ID | Target / explicit Quire disposition | Owner | Verification |
| --- | --- | --- | --- |
| A51a | B/P scoped entitlement transitions without destructive downgrade | A | T14 |
| A51b | B/P separate technical limits, actual Quire defaults | K | T04 |
| A52a | B organization roles/seats/export/metrics/audit paging | A | T14,T15 |
| A52b | A/P billing/invoice/seat state, configured merchant rules only | A | T19; X-BILLING |
| A52c | B organization AI/chat/Dropbox controls and audit | A | T14,T16,T17 |
| A53a | B institutional portal/verified self-enrollment/admin/metrics | A | T14 |
| A53b | B eligibility loss preserves projects/alternative login | A | T14 |
| A54a | B/A primary/secondary identities, Google/ORCID/SSO; GitHub from design | A | T01,T19; X-IDENTITY |
| A54b | B reset/alerts/session revoke/delete and managed restrictions | A | T01,T14 |
| A55a | B accepted management/restricted changes/release/reassignment | A | T14 |
| A55b | B/P configurable managed lapse/soft-delete/recovery only | A | T14 |
| A55c | A SAML linking/rotation/fallback, explicit both-signature policy | X | T19; X-IDENTITY |
| A55d | B operator search/projects/transfer/session/site/editor controls | A | T14,T21 |
| A56a | B/P consent/privacy/export/deletion; no vendor security warranties | A | T15,T20 |
| A56b | B distinguish source/history/generated/complete operator backups | K | T04,T06,T21 |
| A57a | B/P one Quire server capability registry, real adapters not vendor editions | O | T21,T22 |
| A57b | P configured support/contact scope, no invented response SLA | V | T20 |
| A58a | B Compose/Helm/config/logs/doctor/upgrade/air-gap lifecycle | O | T21,T22 |
| A58b | B consistent quiesced full backup/restore versus config/export | O | T21 |
| A59a | B restricted compile workers/images/resource controls | C | T18,T22 |
| A59b | B actual scalable profile/S3/fencing/worker replacement/logs | O | T22 |
| A60a | B owned open-in import/API, no private Overleaf service dependency | K | T04 |
| A60b | B/E browser/mobile/short-offline/Labs/URL boundaries | U | T03,T05,T20 |

## Design: all 23 screens and their operational additions

Design features that exceed/clarify the research remain build targets. Sample prices, version numbers, counts, response times and testimonials are not runtime evidence.

| ID / source stem | Operations including non-default panels | Owner | Verification |
| --- | --- | --- | --- |
| D01 `01-editor` | Four modes, real tree/source/PDF, auto/manual compile, actual warning/status/cursors, assistant/share | U | T03,T05,T07,T09,T20 |
| D02 `02-git` | Real branches/stage all/hunk/discard/commit/compile gate/push/pull/clone/tokens; unified/split/rendered diff | U + K | T11,T12,T20 |
| D03 `03-ai-agent` | Ask/Agent, run steps, context/attachments/edit policy, per-hunk/all approval, source provenance, commit accepted changes | U + X | T17,T20; X-AI |
| D04 `04-history` | File/author comparison, timeline/labels, labeled download/restore | U | T06,T20 |
| D05 `05-billing` | Configured catalog/period/change/cancel/payment/seat/usage/invoice-email/tax/invoice download, no sample charges | V + A | T19,T20; X-BILLING |
| D06 `06-editor-tools` | Search/replace filters and results, symbols/categories, key/label/remote bibliography completion | U | T03,T13,T20 |
| D07 `07-projects` | Real project table/search/workspace/ownership/archive/trash/tags, creation/import, category templates | V | T02,T13,T20 |
| D08 `08-sign-in` | Password/SSO domain chooser/Google/GitHub/ORCID and error navigation | V | T01,T19,T20; X-IDENTITY |
| D09 `09-pricing` | Config-driven plans/period/comparison/FAQ/contact/self-host CTAs; unconfigured pricing honest | V | T19,T20 |
| D10 `10-review` | Tracking, author-colored source, file/overview filters, individual/bulk decisions, threads/replies/resolve/reopen | U | T06,T20 |
| D11 `11-compile-logs` | Parsed/raw/class filters/source navigation/AI fix/output download/cache; last successful PDF on failure | U | T08,T17,T20 |
| D12 `12-admin-identity` | Real SAML/OIDC/LDAP test/save/metadata, attribute/domain/SSO/enrollment/break-glass policy, SCIM token and group-role-AI mapping | V + X | T19,T20; X-IDENTITY |
| D13 `13-pdf-diff` | Revision selectors, actual changed pages, side-by-side/overlay and downloadable diff PDF | U + C | T10,T20 |
| D14 `14-onboarding` | Create/verify email/start choice/template/import, persisted bounded flow | V | T01,T02,T20 |
| D15 `15-landing` | Working signup/template/Git/AI/org/self-host/pricing/FAQ/legal navigation; sample mockups not product evidence | V | T20 |
| D16 `16-settings` | Profile/avatar/LaTeX name/affiliation/ORCID/locales; identities/sessions/delete; dark/system/theme/bindings/font/modes/compiler/spell/viewer/autocomplete/cursors; AI model/style/retrieval/inline/branch/shared-chat/clear; GitHub/GitLab/reference grants/tokens/SSH/compile gate; channel/event notifications | V + A | T01,T03,T11,T15-T17,T19,T20 |
| D17 `17-self-hosting` | Real local docs/download bundle/Compose/Helm commands, optional provider/support inquiry, air-gap path, truthful tested hardware/version/capabilities | V + O | T20-T22; X-DEPLOY |
| D18 `18-admin-console` | Actual service health/queue/add worker/auth/backup/provider controls/update state, no synthetic replicas/counts | V + O | T08,T21,T22 |
| D19 `19-architecture` | Faithful diagram with active local/scale topology; clearly label SQLite/disk substitution and configured external systems | V | T20,T22 |
| D20 `20-share` | Focus-managed invite/roles/pending/resend/off-view-edit link/revoke/transfer/Git sharing | U | T05,T14,T20 |
| D21 `21-new-project` | Blank/template/GitHub/ZIP/generic Git clone, workspace/name/compiler/environment/seeds/branch/auth/history/sync selection | V + K | T02,T04,T11,T16,T20 |
| D22 `22-admin-operations` | Users/groups search/filter/CSV/invite/manage; worker min/max/drain/remove; environment build/default/retire/mirror; AI endpoint/model/budget/logging/citation/confidential policy; template visibility; storage/full backup/schedule/retention/restore; signed updates/schedule/auto security; redacted support bundle; audit filters/export/SIEM | V + O | T14,T18,T19,T21,T22 |
| D23 `23-reset-password` | Request/inbox/new password/strength/confirmation/success plus SSO explanation; real single-use token | V | T01,T20 |

## Cross-cutting reconciliation

These rows retain annex/security requirements without duplicating extraction prose. They also resolve design versus research differences.

| ID | Decision / requirement | Verification |
| --- | --- | --- |
| Q01 | All 60 original research sections mapped by core/services upstream; all 141 extracted IDs individually retained above | Static ID set comparison |
| Q02 | Review/PDF/source/generated/full-backup representations never conflated | T04,T06-T10,T21 |
| Q03 | Every surface authorizes reads/writes/downloads/realtime/AI/worker completion; independent role/seat/owner/org/managed dimensions | T05,T14,T17,T19 |
| Q04 | No access-request/link/quota/transfer race elevates authority; revocations affect open transports | T05,T14 |
| Q05 | Consent, protected credentials, SSRF/ZIP/path validation, federation replay rejection, sandbox resource isolation | T04,T17-T19 |
| Q06 | Source convergence and ack durability are separate from backup; event/outbox/replay and Git intent crash recovery | T05,T11,T21,T22 |
| Q07 | Git branches/SSH/GitLab/SCIM/OIDC/persistent opt-in shared AI chat/dark theme/label completion are explicit design additions, not unsupported research parity claims | T03,T11,T17,T19,T22 |
| Q08 | Short offline: buffer current file for configurable 10 minutes, disallow compile/file switch/comments/AI offline; retain recovery/export text after lock, reconnect merge/conflict preview; longer work via actual Git | T05,T11,T20 |
| Q09 | Dashboard tags private; confidential AI restriction uses separate project security label under Owner/org authority | T14,T17 |
| Q10 | No fabricated pricing, support SLA, version/replica/health/provider/citation/compile success, legal warranty or vendor institutional policy | T17,T19-T22 |
| Q11 | Responsive 1440/390 layouts, keyboard/focus/contrast/assistive-tech and PDF validation separate | T20; X-A11Y |
| Q12 | SQLite/local replaces deployment stores only in local profile; PostgreSQL/Redis/S3/Helm/fencing/scale behavior remains built/tested | T21,T22 |
| Q13 | Runtime languages/bundled dictionaries/font assets, signed release/air-gap package/optional metrics have actual provenance/configuration, not decorative claims | T03,T20-T22 |
| Q14 | Deprecated X login/password Git/standalone Writefull tools/old AI add-on packaging not implemented as current parity; unknown arbitrary RTL/retouch/PythonTeX/enterprise vendor promises not invented | T03,T11,T17,T20 |
| Q15 | Local startup on 5173, seeded multi-user example, actual backend/Git/compile with no mandatory SaaS; no committed credentials | T01,T02,T07,T11,T20 |

## Exact external prerequisite ledger

Build/test fixtures are mandatory even where live evidence is blocked. “Missing credentials” does not excuse absent code, missing native operations, canned success or unimplemented UI.

| Key | Actual external prerequisite | Without it |
| --- | --- | --- |
| X-AI | Authorized configured model endpoint, credential if required, model/modalities and processing consent | Completed gateway/proposal UI + protocol fixture tests; local app works, AI explicitly unconfigured. Local model endpoint is equally valid. |
| X-RETRIEVAL | Dimensions access contract/credential if selected; or explicitly labeled configured Crossref/arXiv/Semantic Scholar retrieval access | Fixture proves provenance/insertion; no live Dimensions claim or invented publication. |
| X-REF | User grants and developer registration/usable provider API for Zotero/Mendeley/ReadCube | Manual `.bib` and account Library remain operational; adapter test coverage and exact unconnected provider state. |
| X-DOI | Reachable chosen DOI metadata endpoint/usage permission; credential only if provider requires | Deterministic lookup fixture; ordinary bibliography editing unaffected. |
| X-GIT | GitHub/GitLab app registration/user repository grant and organization approval as required | Real local Git bridge/clone/push works; remote adapter fixtures prove flow, remote connection remains unset. |
| X-DROPBOX | Quire-owned Dropbox app and user grant to its app folder | Real sync engine tested with protocol fixture, no claim it syncs an unconnected account. |
| X-IDENTITY | Google/GitHub/ORCID registrations, institution IdP metadata/certificates or LDAP directory/TLS/bind configuration | Local password/email-sink auth and local IdP/LDAP/SCIM contract suites run; no fictitious organization login. |
| X-BILLING | Selected merchant sandbox/production credentials, webhook secret, operator prices/tax/support policy | Manual/unbilled local edition and signed fixture tests; no real charge/invoice manufactured. |
| X-PUBLISH | Destination-specific public/partner API contract and authorized recipient credential | Real prepared submission bundle/manual workflow; no “submitted” without actual receipt. |
| X-URL | Public direct-download URL reachable under safe-fetch policy | Local HTTP fixture; login landing pages fail truthfully, no invented Drive two-way sync. |
| X-TOOLS | Installation/build access for Pandoc, R/knitr, chosen Pyodide/assets, fonts, additional TeX environments | **Implementation provisioning task**, not terminal credential blocker. Build isolated profiles/bundle assets; advertise only validated profiles while installing. Native TL2025 already reported available. |
| X-A11Y | Human screen-reader review and selected external tagged-PDF validator/tool version | Automated accessible UI/tagged fixture checks still required; record the unperformed manual certification check without claiming conformance. |
| X-DEPLOY | Deployment destination/TLS/domain/S3 credentials for actual production; cluster or arm64 runner for corresponding live deployment tests; operator release signing key for distribution | Local and owned Docker profile/Helm rendering/unsigned-dev bundle still tested; label untested platform/live distribution. Do not invent public download/chart domains. |
| X-MAIL | Authorized SMTP sender/domain for external delivery | Local durable mailbox verifies all notification flows; external email not claimed sent. |

## Coverage/ownership audit

Expected extracted inventory: A01-A27 (27), P01-P30 (30), C01-C29 (29), C31/C32a-b/C33a-b/C34a-b/C35/C36a-b/C37/C38/C39a-b/C40a-b (16), I41a-b/I42a-b/I43/I44a-b/I45a-b/I46/I47/I48/I49a-b/I50a-b (16), A51a-b/A52a-c/A53a-b/A54a-b/A55a-d/A56a-b/A57a-b/A58a-b/A59a-b/A60a-b (23). Total **141 extracted + 23 design = 164 primary rows**, plus 15 cross-cutting rows.

Disjoint file ownership is defined in implementation-plan section 2; a matrix row with two owners means backend/UI cooperation through shared contracts, not shared file edits. Foundation edits shared schemas/manifests/composition; other lanes request contract deltas. Verification IDs refer to real commands/test paths to build, not existing passing tests. Completion evidence must mark each row `passed`, or `live external check blocked: <ledger key + missing artifact>` after its implementation and fixture tests pass. `not implemented` is never a completion disposition.

Architecture audit on October 26, 2026: read all three upstream reports and the decoded operational panels; extracted 86 core and 55 service IDs directly from their tables; compared against 164 primary matrix rows with **zero missing IDs and zero duplicate IDs**. All T01-T22 references resolve to the 22 declared suites. Expanded the ownership table to 44 path assignments and found **zero cross-lane overlaps**. All three TypeScript contract blocks parsed successfully with Bun.Transpiler; this is syntax validation, not application typechecking. No application implementation, builds, browser QA or integration tests were performed by this documentation assignment. The architect's empty temporary directory was removed; report/audit evidence remains in these two files and session tool output.
