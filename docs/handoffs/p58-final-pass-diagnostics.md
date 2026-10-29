# P58 final-pass compiler diagnostics

October 28, 2026. FINAL parent correction of the stale bibliography-warning
finding observed in P54.

For a recognized multipass latexmk transcript, warning and typesetting
summaries now come from the final TeX-engine pass. Errors remain visible from
every pass. Single-pass and non-latexmk logs keep their previous behavior.
Raw logs are not modified, and diagnostic source spans retain their offsets
into the complete raw transcript.

The cache namespace is now explicitly `diagnostics-v1:`. Both request-time
and local-execution keys use it, and remote queue claims bypass old unversioned
keys, including requests queued before the change. Current local/remote cache
hits still work. Historical completed jobs/logs are not rewritten; old cache
entries become unused until normal project cache clearing.

## Reproduction and checks

`docs/evidence/p58-final-pass-diagnostics/red.log` records all four new checks
failing before the fix, including actual BibTeX and Biber builds whose final
PDFs were valid but whose summaries retained earlier warnings. `cache-red.log`
separately reproduces reuse of an obsolete cached summary.

`green.log` records the final selected parser, real bibliography and cache
checks: **9 pass, 39 assertions, exit 0**, with six identical pre/post
source/test fingerprints. UTC 18:57:50Z through 18:58:37Z.
Monitor `mon_HCVCY81GY5GDWD25` / `bash_455`.

The cache case uses real builds and persisted rows: it verifies legacy queued
remote work receives a lease instead of stale cached diagnostics, a local
request rebuilds, and both current queue paths reuse the new cache. The
retained error test checks source IDs and raw spans. Real BibTeX/Biber cases
check actual PDF text and zero final diagnostics while raw logs still contain
their transient warnings. Their optional artifact-retention environment
variable was unset, so no separate unit-build PDF files are claimed.

`errors-static.log` records the affected actual malformed-source regression:
**1 pass, 3 assertions**, followed by native-fixture TypeScript/lint, exit 0.
`static.log` records compiler-scope TypeScript and type-aware deny-warning lint,
`P58_STATIC_EXIT=0`. No error or warning was suppressed to pass those checks.

## Actual native surface

The affected citation-review bibliography workflow was run once with new
assertions for the final compile diagnostics and the actual Logs tab. It
passed **1 case, 33 assertions**, `P58_NATIVE_EXIT=0`, from 19:03:09Z to
19:04:06Z, with four matching source/test fingerprints.
Monitor `mon_H3C7QM7DJ6RTJXGR` / `bash_457`.

The unique packet is
`docs/evidence/p54-citation-reviewer/6a554a8f-4a69-4d01-9397-6525ca5352ca/`.
Job `e946deab-df03-49ec-be5f-50968c72b8e9` succeeded with an empty diagnostic
array and actual PDF `02be170e-56a1-4953-bd8b-a4c39d932bdc`.
Its retained build log still contains all five earlier citation/rerun warnings.
Parent opened `final-pass-diagnostics.png`: All, Errors, Warnings and
Typesetting each display zero; the complete raw-log download remains available.

The real 27,314-byte PDF was rendered and inspected, including its only page.
It shows the expected citation marker and reference entry. Render:
`docs/evidence/p58-final-pass-diagnostics/native-output.png`;
`pdftoppm` exited 0. The controlled publication remains a test fixture, not a
claim of live retrieval or model truth.

## Cleanup and scope

Native disposal closed the browser, application and provider without errors.
Parent independently verified `/tmp/quire-assembly-IdSY9p` absent and all
three owned ports 37465, 45763 and 44131 refusing connections. Compiler unit
fixtures use awaited teardown; their per-root names are not emitted, so no
historical exact-name receipts are invented.

No layout redesign, live provider call, migration, user project mutation,
original-input edit or port 5173 operation occurred. The next integrated
static/build gate must include this compiler/cache correction; P53 predates it.
