# P7 installation integration: IN PROGRESS

## Later parent acceptance supersession

October 28, 2026: `p21-activation-deadlock.md` supplies durable current-source
all-role native and same-host scale rollback passes, after correcting the
activation/admission deadlock. It also records five affected authority
regressions and independent cleanup. The old missing-terminal-result finding
below is preserved as history, not a current absence of those two proofs.

`p22-restored-inventory.md` additionally accepts complete SQL/blob/Git archive
comparison at a real peer-attested fresh prepared-health boundary, before
producer activation, for native and PostgreSQL/S3/Git deployments. Its original
scale cleanup failure and corrected passing run are both retained.
Remaining installation gates below are still open unless those handoffs
explicitly close them; this P7 integration handoff is not yet FINAL.

## Earlier integration and recovery record

October 28, 2026. Owner: `st_01a17e71`.

**Not FINAL. Configured supervisor/native/scale acceptance is not claimed.**
The independent client/operation-reader bridge is implemented and verified.
The actual FINAL `docs/handoffs/p7-supervisor.md` exports from recovery owner
`st_01a17e6f` have now been read and consumed. Dependent implementation and
configured proof are in progress; source appearing on disk remains distinct
from accepted runtime evidence.

## Settled receipt recovery and concrete blocker

The current continuation stops at missing original terminal evidence, not at
configured acceptance. No test was rerun during receipt recovery. The complete
session JSONL was parsed with the eval `read(path, line, 1)` helper; only text
and paired originating tool calls were retained. The linked original 52,035-byte
output artifact was also recovered without the display's long-line truncation.
The retained records do not contain either final result needed below.

`docs/evidence/p7-installation-integration/settled-receipt-recovery.json`
contains 21 raw original receipts with their JSONL lines and paired tool-call
arguments, the complete linked artifact, 36 selected current source SHA-256
fingerprints, and the exact before/reset/after cleanup evidence. Fingerprints
are a current source snapshot, not a retroactive historical test-input claim.
Supervisor dependency fingerprints are recorded read-only; no driver-owned or
other-lane source was edited.

* `bash_18` / `mon_7CW8CQQ9E837VVX8`: the original combined command's retained
  output reports the first scale case failing at 225.24107 seconds, then the
  native all-role case starting. Neither the native test summary nor the final
  combined-command exit receipt is retained.
* `bash_21` / `mon_ZMER2TAMSEJ802SZ`: the corrected PostgreSQL command and monitor
  start are retained, but its final test summary and exit receipt are not.
* JSONL lines 1411-1412 establish the combined output ordering:
  `bash_18`, then `bash_19`, then `bash_20`. The two completed exit-0 receipts
  belong to the older exact-cleanup audit and inventory-helper lint,
  respectively. They do not make either all-role test pass.
* Original accepted reader, composition, entrypoint, controller, signed-native,
  factory, unsupported-deployment and corrected crash receipts are preserved
  in the recovery evidence. The mixed prepared-health/crash run remains
  1 pass / 1 fail with test exit 1; its separate cleanup exit 0 is not folded
  into the test verdict.

Both original terminal handles are no longer registered. Absent an external
copy of those missing completion receipts, the next runtime work requires
rerunning only the two unverified cases, with durable complete output and exit
capture:

```sh
./node_modules/.bin/bun test tests/integration/installation/all-role-native.test.ts
./node_modules/.bin/bun test tests/integration/installation/all-role-scale.test.ts
```

These commands have not been executed during this recovery. No unchanged
passing case needs repeating solely for the parent scheduler, account layout,
or other updates. A future fixture captures the then-current migration
registry; it cannot reproduce the missing original snapshot by implication.

Before cleanup, the retained records were two inactive controller units and
two failed execution units, all with `MainPID=0` and empty `ControlGroup`.
The failed execution records were metadata, not observed surviving workloads.
The exact four-unit `systemctl --user reset-failed` succeeded. Fresh inspection
then reported all four `LoadState=not-found`, `ActiveState=inactive`,
`MainPID=0`, and empty cgroup fields:

* `quire-integration4d167f0f78a1-controller.service`
* `quire-integration4d167f0f78a1-exec-d5e74b38-ac02-498b-9c22-53bfa27b9aba.service`
* `quire-integrationcdf5f6414cb4-controller.service`
* `quire-integrationcdf5f6414cb4-exec-fe20c150-0431-49eb-b78f-e4916ad9bf80.service`

