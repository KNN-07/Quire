# P73 configured installation continuation

## Final lead closure

The corrected configured selection is accepted within the native and same-host
scale fixture boundary. Four child cases exited 0: native rollback (35
assertions), native promotion (36), scale rollback (28), and prepared crash
recovery (19). The interrupted restart run was not counted as a pass.

The lead reran only restart authority. It exposed a pre-existing fixture race:
the `systemd-run` process can exit before `--collect` removes its transient
unit definition. Immediate recreation sometimes failed as already loaded;
an unconditional stop sometimes failed because collection had already finished.
Both failed receipts remain in `restart-lead.log` and `restart-final.log`.

The test now subscribes to removal of its exact owned transient definition
before sending SIGKILL, waits for that event and process exit together, then
restarts. No sleeps, retries, assertion removals or production changes were
introduced. `restart-collection.log` records 1 pass, 18 assertions, zero
failures, exit 0, 113.58 seconds. Promoted floor, binding, byte-equivalent
receipt and replay denial survive controller restart.

Changed-file typed lint and scoped installation TypeScript passed.
The fixture emitted cleanup; the lead independently observed all twelve units
from its three attempts as `LoadState=not-found`, `ActiveState=inactive`,
`MainPID=0`, and no process referencing its run root.
Child cleanup is retained in `cleanup-fixed.json`; lead cleanup is retained in
`cleanup-lead.json` under `docs/evidence/p73-installation-continuation/`.
Historical failures and the interrupted run are superseded only by these
specific terminal passes, not erased.

November 6, 2026. Owner: `st_01a1b160`. FINAL continuation report.

## Authorized post-fix verification: FINAL bounded result

The lead accepted the sharing owner's restore correction documented in
`p73-prospective-sharing.md` and authorized the affected configured selection.
The historical failures below are preserved. The sharing owner was asked to
keep `restore-target.ts` frozen; its SHA-256 at launch was
`d7480658e9133e40497ffaeebb1d3eab8cc6c0553f53d3c1d6f4820a211282ea`.
No installation or restore source was changed by this lane.

`mon_238N42EGSA0AA6WR` / `bash_6` started five separate Bun processes with
`--timeout 650000`: native `fresh rollback`, native `signed promotion`, scale,
prepared crash and restart authority. Durable output and per-process exit
receipts were written directly to this handoff's evidence directory as
`native-rollback-fixed`, `native-promotion-fixed`, `scale-fixed`,
`crash-fixed` and `restart-fixed` files. The 35 associated checks were not
repeated, and no test was relaunched after the lead's final instruction.

| Post-fix selection | Terminal result | Assertions | Duration |
| --- | --- | --- | --- |
| Native all-role fresh rollback | `P73_NATIVE_ROLLBACK_FIXED_EXIT=0`, 1 pass / 0 fail | 35 | 339.78 seconds |
| Native all-role signed promotion | `P73_NATIVE_PROMOTION_FIXED_EXIT=0`, 1 pass / 0 fail | 36 | 314.78 seconds |
| Same-host scale rollback | `P73_SCALE_FIXED_EXIT=0`, 1 pass / 0 fail | 28 | 351.36 seconds |
| Prepared controller crash/recovery | `P73_CRASH_FIXED_EXIT=0`, 1 pass / 0 fail | 19 | 102.48 seconds |
| Promoted restart authority | **Missing terminal result; not accepted** | Unreported | Unreported |

Each of the four completed cases has a matching `.log` and `.exit` file.
The first three logs retain the existing teardown-time manager failure
stack from `parentClosed`; this is not relabeled a clean shutdown. Independent
resource inspection below proves actual absence.

The original monitor/terminal became unavailable during the restart case.
Recovery found neither `restart-fixed.exit` nor `postfix-selection.exit`.
The restart log ends at its ownership manifest. A process census found no
`bun test` runner or original command shell, although its systemd controller
and two API roles survived. A direct durable-file watch had also been armed;
it could not manufacture a receipt after the runner disappeared.
No process-exit code or aggregate PASS is invented.

