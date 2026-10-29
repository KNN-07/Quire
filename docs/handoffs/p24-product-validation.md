# Current-tree production validation: FINAL scoped checks

October 28, 2026. Parent validation after P20-P23 changes; this supersedes
the checkpoint-only global-build statement, not whole-product acceptance.

After the P25 controller error-transport correction, the same root
typecheck/lint/full-build chain passed again, exit 0 under
`mon_M08MMC0YZ1J1GHTR` (`bash_373`). Current raw output:
`docs/evidence/p7-installation-integration/p25-product-validation.log`.
That later run regenerates the affected production bundles; the original
P24 receipt below remains historical evidence rather than being relabeled.

From the repository root, with the project-local Bun directory first in PATH:

```sh
bun run typecheck
bun run lint
bun run build
```

The chained command exited **0** under `mon_YRVXDRC2WAVERJDW` (`bash_369`).
Raw output: `docs/evidence/p7-installation-integration/p24-product-validation.log`.
Root TypeScript and type-aware deny-warning lint passed. The production build
regenerated local Python/spelling assets, the web bundle, API server, repository
server, compiler worker, stable installation controller, signed role factory
and SSH proxy bundle.

Vite transformed 421 modules and built in 6.02 seconds. The principal web JS
chunk is 1,919.01 kB, 572.64 kB gzip, and retains the existing greater-than-500-kB
chunk warning. No size threshold was raised or warning suppressed.
API, repository, compiler, installation and SSH Bun bundles all completed.
This is not a newly executed whole-repository test aggregate; scoped test
receipts remain in their named handoffs.

## Required-origin gate

The exact `127.0.0.1:5173` listener is still occupied. A read-only HTTP probe
returned status 200 and title `FastShort`. It was not stopped, replaced or
silently substituted. The earlier unanswered port-choice question grants
no authority to change the requested origin or interrupt that service.
Literal `http://localhost:5173` browser acceptance therefore remains open.

## Installation scope

P21-P23 now supply actual controlled native/scale rollback, pre-activation
full inventory verification, signed promotion with replacement-worker PDF
compilation, and installed environment-build/probe/publication. The current
build includes those production changes. Cross-profile custom-worker admission,
additional retained-floor/receipt scenarios and final integration handoff
reconciliation remain explicit gates, not inferred from a successful build.
