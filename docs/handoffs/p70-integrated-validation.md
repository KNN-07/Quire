# P70 integrated progress/import validation

FINAL, October 29, 2026. The settled P68/P69 implementation passes root
TypeScript, type-aware deny-warning lint, capability mapping and all
production bundles. This supersedes P67 for the integrated code baseline,
not for whole-product behavioral acceptance.

`docs/evidence/p70-integrated-validation/validation.log` records Bun 1.4.4,
02:07:51Z-02:09:15Z, and the actual command chain:

```sh
bun run typecheck
bun run lint
bun run verify:matrix
bun run build
```

`P70_INTEGRATED_EXIT=0`. All 1,727 selected application/package/service/
worker/script/test/deployment/runbook inputs, root configuration, README and
the matrix match before/after; `P70_INPUTS_EXIT=0` records the empty diff.
Generated evidence, dependencies and build outputs are excluded.

At this gate all 164 IDs map without missing, unexpected or duplicate IDs:
75 MOUNT, 8 UI, 31 BE, 17 EXT, 25 PART and 8 BOUND. The verifier correctly
reports mapping completeness rather than behavioral acceptance. Subsequent
documentation-only acceptance updates require only a mapping recheck.

That recheck is retained in `final-mapping.log`, with
`P70_FINAL_MAPPING_EXIT=0`: 164 mapped IDs, 76 MOUNT, 8 UI, 31 BE, 17 EXT,
24 PART and 8 BOUND. D03's former bold MOUNT was already counted by the
verifier; its stale presentation gap is now resolved, not double-counted.
D21 adds the newly accepted creation chain. No unchanged production build
was rerun for these documentation-only updates.

Web/API/repository/compiler/installation/SSH bundles are emitted. Vite
transforms 449 modules and finishes in 5.48 seconds. Its existing large-chunk
warning remains unsuppressed: main JavaScript 2,027.08 kB, gzip 603.71 kB.
No warning threshold or test gate was weakened.

P68's accepted targeted backend and native checks remain distinct from its
broader 95-pass/2-fail AI run. The two failed-citation fixtures still encounter
the unchanged read-time `AI_RETRIEVAL_CONSENT` guard; no before-change green
execution was established. Neither those failures nor inherited full-panel
visual checklist deviations are converted to green by this static/build gate.

This command creates no long-lived QA service, browser or container.
Production `dist/` output is retained intentionally. Original supplied
design/research inputs were not edited. Remaining todo work and literal
localhost:5173 acceptance are not closed by this result.