Before cleanup, read-only inspection of the actual control ledger found an
open generation-1 sequence-2/version-2.0.0 committed binding and completed
update receipt. `restart-fixed-interrupted.json` preserves the actual state,
receipts, executions and role ports. That proves reached promotion only;
it does not establish the missing controller-restart/replay assertions or a
completed test. The cause of terminal/runner disappearance is unproven.
The missing terminal result remains the sole unfinished selection evidence.

The lead then explicitly requested cleanup without another test.
`systemctl --user stop quire-integration9dc9a7e26787-controller.service`
exited 0, retained in `restart-owned-stop.exit`. Only that orphaned fixture
was stopped. Its ownership manifest was checked, every recorded unit had
MainPID 0 and empty ControlGroup, and its process census was empty before
removing `/tmp/quire-installation-integration-aNVyyN`. The now-useless child
file watch was stopped; no lead-owned watcher was changed.

`cleanup-fixed.json` independently records all five post-fix roots absent,
all **117** exact recorded units not-found/inactive with MainPID 0 and empty
ControlGroup, all **84** recorded execution-container names and **3** storage
containers absent, and the one exact S3 volume absent. Grouped systemctl,
live Docker container and live volume inspections each exited 0. The four
recorded listener ports (32784, 40849, 44283, 33065) all returned
`ECONNREFUSED`. Unprinted API/SSH ports are not reconstructed.

The restore source hash remained
`d7480658e9133e40497ffaeebb1d3eab8cc6c0553f53d3c1d6f4820a211282ea`
when the existing terminal receipts were recovered. The sharing owner was
notified that this verification freeze can be released. No source file or
test assertion was edited, no associated check was repeated, and no commit
was created. The prior failures below remain intact as historical evidence;
this current result accepts four corrected lifecycle cases, not a complete
five-case aggregate or whole-product gate.

## Preserved pre-fix disposition

**Current configured integration is not green.** The initial native all-role
rollback passed, and associated tests/typecheck passed at their snapshot.
Four initial startup failures identify concurrent migration-input instability.
The sole authorized fresh-process rerun also failed. Its live restart fixture
proves an archived-data restore collision introduced by the concurrent sharing
migration. All owned lifecycle resources were independently checked absent.
Per the lead's instruction, no further lifecycle retry was started.

## Current diagnosis

The original P7 missing-integration report is historical. The current source
already composes the independent controller and real update scheduler in
`services/operations/installation/controller.ts`, dispatches the stable
launcher before application construction in `launch.ts`, and provides actual
API, repository, SSH, worker-controller and worker factories in
`apps/server/src/installation-role.ts`.

The actual dependency chain was read before starting verification:
P7 installation verification, P7 supervisor, P9 supervisor execution, P7
installation integration, P11 installation bundles, P21 activation deadlock,
P22 restored inventory, P23 promotion/environment build, P25 restart authority,
P26 remaining acceptance, P27 custom environment and P37 admission recovery.
P21 corrects the activation admission deadlock. P22 accepts complete restored
SQL/blob/Git inventory before activation. P23 accepts replacement-worker
execution after promotion. P25 accepts durable promoted floor and receipt
across controller restart. P37 accepts explicit signed custom-image admission
and subsequent signed revocation. These are bounded historical receipts,
not new P73 runs.

No missing installation supervisor mechanism was established in this continuation.
Reimplementing the accepted supervisor or weakening fresh-target, signing,
role or invocation checks would not address a demonstrated current defect.

## Actual host prerequisites

The repository-local `./node_modules/.bin/bun --version` returned `1.4.4`.
`systemctl --user is-system-running` reported `degraded`; this is not a
healthy-manager claim. A uniquely owned transient unit executed successfully:

```sh
systemd-run --user --quiet --wait --pipe --collect \
  --unit=quire-p73-st01a1b160-probe /usr/bin/true
```

