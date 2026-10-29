# A52a audit ZIP independent adjudication: FINAL

October 28, 2026. Adjudicator `st_01a18084`; producer `st_01a18076`.

**FAIL for unconditional evidence-complete acceptance.** The emitted paginated
ZIP bytes pass independent checks, and the executed native isolation/ownership
negatives pass. Role-specific coverage and final raw terminal provenance remain
incomplete. These are evidence gaps, not observed authorization vulnerabilities.
Nothing is pending in this adjudication.

Requirement: `docs/discovery/services.md:73` (A52a) requires paginated audit
CSV ZIPs, reference 100 entries per file, no missing/duplicated events, and
organization access enforcement. This adjudication covers that export boundary,
not all other A52a capabilities.

Evidence and reproduction:
`docs/evidence/p14-audit-zip-verification/results.md` and
`docs/evidence/p14-audit-zip-verification/check_artifacts.py`.
The latter was executed once successfully using the existing Python kernel.
No unchanged passing application suite was rerun.

## Boundary verdicts

| Export boundary | Verdict | Evidence and exact limit |
| --- | --- | --- |
| FINAL producer handoff exists | PASS | `docs/handoffs/p14-audit-zip.md` is FINAL and records completed commands, artifacts and cleanup. |
| Actual ZIP rather than inline CSV/renamed text | PASS | Independently opened all four retained ZIPs with Python zipfile; PK signature, central-directory names, decompression and CRC pass. |
| Maximum 100 audit entries per CSV | PASS | Final and earlier organization pages 100/1; operator pages 100/2. Headers excluded by CSV parser, including embedded newlines. |
| Zero-entry useful export | PASS | Actual completed native 0-entry case verifies header-only audit-0001.csv, metadata and native download. No retained zero-entry archive was independently unpacked. |
| Exactly 100 entries creates no extra empty page | PASS | Actual completed native exact-100 case verifies one file and complete expected bytes. No retained exact-100 archive was independently unpacked. |
| Headers, deterministic names, seven-column records | PASS | Every independently parsed CSV has the same header and seven fields; ordered audit-0001.csv/audit-0002.csv names. |
| Ordering, completeness, uniqueness across page boundary | PASS | Both retained packets have consecutive sequences 1..101/1..102, unique targets and 101 fixture records. Completed native 101-entry case also compares complete decompressed bytes with insertion expectations. |
| Snapshot excludes its own export event | PASS | Organization 101 rows; operator prefix equals that complete snapshot and has one additional audit.exported receipt with rows=101. Export source records its audit event afterward under the same transaction. |
| Redaction, formulas, quotes, commas, Unicode, multiline | PASS | Independent parsed values retain exact visible text and redacted token; formula event is apostrophe-prefixed; original secret absent. Completed native fixtures also exercise whitespace-prefixed formulas, CRLF and foreign-secret exclusion. |
| Native ZIP MIME, attachment name and actor-owned operation | PASS | Completed native HTTP checks require application/zip and attachment audit.zip; ownership is persisted. Existing download/result guards inspected. |
| Organization admin success, organization isolation, outsider denial | PASS | Executed native admin export, foreign-organization row exclusion, other-organization 403, outsider 403; actual organization browser ZIP independently checked. |
| Organization Member and Manager export denial | FAIL | Executed negative actor Sam is not an organization member. Seed inserts only Kien/admin. Rank guard is correct in source, but no submitted native Member/Manager export negative executes it. |
| Installation operator can use organization export override | FAIL | Source authorizes this override. Executed operator success covers installation export, not the organization endpoint. No submitted executed positive establishes this distinct claim. |
| Installation-only export and result/download reauthorization | PASS | Native nonoperator creation denial and demoted-owner result/download 403 execute real transports. |
| Cross-actor privacy, including another installation operator | PASS | Executed 404 for both result and download by outsider and separate operator; unauthenticated download 404. |
| Authentication, CSRF and idempotent replay | PASS | Executed organization export 401/403 and same-key replay equality in the completed native suite. |
| Inclusive operator time range and invalid interval | PASS | Executed equal from/to selects one of two timestamps; inverted range returns 400. |
| Exclusion of a nonmatching operator event | FAIL | Both inserted candidate rows have event audit.fixture. Parameter is sent, but exclusion is not discriminated. Correct SQL predicate is source-only proof for this negative. |
| Both browser ZIP consumers and final visual evidence | PASS | Four saved browser downloads independently parse; both consumer sources inspected; every submitted screenshot opened. All eight final captures show ZIP controls/success without observed overlap or horizontal clipping. Recorded final browser receipt says 1 pass/235 assertions, exit 0. Raw receipt limitation is separately failed below. |
| Source/artifact identity | PASS | Independently recomputed all 9 source/config and 10 final ZIP/PNG manifest hashes; all match. Earlier ZIP hashes also recorded independently. |
| Independently recoverable final browser/static terminal receipts | FAIL | Native terminal output and an earlier static completion are independently readable. Final bash_13/bash_14 summaries say completed exit 0, but original final image-bearing transcript record exceeds the read tool's per-line limit and producer-local terminal handles are unavailable here. Summaries are not promoted to independently inspected raw completion receipts. |
| Exact cleanup and resource ownership | PASS | All seven exact roots absent; all six recorded ports nonlistening; no owned browser/test/Vite process. Read-only cleanup command completed exit 0. FastShort 5173 remained untouched. |

## Required evidence before unconditional PASS

Provide bounded original final `bash_13` and `bash_14` completion output, not
another running-status claim. Supply executed native export denial evidence
with actual organization Member and Manager actors; an operator-on-organization
export success; and a nonmatching-event exclusion fixture. These are uncovered
cases, not a request to rerun unchanged passing suites. No production or test
changes were made by this adjudicator.

Organization post-export membership revocation is not rechecked: downloads
retain the existing actor-owned snapshot semantics. This is explicitly disclosed
by the producer, not accepted as a tested new revocation policy. Pending
organization invitations, invitation/account-creation parity, membership CSV,
other-browser/touch-device coverage, installation QA and full-product acceptance
are outside this ZIP verdict. In particular, the passing operator account-setup
test is not evidence of pending organization invitation parity.
