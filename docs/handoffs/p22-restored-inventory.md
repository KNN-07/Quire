# Full restored inventory: FINAL

October 28, 2026. Parent continuation of the remaining installation evidence
gap, not a replacement for the accepted P21 native/scale rollback cases.

## Added acceptance boundary

`nativeInstallation` now accepts an optional `onRestoredHealth` callback.
Only fixtures requesting it sign the existing real-role wrapper into their
prior release, along with its health-socket metadata. The wrapper preserves
the actual worker factory. Ordinary initial startup does not enter the hook.

At fresh prior-release prepared health, the fixture checks the real Unix peer,
user ID, role unit, systemd invocation, cgroup, prepared purpose, non-source
generation and non-null operation ID. It then invokes the existing
`assertRestoredInventory` before responding to the role's health request.
The controller cannot activate that cohort before the comparison completes.
No production readiness or supervisor behavior was replaced.

The comparison verifies the signed archive identity, complete SQL export
with explicit dead-owner transformations, every blob's bytes/hash and exact
key inventory, and Git integrity/refs/object counts. It checks the binding
against the real durable restore receipt. Native and PostgreSQL variants are
separate cases in `restored-inventory.test.ts`.

## Verification

Touched fixture/test diagnostics are clean. Scoped strict TypeScript and
type-aware deny-warning lint passed. The native case passed **1 case/33
assertions**, 118.28 seconds, exit 0 under
`mon_PZVSXXQ0M1CPX9PV` (`bash_357`). Its real prepared-health comparison covered
all **150 SQL tables, 6 blobs and 1 Git repository**, then the actual cohort
activated and the controller returned open on the fresh generation.
Durable receipts:
`docs/evidence/p7-installation-integration/p22-native-inventory.log/xml`.
The private native root was independently absent. Its four exact unit checks
are recorded under `mon_4TADJCH8SEPA1XVF` (`bash_359`).

The first PostgreSQL/S3/Git case compared all 150 tables, 6 blobs and 1
repository successfully and reached its final assertions, but exited 1 during
fixture disposal: `EACCES` removing two intentionally sealed execution-source
directories (mode 0555). Its **0 pass/1 fail, 38 assertions**, 167.65-second
receipt is retained under `mon_2WSYT3C28ECEVHJ9` (`bash_358`), with durable
`p22-scale-inventory.log/xml`. It is not relabeled a passing test.

Fixture teardown now includes ledger-owned dynamic execution units, checks zero
PIDs as well as empty cgroups, and uses the existing ownership-checking
`removeExecutionFiles` primitive for sealed source trees after units stop.
No production source sealing was weakened. The old exact installation scope
had no remaining units or Docker containers; its residual root was removed
with that same primitive through the project-local Bun runtime and independently
confirmed absent (`bash_360`, `bash_361`). The eval kernel's initial import
could not resolve workspace dependencies and made no cleanup changes.

Only the failed scale case reran after passing scoped types/lint under
`mon_MXDBQTXPJQFQXWQJ` (`bash_362`), retaining
`p22-scale-inventory-fixed.log/xml`. It passed **1 case/38 assertions**,
166.62 seconds, exit 0. All 150 PostgreSQL tables, 6 S3 blobs and 1 Git
repository matched the signed archive at prepared health. Activation completed
on the fresh generation and fixture disposal completed successfully.
The exact private root was independently absent; final exact installation
unit/container-scope inspection returned no units or containers, exit 0,
under `bash_363`.
No previous successful
all-role, recipe or authority suite was replayed.

This closes full restored-inventory acceptance for the two tested deployments.
It does not close post-promotion environment builds, custom worker adoption,
retained release/floor scenarios beyond these updates, or the remaining final
bundle/build and product acceptance work.