`docker info --format {{.ServerVersion}}` returned `29.8.2`.
The accepted `quire-p2o-environments:st_01a17c2c` image is present with ID
`sha256:1ffb2fe8f831d4296f2de1c993a491444a9f6706e5498151ff41783468448258`.
`XDG_RUNTIME_DIR` is `/run/user/1000`. Neither `QUIRE_TEST_POSTGRES_URL`
nor `QUIRE_TEST_REDIS_URL` is set. Those variables do not block this configured
scale fixture: `scale-resources.ts` provisions its own isolated PostgreSQL,
Redis and S3 containers and generation stores. No existing database or service
was selected as a substitute.

## Current verification

The configured selection runs the existing native rollback and promotion,
same-host scale rollback, prepared-controller crash recovery and promoted
restart authority scenarios. Independent associated checks cover the ledger,
protocol, concurrency, pagination, import, foundation fences/durability,
direct entrypoints, unsupported deployments, operation readers, client
composition and worker-factory denial. Scoped installation TypeScript runs
after the associated tests.

Initial output was retained at
`/tmp/quire-p73-st01a1b160/{configured,associated,types}.log`.
The configured monitor is `mon_XWS11VAMFMYBZ3HE` / `bash_1`;
the associated/type monitor is `mon_RQ3BKVRGCFSQG6QR` / `bash_2`.
Explicit terminal exit markers distinguish completed checks from intermediate
passing cases. Completed logs and exit receipts are now preserved in
`docs/evidence/p73-installation-continuation/`.

Only this continuation document has been edited. No commit, production
installation, host-policy repair or change to user services/data was made.

### Initial completed results and source-change diagnosis

The associated selection finished **35 passed, 0 failed, 242 assertions** in
59.07 seconds. `P73_ASSOCIATED_EXIT=0` and `P73_TYPES_EXIT=0` were recovered
from the completed monitor; its aggregate exit was 0. The empty `types.log`
is successful compiler silence, not the exit receipt by itself.

The configured aggregate exited **1**, with **1 passed, 4 failed,
35 assertions**, 387.09 seconds. The native all-role rollback passed in
362.11 seconds. Promotion, scale, prepared crash and restart then failed
during initial role startup, before those cases exercised their update paths.
This aggregate is retained as failed.

Actual role journals for `integrationeed4cd4df73d`,
`integration594c4214de77`, `integration5cdc3403e343` and
`integrationd6b36871b207` identify:
`MIGRATION_REQUIRED: 025-k-institution-template-selection`.
The test process imports `applicationMigrations` and composition once, whereas
each `nativeInstallation()` bundles current role source afresh. Concurrent
institution-template edits introduced this migration after the first fixture
started. Later bundles required it while the process's cached inventory still
seeded the earlier schema. The controller's `CONTROL_PREPARED_CHILD_DIED` is
the consequence of that real role schema rejection, not missing systemd
privilege or evidence that the accepted activation deadlock recurred.
No production migration/readiness fence was loosened.

Independent first-run teardown inspection found all five exact roots absent,
all five exact installation unit scopes empty and all five installation-label
container scopes empty. The scale PostgreSQL/Redis names were absent; Docker
explicitly reported the exact S3 container absent. Fixture output also
records S3 volume/listener cleanup. The initial probe unit is
`LoadState=not-found`, inactive, MainPID 0, with empty ControlGroup.

Only the four failed cases were rerun, each in a fresh Bun process, so
their module inventory and newly bundled source start from current inputs.
The already passing native rollback and associated/type selection are not
repeated. New monitor: `mon_T2233STTJJ9YE94T` / `bash_4`. Output paths are
`/tmp/quire-p73-st01a1b160/{promotion,scale,crash,restart}-fresh.log`;
each has a separate explicit `.exit` receipt. This is a changed source-state
assumption, not an unchanged timed retry. Their final results and exact
independent teardown follow below.

The lead subsequently directed this active rerun to finish, with **no further
lifecycle retries while schema/registry producers are editing**. If the active
selection encounters moving inputs again, its exact failure and cleanup will
be the final P73 disposition, and final verification belongs after source
freeze. The initial native rollback and associated/type passes retain their
own snapshot boundaries and are not relabeled as a final frozen-source gate.

