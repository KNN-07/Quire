# P3 account integration verification

Status: FINAL, independent **PASS for the bounded account integration gate**.
Verifier: `st_01a17d2c`. Date: October 27, 2026.
No unresolved account UI defect was found in the final evidence packet.
This is not live-vendor or whole-current-worktree deployment acceptance.

## Accepted evidence and ownership

**Producer execution:** `bun run test tests/ui-integrations`, project-local
Bun 1.4.4, six passing tests, zero failures, 163 assertions, 102.97 seconds,
exit 0 as recorded by the FINAL handoff and user-delivered receipt.
The verifier read the complete terminal log, current tests and real provider
fixtures, and independently matched the log's SHA-256:
`749b05c0a723c2ade5e847ec30f4a8b0f6f4c637156deb4379f138d61e430940`.
The passing selection was not rerun.

Packet: `tests/ui-integrations/evidence/project-local-1.4.4-acceptance-b/`.
All 26 current full-page frames, four before/after pairs and four diff JSON
reports were independently inspected. The complete per-file verdicts are in
`docs/evidence/p3-connections-verification/final-capture-review.md`.
Its capture inventory and static receipt hashes match the FINAL handoff.
The producer's static receipt explicitly records types/lint/guard exits 0.

**Independent execution:** the verifier previously drove the actual
`connectionApplication` aggregate fixture using an owned Chromium profile,
OmOWright and real authenticated HTTP. Its final run exited 0 in 51.878 seconds,
with 28 captures, actual 390x844/DPR-3 mobile and 1440x900/DPR-1 desktop,
both themes. No response was replaced and no ready grant was inserted by SQL.
That fixture used Bun 1.4.3, not the later project-local 1.4.4 acceptance runtime;
these two receipts are deliberately not conflated.
All five account UI hashes from that independent run still match current
source exactly. Its proof remains in:

- `docs/evidence/p3-connections-verification/browser-final-css.log`
- `docs/evidence/p3-connections-verification/final/browser-results.json`
- `docs/evidence/p3-connections-verification/final/*.png`
- `docs/evidence/p3-connections-verification/final-verified-ui-fingerprint.log`

The verifier independently reran current scoped strict TypeScript and
type-aware lint once after discovering changed shared inputs. Both exited 0:
`docs/evidence/p3-connections-verification/final-current-static.log`.
No producer browser or adapter selection was repeated during final review.

## Requirement verdicts

| Requirement | Verdict | Concrete proof |
| --- | --- | --- |
| Required upstream reports are complete | PASS | Read FINAL `p3-connections.md`, completed `p2x-http-admission.md` and `p2x-generic-credentials.md`; code contracts agree. |
| Final native account command | PASS, producer | Hashed final packet: six tests, 163 assertions, no failures; actual generic test returns 200. |
| Missing configuration is truthful | PASS, independent + producer | Six provider states/reasons read from real availability HTTP; all admission controls disabled without configuration, in four width/theme cases. |
| No invented readiness | PASS | Configured fixtures use real administrator HTTP; saved rows come from actual grants. GitLab/Mendeley remain unavailable without their real requirements. |
| Zotero secret handling | PASS, independent + producer | Password/new-password field, upstream key validation, clear before reload, no DOM/storage/input/list echo; final producer also checks admission response secrecy and missing-CSRF denial. |
| Generic Git fields and secret handling | PASS | Four distinct fields; independent masked-field and cancellation/reopen clearing checks; final producer verifies successful admission clears the secret and survives reload. |
| Genuine account reload | PASS, independent + producer | Fresh navigation reads real saved grants; final producer also reloads the actual repository-bound generic grant. No illustrative saved count. |
| Connection ownership denial | PASS, independent | Outsider list is empty; test, cursor and delete each return 404 `GRANT_NOT_FOUND` in all four cases; owner's real grant remains ready. |
| Scoped policy authority | PASS, producer | Real project/organization choices, organization deny-wins after reload, stale-write 409, missing-CSRF 403, foreign project/organization 403. |
| Durable Dropbox operations | PASS, producer | Actual loopback provider files become nonempty; completed operation reloads; real competing writer causes cursor 409 with no extra provider call; explicit retry succeeds. |
| Project disconnect is not account revocation | PASS | Producer verifies project disconnect succeeds while the account Dropbox grant remains testable; source and rendered text distinguish them. |
| Generic removal does not invent revocation | PASS | Confirmation says local forgetting; actual encrypted secret becomes null/disabled while the independent upstream token remains valid. |
| OAuth revocation really occurs | PASS, producer audited independently | Subsequent GitHub disconnect requires HTTP 204; unchanged strict provider JSON parser removes the issued token, and the passing test verifies it is gone. |
| Layout and geometry | PASS, independent review | Every final image inspected; document-only scrolling and no horizontal overflow are exercised. Independent probes report zero overlapping connection controls. |
| Mobile saved-label regression | PASS | Final four mobile form/sync matrices show labels on their own rows; independent probe measures 316px identity in a 316px row, `flex-basis: 100%`. |
| Existing account content retained | PASS | All four before/after pairs retain Git tokens, SSH-key inputs, compile-before-commit preference and Save changes. |
| Current scoped strict/lint | PASS, independent | TypeScript and type-aware oxlint exits 0 on changed current imports; no suppression or test weakening. |
| Cleanup and write boundary | PASS | Actual fixture/browser disposal receipts, exact producer/independent roots absent, no owned application/browser process remaining; verifier wrote only its report/evidence paths. |

