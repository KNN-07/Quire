# Managed-worker activation admission: FINAL scoped fix

October 28, 2026. Parent follow-up to the unverified all-role installation
acceptance in `p7-installation-integration.md`.

## Observed failure and change

The native scenario ran real worker/compiler/PDF operations, reached a durable
rollback result, then failed waiting for the replacement cohort to activate:
**0 passed, 1 failed, 12 assertions**, 412.31 seconds, exit 1.
Original output and JUnit are retained at
`docs/evidence/p7-installation-integration/p21-native.log` and
`p21-native.xml` (`mon_SSQ6T8Q381JNBCDG`, `bash_343`).

The exact failed generation-1 worker unit was
`quire-integration7ff8f01a1e7e-exec-7e5b5aca-7aa6-459e-995b-3b51242f203a.service`.
Its user journal records `CONTROL_REQUEST_TIMEOUT` before its launch handshake
completed. The parent worker-controller reports
`CONTROL_EXECUTION_NOT_STARTED`; the stable controller reports
`CONTROL_REQUEST_FAILED`. Journal reads were `bash_344` and `bash_346`, exit 0.

`SystemdInstallationAuthority.commit` held its serialized admission queue
while awaiting each role's activation callback. Worker-controller activation
awaits a managed child; that child's launch request queues behind the same
commit. The change keeps validation and the durable commit inside the queue,
then invokes activation outside it. Each session is attested again immediately
before activation, preserving epoch/generation/invocation checks. Launch
admission, pending-role checks and execution authorization are unchanged.

The same runtime case passed after this lock-boundary change.
No timeout or assertion was weakened, and no new synthetic test substitutes
for the existing actual all-role scenario.

## Verification

Component LSP diagnostics are clean. Scoped installation strict TypeScript and
typed deny-warning lint passed. The same failed native scenario passed
**1 case/35 assertions**, 339.66 seconds, exit 0 under
`mon_R8MCQT1MMVR65DZV` (`bash_347`). Durable outputs are
`p21-native-fixed.log` and `p21-native-fixed.xml` in the same evidence directory.
It proves real managed compilation before and after fresh rollback, a distinct
replacement worker, actual PDF bytes, open generation 1, retained prior release,
and drained old execution units.

The passing command retained a teardown-time `CONTROL_MANAGER_FAILED` warning
from `parentClosed` while stopping its controller. It is not erased or called
a clean shutdown. Independent inspection of all 58 exact units across the red
and green runs found zero main PIDs and empty cgroups. All green-run units were
unloaded. The red run retained one failed worker metadata record; after exact
`reset-failed`, that unit and its controller were confirmed unloaded
(`bash_349`, `bash_350`). Both private roots were independently absent.
Both exact Docker ownership-scope queries returned no containers, exit 0
under `bash_352`.

The affected real authority lifecycle/prepared-health selection passed
**5 cases/79 assertions**, 135.41 seconds, exit 0 under
`mon_Z1YV7FFKEPVC9P8G` (`bash_348`), with durable
`p21-authority-regressions.log/xml`. It retains controller/helper crash recovery,
dead prepared-child denial and completed health-failure rollback; all five
fixtures reported exact cleanup; their five roots were independently absent.
The previously unverified same-host scale case passed **1 case/28 assertions**,
365.85 seconds, exit 0 under `mon_3BWT2AZPTXKEHBB8` (`bash_351`), with durable
`p21-scale.log/xml`. It proves real PostgreSQL/S3/Git/Redis replacement bindings,
preserved source/refs and compilation before and after rollback. Its teardown
also logs the retained manager warning. Parent independently inspected all
37 exact scale units: unloaded, inactive, zero main PID and empty cgroup.
Exact installation-label and storage-container queries returned no containers,
and `/tmp/quire-installation-integration-vNxG9l` was independently absent
(`mon_71M16MTXY1PCZ2YY`, `bash_356`, exit 0).
No unchanged unrelated recipe tests were replayed.
Full restored-inventory was subsequently accepted in `p22-restored-inventory.md`.
Post-promotion/environment-build and final installation acceptance remain
separate open work.