## Terminal rerun results and concrete blocker

`mon_T2233STTJJ9YE94T` / `bash_4` terminated with aggregate
`P73_FRESH_RERUN_EXIT=1`. Each separate process exited 1:

| Selection | Actual result | Duration |
| --- | --- | --- |
| Native signed promotion | 0 pass / 1 fail, 12 assertions; durable operation remains running at progress 0.55 with `UPDATE_HELPER_RESULT_UNPROVEN` | 281.08 seconds |
| Same-host scale rollback | 0 pass / 1 fail, 9 assertions; durable operation remains running at progress 0.55 with `UPDATE_HELPER_RESULT_UNPROVEN` | 208.08 seconds |
| Prepared controller crash | 0 pass / 1 fail, 2 assertions; prepared-health boundary times out after the controller reports `UPDATE_HELPER_RESULT_UNPROVEN` | 127.28 seconds |
| Promoted restart authority | 0 pass / 1 fail, 2 assertions; role-activation boundary times out after `UPDATE_HELPER_RESULT_UNPROVEN` | 128.17 seconds |

The raw `{promotion,scale,crash,restart}-fresh.log` files and individual `.exit`
files are retained with `checks.md`. No failed command was relabeled green or
folded into the initial passing snapshot.

Before the last fixture disposed, its control ledger was queried read-only.
It records a successful real backup, then an actually started/exited restore
helper with exact result bytes:

```json
{"code":"SQLITE_CONSTRAINT_PRIMARYKEY","detail":"UNIQUE constraint failed: account_project_sharing.project_id","outcome":"failed"}
```

`live-restore-failure.json` preserves the exact invocation, operation,
generation, timestamps, backup identity and result bytes.
`services/accounts/identity/project-sharing-migration.ts` adds
`account_project_sharing_create AFTER INSERT ON projects`; the trigger inserts
the project's sharing row. The existing full importer at
`services/operations/backups/restore-target.ts:226-235` clears tables, then
inserts archived rows in dependency order. The sharing table depends on
projects, so inserting the archived project fires the trigger before the
archived sharing row is inserted. Its primary key then collides. This
accounts change is outside this lane's permitted edit paths; the diagnosis
was returned to the lead instead of bypassing restore integrity or changing
someone else's migration.

The live receipt directly proves that cause for the native restart fixture.
Promotion/scale/crash ledgers had already been disposed before diagnosis;
their identical public helper-evidence error does not independently prove
their internal restore result. In particular, no PostgreSQL collision receipt
is fabricated.

There is also an error-reporting boundary: preflight invokes a restore helper,
while `UpdateService.perform` validates reported failure purpose against the
outer preflight intent. A restore-purpose failure is rejected as
`UPDATE_HELPER_RESULT_UNPROVEN`, retaining closed authority and obscuring the
underlying error from the public operation. The exact underlying native
failure above was recovered from the controller-only ledger. No updater
error-mapping change was attempted outside the assigned scope.

Final verification requires the sharing owner to resolve archived import
semantics and the lead to freeze schema/registry producers before selecting
the failed lifecycle checks again. Host privileges, Bun, systemd and Docker
were executable; missing PostgreSQL/Redis environment URLs were not this
failure. Existing P21-P37 acceptance remains historical scoped evidence, not
proof that today's concurrently edited tree passes.

## Independent exact cleanup and scope

`cleanup.json` records all nine private roots absent, all **108** recorded
stable/dynamic unit IDs `not-found` and inactive with MainPID 0 and empty
ControlGroup, all **56** recorded execution-container names plus **6** storage
containers absent, and both exact named S3 volumes absent. The live Docker
container/volume listings and grouped systemctl query each exited 0.
All three loopback ports recovered from retained runtime output
(32773, 32777, 40169) rejected TCP connections with `ECONNREFUSED`.
Role API/SSH ports not printed in the retained logs are not invented;
their owning units and cgroups are absent. Fixture output additionally
records its listener shutdown and scale-service cleanup.

