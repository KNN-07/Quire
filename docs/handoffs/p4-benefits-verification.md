# P4 owner-benefits independent verification - PASS (scoped phase)

October 27, 2026 UTC / October 28, 2026 +07:00. Verifier `st_01a17e3c`.

**Scoped behavioral verification: PASS. Recorded visual artifact: PASS.
Deterministic Share read-order gate: PASS.
Combined owner-benefits P4: PASS within this phase's documented scope.** Both FINAL handoffs were read;
all design invariants below have observed evidence or an explicit failure.
The unchanged independent session attacks now pass: revoked owner returns 401,
expired operator returns 403, and both persisted records remain unchanged.
The current mounted mobile stale-write/reload scenario also passes.
The accepted 84-frame packet closes the restricted-state visual mismatch:
`limited-share-1440-light.png` now shows `1 writable place` and a consistent
60-second/one-collaborator benefits summary. The later forced old-response-last
probe reproduces removal of Selection required on actual standalone 1920/light
Share. A current read-generation guard fixes that demonstrated mechanism;
the same probe and both existing controls cases pass. This closes the scoped
transition gate. The historical single timeout remains failed and unattributed:
its actual response ordering was not recorded, and certainty about its past
cause or universal transition reliability is not claimed.

The earlier repeated 12-failure note was stale coordination, not a new run.
It is not a gate. Existing receipts remain 376 combined passes with two fixture
timeouts resolved by 13/13, the full original 28 classification and final real
PostgreSQL proof. Controls FINAL supplies completed 4/4/84 and native 8/8/35
receipts, but explicitly discloses later expanded-matrix failures and mixed-age
captures. These are not relabeled as a same-revision all-green aggregate.

Evidence: `docs/evidence/p4-benefits-verification/audit.md` and
`observed.sha256`; exact focused results are in `final-runs.md`, and the
per-item visual ledger is in `visual-review.md`. All commands used the shared repository read-only except
these report/evidence files. Project-local Bun is 1.4.4.

The accepted artifact evidence-only review is
`docs/evidence/p4-benefits-verification/consistent-visual-review.md`. At that
review all 84 PNG and 14 source/test hashes matched, as did the 13 production
inputs compared with the preceding
packet; the driver hash is explicitly post-run. Of the latest images, 65 match
previously inspected originals byte-for-byte; all 19 changed originals were
directly opened. No behavioral, matrix, backend, static or session-fence rerun
was made. `current-visual-review.md` retains the preceding packet's visual FAIL.

Final read-order disposition:
`docs/evidence/p4-benefits-verification/read-order-disposition.md`. The current
Share/fixture/probe hashes match the scoped correction manifest. All four
red/green probe screenshots were independently opened; no test was rerun.
The 84-image artifact remains scoped to its prior input, supplemented by the
nonvisual Share guard's exact-surface proof rather than relabeled current.

## Findings and resolution

1. **RESOLVED - revoked owner session committed selection.** With the real identity
   mutation verifier completed, revoke that exact session under accounts lock
   before the route transaction. PUT writable-members still returns 200,
   changes null selection to `[]` and increments project version 0 to 1 while
   the session row is absent. Boundary:
   `services/core/base/access-routes.ts` owner-selection transaction. Parent
   added transaction-bound session/expiry/active-actor checks. The unchanged
   attack now returns 401 and retains null selection/version 0.
2. **RESOLVED - expired operator session committed grant.** After actual mutation
   verification, expire the same session under accounts lock. Benefit PUT still
   returns 200, changes baseline values and increments version 0 to 1.
   Boundary: `services/accounts/governance/project-benefits.ts` admission;
   `fresh` checked creation-time freshness only. Parent added transaction-bound
   operator/session/expiry/active-actor checks. The unchanged attack now returns
   403 and retains the original baseline/version 0.