Their exact cgroup directories and the `Ghk10m` / `O9dnbj` private fixture
roots are absent. No units remain listed for either installation; no
installation-labelled containers/images, fixture-prefixed PostgreSQL/Redis/S3
containers, named S3 volumes, or owner-labelled service containers are listed
against live Docker 29.8.2. The audit completed with
`EXACT_SETTLED_METADATA_CLEANUP_OK` and a separate `AUDIT_EXIT_CODE=0`.
The corrected-scale original service-resource manifest is not retained; the
current prefix and owner-label checks are observations, not a reconstructed
historical manifest. Absent roots and rollback-generation records prove
neither a test PASS nor complete SQL/blob/Git restoration.

The remaining runtime gaps are all-role native/scale completion, actual
post-promotion execution, environment-build and derived-image caller adoption,
the full restored SQL/blob/Git comparison at a real prepared-health gate, and
retained floor/receipt guarantees beyond the first-update fixtures. General
custom-environment worker adoption is not accepted by the pinned-environment
fixture. Installed Pandoc remains explicitly unsupported. Final settled
owned checks and parent-coordinated bundle/global-build regeneration are also
pending. The overall handoff therefore remains **IN PROGRESS, not FINAL**.

## Finished independent boundary

`ApplicationOptions.updates` accepts the existing `UpdateApiOptions`.
`createApplication` supplies the same client to the existing update and tasks
registrations. It does not add another endpoint registration, construct an
`UpdateService`, or start an update scheduler in the API.

`services/operations/tasks/{store,readers}.ts` separate application SQL reads
from authoritative control reads. The existing public endpoints retain
ascending ID ordering, exclusive cursors, actor ownership and current operator
authorization. The bridge consumes the parent-verified additive
`UpdateOperationQuery.order: "asc"` and fetches at most 101 control rows in two
bounded queries for the largest public page. It preserves stored result bytes
as parsed operation results, marks installation receipts operator-only without
rewriting those results, and rejects duplicate IDs across authorities rather
than choosing one silently. There is no application update-receipt mirror.

The independent finished checks passed on project-local Bun 1.4.4:

* Six existing/new real HTTP reader tests, 33 expectations, zero failures.
* One additional real `createApplication`/signed-client composition HTTP test,
  five expectations, zero failures.
* Scoped strict TypeScript and type-aware deny-warning lint, exit 0.
* The actual production API Bun build, 646 modules and a 3.37 MB entrypoint,
  exit 0; no shared `dist` output was changed.

These were two disjoint finished test runs. The composition test's actual
loopback peer authenticates HMAC envelopes and implements receipt reads only;
it rejects other commands and supplies no supervisor or installation authority.
It is not configured update acceptance. Initial diagnostic/correction history
and finished command output are retained in
`docs/evidence/p7-installation-integration/reader-checks.txt`.

## Pending integration requirements

The original supervisor task delivered no implementation. Its recovery owner's
FINAL now supplies concrete authority, storage and IPC. Integration has added
the actual stable controller/launcher/operator CLI at
`apps/server/src/installation-main.ts`, controller/client/launch/binding helpers,
and a release-owned `installation-role.ts` factory for API, PostgreSQL
repository, SSH, worker-controller and worker lifecycles.

Direct API, repository, migration, worker-controller, worker and SSH storage
entrypoints now reject installed markers before storage construction. Three
new focused real-process cases passed, 20 expectations, with scoped strict
types and deny-warning lint. They cover ambient data/key/DSN override attempts,
release ancestry, explicit uncontrolled development and direct factory-call
denial. These are entrypoint-boundary tests, not configured update acceptance.

The production-controller/two-API native startup proof passed one case,
16 expectations, and its four exact units/private root were independently
checked absent. Its raw protocols are in `runtime-checks.txt`.
The parent FINAL `p7-package-root-metadata.md` resolves the required metadata
parser seam. The actual signed native success/migration-failure fresh rollback
run finished: **2 passed, 0 failed, 23 expectations, 196.98 seconds, exit 0**.
Both cases run the production controller, two actual API slots and real
archive/preflight/migration/restore helpers. Their eight exact units are
independently unloaded, both roots are absent, and their fingerprint snapshot
rechecks clean. Raw protocols and exact scope are in `signed-native-checks.txt`.
Complete signed/crash/scale proof still requires the cross-owner seams in
`docs/evidence/p7-installation-integration/driver-extension-request.md`,
including tracked execution authority, a scale-local writable runtime root and a
reported completed candidate-health failure contract.

The independent supervisor gate
`p7-supervisor-recovery-verification.md` was read in full. Its unchanged
7/83 authority/storage results stand; integration does not repeat them or
turn them into all-role configured acceptance. The new execution delivery is
expected at `p9-supervisor-execution.md`. Direct messaging to both the task handle
and parent-supplied owner UUID returned not_found, including daemon-wide scope;
the parent is relaying the explicit API draft request before caller adaptation.