No residual owned resource required deletion by the independent audit.
The audit did not remove unrelated containers, volumes, units or services.
No production source, test assertion, migration, account file, shared
contract or dependency was changed by this lane. Only this handoff and its
evidence packet were added. No commit was created. Current acceptance is
left explicitly failed for the lead's source-freeze follow-up.

Both evidence JSON files parsed successfully. Markdown no-index whitespace
checks emitted no diagnostics; their raw exit 1 denotes differences from
`/dev/null`, not a whitespace diagnostic. No whole-product build, fresh
global typecheck, or post-freeze lifecycle pass is claimed.

## Exact matrix corrections proposed to the lead

The matrix's introductory supersessions at lines 24, 26 and 44 already cite
P21-P25/P37 correctly. The following remaining cells still state the old
blanket failure. These are proposed edits, not authorization to broaden
acceptance or alter the row status:

| Current `docs/feature-matrix.md` location | Exact proposed disposition |
| --- | --- |
| Core INSTALL ledger, line 86 | Preserve the P5-only scope, but replace the current blanket configured rejection with “P5 alone does not prove supervision; configured acceptance is separately established by P21-P25/P37 for the tested profiles.” |
| C15, line 178 | Retain deployment provisioning requirements; replace the next action to repeat the configured gate with preserving accepted P21/P23 lifecycle evidence and checking prerequisites for each new deployment. |
| C17, line 180 | Cite P21 stopped rollback, P23 replacement-worker PDF and P37 admitted custom-worker execution; retain selected-host provisioning/isolation limits instead of requesting already accepted integration. |
| Services INSTALL/HOST ledgers, lines 217-218 | Keep P5 and P7 historical receipts labeled, then cite P21/P22 native/scale rollback and inventory, P23 promotion, P25 restart authority and P37 explicit admission/revocation as the current bounded configured result. The P7 FAIL is historical. |
| A56b, line 282 | Preserve backup/export distinctions and absence of RPO/RTO guarantees; replace “close configured rollback” with the P21/P22 accepted installed rollback references. |
| A58a, line 285 | Remove “All-entrypoint adoption ... remain unaccepted” and its repeated integration next action. Cite P21-P25/P37; retain unsupported Compose/Helm signed updates, operator provisioning and distribution limits. |
| A58b, line 286 | Replace missing all-role recovery wording with accepted P21/P22 stopped-cohort native/scale recovery and inventory; retain P65 timer installation as a separate deployment prerequisite. |
| A59a, line 287 | Cite accepted owned execution/worker inventory in P21/P23/P37; retain immutable manifests, selected production topology and security/certification limits. |
| A59b, line 288 | Remove the missing same-host scale rollback action, citing P21/P22. Preserve the independent persistent log rotation/monitoring contract and same-node Helm/RWX/SLA limits. |
| Design INSTALL ledger, line 315 | Replace reader-only/current admission FAIL and pending all-role claims with the historical P7 scope plus the P21-P25/P37 configured supersessions. |
| D22, line 347 | Replace “Configured supervisor/update safety remains pending” with accepted bounded backend lifecycle evidence; full nine-panel mounted browser acceptance remains unproved. |
| D22 Compile workers / Updates, lines 357 and 362 | Preserve missing mounted policy/drain/remove and scheduling-panel consumer evidence; stop describing supervisor adoption and configured all-role runtime acceptance as absent. |
| Q02/Q06, lines 373 and 377 | Replace current HOST FAIL/open recovery wording with the P21/P22/P25 bounded accepted rollback/inventory/restart result. Preserve representation and source-ACK distinctions. |
| Q12/Q13, lines 383-384 | Do not infer installation success from storage foundations; cite the separate P21-P25/P37 evidence explicitly. Preserve multi-host, RWX, platform, dictionary and additional-release limits. |

The P37 known unbuilt/wrong-role generic internal-error mapping remains a
diagnostic-quality limit, not proof of admission bypass. No arbitrary
multi-release rollback history, cluster-wide update driver, online package/font
installation, production ingress or literal-port-5173 acceptance is inferred.
