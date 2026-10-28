# P1S verification delivery

Owner: st_01a17bc1. October 27, 2026. Status: COMPLETE.

The final reconciled bounded handoff is `p1s-verification.md`.
Evidence and owned audit code/tests are under
`docs/evidence/p1s-verification/`.

Final independent native acceptance: **400 pass, 0 fail, 1,330 expectations,
111 files, 327.98 seconds, exit 0**.
Exact combined real scale acceptance, `bun run test:scale`:
**3 pass, 0 fail, 3 files, 265.23 seconds, exit 0**.
Root strict TypeScript, type-aware lint and multi-role build each exit 0.
All sixteen live PostgreSQL migration digests match, and all twelve original
SQLite migration definitions match commit `3fe3a23`.

The before/after final-input fingerprint is identical. Cleanup independently
confirms sixteen owned containers, three captured volumes, 280 logged roots
and all three assembly API processes are absent. Actual service/image/socket
and separate-process evidence is retained. Earlier failures are preserved,
not substituted for passing acceptance or hidden.

No unresolved assigned dependency, pending check or owned resource remains.
The pre-existing Vite chunk-size warning and later deployment/product gates
are explicitly bounded in the final handoff.

Baseline follow-up is complete: the original 970,752-byte fixture is unchanged,
and an isolated main-file-only copy proves no data depends on WAL. No active
handle was found; SQLite-owned checkpoint/close retired the zero-byte WAL and
inactive SHM without manual unlink. Ownership, capture/consumer closure and the
compiler reader's residual non-finally exception path are recorded in
`docs/evidence/p1s-verification/baseline-ownership.md`. Audit, cleanup and strict/
type-aware checks exit 0. The main fixture remains retained; both sidecars and
the unique audit-copy root are absent. Existing full-suite receipts are unchanged.
