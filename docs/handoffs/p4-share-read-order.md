# Share access response ordering: FINAL scoped correction

October 27, 2026.

The actual standalone Share panel could replace current restricted access with
an older successful response. A deterministic browser regression buffers one
real authorized response, commits a real capacity restriction, waits for the
current capacity and summary to render, then releases the old response.
Actual response bytes and authority are preserved. React's test boundary
settles its state updates without sleeps or polling assertions.

Before correction, `mon_EJBEEA896DDMA3Q4` failed:
`data-selection-required` became false instead of remaining true.
The retained 1920/light screenshot visibly restores Unlimited/2 effective
members beside the current 1-member/60-second benefits summary:
`docs/evidence/p4-benefits-current/read-order-9258d828-aacc-49f2-a571-7e4a6d1f84d7/after-old-response.png`.

`SharePanel.load` now uses a monotonically increasing read generation and
ignores successful responses superseded by a newer read. It does not retry
mutations or weaken any server version/role check. The test-only review fixture
exposes React's effect-settling test boundary; production routes do not use it.

After correction, `mon_KV78C7NJTZFMHFXS` passed the new ordering probe and both
existing benefits-control cases: 3 passed, 39 assertions, 60.35 seconds.
Explicit grants, ordinary-session denials, stale/reload handling, actual
membership selection, live effective roles and retained proposals remain
covered. The unchanged probe's after-response screenshot was opened and
inspected:
`docs/evidence/p4-benefits-current/read-order-1911a608-3ba1-4cea-a29b-6e6f90a42db3/after-old-response.png`.
It retains restricted capacity and current benefits. Both exact probe roots
were independently confirmed absent.

The chained lint initially found one unused test import; it was removed.
The subsequent combined parser/Share lint passed. Root TypeScript reported
only four errors in the separately owned in-progress installation fixture,
as recorded in `p7-package-root-metadata.md`; global types are not claimed green.
Source hashes are retained in
`docs/evidence/p7-installation-integration/parent-package-share.sha256`.
The initial passing browser result and lint failure remain in
`docs/evidence/p4-benefits-current/share-read-order-result.txt`.

The installation owner subsequently corrected the four unrelated fixture
errors. Root `tsc --noEmit` then passed in `mon_YW8Q4HY88SS0CEBZ`, exit 0;
passing browser and lint checks were not repeated.

This reproduces and fixes a mechanism that can remove Selection required in
the exact standalone 1920/light surface. The prior single timeout did not
record its response order, so its historical cause is not asserted as certain.
Independent P4 acceptance should assess this forced-order red/green proof,
the accepted complete visual artifact, and the remaining typecheck receipt;
no unchanged full matrix or backend run is implied.
