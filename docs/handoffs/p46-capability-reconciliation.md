# P46 capability and setup documentation reconciliation

October 28, 2026. FINAL documentation increment, not final product acceptance.

The refreshed independent `p34-account-entry-verification.md` accepts the
bounded D09 pricing and D14 onboarding paths. The matrix now cites that
verdict, P45's current-source pricing composition and P44's mobile status
correction. D21 retains its distinct Git/history/settings gaps while accepting
P34's persisted ZIP recovery. Original P34 provenance limitations remain
historical; no missing original receipt was invented.

D09 and D14 move from PART to MOUNT. The original design-disposition column
stays unchanged. Current counts are 64 MOUNT, 10 UI, 32 BE, 17 EXT, 33 PART,
zero GAP and eight BOUND across 164 primary capabilities. These classify
scoped evidence, not complete workflows or a percentage of product completion.

The priority list no longer presents P7's blanket installed-supervisor failure
as current. P21-P25/P37 close only their tested native/same-host scale
rollback, restored inventory, signed promotion/PDF, restart and custom
admission/revocation paths. README now states the same boundary.

Current runtime instructions in the adapter, support, toolchain, SSH and worker
runbooks now use repository-pinned Bun 1.4.4, matching package.json. Historical
1.3.14 observations remain identified as earlier evidence, not rewritten as
new runs.

## Executed check

Cwd: `/home/norman/Repos/Quire`.
Command: `./node_modules/.bin/bun run verify:matrix`.
Monitor: `mon_AJ4D712H046C60TS`; session: `bash_425`.
The completed command exited 0 with the following output:

```text
$ bun packages/runtime/src/verification.ts matrix
{
  "scope": "capability-mapping-only",
  "behavioralAcceptance": false,
  "mappingComplete": true,
  "inventory": {
    "core": 86,
    "services": 55,
    "design": 23,
    "total": 164
  },
  "mapped": 164,
  "declaredCoverage": {
    "MOUNT": 64,
    "UI": 10,
    "BE": 32,
    "EXT": 17,
    "PART": 33,
    "GAP": 0,
    "BOUND": 8
  },
  "missing": [],
  "unexpected": [],
  "inventoryDuplicates": [],
  "matrixDuplicates": [],
  "missingDisposition": [],
  "emptyInventories": []
}
P46_MATRIX_EXIT=0
```

This prose-only increment adds no tests and repeats no browser or production
build. P41/P43/P44 remain the prior scoped validation receipts; the independent
P46 lifecycle implementation is in progress and is not accepted by this report.
Literal localhost:5173, broader elected capability gaps and final cleanup
remain open. The mapping command created no application runtime or browser.
