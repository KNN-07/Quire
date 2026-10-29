# P9 exact-owned execution stop race: FINAL

October 28, 2026. Owner: `st_01a17e6f`. Delta from checkpoint `17a8dd4`.

**PASS for the narrowly identified stop/unloaded-unit race. The separate
worker startup interruption remains unresolved. No all-role acceptance is
claimed.**

## Attribution and correction

`docs/evidence/p7-installation-integration/all-role-attempts.txt` records the
actual failure for
`quire-integration07414b325c32-exec-e3702469-683b-49f0-8818-a4be37d9afc2.service`.
Its raw controller stack points to `stopExecutionUnit` through `stopOwned`:
the driver observed an active transient unit, but the unit was unloaded by
the time `systemctl stop` reached the manager.

The authority retains its exact durable launch-ownership check, expected-stop
tracking, pending-start cancellation, and session removal only after proof.
Its process-stop proof is now isolated in `execution-stop.ts` so the observed
ordering can be tested deterministically without timing sleeps.

Only `CONTROL_MANAGER_FAILED` with the complete diagnostic naming the exact
requested unit is eligible:

```text
/usr/bin/systemctl: Failed to stop <unit>: Unit <unit> not loaded.
```

The helper still awaits the original manager job. After this specific error
it additionally requires a fresh `LoadState=not-found` observation. It also
retains the independent inactive/failed state, zero MainPID, and empty old
and current cgroup checks. A loaded replacement, live PID, populated cgroup,
wrong-unit diagnostic, unrelated manager failure, or failed fresh observation
remains fatal. The missing-unit text alone is never stopped evidence.

The helper returns no payload result. Existing interrupted/missing-report
semantics remain in the broker; no successful payload exit is invented.
No inventory, caller API, worker factory, or recipe was broadened or changed.

Production changes are limited to `systemd-authority.ts` and the new
`execution-stop.ts`.

## Verification

Four deterministic manager-seam cases passed **17 assertions**. They force
the observed ordering, prove the manager job is awaited before the fresh
inspection, check both cgroups, and reject each independent failed proof.
These are controlled seam tests, not a claim that a live systemd timing race
was reproduced by chance.

The separate real-process case launched one pre-recorded owned `cat` service,
subscribed to its output before triggering readiness, stopped it through the
same helper, checked PID/cgroup absence, and repeated the already-stopped
operation. It passed **5 assertions**, with the selected command completing
in **1.497 seconds**, exit 0.

The first real-process test attempt failed on its own disturbed-stream reader.
Only that failed case was rerun after correction; the four passed guard cases
were not duplicated. A subsequent test-only stdin-write lint finding was
corrected, then scoped strict TypeScript and type-aware deny-warning lint
both exited 0. The evidence does not claim a single combined five-case green
command. Accepted recipe and baseline cases were not rerun.

Both fixture roots and all eight recorded fixture unit names are absent.
No containers were created. A separate read-only audit of the two exact
dynamic units named in the original incident found `LoadState=not-found`,
`ActiveState=inactive`, `MainPID=0`, and empty `ControlGroup`; the recorded
integration root was also absent.

`p9-supervisor-stop-race.evidence.json` records the exact identities and four
delta fingerprints. Historical P9 execution and recipe handoffs/evidence
match checkpoint `17a8dd4`. No commit or push was performed.

## Scoped reproduction

```sh
./node_modules/.bin/bun test tests/operations/installation/supervisor-stop-race.test.ts
./node_modules/.bin/bun ./node_modules/typescript/bin/tsc --noEmit \
  -p tests/operations/installation/supervisor-stop-race-tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/operations/installation/execution-stop.ts \
  services/operations/installation/systemd-authority.ts \
  tests/operations/installation/supervisor-stop-race.test.ts
```

The integration owner must still diagnose worker startup and establish the
configured all-role result. This correction removes the demonstrated cleanup
failure; it does not establish why those workers stopped initially.
