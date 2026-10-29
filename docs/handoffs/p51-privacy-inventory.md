# P51 browser storage and processor-disclosure inventory

October 28, 2026. FINAL source inventory, not A56a whole-workflow acceptance.

Added `docs/runbooks/privacy.md` after inspecting the actual authentication
cookie implementation, all direct local/session-storage call sites in
application source, the HTML entrypoint, package source and manifest, AI
operator policy/consent routes, and account metadata export.

The document distinguishes account-keyed preferences, browser-wide intent,
project-only operation IDs, opaque AI run IDs and source-text-bearing private
draft recovery. It records explicit expiry only where implemented and does
not claim that logout purges browser storage. The source scan found no
application-owned analytics integration; this is not a deployed network
capture or a promise about operator-added proxy/extension behavior.

No cookie-choice UI was invented for nonexistent analytics. No legal or vendor
security guarantee is made. The public disclosure surface and selected
processor/deployment checks remain explicit A56a work.

This increment changes documentation only. It creates no test, process,
browser, temporary runtime or cache; no accepted test/build was replayed.
Concurrent Dropbox and Mendeley implementation remains outside this snapshot.

After accepting the independent P46 lifecycle verdict, the matrix command
`./node_modules/.bin/bun run verify:matrix` passed with
`mappingComplete: true`, 164 mapped IDs and `P51_MATRIX_EXIT=0`.
Raw output: `docs/evidence/p51-privacy-inventory/matrix.log`;
monitor `mon_X7HE5815NPCT9M9Q` / `bash_436`, exit 0.
Declared scoped coverage is now 65 MOUNT, 10 UI, 31 BE, 17 EXT, 33 PART
and eight BOUND. A56a stays PART; the source inventory is not behavioral
or whole-product acceptance.