3. **HISTORICAL FAIL - complete same-revision visual certification was unavailable.**
   Final manifests match 7 controls source files and all 114 PNGs. All 81
   original frames were independently viewed through 21 contact sheets and
   all 12 before/after pairs were opened. Some retained dark/desktop frames
   still contain the older long selector label and excluded Viewer candidate;
   later light/mobile frames match current compact copy. The producer
   explicitly discloses this mixed-age boundary. A content hash proves identity,
   not that a frame renders the current source. No complete current-build visual
   PASS was issued for that packet. This was an evidence failure, not a claim
   that the corrected current compact layout was broken. The new packet below
   supersedes this freshness boundary without relabeling the historical PNGs.
4. **HISTORICAL VISUAL FAIL - one restricted-state capture was internally inconsistent.**
   In `docs/evidence/p4-benefits-current/162904f6-8c6e-412e-8087-f0dbcc2c1fa7/limited-share-1440-light.png`,
   capacity reads `0 effective` and `1 writable place`, with both candidates
   effectively Viewer, while Current project benefits still reads
   `180 seconds` and `Unlimited`. Corresponding dark/1920 and later selected
   frames show the committed `60 seconds` and `1` correctly. The driver's
   restricted-state barrier waits for the warning, not both summaries to
   converge. This establishes an inconsistent fresh capture, not lasting
   stale UI or failed backend authorization. A focused replacement after an
   observable current-summary barrier was needed. The new `9cdb37d5-...`
   packet supplies a consistent replacement and receives artifact PASS.
   The original failing frame and review remain retained.
5. **DISPOSED FOR SCOPED P4 - historical timeout remains unattributed.**
   `mon_Z5ZHSVDTA5KGZ2S8`, packet `5703f743-732f-4a7e-a51a-ab6d3e77f72e`,
   failed after 145.59 seconds at 1920/light waiting for Selection required,
   before the added summary barriers. The subsequent diagnostic run passed;
   failure-only diagnostics did not fire. That pass alone did not justify
   closure. The later actual old-response-last probe fails before the Share
   generation guard and passes after it, retaining restricted state on the
   exact surface. Its 3-case/39-assertion positive controls and current matching
   fingerprints establish the scoped correction. Historical attribution remains
   uncertain; see `read-order-disposition.md`. No failed receipt is erased.

`session-before-fix.md` retains exact original failures. `final-runs.md` retains
the focused post-correction 2 pass/4 assertions/1.17 seconds and the current
browser 1 pass/6 assertions/52.33 seconds, both exit 0. The two earlier browser
fixture failures are disclosed separately, not counted as production defects.
No broad producer suite was repeated.

The controls handoff's presumed missing shell-refresh section is superseded by
the actual `docs/handoffs/p4-shell-authority.md`: real Editor/operator browser
quota zero/unlimited acceptance passed with Share never opened, controls
disabled/re-enabled and the same source node retained. Parent scoped lint and
full TypeScript exited 0. No shell patch or duplicate stream is demanded by
this phase. The separately reported replay-traffic concern belongs to the
editor verifier and is not asserted here without repeated-request evidence.

## Evidence interpretation

The table's PASS means the named invariant has observed scoped evidence; it
does not waive a concrete failing session fence. A static code path is
distinguished from an executed race. New cases started only after both FINAL
handoffs existed. No unchanged passing suite was rerun. No nested agent was
used; parent explicitly designated this child as the single independent gate.

Receipt names below abbreviate paths under
`docs/evidence/p4-benefits-backend/`:
N = `native-rerun.log`; C = `native-fixture-corrections.log`;
P = `postgres-final.log`. All 53 entries in `inputs.sha256` independently
matched at final-packet admission, including 29 production files and 24 tests.
The controls 7-source and 114-PNG checks also all matched. Parent's subsequent
two-file session fixes have a focused superseding receipt and fingerprints;
the historical manifests are not silently rewritten to imply an unchanged
whole repository. The fresh visual packet adds a separately verified 14-input
manifest including the Git status and review/PDF corrections. Their FINAL
handoffs record passing scoped tests, lint and root TypeScript; these are
reused receipts, not a new global run by this verifier.

## Invariant and original-source ledger

