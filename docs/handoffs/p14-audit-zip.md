# A52a paginated audit CSV ZIP: FINAL

October 28, 2026. Producer: `st_01a18076`.

**PASS for real paginated audit ZIP export and both existing browser consumers.**
The scoped native, browser, strict TypeScript and type-aware deny-warning lint
gates completed exit 0. Cleanup is proven. This handoff was written last, after
implementation, verification, screenshot inspection, cleanup and hash receipts.

## Delivered behavior

`services/accounts/governance/reports.ts` reads the authorized audit stream
in monotonic sequence pages of at most 100 entries within the existing locked
transaction. It creates `audit-0001.csv`, `audit-0002.csv`, and so on with the
same seven-column header in every file. Exactly 100 entries produce one CSV;
101 produce two; zero produce a useful header-only first CSV. The export's
own audit event is recorded afterward and is not included in its snapshot.

CSV serialization and sensitive detail-key redaction are preserved. Existing
`fflate.zipSync`, already used by project archives and compiler bundles,
creates an actual ZIP. Its blob is referenced in the transaction through the
existing runtime helper. The actor-owned succeeded operation stores existing
download metadata (`blob`, `projectIds`, `mime`, `filename`, `operatorOnly`)
plus `format: "zip"`, `rows`, and `files`. It does not inline CSV under a ZIP
filename or create a new endpoint.

The existing native `/api/operations/:id/download` transport returns the
actual bytes as `application/zip` with `attachment; filename="audit.zip"`.
Organization export still requires admin/operator authority and selects only
that organization. Installation-wide export remains operator-only and
preserves the event/time filters; its result and download also recheck operator
authority. Operation results/downloads remain owned by their requesting actor:
even another installation operator cannot retrieve them.

`apps/web/src/features/account/organizations/reports.tsx` displays
**Export audit ZIP** and a succeeded **Download audit ZIP** link to the existing
native download URL. `apps/web/src/features/admin/Audit.tsx` displays
**Export ZIP**, fetches bytes through the existing typed download endpoint,
then downloads `audit.zip`. The membership export remains CSV.

No route, contract, migration, dependency, installation, root package or
commit was added. Pending organization invitations remain parent-owned.
Unrelated existing workspace edits were preserved.

## Verification receipts

| Gate | Final terminal | Result |
| --- | --- | --- |
| Required native command: `./node_modules/.bin/bun test tests/accounts/governance/audit-zip.test.ts tests/accounts/governance/audit-admin.test.ts` | `bash_10` | Exit 0; 10 pass, 0 fail, 100 assertions; 9.00 seconds |
| Account strict TypeScript: `./node_modules/.bin/tsc --noEmit -p tests/accounts/tsconfig.json` | `bash_11` | Exit 0; existing account config includes runtime asset declarations |
| Consumer/browser strict TypeScript: `./node_modules/.bin/tsc --noEmit -p tests/ui-product/account/audit-zip/tsconfig.json` | `bash_14` | Exit 0 on final capture source; extends the existing organization account configuration with asset declarations |
| Touched-source `oxlint --type-aware --deny-warnings` | `bash_14` | Exit 0 for all seven changed TypeScript/TSX files |
| Real browser command: `./node_modules/.bin/bun test tests/ui-product/account/audit-zip/browser.test.ts` | `bash_13` | Exit 0; 1 pass, 0 fail, 235 assertions; 48.98 seconds |
| Scoped whitespace and source/artifact hash verification | Final shell inspections | Exit 0; 9 source/config and 10 final ZIP/PNG hashes match |

The new native cases check 0/100/101 records with complete decompressed CSV
byte equality: ordering, headers, formula escaping, quoting, multiline values,
Unicode, redaction, no omission or duplication, and organization isolation.
They cover native unauthenticated/missing-CSRF/unauthorized requests,
cross-actor result/download denial, idempotent replay, operator filters,
invalid intervals, and demoted-operator result/download denial.

The focused browser case uses the actual application, persisted SQLite audit
rows, real signed-in Chromium contexts and native HTTP. It subscribes to export
responses and downloads before clicking. Both downloaded ZIPs are saved and
unpacked, with magic bytes, CSV page counts, headers, every target exactly once,
escaping and redaction asserted. The organization ZIP contains 100/1 entries.
The operator ZIP contains 100/2 because the organization export itself adds an
audit event. Its native byte response is consumed by the actual admin client.
No successful-response mocks or sleeps are used.

Earlier failures and their corrected root causes are retained in
`docs/evidence/p14-audit-zip/verification.md`; no assertion was weakened to
turn a real export failure green. The unchanged organization account/role
workflows were not rerun. The older organization browser test was updated only
where its inline-CSV expectation became stale; the new focused case is the
executed ZIP-consumer proof.

## Actual artifacts and visual review

Final packet:
`docs/evidence/p14-audit-zip/1b2dacb3-cdef-449e-9cee-ca189c552dcd/`

- `organization-audit.zip`: actual organization browser download.
- `operator-audit.zip`: actual operator browser download.
- `organization-{1440,390}-{light,dark}.png`: four actual organization captures.
- `operator-{1440,390}-{light,dark}.png`: four actual operator captures.

All eight final screenshots were opened and inspected. Both themes have
visible, legible ZIP controls and success state. Desktop table columns and
mobile stacked controls/cards fit their viewports without observed blank
content, overlap or horizontal clipping. Operator mobile images are readable
390x844 viewport captures; organization captures retain the full settings page.
See `docs/evidence/p14-audit-zip/visual-review.md`.

The earlier successful browser packet
`docs/evidence/p14-audit-zip/df499ed0-d02e-4269-a168-869935ea9c61/`
is preserved with its two ZIPs and eight screenshots. Its operator mobile
full-page images were too tall for convenient review, which is why the final
packet uses mobile viewport captures.

## Cleanup and identity

All native/browser/static terminals have completed; none is pending.
All four exact new native-test roots and all three exact browser-run roots
are absent. No listener remains on the browser fixtures' six exact ports:
36479, 46603, 43475, 46571, 39515 and 43607. The final fixture's web/API origins
were `http://127.0.0.1:39515` and `http://127.0.0.1:43607`; its own test
asserted both closed after awaited disposal. Owned browser/test/Vite process
inspection was empty. Exact identities and terminal receipts are in
`docs/evidence/p14-audit-zip/cleanup.md`.

`docs/evidence/p14-audit-zip/source-sha256.txt` records all eight delivered
source/config files plus the existing account config used by verification.
`docs/evidence/p14-audit-zip/artifact-sha256.txt` records the two final ZIPs
and eight final screenshots. Both manifests were verified with `sha256sum -c`.

Port 5173 belongs to FastShort and was not touched. These are owned ephemeral
QA receipts, not requested-origin acceptance. This bounded delivery does not
claim other-browser/touch-device coverage, a full-product build, pending
organization invitation parity, or a new post-export organization-membership
revocation policy. Exported artifacts retain the existing actor-owned snapshot
semantics; downloaded copies cannot be recalled. No scoped behavior remains
deferred.