## Transport correction and controlled provider state

`services/adapters/shared/http.ts:27` now derives `content-length` from
`Buffer.byteLength` whenever a body is supplied, including DELETE. The new
real UTF-8/binary regressions in `tests/adapters/shared/http.test.ts` assert
the exact received bytes and encoded length. The parent-reported 33-test
HTTP/remote-Git receipt was not relabeled as a new verifier execution.

The decisive final account proof is stronger than a success label:
`tests/ui-integrations/connections.test.ts` verifies local generic forgetting
leaves the issued token valid, then separate OAuth disconnect removes it.
`tests/adapters/remote-git/provider-fixture.ts` still uses strict
`request.json()` validation for that DELETE and mutates its real token set.
`services/adapters/remote-git/github-client.ts:76` sends the token body and
requires 204. Generic Git instead declares `revoke: "local"`.
No parser fallback, swallowed body error, synthetic grant, or fabricated ready
state was found.

Dropbox capture setup restores only a previously returned operation ID and
scope choice into browser storage. The operation itself, provider file writes,
deny-wins decisions and competing cursor writer are real service operations;
the harness holds then continues a request rather than fulfilling a fake reply.

## Source identity and bounded scope

`producer-final-audit.log` independently verifies the published binary, log,
manifest and inventory hashes. Comparing the packet's 565-entry before/after
manifests finds only `services/operations/backups/restore.ts` changed during
the producer run.

The later current-tree check returns `MANIFEST_CHECK_EXIT=1`: 22 entries have
changed since that snapshot. Those failures are retained, not hidden. The five
account UI files and final shared HTTP correction still match; the current
aggregate factory was inspected and current scoped type/lint checks pass.
This gate accepts the final account packet plus unchanged account UI and the
listed independent checks. It does not certify all subsequent editor,
repository, compiler, storage, benefit-policy or backup work as a composed
deployment.

The four diff reports have intact alpha but different page heights because
required provider and policy content was added. Their 87-91 similarity scores
are not treated as pixel-perfect approval. Each pair was visually inspected,
and the existing required fields remain present.

## History, limitations and cleanup

Earlier missing-FINAL, native EBADF, empty-500, teardown and DELETE-body
failures remain in the producer history and
`docs/evidence/p3-connections-verification/upstream-receipts.md`.
They are superseded by the verified project-local 1.4.4 acceptance packet,
not erased or attributed to a universal Bun root cause. Earlier verifier
capture-tool mistakes and the pre-fix mobile label defect are likewise retained;
only final-build captures approve the corrected layout.

No live external credentials were supplied or external provider writes made.
Controlled positive workflows cover the owned GitHub/Git, Zotero and Dropbox
protocol fixtures. Actual vendor OAuth registration, consent, organization/app
approval, deployed callbacks, real key permissions and live account revocation
remain untested. GitLab/Mendeley live positive acceptance is not claimed.

All three final producer roots have `CONNECTIONS_CLEANED` receipts and are
independently absent. Every verifier fixture/profile was disposed or, for its
initial stalled checkpoint, explicitly tree-killed and its exact root removed.
The final independent browser and service fixture each exited 0 and recorded
cleanup. Monitors were closed. No commits, producer edits, nested tasks,
credentials in evidence, or outstanding owned resources remain.

Must fix within this bounded account gate: **none**.
