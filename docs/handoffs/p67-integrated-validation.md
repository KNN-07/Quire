# P67 integrated validation

FINAL, October 28, 2026. The integrated P61-P66 source state passes the root
typecheck, type-aware deny-warning lint, capability mapping and production
build. This supersedes P59 as the integrated static/build baseline, not as
whole-product behavioral acceptance.

`docs/evidence/p67-integrated-validation/validation.log` records repository
Bun 1.4.4 and the actual commands from 22:51:06Z through 22:52:30Z:

```sh
bun run typecheck
bun run lint
bun run verify:matrix
bun run build
```

The combined command exits 0 (`P67_INTEGRATED_EXIT=0`). The before/after
manifests contain 1,709 identical selected application, package, service,
worker, script, test, deployment and runbook files plus root package/lock/type
configuration. `P67_INPUTS_EXIT=0` records the empty diff. Generated evidence,
node_modules and build outputs are excluded. Imported runbook/deployment
downloads are included; this is not a claim that every external runtime input
was fingerprinted.

Mapping covers all 164 IDs with no missing, unexpected or duplicate IDs:
75 MOUNT, 8 UI, 31 BE, 17 EXT, 25 PART and 8 BOUND. The verifier explicitly
reports `behavioralAcceptance:false`; a complete mapping does not close the
remaining behavior, deployment or external-provider work.

Production builds emit web, API, repository, compiler, installation
controller/role and SSH bundles. Vite transforms 447 modules and completes
in 5.66 seconds. Its existing large-chunk warning remains visible and
unsuppressed: main JavaScript is 2,021.71 kB, gzip 602.11 kB. No threshold
was raised to hide the warning.

The retained targeted runtime evidence remains separate: saved preferences
and exact-tree commits in P61, deployment downloads in P62, event sharing and
admission denials in P63, Rtex/cache policy in P64, backup scheduling controls
in P65 and generated-asset reuse in P66. No unchanged broad compiler,
installed lifecycle or restore suite was replayed for this static gate.
The P63 independent review remains its own acceptance artifact.

The command starts no long-lived QA server, browser or container. Production
`dist/` artifacts are retained intentionally. Original design/research input
preservation retains the P59 hash-check evidence; neither input was edited
by these increments. Port 5173 and the remaining todo tasks are not closed
by this validation result.
