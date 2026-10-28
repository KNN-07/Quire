# P7 configured installation verification: FINAL

October 27, 2026. Independent verifier: `st_01a17e77`.

**FAIL: configured installation acceptance is not admitted or proved.**
The concrete stopping boundary is missing FINAL supervisor/integration
deliveries and their actual configured host acceptance command. No real
controller kill, stopped-cohort proof, installed-entrypoint rejection,
configured native rollback, or configured same-host scale rollback was run.
This report does not relabel foundation primitives or prepared 503 responses
as installation acceptance.

## Admission and actual source boundary

The full architecture decision and FINAL `p5-installation-control.md`,
`p5-restore-target.md`, `p5-update-control.md`,
`p5-installation-foundations-verification.md`, and `p7-prepared-runtime.md`
were read. The four P5 deliveries and prepared-runtime delivery pass their
document-admission requirements. Supervisor and configured integration FINAL
handoffs were absent at inspection and fail admission.

The real source contains new `systemd-authority.ts`, `systemd-process.ts`,
`controller-server.ts`, `driver-config.ts` and `prepared-storage-host.ts`.
Their presence is not a finished executable delivery. No installation
controller main/launcher existed under `deploy/runtime`; no configured host
acceptance directory/command existed. The integration test directory contained
only a strict configuration. The inspected authority still referred to an
absent `./storage` host type.

`scripts/ops/install.ts` still provisions `release`, `data`, and `bin/quire`.
That launcher's serve action invokes migration then the production server
without a controller protocol. `scripts/migrate.ts` calls `prepareData` before
opening storage; the inspected configuration implementation contains no
installation-owned launch guard. `apps/server/src/main.ts` creates and starts
the application directly. Thus this inspected set cannot establish that all
entrypoints reject uncontrolled launch or ambient overrides. No private
installation was manufactured from these incomplete, concurrently edited
inputs.

The prepared-runtime FINAL handoff explicitly limits readiness to database
and migration checks, defers registration until activation, and leaves the
production scale inert factory, invocation-bound private channels and other
role entrypoints to the host. This is a useful prerequisite, not all-role
prepared executable/static/store health.

## Verdict per design invariant

These verdicts judge **configured acceptance**, not the previously accepted
foundation increment. FAIL includes absent required proof; it does not mean
the corresponding existing persistence primitive failed its tests.

| Design invariant | Verdict | Exact observed boundary |
| --- | --- | --- |
| 1. Independent authority | FAIL | P5 independently passed real control SQLite separation, but no admitted configured controller layout, singleton ownership or ordinary-role control-file denial was executed. |
| 2. One launch owner | FAIL | No delivered main/launcher or all-entrypoint installation guard; unmanaged installer and direct migration startup remain in the inspected input. No real invocation-bound denial or transient/container inventory acceptance. |
| 3. No maintenance before actual stop | FAIL | No real two-API/Git/adapter/compiler cohort was stopped. No surviving Git child/cgroup/container prevented a maintenance marker in an executed scenario. New source observation code is not process evidence. |
| 4. Crash closure | FAIL | No controller/helper SIGKILL, persisted unsafe-boundary receipt, surviving-role write denial, closed restart or exact recovery was executed. Reachable degraded systemd is only a prerequisite observation. |
| 5. Fresh binding | FAIL | Existing native and PostgreSQL/S3/Git importer proofs remain accepted only at their foundation scope. No configured promotion replaced every role/handle or proved shared restored binding and Redis cursor replacement. |
| 6. One commit point | FAIL | Existing control atomicity remains foundation evidence. No configured private readiness, executable/assets/blob/Git checks and actual activation after the atomic transaction were observed. |
| 7. Recovery cannot lower authority | FAIL | P5 floor/offline replay/idempotency/branch-worker fence proofs remain intact. No configured rollback/restart demonstrated old invocation denial, retained-binding inventory or restored reservation reconciliation before reopening. |
| 8. No broad backup exception | FAIL for configured combination | P5's structural rule passed: no application updater receipts and unchanged strict settled-operation rejection. No newly configured real backup/rollback store was opened here, so application-receipt absence through that full host flow is unproved. |

## Executed and retained evidence

`docs/evidence/p7-installation-verification/admission.md` records measured
inputs, actual outputs, the initial read-only command-chain failure and exact
resource observations. Project-local Bun was actually `1.4.4`; the global/eval
runtime was not substituted.

The actual `validateDriverConfig` rejected both Compose and Helm with
`UPDATES_DEPLOYMENT_UNSUPPORTED` and the explicit missing local systemd
cohort, launch inhibition and fresh-store authority message. This negative
capability boundary passes. Neither deployment is a supported signed-install
target. This does not pass the supported native or same-host PostgreSQL path.

The retained Bun 1.4.4 package manifest's Ed25519 signature independently
verified against its retained trusted public key. Its exact hashes match the
prior producer evidence; it describes five images and 9,462 inventory entries.
The retained historical PDF is actually 41,497 bytes with SHA-256
`ed71277fae5986392ec628709e8c33a3dc6244b4cf41f18871d2bbaef094ecbc`.
The actual prior PDF log reports two rejected receipts and successful accepted
PDF download. Its historical runtime boundary is retained. The full ephemeral
package payload was removed by its producer, so this inspection verifies the
retained signature and PDF bytes, not a fresh full-payload installation or
current configured source/PDF smoke.

The prior independent 73-case foundation result and prepared-runtime
13-case result remain unchanged at their documented scopes. Neither suite,
the deployment matrix, frozen benefits backend, nor unrelated UI/product
suites were rerun. No changed host acceptance command exists to run once.
There are no actual crash/rollback observations to cite; ledger fixtures and
prepared transport denial were deliberately not substituted.

## Checks, cleanup and completion boundary

Only this handoff and its named evidence directory were written. No producer
source, original migration, original evidence, test input, runtime dependency,
concurrent editor/account/benefits work or user data was edited. This
documentation-only result adds no prose-pinning test and requires no new
TypeScript project or product build.
Owned Markdown whitespace checks emitted no diagnostics and the normalized
check exited 0; raw no-index difference exits are explained in the evidence.
Architecture and all five admitted FINAL handoff hashes matched before/after.
The later `p7-control-pagination.md` describes only its additive query contract,
not the missing configured supervisor/integration delivery.

No host units, processes, containers, volumes or private application roots
were created. Read-only scans for exact observation prefix
`quire-p7verify-st01a17e77-` found no loaded units or unit files; the empty
unit-file query returned 1 and is recorded rather than called exit-0 proof.
Docker's exact-name scan exited 0 with no matching containers, the reserved
`/tmp/quire-p7verify-st01a17e77` root was absent, and the scoped process scan
found no owned process. There was no resource to stop or delete.
FastShort PID 1143097/port 5173, unrelated units/containers and the degraded
user manager were left untouched. No commit, global upgrade or production
installation occurred.

Completion is the recorded concrete admission failure, not configured success.
A later verification must consume FINAL immutable host/integration manifests
and execute their real acceptance command, including the actual controller
kill and recovery and original-dialect native/scale all-store rollback.
