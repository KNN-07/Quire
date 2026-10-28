# P7 supervisor recovery independent verification: FINAL

October 27, 2026 (UTC). Independent verifier: `st_01a17ea8`.

**PASS for the concrete `systemd-local-v1` authority/storage gate, including
the actual prepared application factory.** Independent execution passed
**7 tests, 83 assertions, zero failures, 94.93 seconds, exit 0**, on project-local
**Bun 1.4.4 (38afee6c8)**. Owned strict TypeScript and type-aware deny-warning
lint also exited 0. Exact owned resources are gone. This is not certification
of later all-role application integration or whole-product update/rollback.

## Admission history and exact inputs

Initial admission failed correctly: the supervisor FINAL handoff was missing,
and the historical prepared-runtime manifest differed on composition.
`docs/evidence/p7-supervisor-recovery/admission.txt` preserves that result.
Missing paths were not treated as missing implementation, and no candidate
tests were run at that initial admission.

The complete `p7-supervisor.md` FINAL, its exact 17-entry source manifest,
required command chain, strict configuration and cleanup inventory were
subsequently read. All 17 fingerprints matched before independent execution
and again afterward. The original complete `p7-prepared-runtime.md` FINAL
and its 12-entry manifest were read; 11 entries remained unchanged.

The parent then explicitly admitted the narrow independent supervisor gate.
After the checks had started, the parent required the new composition receipt
before accepting outcomes. Results were held provisional, not rerun or
silently narrowed. `p7-prepared-composition-revalidation.md` is now FINAL and
was read in full. Its complete superseding
`docs/evidence/p7-prepared-runtime/composition-revalidation.sha256` manifest
was read and checked: all 12 entries match. It preserves the historical
manifest and documents the integration owner's signed update-client and
operation-reader injection, with six affected application cases independently
revalidated by the parent. That parent run is dependency admission evidence,
not counted among this verifier's seven tests.

Composition remained
`68f248ababd48eb6f0bc918f27d6f193d70ff7df872646255e8dac8d4ca21277`
through this verifier's execution. No application-factory case was excluded.
Handoff fingerprints and commands are retained in `run-admission.txt` and
`results.txt` under `docs/evidence/p7-supervisor-recovery/`.

## Independent commands and concrete observations

The following focused test command ran once, not a recovery of producer output:

```sh
./node_modules/.bin/bun test \
  tests/operations/installation/supervisor-lifecycle.test.ts \
  tests/operations/installation/supervisor-transport.test.ts \
  tests/operations/installation/supervisor-scale.test.ts
```

Owned checks ran once, joined with `&&`:

```sh
./node_modules/.bin/bun ./node_modules/typescript/bin/tsc --noEmit \
  -p tests/operations/installation/supervisor-tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/operations/installation/driver-config.ts \
  services/operations/installation/systemd-process.ts \
  services/operations/installation/controller-server.ts \
  services/operations/installation/systemd-authority.ts \
  services/operations/installation/storage.ts \
  services/operations/installation/prepared-storage-host.ts \
  services/operations/installation/control-store.ts \
  tests/operations/installation/supervisor-*.ts
```

The inspected tests and actual run establish:

* Actual Unix peer PID/start time, canonical bounded frames, exact command
  authentication, changed request/MAC denial and oversized/noncanonical
  connection closure. Compose and Helm explicitly reject with
  `UPDATES_DEPLOYMENT_UNSUPPORTED`.
* Actual missing launch capability rejects `UPDATES_LAUNCHER_UNAVAILABLE`
  before configured slots have joined. A live unowned launch caller rejects
  `CONTROL_PROCESS_CHANGED`; forged readiness tokens are rejected.
* Two real systemd API slots stop as a cohort. Tests inspect their actual
  cgroups recursively for zero PIDs, not just a stopped flag. A deliberately
  unrelated unit retains its invocation. Restart while recovery is closed
  rejects `CONTROL_LAUNCH_DENIED`, and actual role MainPID remains zero.
* Successful authority construction executes real bwrap mount/PID isolation
  and `/usr/bin/test ! -e <controlRoot>/control.sqlite` inside that namespace.
  Ordinary/prepared/helper processes also use the concrete bwrap launch path.
  This verifies inaccessible control state rather than trusting user-manager
  `InaccessiblePaths` or a capability boolean.
* Real signed native backup/restoration preserves application and migration
  rows into a distinct generation. Actual prepared application factories
  activate only through guarded commit. Controller death preserves successful
  floor/receipt. Real isolated preflight leaves source schema unchanged;
  live migration changes it; authenticated recovery restores original rows
  and the prior floor into another generation.
* Killing a real maintenance helper at a subscribed IPC boundary yields an
  empty cgroup and a missing result retained through controller restart and
  explicit recovery. A dead prepared role prevents commit; stale recovery
  generation is denied. These are process-death cases, not fabricated flags.
* Real PostgreSQL/S3/owned Git backup/restoration and Redis readiness use
  original-dialect storage. Source/target database OIDs were `16384`/`18138`
  in cluster `7701422278395007010`, with distinct buckets and Git inodes.
  Source snapshots remain unchanged; wrong database identity rejects
  `CONTROL_DATABASE_IDENTITY_MISMATCH`. This remains an adapter proof, not
  configured all-role PostgreSQL systemd installation acceptance.

## Exact cleanup and unrelated resources

All four systemd fixtures printed exact ownership before use and cleanup
afterward. Their cleanup checks actual inactive/failed state and recursively
empty owned cgroups before removing roots/resetting exact failed units.
This verifier then independently checked all 20 exact unit names:
every `LoadState` was `not-found`. All five private roots, three exact
containers and the MinIO volume were independently absent; the fixture also
confirmed its S3 listener removed. Exact names are in `results.txt`.
PostgreSQL/Redis exit 137 reflects intentional owned container removal.

The live unrelated dbus/document-portal/permission-store units retained their
exact PIDs and invocation IDs across the captured snapshots. The intentionally
unrelated owned fixture unit retained its invocation across cohort stop.
No unrelated unit was stopped, reset or removed; no host configuration was
repaired. No producer source, application integration source, existing tests
or prior evidence was edited, and no production deployment or commit occurred.

## Acceptance boundary

The original failed admission is superseded for the current verified inputs,
not erased. There are no failures in this independent focused run and no
owned runtime resources deferred for cleanup.

This report certifies only the concrete authority, authenticated local
transport, prepared host and tested native/PostgreSQL storage behavior above.
It does not certify later API/repository/compiler/SSH public entrypoint
adoption, full execution-slot inventory, signed-package production metadata,
configured all-role installation integration, or whole-product update/rollback.
Those remain the integration lane's separate gate.