| Invariant / original source IDs | Verdict | Observed evidence and boundary |
| --- | --- | --- |
| Exactly four grant fields; no plan-name, AI, connector or technical-limit fields; A51a/A51b, C40a | PASS | Current `identity/project-benefits.ts` projects exactly compileSeconds, writableMembers, historyDays, trackChanges. `ProjectBenefitsSchema` is consumed separately from policy; the backend contract receipt records the exact DTO. |
| Baseline 180/unlimited/full/tracking, not invented hosted values; A51a and core commercial-policy table | PASS | Current `project-benefits-migration.ts` seeds deployment/local with the exact stable JSON/version 0/epoch tuple. N:19-20 passes existing-digest and accepted-baseline reopen tests. |
| Append-only migration, old SQL digests/receipts/roles/policies preserved | PASS | N:19-20, N:139-140, N:622 report passing digest/reopen assertions; P verifies benefit migration digest `18928a8f...37c511`, old roles and unchanged ledger across restart. Read migration test retains both original account SQL digests; inspected git deltas do not alter old SQLite SQL. This reuses receipts rather than claiming a new exhaustive historical PostgreSQL baseline comparison. |
| Durable grants, null withdrawal counters, stale resurrection denial | PASS | N:281-284 and P: optional grants move to null/version 2; stale version 1 PUT fails; restart retains tombstone and membership selection. |
| Actual SQLite plus PostgreSQL business behavior, not SQL parsing | PASS | N uses native SQLite fixtures. P exits 0 with two standalone PostgreSQL business scripts and 15 review/export/event cases/83 assertions. PostgreSQL runtime dialect is asserted in the inspected script. |
| Only active licensed mapped organization sponsorship confers a grant; unlicensed admins/unmapped/personal rows do not; A52a/A52b | PASS | Current `ownerBenefits` joins existing licensed membership to active billing and exact provider:plan key. N:323,384 proves maximum/OR sponsorship aggregation and excluded contributions; P checks unlicensed actor gets baseline. |
| Signed activation, existing external projects, scheduled cancellation, receipt and seat rollback; A51a/A52b | PASS | N:207 and surrounding billing flows report controlled signed mapped sponsorship and unchanged duplicate/reorder/seat fences. `active` with no renewal remains active; P cancels one contribution and observes explicit user fallback on both existing projects. No live merchant contacted. |
| Actor/user/federation/global/project/workspace/actor-organization restrictions remain deny-wins; C33b/C40a/I50b | PASS | Read `identity/policy.ts` selects actor and federation rows separately, meets owner grants with explicit restrictions, and retains actor consent. N:373-384 covers each ceiling, simultaneous actor/federation and owner-restriction separation. Collaborator grants cannot upgrade someone else's project. |
| Operator-only, fresh session, CSRF, current operator, expectedVersion | PASS | N:281-284 covers ordinary admin denial, key/reference/deployment validation, freshness, CSRF and optimistic tombstone writes. Corrected `admit` joins current session, expiry and active operator under accounts lock before existing creation-time freshness. |
| Current session invalidation at the final fence under an interleaved revoke/expiry | PASS after correction | Preserved native attacks first observed unauthorized 200 writes, then ran unchanged against the verified parent fix: owner 401/operator 403, unchanged selection/grant/version. `final-runs.md`; two tests/four assertions, exit 0. No newly executed PostgreSQL race claim. |
| Owner-only selection; actual membership IDs; owner/Viewer excluded; C32a/C32b/C34a | PASS | Current `access-routes.ts` reauthorizes share under account lock, checks project version, duplicates/candidate membership/capacity/sharing, then records access event. N:633-640 proves invalid IDs and effective-Editor denial. Owner inventory remains absent from ordinary projectAccess. |
| Fail-closed automatic/explicit overflow, no arbitrary winner; C32b/C39a | PASS | Current shared resolver makes all overfull candidates ineffective; N:633-640 proves suspension, fitting automatic restoration, persistent explicit subsets, oversized selection suspension and stale deleted/recreated membership isolation. |
| Assigned roles and versions/history/proposals are preserved on downgrade; C32b/C35/C37/C38/A51a | PASS | N writable-capacity cases retain assigned rows; P compares exact original member IDs/roles/versions after selection and restart. P tracking-withdrawal case retains old proposals; no destructive demotion/purge is introduced by the resolver. |
| Actor-specific seat restrictions demote only that actor; owner remains owner | PASS | N:381 and N benefit-admission cases prove shared capacity excludes owner personal restrictions and a local actor ceiling affects only that actor. Resolver handles owner before capacity. |
| Reviewer+Editor count, link Editors count, no Reviewer link; invitations reserve nothing; same-seat conversion and concurrent last seat | PASS | N:634,637 and N:677-683 cover conversion, last-seat race, link counts, pending invitations, admission appending actual membership ID and overfull denial. C passes the corrected invitation transfer-sharing case. C33 link-counting is an explicit elected design decision, not inferred vendor parity. |
| Effective Viewers retain reads but cannot protected writes/compile/review/restore; selected Reviewer comments with tracking off; C34a/C35 | PASS | N writable-capacity and review enforcement receipts; P proves selected Reviewer commenting with tracking disabled and new proposals rejected while existing suggestions remain. Authorization derives capabilities from effective roles. |
| Transfer recomputes recipient benefits and clears finite selection; former-owner Editor retained; C39a/P03 | PASS | N:613-617, C transfer cases and P role preservation. C proves the stale competing transfer case after deterministic fixture correction; do not count its earlier timeout as green. |
| Transactional transfer rechecks recipient/sharing/managed restrictions and sends owner notifications | PASS | N:614-617/C cover suspend, removal, sharing and managed changes under account fence; backend receipt describes committed project invalidation and both-owner notifications. No broader global integration acceptance is inferred. |
| Release clears only sponsor license; delete/terminal reassignment before revocation; C40b/A53b/A55a/A55b/A55d/P04 | PASS | N:244-247,255 proves lifecycle/reassignment and non-destructive release with independent grants. Grant derivation does not equate management role with license ownership. |
| Project-scoped committed policy/access invalidation and already-open transport write denial | PASS | P owner-benefits-events case and N:420 prove open SSE/WS seat-loss invalidation and next socket write denial. Read `publishPolicyChange` enumerates owned, external and collaborator projects; event resourceId and aggregateId are project IDs. Sequence cursor is used by the read UI event consumer. |
| Current assembled controls refetch, stop mutation, select Reviewer/Editor, and recover stale drafts | PASS | Controls FINAL 4/84 and later corrected-input 3/39 cover event downgrade, membership-ID selection, Reviewer comment/proposal distinction, retained review/history, selected Editor writes and stale/reload handling. Separate finalized controller/shell/recovery 3/23 receipt verifies queued authority refresh with Share closed and genuine document recovery. Independent earlier STALE_VERSION browser proof remains retained. |
| Accounts-before-compiler lock; post-preparation current budget; local/remote queue before cache and attempts; running budget retained | PASS | N:108-113 and P compiler PASS prove immutable-preparation reread, local/remote unselection/transfer cancellation without new attempts, current claim budget and retained running budget. Existing worker/deployment ceilings and callback fences remain in the scoped receipt. |
| Shared historical age+label gate, no review-registration dependency; source/compare/restore/compile/diff/download checks; C37/C38 | PASS | P labeled history and export/review cases; N owner-history cases prove compiler-only foundation predicate, both actual diff source jobs, queued history recheck and final byte-access checks. Restore expiry/replay/revoked-actor cases pass; history is accessibility, not purge. |
| Export provenance/current revision exception/legacy bytes remain fenced | PASS | P has eight source-export cases: explicit history never treated current; moved branch revokes current exception; labeled old bytes allowed; anonymous policy independent; finite history denies legacy; publication/download recheck after byte preparation. |
| Personal AI allowance/consent and connectors never transfer; I43/I44a/I44b/I45a/I50a/I50b | PASS | Read personal-benefits test asserts unchanged encrypted Dropbox grant, no provider calls on denial, retained reference bytes and old owner's refresh credential, unchanged actor AI ledger with exhausted allowance. N:357-359 and N:382 pass. This does not establish commercial personal-premium connector eligibility. |
| Independent technical file/upload/material limits; A51b | PASS | Grant representation has no technical-limit fields and current policy projection only overwrites four elected fields. Unchanged technical controls are not recertified as vendor numerical parity. |
| Fresh desktop/mobile themes, scroll ownership, before/after and behavioral evidence | Recorded artifact PASS; scoped supplement PASS | Historical 81 originals/21 contact sheets/12 pairs and `162904f6-...` visual FAIL retained. UUID `9cdb37d5-9c95-4fd6-ba8f-1e0c442c8b5b`: all 98 hashes matched at review; 13 production inputs unchanged then, test hash post-run. Full 390/1440/1920 light/dark matrix: 65 byte-identical prior inspected originals plus 19 changed originals opened. Only Share now differs among those production entries; its nonvisual guard is supplemented by exact post-fix screenshots and 3/39 proof, not a relabeled full matrix. |
| Reordered access reads cannot replace newer restricted capacity | PASS; historical timeout unattributed | Exact standalone 1920/light forced real-old-response-last regression fails before Share generation guard and passes after it; actual 3-case/39-assertion controls receipt retained. All four red/green originals independently opened; green before/after images are byte-identical. Current production/test fingerprints match. This is a scoped deterministic correction, not proof of the old timeout's certain cause or universal timing reliability. |
| Scoped static/native acceptance and accurately bounded aggregate claim | PASS with explained global errors | Historical 376+13 corrected receipts remain valid for recorded inputs; no all-green aggregate invented. Independent session/browser and parent correction 18-case receipts retained. Latest Share/controls 3/39 passes; initial chained lint failure was corrected and later scoped lint passes. Current recorded root TypeScript fails only on four unrelated installation-fixture errors; earlier three prepared-runtime errors remain historical. No current global green claim. |