The full EARLY execution contract/model and subsequently published concrete
client/runner/broker were read. Settled typed compile/probe/SyncTeX/PDF validation
and environment-build paths now use the owned client; generic installed
environment commands have no direct-launch fallback. Worker bookkeeping uses
actual PID/start/exit/stop/release rather than a fake Bun child, retains nullable
exit codes, and distinguishes observed requested stop from unknown failure.
The stable launcher dispatches actual task permits, and the signed release
exports the real worker factory using readonly bound SQL environment manifests
and the existing remote worker lifecycle. Caller adapters use the separate
`caller-execution*` filenames; no driver-owned execution source was edited.

Two additional direct-factory/nested-generation admission cases passed,
four expectations, with selected type-aware lint exit 0. These are boundary
checks only. Their output and the scoped type/LSP history are in
`early-caller-checks.txt`. Configured execution tests wait for the P9 FINAL.

The parent FINAL compiler deferred-dispatch and updater prepared-health
admission seams were read without rerunning their accepted tests. Remaining
recipe disagreements are concrete and documented in `execution-consumers.md`:
the complete native metadata/PDF identity recipe, PDF render/comparison output,
and controller-attested selection of a newly built image for its real probes.
No base-image probe is substituted for that last requirement.

The complete production subprocess inventory is now
`docs/evidence/p7-installation-integration/spawn-families.md`. It covers compiler
sandbox children, actual managed-worker factories, environment helpers and
Docker objects, plus inherited Git/SSH/lock/version children. The current
passing two-API fixtures declare no execution profiles; they are not execution
adoption evidence. The ledger names the concrete declarations required for the
remaining all-role fixture and separates post-promotion and failed/stopped
generation proof obligations.

The wider inventory found an additional direct compiler stale-job manager call
and the Pandoc converter's independent Docker family. Installed stale-job startup
now relies on real supervisor descendant reconciliation instead of signaling a
guessed external compile unit. Pandoc has no accepted fixed recipe: installed
capability is explicitly unconfigured, and generic conversion execution rejects
before spawn. This unsupported family was reported to the parent before FINAL;
no generic Docker forwarding was added. Scoped integration TypeScript and
type-aware deny-warning lint for these new guard sources passed exit 0 under
`mon_DGTE94F8FDHVP31T`. Their real configured admission behavior remains to be
covered with all-role adoption.

The actual `p9-supervisor-execution.md` FINAL and its evidence JSON have now
been read in full. Its final delta records 8 cases, 68 assertions, 119.05
seconds, exit 0, plus the separately affected regression cases and exact
cleanup. These producer results are not configured integration acceptance.
The settled broker resolves a derived immutable image through its own
successful build ledger and current signed inherited profile; the caller now
sends the exact image ID as `profileId` for its real post-build probes.
The complete native metadata and PDF-diff recipe gaps remain explicit.
The new configured listener-collision rollback passed with actual
`EADDRINUSE`, live source migration, distinct fresh rollback and replacement
API invocations. Its companion crash test timed out at an incorrect
namespace-local/host PID comparison in the test barrier. That barrier now
verifies the actual kernel peer's cgroup and unit invocation; only the failed
crash case was rerun under `mon_YD8HYJQXRKVY0JWQ` and passed 1 case,
19 expectations, 103.93 seconds, exit 0. The actual production status CLI
exposed the interrupted durable operation, wrong-ID recovery stayed denied,
and exact recovery restored a fresh prior-release generation before actual
role activation. Scoped types and fixture lint in the same command passed.
The original joined run was 1 pass/1 fail, 16 expectations, exit 1; it is not
reported green. Settled scoped types/caller lint exited 0.
The eight original exact units/cgroups and two roots were independently
checked absent, exit 0. Scope, raw report location and correction history are
in `prepared-configured-checks.txt`. No earlier passed case is being repeated.

Two further configured proofs were authored while P9 was unsettled and have
now run as described above. `prepared-health-failure.test.ts` signs a real simultaneous API
listener collision: sequential preflight can pass, then live construction
must fail after migration and restore a fresh prior generation.
`prepared-crash-recovery.test.ts` subscribes a peer-verified actual prepared
health boundary, kills the controller, checks restarted closure and absent role
cgroups, rejects a wrong operator recovery ID, and uses the production
status/recover CLI for exact fresh recovery. Neither test supplies a synthetic
supervisor, stopped callback or migration result. Source diagnostics found one
nullable-ID assertion error, which was corrected. Fresh crash-test diagnostics
and scoped type-aware lint pass. Both cases now have actual passing behavior
evidence in disjoint runs, with the original failed run preserved.
These cases are not evidence of full all-role acceptance.

The production controller now checks the declared driver before its strict
systemd configuration parse, preserving the existing explicit
`UPDATES_DEPLOYMENT_UNSUPPORTED` capability error for Compose/Helm instead of a
generic schema error. Two new production CLI subprocess cases assert rejection
before any control/application storage appears, including ambient DSN/data
overrides. Both files have clean source diagnostics; their isolated behavior
run passed 2 cases, 6 expectations, exit 0. Scoped type-aware deny-warning lint
also passed on the controller and new denial/prepared-health/crash sources.
Raw commands and scope are in `configured-denial-checks.txt`.
This denial is not a scale-update proof.

The parent has now assigned the existing launch seam:
`services/operations/workers/process.ts` directly invokes unrestricted
`systemd-run --user` for `quire-worker-<uuid>.service`, then `systemctl stop`.
Installed-mode launch/stop must consume the real scoped supervisor execution
protocol. Entry-point validation alone does not establish complete child/unit
inventory. The parent also authorized necessary environment/compiler execution
integration; any concrete driver extension remains coordinated with its owner.

The actual SSH CLI is `scripts/ops/ssh.ts`; `scripts/ops/ssh-server.ts` does not
exist. It must be guarded before `createSshRuntime`, not replaced by a guessed
duplicate entrypoint. The complete entrypoint/storage-boundary inventory is
`docs/evidence/p7-installation-integration/entrypoint-inventory.md`.

Host inspection observed a reachable degraded user manager and a denied direct
user-namespace probe. Those observations neither repair the manager nor prove
unit sandbox capabilities. No configured authority, preparation, crash closure,
signed update/rollback, complete retained inventory or scale restoration claim
is made by the independent reader tests.

## Resources and remaining checks

October 28 all-role work has executed, not merely been planned. The fixture
signs the concrete profiles in `spawn-families.md` and starts actual API2,
SSH, worker-controller and dynamic worker factories. The static Docker
profile-ID correction resolved worker startup: the latest completed native
attempt ran 14 real Docker payloads through actual toolchain probing,
compilation and PDF validation. It then hit the fixture's 120-second update
deadline; teardown interrupted the ongoing update. The all-role receipt and
activation budget is now 300 seconds; prior two-API budgets are unchanged.

The same-host scale fixture is wired and has run actual PostgreSQL/S3/Git/
Redis application roles, including the singleton repository and real managed
worker compilation. Its first update rejected the candidate with
`MIGRATION_DIALECT_MISSING`: the fixture omitted the explicit PostgreSQL
variant for its real added SQL migration. That variant is now supplied.
This failed case is preserved, not relabeled a rollback success.
The native case ran under `mon_7CW8CQQ9E837VVX8`; only the failed scale
case was rerun under `mon_ZMER2TAMSEJ802SZ`. Both processes have settled.
Their missing final receipts and exact metadata cleanup are recorded above;
neither case is newly accepted.

The complete P9 recipe and stop-race FINAL prose/evidence were read.
All six recipe fingerprints matched. The four stop-race fingerprints gated
the joined configured command before its scoped checks and runtime tests.
No accepted driver case was repeated. Caller adoption uses the exact
`pdf-diff-render` / `pdf-diff-compile` schemas and full native metadata recipe.
The full parent `p11-installation-bundles.md` was read: packaging/build/smoke
passes stand scoped, and the final settled release still needs regeneration.

The independent fixtures await listener/application/control-SQL disposal and
remove only their exact private roots. Independent cleanup of the completed
native compiler attempt checked 21 exact units/cgroups, its Docker ownership
scope and root absent. Cleanup of the failed scale attempt checked 22 exact
units/cgroups, 14 execution containers, all three storage-service containers,
the named S3 volume/listener and its root absent against live Docker.
Earlier cleanup and raw failures remain in the evidence directory.
No production data or FastShort PID/port was touched by this lane.

Implementation wiring is closed; four verification tasks remain open.
Remaining acceptance includes completed all-role native/scale rollback,
post-promotion and environment-builder execution, full restored SQL/blob/Git
inventory, retained floor/receipt guarantees beyond first-update fixtures,
final owned checks and settled bundles, and this handoff's FINAL
verdict. `restored-inventory.ts` now provides the complete archive comparison
with explicit dead-owner transformations and actual blob/Git checks; its
source diagnostics/lint pass, but it is not yet wired to the real fresh
prepared-health gate and is not runtime evidence.
Existing foundation, prepared-runtime and frozen benefits evidence is not
rerun or expanded by implication.