## Configuration and deliberately unresolved contracts

Finite deployment values and mappings must be deliberately configured. The
shipped baseline is 180 seconds, unlimited writable memberships/full history
and tracking enabled. A lower explicit organization/user/federation restriction
still caps any stronger grant. Unmapped active plans grant nothing beyond
independent contributions. There is no inferred personal checkout or paid
connector contract.

The accepted design deliberately leaves C40a prospective sharing semantics,
Git personal-versus-owner premium wording, complete personal connector
licensing and vendor numeric parity unresolved. They remain unresolved here.
Core A17-A20's manual bibliography/copy-versus-refresh distinctions are not
replaced by project-owner grants. No live providers, production databases,
commercial credentials or entitlement assumptions were used.

## Final combined P4 verdict and evidence boundary

Complete: full design and actual FINAL handoff reads; source-ID cross-check;
scoped receipt/source review; backend 53-input and controls 7-source/114-PNG
checks; all original-frame and before/after inspection; original session
failures preserved; verified parent corrections read and fingerprinted; focused
unchanged attacks pass; current browser stale recovery passes with two fresh
inspected mobile screenshots. Original `observed.sha256` entries matched at
the earlier review boundary; later report revisions do not rewrite that
historical manifest. The accepted capture/source manifests independently matched
all 98 entries at artifact review. The preceding inconsistent visual packet remains FAIL.
The latest packet's 84 images are covered by 65 byte-identical reused inspections
and 19 directly opened changed originals. Current-source freshness, complete
requested matrix coverage and latest visual artifact consistency pass.

All independent commands settled and awaited fixture disposal. Both one-shot
handoff watches are absent on cleanup. No producer source was edited, nested
agent spawned, live provider contacted or shared resource removed.

Scoped behavioral and recorded visual artifact verdicts are PASS. The later
deterministic native-response ordering proof, verified production guard and
positive controls supply the missing transition disposition; combined
owner-benefits P4 is PASS at this phase scope. The historical single timeout
remains failed/unattributed. The older passing retry alone is still insufficient
and is not the reason for closure.

Only Share differs among the accepted artifact's 13 production entries; its
read-generation guard changes no markup/CSS/copy. Exact post-fix screenshot and
test receipts supplement the prior visual input. Current scoped lint passed;
root TypeScript remains non-green only on four separately owned installation
fixture errors, documented without suppression. No global green build is
claimed. All old failures and captures remain intact; no suite, PostgreSQL,
static, session or matrix rerun was made for this review, and this reviewer
changed no production source.

This report neither completes nor replaces the parent's separate
product/global-integration gate.
